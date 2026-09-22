import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';

/**
 * Publicar un backend generado.
 *
 * No es un caso de uso: es el paso que sigue a generarlo (CU07) y a
 * descargarlo (CU08). Generar deja un proyecto Maven en el disco del servidor;
 * publicarlo lo convierte en algo que responde en una URL, que es lo que la
 * aplicación móvil de CU09 necesita para existir.
 *
 * Cómo se hace: el servidor corre en la misma máquina que el demonio de Docker
 * y tiene su socket montado, así que construye una imagen del proyecto
 * generado, crea una base de datos para él y arranca un contenedor con las
 * etiquetas que Traefik lee para darle dominio y certificado. Cada backend
 * responde bajo `/d/<slug>` y lo sabe, porque se le dice con `CONTEXT_PATH`;
 * así las rutas que devuelve son las buenas y el proxy no tiene que reescribir
 * nada.
 *
 * Publicar tarda —Docker compila el proyecto con Maven dentro de la imagen—,
 * de modo que la petición no espera: crea la fila, lanza el proceso y devuelve
 * el despliegue. El cliente pregunta por su estado hasta que llega a RUNNING o
 * a FAILED, igual que hace con la generación.
 */

/** Nombre de la carpeta del proyecto generado, el mismo que usa CU07. */
const PROJECT_NAME = 'backend-generado';

/** Estados en los que el despliegue ya no va a cambiar por sí solo. */
const FINISHED = ['RUNNING', 'FAILED', 'STOPPED'];

/** Los que ocupan memoria en la instancia. */
const ALIVE = ['PENDING', 'BUILDING', 'STARTING', 'RUNNING'];

type DeploymentStatus = 'PENDING' | 'BUILDING' | 'STARTING' | 'RUNNING' | 'FAILED' | 'STOPPED';

/** Cuánto se espera a que el backend publicado conteste. */
const HEALTH_TIMEOUT_MS = 120_000;

/** Construir una imagen descarga dependencias de Maven la primera vez. */
const BUILD_TIMEOUT_MS = 900_000;

export interface DeploymentResponse {
  id: string;
  diagram_id: string;
  status: string;
  slug: string;
  /** La URL pública; sólo cuando el despliegue llegó a responder. */
  api_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deployed_at: string | null;
}

@Injectable()
export class DeploymentsService {
  private readonly logger = new Logger(DeploymentsService.name);

  /** Donde CU07 dejó los proyectos generados, uno por trabajo. */
  private readonly workspace = resolve(
    process.env.GENERATED_DIR ?? join(process.cwd(), 'generated'),
  );

  /** El dominio bajo el que responden los backends publicados. */
  private readonly domain = process.env.DEPLOY_DOMAIN ?? '';

  /** La red de Docker donde está Traefik; la crea deploy/docker-compose.yml. */
  private readonly network = process.env.DEPLOY_NETWORK ?? 'case-tool';

  /**
   * Cómo se llega a PostgreSQL, que son dos cosas distintas y conviene no
   * confundirlas.
   *
   * `dbHost` es el nombre con el que se le habla **por la red de Docker**: es
   * el alias del servicio, y es lo que va en la URL de JDBC que recibe cada
   * backend publicado.
   *
   * `dbContainer` es el nombre del **contenedor**, que es otra cosa: Compose
   * le pone delante el nombre del proyecto, de modo que el servicio `postgres`
   * acaba siendo el contenedor `case-tool-postgres`. Es lo que hace falta para
   * `docker exec`, que no entiende de alias de red.
   */
  private readonly dbHost = process.env.DEPLOY_DB_HOST ?? 'postgres';

  private readonly dbContainer =
    process.env.DEPLOY_DB_CONTAINER ?? 'case-tool-postgres';

  private readonly dbUser = process.env.DEPLOY_DB_USER ?? 'postgres';
  private readonly dbPassword = process.env.DEPLOY_DB_PASSWORD ?? 'postgres';

  /**
   * Cuántos backends pueden estar publicados a la vez. Cada uno ocupa entre 250
   * y 400 MB, y la instancia tiene 4 GB contando con la propia herramienta.
   */
  private readonly maxDeployments = Number(process.env.MAX_DEPLOYMENTS ?? 3);

  constructor(private readonly diagramsService: DiagramsService) {}

  // ------------------------------------------------------------- operaciones

  /**
   * Publica el backend generado de un diagrama.
   *
   * Reemplaza lo que hubiera: un diagrama tiene un despliegue, y volver a
   * publicar es cambiar el contenedor por uno nuevo, no añadir otro.
   */
  async deploy(userId: string, diagramId: string): Promise<DeploymentResponse> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);
    this.assertConfigured();

    const job = await db.orm.public.CodeGenerationJobs.where({ diagramId, status: 'SUCCESS' })
      .orderBy((row) => row.createdAt.desc())
      .first();

    if (!job) {
      throw new BadRequestException(
        'Todavía no hay un backend generado para este diagrama. Genérelo antes de publicarlo.',
      );
    }

    const project = join(this.workspace, job.id, PROJECT_NAME);
    if (!(await this.exists(join(project, 'Dockerfile')))) {
      throw new BadRequestException(
        'El backend generado es anterior a la publicación y no trae Dockerfile. ' +
          'Vuelva a generarlo y publíquelo después.',
      );
    }

    const diagram = await db.orm.public.Diagrams.select('name').first({ id: diagramId });
    const slug = this.slug(diagram?.name ?? PROJECT_NAME);

    await this.assertRoom(diagramId);

    // Una fila por diagrama: si ya hay una, se reutiliza en vez de crear otra,
    // que es lo que impone el UNIQUE de la tabla.
    const existing = await db.orm.public.BackendDeployments.where({ diagramId }).first();

    const deployment = existing
      ? await this.save(existing.id, {
          status: 'PENDING',
          jobId: job.id,
          requestedBy: userId,
          slug: slug as Varchar<100>,
          errorMessage: null,
          apiUrl: null,
          deployedAt: null,
        })
      : await db.orm.public.BackendDeployments.create({
          diagramId,
          jobId: job.id,
          requestedBy: userId,
          status: 'PENDING',
          slug: slug as Varchar<100>,
          apiUrl: null,
          containerName: null,
          databaseName: null,
          imageTag: null,
          errorMessage: null,
          deployedAt: null,
        });

    // Sin await, como la generación: los fallos quedan en la propia fila.
    void this.run(deployment.id, slug, job.id, project);

    return this.toResponse({ ...deployment, status: 'PENDING', slug });
  }

  /** El despliegue actual del diagrama, para consultarlo periódicamente. */
  async find(userId: string, diagramId: string): Promise<DeploymentResponse | null> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const deployment = await db.orm.public.BackendDeployments.where({ diagramId }).first();

    return deployment ? this.toResponse(deployment) : null;
  }

  /** Las últimas líneas del contenedor: es lo que explica un arranque fallido. */
  async logs(userId: string, diagramId: string): Promise<{ lines: string }> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const deployment = await db.orm.public.BackendDeployments.where({ diagramId }).first();

    if (!deployment?.containerName) {
      throw new NotFoundException('Este diagrama no tiene ningún backend publicado.');
    }

    const { output } = await this.docker(
      ['logs', '--tail', '200', deployment.containerName],
      60_000,
      // Un contenedor que ya no existe no es un error que merezca un 500.
      true,
    );
    return { lines: output.trim() };
  }

  /** Da de baja el despliegue: para el contenedor y borra su base de datos. */
  async remove(userId: string, diagramId: string): Promise<DeploymentResponse> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const deployment = await db.orm.public.BackendDeployments.where({ diagramId }).first();

    if (!deployment) {
      throw new NotFoundException('Este diagrama no tiene ningún backend publicado.');
    }

    if (deployment.containerName) {
      await this.removeContainer(deployment.containerName);
    }
    if (deployment.databaseName) {
      await this.dropDatabase(deployment.databaseName);
    }

    const stopped = await this.save(deployment.id, {
      status: 'STOPPED',
      apiUrl: null,
      containerName: null,
      databaseName: null,
      deployedAt: null,
      errorMessage: null,
    });

    return this.toResponse(stopped);
  }

  // ------------------------------------------------------------ la publicación

  /**
   * Publica, paso a paso, dejando el estado escrito antes de cada uno para que
   * quien pregunte vea en qué anda y no sólo si acabó.
   */
  private async run(
    deploymentId: string,
    slug: string,
    jobId: string,
    project: string,
  ): Promise<void> {
    const image = `case-tool/${slug}:${jobId}`;
    const container = `case-backend-${slug}`;
    const database = this.databaseName(slug);
    const url = `https://${this.domain}/d/${slug}`;

    try {
      await this.save(deploymentId, {
        status: 'BUILDING',
        imageTag: image as Varchar<200>,
        containerName: container as Varchar<100>,
        databaseName: database as Varchar<63>,
      });
      await this.docker(['build', '-t', image, project], BUILD_TIMEOUT_MS);

      // La base tiene que existir antes de arrancar: el backend generado crea
      // sus tablas, no su base de datos.
      await this.createDatabase(database);

      await this.save(deploymentId, { status: 'STARTING' });

      // Primero se quita el anterior: dos contenedores con el mismo nombre no
      // pueden convivir, y dos con las mismas etiquetas confundirían a Traefik.
      await this.removeContainer(container);
      await this.docker(['run', '-d', ...this.runArguments(container, slug, database, image)], 120_000);

      const healthy = await this.waitForHealth(`${url}/actuator/health`);
      if (!healthy) {
        throw new Error(
          'El backend arrancó pero no llegó a responder. Revise sus registros con el botón de diagnóstico.',
        );
      }

      await this.save(deploymentId, {
        status: 'RUNNING',
        apiUrl: url as Varchar<500>,
        errorMessage: null,
        deployedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falló la publicación del backend «${slug}»: ${message}`);

      await this.save(deploymentId, {
        status: 'FAILED',
        errorMessage: message,
      }).catch(() => undefined);
    }
  }

  /**
   * Cómo se arranca el contenedor del backend publicado.
   *
   * Las etiquetas son lo que hace que Traefik le dé dominio y certificado sin
   * que nadie toque su configuración: le basta con ver el contenedor. El
   * prefijo no se le quita en el proxy porque la aplicación lo conoce por
   * `CONTEXT_PATH`, y así las rutas que devuelve siguen siendo válidas desde
   * fuera.
   */
  private runArguments(
    container: string,
    slug: string,
    database: string,
    image: string,
  ): string[] {
    return [
      '--name',
      container,
      '--restart',
      'unless-stopped',
      '--network',
      this.network,
      '-e',
      `DB_URL=jdbc:postgresql://${this.dbHost}:5432/${database}`,
      '-e',
      `DB_USER=${this.dbUser}`,
      '-e',
      `DB_PASSWORD=${this.dbPassword}`,
      '-e',
      `CONTEXT_PATH=/d/${slug}`,
      // El editor llama a estos backends desde el navegador, y la aplicación
      // móvil desde fuera del navegador, donde no hay CORS que valga.
      '-e',
      `CORS_ORIGINS=https://${this.domain}`,
      '-l',
      'traefik.enable=true',
      '-l',
      `traefik.http.routers.${slug}.rule=Host(\`${this.domain}\`) && PathPrefix(\`/d/${slug}\`)`,
      '-l',
      `traefik.http.routers.${slug}.entrypoints=websecure`,
      '-l',
      `traefik.http.routers.${slug}.tls.certresolver=le`,
      '-l',
      `traefik.http.services.${slug}.loadbalancer.server.port=8080`,
      image,
    ];
  }

  /** Pregunta por la salud hasta que conteste, o hasta que se acabe el tiempo. */
  private async waitForHealth(url: string): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);

        if (response.ok && (await response.text()).includes('"status":"UP"')) {
          return true;
        }
      } catch {
        // Todavía no contesta nadie ahí; es lo normal mientras arranca.
      }
      await new Promise((wait) => setTimeout(wait, 2000));
    }
    return false;
  }

  // -------------------------------------------------------------- PostgreSQL

  /**
   * Crea la base del despliegue si no la hay.
   *
   * `CREATE DATABASE` no admite IF NOT EXISTS, así que se pregunta antes. Se
   * ejecuta dentro del contenedor de PostgreSQL con `docker exec`, que es la
   * única forma de llegar a él: ese servicio no publica puertos.
   */
  private async createDatabase(database: string): Promise<void> {
    const { output } = await this.psql(
      `SELECT 1 FROM pg_database WHERE datname = '${database}'`,
    );

    if (output.includes('1')) {
      return;
    }
    await this.psql(`CREATE DATABASE "${database}"`);
  }

  /** Al dar de baja, la base se va con el contenedor: no queda nada colgando. */
  private async dropDatabase(database: string): Promise<void> {
    await this.psql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch((error: unknown) => {
      this.logger.warn(
        `No se pudo borrar la base ${database}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private psql(sql: string): Promise<{ output: string }> {
    return this.docker(
      [
        'exec',
        '-e',
        `PGPASSWORD=${this.dbPassword}`,
        this.dbContainer,
        'psql',
        '-U',
        this.dbUser,
        '-d',
        'postgres',
        '-tAc',
        sql,
      ],
      60_000,
    );
  }

  // ------------------------------------------------------------------- Docker

  /** Para y borra un contenedor; que no exista no es un fallo. */
  private async removeContainer(container: string): Promise<void> {
    await this.docker(['rm', '-f', container], 60_000, true);
  }

  /**
   * Ejecuta el cliente de Docker contra el demonio del anfitrión.
   *
   * `tolerant` es para las órdenes que se lanzan por si acaso —borrar un
   * contenedor que quizá no existe—, donde un código de salida distinto de cero
   * es la respuesta y no un error.
   */
  private docker(args: string[], timeoutMs: number, tolerant = false): Promise<{ output: string }> {
    return new Promise((done, fail) => {
      const child = spawn('docker', args, { windowsHide: true });

      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        // Construir una imagen suelta cientos de líneas; interesa el final.
        if (output.length > 8000) {
          output = output.slice(-8000);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);

      const timer = setTimeout(() => {
        child.kill();
        fail(new Error(`docker ${args[0]}: tardó más de ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timer);
        fail(new Error(`docker: no se pudo ejecutar (${error.message}).`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || tolerant) {
          done({ output });
          return;
        }
        fail(new Error(`docker ${args[0]}: terminó con código ${code}.\n${output.trim()}`));
      });
    });
  }

  // -------------------------------------------------------------------- apoyo

  /** Publicar necesita saber bajo qué dominio; sin eso no hay nada que hacer. */
  private assertConfigured(): void {
    if (this.domain) {
      return;
    }
    throw new BadRequestException(
      'Este servidor no está preparado para publicar backends: falta configurar DEPLOY_DOMAIN.',
    );
  }

  /**
   * Que quepa uno más. Se cuentan los de otros diagramas: volver a publicar el
   * mismo no ocupa sitio nuevo, porque reemplaza su propio contenedor.
   */
  private async assertRoom(diagramId: string): Promise<void> {
    const deployments = await db.orm.public.BackendDeployments.select(
      'diagramId',
      'status',
    ).all();

    const others = deployments.filter(
      (row) => row.diagramId !== diagramId && ALIVE.includes(row.status),
    );

    if (others.length < this.maxDeployments) {
      return;
    }
    throw new BadRequestException(
      `Ya hay ${others.length} backends publicados, que es el máximo que admite este servidor. ` +
        'Dé de baja alguno antes de publicar otro.',
    );
  }

  /**
   * «Sistema de Ventas» da «sistema-de-ventas». Es la misma función que usa
   * CU08 para nombrar el .zip: el mismo diagrama se llama igual en la descarga
   * y en la URL.
   */
  private slug(name: string): string {
    const clean = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return clean.length === 0 ? PROJECT_NAME : clean.slice(0, 60);
  }

  /** El nombre de la base: el slug con guiones bajos, que es lo que admite. */
  private databaseName(slug: string): string {
    return `d_${slug.replace(/-/g, '_')}`.slice(0, 63);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async save(
    id: string,
    changes: {
      status?: DeploymentStatus;
      jobId?: string | null;
      requestedBy?: string;
      slug?: Varchar<100>;
      apiUrl?: Varchar<500> | null;
      containerName?: Varchar<100> | null;
      databaseName?: Varchar<63> | null;
      imageTag?: Varchar<200> | null;
      errorMessage?: string | null;
      deployedAt?: string | null;
    },
  ): Promise<DeploymentRow> {
    // updated_at se escribe aquí y no con un disparador, para que el cliente
    // que consulta vea moverse la fecha en cada paso.
    await db.orm.public.BackendDeployments.where({ id }).update({
      ...changes,
      updatedAt: new Date().toISOString(),
    });

    const row = await db.orm.public.BackendDeployments.first({ id });
    if (!row) {
      throw new NotFoundException('El despliegue ya no existe.');
    }
    return row;
  }

  private toResponse(row: {
    id: string;
    diagramId: string;
    status: string;
    slug: string;
    apiUrl: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
    deployedAt: string | null;
  }): DeploymentResponse {
    return {
      id: row.id,
      diagram_id: row.diagramId,
      status: row.status,
      slug: row.slug,
      api_url: row.apiUrl,
      error_message: row.errorMessage,
      created_at: new Date(row.createdAt).toISOString(),
      updated_at: new Date(row.updatedAt).toISOString(),
      deployed_at: row.deployedAt === null ? null : new Date(row.deployedAt).toISOString(),
    };
  }
}

/** Lo que devuelve la tabla, con los campos que aquí se usan. */
interface DeploymentRow {
  id: string;
  diagramId: string;
  status: string;
  slug: string;
  apiUrl: string | null;
  containerName: string | null;
  databaseName: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deployedAt: string | null;
}

export { FINISHED as DEPLOYMENT_FINISHED };
