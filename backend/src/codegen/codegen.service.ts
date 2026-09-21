import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { validateDiagram } from '../diagrams/diagram-validator.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';

/**
 * CU07 — Generar Backend y CU08 — Descargar Backend.
 *
 * El backend NestJS no escribe ni una línea de Java: lee el modelo UML de
 * PostgreSQL, lo valida y se lo pasa al generador de `generator/`, que es un
 * programa Java con JavaPoet. Después comprueba que lo generado compile de
 * verdad ejecutando Maven sobre ello, y sólo entonces da el trabajo por bueno.
 *
 * CU08 no vuelve a generar nada: toma el proyecto que dejó CU07, comprueba que
 * siga completo, lo comprime y lo entrega.
 *
 * Generar tarda —Maven compila un proyecto Spring Boot entero—, así que la
 * petición no espera a que termine: crea el trabajo en `code_generation_jobs`,
 * arranca el proceso y devuelve el trabajo. El cliente sigue su estado
 * preguntando por él, que es justo para lo que esa tabla tiene los estados
 * PENDING, GENERATING, COMPILING, SUCCESS y FAILED.
 */

/** Nombre de la carpeta y del .zip, tal como los ve el usuario. */
const PROJECT_NAME = 'backend-generado';

const MODEL_FILE = 'modelo.json';
const REPORT_FILE = 'informe.json';

/** Estados en los que el trabajo ya no va a cambiar por sí solo. */
const FINISHED = ['SUCCESS', 'FAILED'];

/** Lo que el generador Java escribe en `informe.json`. */
interface GenerationReport {
  project_name: string;
  base_package: string;
  classes: number;
  entities: number;
  endpoints: number;
  files: string[];
  notes: string[];
}

export interface CodegenJobResponse {
  id: string;
  diagram_id: string;
  status: string;
  /** null mientras no se haya llegado a compilar. */
  compile_check_passed: boolean | null;
  /** Ruta de descarga del .zip; sólo cuando el trabajo terminó bien. */
  download_url: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  /** Resumen de lo generado, leído del informe que deja el generador. */
  summary: GenerationReport | null;
}

@Injectable()
export class CodegenService {
  private readonly logger = new Logger(CodegenService.name);

  /** Dónde quedan los proyectos generados, uno por trabajo. */
  private readonly workspace = resolve(
    process.env.GENERATED_DIR ?? join(process.cwd(), 'generated'),
  );

  /** El generador compilado. Se construye con `mvn -f generator/pom.xml package`. */
  private readonly jar = resolve(
    process.env.GENERATOR_JAR ?? join(process.cwd(), '..', 'generator', 'target', 'generator.jar'),
  );

  private readonly basePackage = process.env.GENERATED_PACKAGE ?? 'com.casetool.generated';

  /** Compilar con Maven la primera vez descarga medio Spring Boot. */
  private readonly timeout = Number(process.env.GENERATOR_TIMEOUT_MS ?? 600_000);

  constructor(private readonly diagramsService: DiagramsService) {}

  // ------------------------------------------------------------------- CU07

  /**
   * Arranca la generación del backend de un diagrama.
   *
   * Se valida antes de crear nada: el generador da por hecho que el modelo que
   * recibe es correcto, y es aquí —con el validador de CU02, el mismo que ve el
   * usuario en el lienzo— donde se comprueba que lo sea.
   */
  async generate(userId: string, diagramId: string): Promise<CodegenJobResponse> {
    const diagram = await this.diagramsService.findOneFull(userId, diagramId);
    const validation = validateDiagram(diagram);

    if (!validation.ready_for_generation) {
      throw new BadRequestException(
        validation.errors > 0
          ? `El diagrama tiene ${validation.errors} error(es) que impiden generar el backend: ` +
            validation.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join(' ')
          : 'El diagrama está vacío: dibuje al menos una entidad antes de generar el backend.',
      );
    }

    await this.closeStaleJobs(diagramId);

    const job = await db.orm.public.CodeGenerationJobs.create({
      diagramId,
      requestedBy: userId,
      status: 'PENDING',
      outputArtifactUrl: null,
      compileCheckPassed: null,
      errorMessage: null,
      completedAt: null,
    });

    // Sin await: la petición devuelve el trabajo recién creado y el cliente
    // sigue su estado. Los fallos se guardan en la propia fila.
    void this.run(job.id, diagramId, diagram);

    return this.toResponse(job, null);
  }

  /** El último trabajo de generación del diagrama, con su estado actual. */
  async findLatest(userId: string, diagramId: string): Promise<CodegenJobResponse | null> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const job = await db.orm.public.CodeGenerationJobs.where({ diagramId })
      .orderBy((row) => row.createdAt.desc())
      .first();

    if (!job) {
      return null;
    }
    return this.toResponse(job, await this.readReport(job.id));
  }

  /**
   * Genera y compila, actualizando el trabajo en cada paso.
   *
   * Cada etapa deja su estado en la fila antes de empezar, de modo que quien
   * pregunte por el trabajo vea en qué anda y no sólo si acabó.
   */
  private async run(
    jobId: string,
    diagramId: string,
    diagram: FullDiagramResponse,
  ): Promise<void> {
    const directory = join(this.workspace, jobId);
    const project = join(directory, PROJECT_NAME);

    try {
      await this.assertGeneratorBuilt();
      await mkdir(directory, { recursive: true });

      // El generador lee el mismo modelo que devuelve GET /diagrams/:id. No hay
      // un formato intermedio que mantener al día.
      await writeFile(
        join(directory, MODEL_FILE),
        JSON.stringify(
          { base_package: this.basePackage, artifact_id: PROJECT_NAME, diagram },
          null,
          2,
        ),
        'utf8',
      );

      await this.update(jobId, { status: 'GENERATING' });
      await this.execute(
        'java',
        ['-jar', this.jar, join(directory, MODEL_FILE), project, join(directory, REPORT_FILE)],
        directory,
        false,
      );

      // «Un proyecto que compile», no una carpeta de archivos .java: la única
      // forma de saberlo es compilarlo.
      await this.update(jobId, { status: 'COMPILING' });
      await this.execute('mvn', ['-B', '-q', 'compile'], project, true);

      await this.update(jobId, {
        status: 'SUCCESS',
        compileCheckPassed: true,
        outputArtifactUrl: `/diagrams/${diagramId}/backend/download` as Varchar<500>,
        completedAt: new Date().toISOString(),
      });

      await this.removeOlderArtifacts(diagramId, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falló la generación del backend del diagrama ${diagramId}: ${message}`);

      await this.update(jobId, {
        status: 'FAILED',
        // Sólo se sabe que la compilación falló si se llegó a intentarla.
        compileCheckPassed: message.startsWith('mvn') ? false : null,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------- CU08

  /**
   * El proyecto generado, empaquetado y listo para descargar.
   *
   * No genera código: comprueba que el proyecto que dejó CU07 siga completo y
   * lo comprime. El .zip se guarda junto al proyecto, así que descargarlo dos
   * veces no vuelve a comprimir nada.
   */
  async download(userId: string, diagramId: string): Promise<{ fileName: string; path: string }> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const job = await db.orm.public.CodeGenerationJobs.where({ diagramId, status: 'SUCCESS' })
      .orderBy((row) => row.createdAt.desc())
      .first();

    if (!job) {
      throw new BadRequestException(
        'Todavía no hay un backend generado para este diagrama. Genérelo antes de descargarlo.',
      );
    }

    const directory = join(this.workspace, job.id);
    const project = join(directory, PROJECT_NAME);

    await this.verify(project);

    const archive = join(directory, `${PROJECT_NAME}.zip`);
    if (!(await this.exists(archive))) {
      await this.pack(project, archive);
    }

    const diagram = await db.orm.public.Diagrams.select('name').first({ id: diagramId });
    const slug = this.slug(diagram?.name ?? PROJECT_NAME);

    return { fileName: `${slug}-backend.zip`, path: archive };
  }

  /**
   * «Verificar proyecto»: que esté lo que tiene que estar antes de comprimir.
   * El .zip se entrega al usuario; si al proyecto le falta el pom o la
   * configuración, lo que recibe no es un backend ejecutable.
   */
  private async verify(project: string): Promise<void> {
    const required = ['pom.xml', 'README.md', join('src', 'main', 'resources', 'application.properties')];

    for (const file of required) {
      if (!(await this.exists(join(project, file)))) {
        throw new NotFoundException(
          `El backend generado está incompleto (falta ${file}). Vuelva a generarlo.`,
        );
      }
    }
  }

  private async pack(project: string, target: string): Promise<void> {
    await new Promise<void>((done, fail) => {
      const output = createWriteStream(target);
      const archive = new ZipArchive({ zlib: { level: 9 } });

      output.on('close', () => done());
      output.on('error', fail);
      archive.on('error', fail);
      archive.pipe(output);

      // Todo cuelga de una carpeta: al descomprimir no se desparrama. De
      // `target/` no va nada: son los .class que dejó la comprobación de que el
      // proyecto compila, y lo que se entrega es el proyecto, no su compilado.
      archive.directory(project, PROJECT_NAME, (entry) => {
        const path = (entry.name ?? '').replaceAll('\\', '/');

        return path.split('/').includes('target') ? false : entry;
      });
      void archive.finalize();
    });
  }

  // ------------------------------------------------------------------ apoyo

  /**
   * Lanza un proceso y espera a que termine.
   *
   * En Windows Maven es un `.cmd` y hay que pasar por el intérprete de órdenes;
   * `java` es un ejecutable y no lo necesita, lo que además evita tener que
   * entrecomillar las rutas que se le pasan.
   */
  private execute(
    command: string,
    args: string[],
    cwd: string,
    shell: boolean,
  ): Promise<void> {
    return new Promise<void>((done, fail) => {
      const child = spawn(command, args, {
        cwd,
        shell: shell && process.platform === 'win32',
        windowsHide: true,
      });

      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        // Un fallo de Maven puede traer cientos de líneas; interesa el final.
        if (output.length > 8000) {
          output = output.slice(-8000);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);

      const timer = setTimeout(() => {
        child.kill();
        fail(new Error(`${command}: tardó más de ${Math.round(this.timeout / 1000)} s.`));
      }, this.timeout);

      child.on('error', (error) => {
        clearTimeout(timer);
        fail(new Error(`${command}: no se pudo ejecutar (${error.message}).`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          done();
          return;
        }
        fail(new Error(`${command}: terminó con código ${code}.\n${output.trim()}`));
      });
    });
  }

  private async assertGeneratorBuilt(): Promise<void> {
    if (await this.exists(this.jar)) {
      return;
    }
    throw new Error(
      `No se encuentra el generador en ${this.jar}. ` +
        'Compílelo con: mvn -f generator/pom.xml package',
    );
  }

  /**
   * Un trabajo que se quedó a medias —el servidor se reinició mientras Maven
   * compilaba— se cierra como fallido al pedir otra generación, para que el
   * último trabajo del diagrama diga siempre la verdad.
   */
  private async closeStaleJobs(diagramId: string): Promise<void> {
    const pending = await db.orm.public.CodeGenerationJobs.select('id', 'status')
      .where({ diagramId })
      .all();

    for (const job of pending) {
      if (FINISHED.includes(job.status)) {
        continue;
      }
      await this.update(job.id, {
        status: 'FAILED',
        errorMessage: 'La generación quedó interrumpida.',
        completedAt: new Date().toISOString(),
      });
    }
  }

  /** Sólo se conserva el último backend generado de cada diagrama. */
  private async removeOlderArtifacts(diagramId: string, keepJobId: string): Promise<void> {
    const jobs = await db.orm.public.CodeGenerationJobs.select('id').where({ diagramId }).all();

    for (const job of jobs) {
      if (job.id === keepJobId) {
        continue;
      }
      await rm(join(this.workspace, job.id), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async update(
    jobId: string,
    changes: {
      status?: 'PENDING' | 'GENERATING' | 'COMPILING' | 'SUCCESS' | 'FAILED';
      compileCheckPassed?: boolean | null;
      outputArtifactUrl?: Varchar<500> | null;
      errorMessage?: string | null;
      completedAt?: string | null;
    },
  ): Promise<void> {
    await db.orm.public.CodeGenerationJobs.where({ id: jobId }).update(changes);
  }

  private async readReport(jobId: string): Promise<GenerationReport | null> {
    try {
      const raw = await readFile(join(this.workspace, jobId, REPORT_FILE), 'utf8');

      return JSON.parse(raw) as GenerationReport;
    } catch {
      // Todavía no existe, o el trabajo falló antes de escribirlo.
      return null;
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /** «Sistema de Ventas» da «sistema-de-ventas», que es un nombre de archivo. */
  private slug(name: string): string {
    const clean = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return clean.length === 0 ? PROJECT_NAME : clean;
  }

  private toResponse(
    job: {
      id: string;
      diagramId: string;
      status: string;
      compileCheckPassed: boolean | null;
      outputArtifactUrl: string | null;
      errorMessage: string | null;
      createdAt: string;
      completedAt: string | null;
    },
    summary: GenerationReport | null,
  ): CodegenJobResponse {
    return {
      id: job.id,
      diagram_id: job.diagramId,
      status: job.status,
      compile_check_passed: job.compileCheckPassed,
      download_url: job.outputArtifactUrl,
      error_message: job.errorMessage,
      created_at: new Date(job.createdAt).toISOString(),
      completed_at: job.completedAt === null ? null : new Date(job.completedAt).toISOString(),
      summary,
    };
  }
}
