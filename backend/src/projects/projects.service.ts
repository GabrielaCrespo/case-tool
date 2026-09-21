import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';

/** projects.name está declarado como VARCHAR(150) en PostgreSQL. */
const NAME_MAX_LENGTH = 150;

/** Fila de projects tal como la devuelve el ORM (sin relaciones). */
type ProjectRow = Scalars<Models.public_Projects>;

/** Forma con la que la API responde un proyecto. */
export interface ProjectResponse {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

/** CU03 — Una persona con acceso al proyecto. */
export interface ProjectMemberResponse {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
}

/** Datos aceptados al crear o modificar un proyecto. */
export interface ProjectInput {
  name?: unknown;
  description?: unknown;
}

@Injectable()
export class ProjectsService {
  /**
   * CU01 — Crear proyecto.
   * El propietario nunca llega desde el cuerpo de la petición: es el usuario
   * identificado que recibe el controller.
   */
  async create(ownerId: string, data: ProjectInput): Promise<ProjectResponse> {
    await this.assertUserExists(ownerId);

    const project = await db.orm.public.Projects.create({
      name: this.validateName(data?.name),
      description: this.validateDescription(data?.description),
      ownerId,
    });

    return this.toResponse(project);
  }

  /**
   * CU01 — Proyectos del usuario: los suyos y, desde CU03, aquellos a los que
   * le han invitado. Nunca los de otros usuarios.
   */
  async findAll(userId: string): Promise<ProjectResponse[]> {
    const owned = await db.orm.public.Projects.where({ ownerId: userId })
      .orderBy((project) => project.createdAt.desc())
      .all();

    const memberships = await db.orm.public.ProjectMembers.include('project')
      .where({ userId })
      .all();

    // Un proyecto propio no se repite aunque además figure como miembro.
    const byId = new Map(owned.map((project) => [project.id, project]));
    for (const membership of memberships) {
      if (membership.project && !byId.has(membership.project.id)) {
        byId.set(membership.project.id, membership.project);
      }
    }

    return [...byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((project) => this.toResponse(project));
  }

  /** CU01 — Consultar un proyecto concreto, sólo si el usuario tiene acceso. */
  async findOne(userId: string, id: string): Promise<ProjectResponse> {
    return this.toResponse(await this.findAccessibleProject(userId, id));
  }

  /**
   * CU01 — Modificar un proyecto. Sólo se tocan los campos permitidos.
   * Modificar el proyecto es cosa del propietario: un invitado colabora en los
   * diagramas, pero no renombra ni borra el proyecto ajeno.
   */
  async update(userId: string, id: string, data: ProjectInput): Promise<ProjectResponse> {
    const project = await this.findOwnedProject(userId, id);

    // id, owner_id y created_at no son modificables desde la API.
    const changes: {
      name?: Varchar<typeof NAME_MAX_LENGTH>;
      description?: string | null;
    } = {};
    if (data?.name !== undefined) {
      changes.name = this.validateName(data.name);
    }
    if (data?.description !== undefined) {
      changes.description = this.validateDescription(data.description);
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException(
        'Debe indicar al menos un campo a modificar: name o description.',
      );
    }

    // updated_at lo actualiza el trigger trg_projects_updated_at de PostgreSQL.
    const updated = await db.orm.public.Projects.where({ id: project.id }).update(changes);

    if (!updated) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }

    return this.toResponse(updated);
  }

  /**
   * CU01 — Eliminar un proyecto.
   * Las claves foráneas de la base de datos están declaradas ON DELETE CASCADE
   * (project_members, diagrams y, a través de éstos, las clases, atributos,
   * métodos y relaciones UML), por lo que PostgreSQL elimina los datos
   * dependientes y no quedan registros huérfanos.
   */
  async remove(userId: string, id: string): Promise<void> {
    const project = await this.findOwnedProject(userId, id);

    await db.orm.public.Projects.where({ id: project.id }).delete();
  }

  /**
   * Busca el proyecto y comprueba que el usuario puede verlo: su propietario o
   * alguien a quien haya invitado (project_members, CU03).
   */
  private async findAccessibleProject(userId: string, id: string): Promise<ProjectRow> {
    const project = await db.orm.public.Projects.first({ id });

    if (!project) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }
    if (project.ownerId === userId) {
      return project;
    }

    const member = await db.orm.public.ProjectMembers.select('id')
      .where({ projectId: id, userId })
      .first();

    if (!member) {
      throw new ForbiddenException('No tiene permisos sobre este proyecto.');
    }

    return project;
  }

  /** Operaciones reservadas al propietario: renombrar, borrar e invitar. */
  private async findOwnedProject(userId: string, id: string): Promise<ProjectRow> {
    const project = await db.orm.public.Projects.first({ id });

    if (!project) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('Sólo el propietario del proyecto puede hacer esto.');
    }

    return project;
  }

  // ------------------------------------------------------------------ CU03
  // Invitados del proyecto: es lo que permite que varias personas trabajen
  // sobre el mismo diagrama.

  /** Miembros del proyecto, incluido su propietario. */
  async listMembers(userId: string, projectId: string): Promise<ProjectMemberResponse[]> {
    const project = await this.findAccessibleProject(userId, projectId);

    const owner = await db.orm.public.Users.select('id', 'fullName', 'email').first({
      id: project.ownerId,
    });
    const members = await db.orm.public.ProjectMembers.include('user')
      .where({ projectId })
      .all();

    const rows: ProjectMemberResponse[] = owner
      ? [
          {
            user_id: owner.id,
            full_name: owner.fullName,
            email: owner.email,
            role: 'OWNER',
          },
        ]
      : [];

    for (const member of members) {
      if (!member.user) continue;
      rows.push({
        user_id: member.user.id,
        full_name: member.user.fullName,
        email: member.user.email,
        role: member.role,
      });
    }

    return rows;
  }

  /** Invita por correo a un usuario ya registrado. Sólo el propietario. */
  async addMember(userId: string, projectId: string, data: { email?: unknown }): Promise<ProjectMemberResponse> {
    const project = await this.findOwnedProject(userId, projectId);

    if (typeof data?.email !== 'string' || data.email.trim().length === 0) {
      throw new BadRequestException('Indique el correo de la persona a invitar.');
    }
    const email = data.email.trim().toLowerCase();

    const invited = await db.orm.public.Users.select('id', 'fullName', 'email')
      .where({ email: email as Varchar<150> })
      .first();

    if (!invited) {
      throw new NotFoundException('No hay ninguna cuenta registrada con ese correo.');
    }
    if (invited.id === project.ownerId) {
      throw new ConflictException('El propietario ya tiene acceso al proyecto.');
    }

    const existing = await db.orm.public.ProjectMembers.select('id')
      .where({ projectId, userId: invited.id })
      .first();

    if (existing) {
      throw new ConflictException('Esa persona ya es miembro del proyecto.');
    }

    const member = await db.orm.public.ProjectMembers.create({
      projectId,
      userId: invited.id,
    });

    return {
      user_id: invited.id,
      full_name: invited.fullName,
      email: invited.email,
      role: member.role,
    };
  }

  /** Retira a un invitado. Sólo el propietario. */
  async removeMember(userId: string, projectId: string, memberUserId: string): Promise<void> {
    await this.findOwnedProject(userId, projectId);

    const member = await db.orm.public.ProjectMembers.select('id')
      .where({ projectId, userId: memberUserId })
      .first();

    if (!member) {
      throw new NotFoundException('Esa persona no es miembro del proyecto.');
    }

    await db.orm.public.ProjectMembers.where({ id: member.id }).delete();
  }

  /** El propietario de un proyecto debe ser un usuario existente. */
  private async assertUserExists(userId: string): Promise<void> {
    const user = await db.orm.public.Users.select('id').first({ id: userId });

    if (!user) {
      throw new UnauthorizedException('El usuario indicado no existe.');
    }
  }

  /**
   * El tipo generado para projects.name es Varchar<150>: un string "marcado"
   * que sólo debe construirse tras comprobar la longitud, que es justo lo que
   * hace esta validación.
   */
  private validateName(value: unknown): Varchar<typeof NAME_MAX_LENGTH> {
    if (typeof value !== 'string') {
      throw new BadRequestException('El nombre del proyecto es obligatorio y debe ser un texto.');
    }

    const name = value.trim();
    if (name.length === 0) {
      throw new BadRequestException('El nombre del proyecto no puede estar vacío.');
    }
    if (name.length > NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `El nombre del proyecto no puede superar los ${NAME_MAX_LENGTH} caracteres.`,
      );
    }

    return name as Varchar<typeof NAME_MAX_LENGTH>;
  }

  /** La descripción es opcional; la columna es TEXT, sin longitud máxima. */
  private validateDescription(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException('La descripción debe ser un texto.');
    }

    const description = value.trim();
    return description.length === 0 ? null : description;
  }

  private toResponse(project: ProjectRow): ProjectResponse {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      owner_id: project.ownerId,
      created_at: new Date(project.createdAt).toISOString(),
      updated_at: new Date(project.updatedAt).toISOString(),
    };
  }
}
