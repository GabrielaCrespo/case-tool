import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { DiagramChangeKind } from '../collaboration/collaboration-events.js';
import { DiagramEventsService } from '../collaboration/diagram-events.service.js';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';
import type { DiagramValidationResponse } from './diagram-validator.js';
import { validateDiagram } from './diagram-validator.js';
import {
  assertHasChanges,
  optionalText,
  requiredVarchar,
} from './validation.js';

/** diagrams.name está declarado como VARCHAR(150). */
const NAME_MAX_LENGTH = 150;

type DiagramRow = Scalars<Models.public_Diagrams>;
type ClassRow = Scalars<Models.public_UmlClasses>;
type AttributeRow = Scalars<Models.public_UmlAttributes>;
type MethodRow = Scalars<Models.public_UmlMethods>;
type ParameterRow = Scalars<Models.public_UmlMethodParameters>;
type RelationshipRow = Scalars<Models.public_UmlRelationships>;

/** El diagrama tal como lo devuelve la API. */
export interface DiagramResponse {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AttributeResponse {
  id: string;
  class_id: string;
  name: string;
  /** null = el atributo existe pero todavía no se sabe de qué tipo es. */
  data_type: string | null;
  visibility: string;
  is_nullable: boolean;
  is_unique: boolean;
  default_value: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** uml_method_parameters no tiene columna updated_at en la base de datos. */
export interface ParameterResponse {
  id: string;
  method_id: string;
  name: string;
  data_type: string;
  order_index: number;
  created_at: string;
}

/** uml_methods no tiene columna updated_at en la base de datos. */
export interface MethodResponse {
  id: string;
  class_id: string;
  name: string;
  return_type: string;
  visibility: string;
  order_index: number;
  created_at: string;
  parameters: ParameterResponse[];
}

export interface ClassResponse {
  id: string;
  diagram_id: string;
  name: string;
  stereotype: string | null;
  is_abstract: boolean;
  visibility: string;
  pos_x: number;
  pos_y: number;
  /** null = tamaño automático según el contenido. */
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipResponse {
  id: string;
  diagram_id: string;
  source_class_id: string;
  target_class_id: string;
  relationship_type: string;
  source_multiplicity: string | null;
  target_multiplicity: string | null;
  name: string | null;
  source_role: string | null;
  target_role: string | null;
  is_navigable_source: boolean;
  is_navigable_target: boolean;
  created_at: string;
  updated_at: string;
}

/** Diagrama completo: lo que necesita el editor para dibujar el lienzo. */
export interface FullDiagramResponse extends DiagramResponse {
  classes: (ClassResponse & {
    attributes: AttributeResponse[];
    methods: MethodResponse[];
  })[];
  relationships: RelationshipResponse[];
}

export interface DiagramInput {
  name?: unknown;
  description?: unknown;
}

@Injectable()
export class DiagramsService {
  private readonly logger = new Logger(DiagramsService.name);

  constructor(private readonly diagramEvents: DiagramEventsService) {}

  /**
   * CU03 — Avisa a la sala del diagrama de un cambio ya guardado.
   * Lo usan también ClassesService y RelationshipsService.
   *
   * Además de difundirlo, lo anota en `diagram_change_log`. Se hace aquí y no
   * en cada servicio porque todos los cambios pasan por este método: es el
   * único sitio donde la bitácora está completa por construcción y no por
   * acordarse de llamarla.
   */
  publish(diagramId: string, kind: DiagramChangeKind, payload: unknown, actorId: string): void {
    this.diagramEvents.emit({ diagram_id: diagramId, kind, payload, actor_id: actorId });

    // Sin await: que la bitácora tarde no puede retrasar la respuesta al que
    // hizo el cambio, y que falle no puede deshacer un cambio ya guardado.
    void this.log(diagramId, kind, payload, actorId);
  }

  /**
   * Anota un cambio en la bitácora.
   *
   * Es auditoría: quién tocó qué y cuándo, con el recurso afectado tal como
   * quedó. No se usa para reconstruir el diagrama —para eso están las tablas
   * del modelo, que son la verdad— sino para poder explicar después cómo llegó
   * a estar como está, que es lo que hace falta cuando varias personas editan
   * a la vez (CU03).
   */
  private async log(
    diagramId: string,
    kind: DiagramChangeKind,
    payload: unknown,
    actorId: string,
  ): Promise<void> {
    // Un diagrama borrado se lleva por delante sus propias anotaciones
    // (ON DELETE CASCADE), así que anotar su borrado no serviría de nada.
    if (kind === 'diagram.deleted') {
      return;
    }

    const [entity, operation] = kind.split('.');

    try {
      await db.orm.public.DiagramChangeLog.create({
        diagramId,
        userId: actorId,
        operationType: operation!.toUpperCase() as Varchar<50>,
        entityType: entity!.toUpperCase() as 'DIAGRAM' | 'CLASS' | 'ATTRIBUTE' | 'METHOD' | 'RELATIONSHIP',
        entityId: this.identifierOf(payload),
        payload: payload as never,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo anotar el cambio ${kind} del diagrama ${diagramId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** El identificador del recurso que cambió, si el payload lo trae. */
  private identifierOf(payload: unknown): string | null {
    if (payload !== null && typeof payload === 'object' && 'id' in payload) {
      const id = (payload as { id: unknown }).id;

      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  /** CU02 — Crear diagrama dentro de un proyecto. */
  async create(userId: string, projectId: string, data: DiagramInput): Promise<DiagramResponse> {
    await this.findAccessibleProject(userId, projectId);

    const diagram = await db.orm.public.Diagrams.create({
      projectId,
      name: requiredVarchar(data?.name, 'name', NAME_MAX_LENGTH),
      description: optionalText(data?.description, 'description'),
      createdBy: userId,
    });

    return this.toDiagramResponse(diagram);
  }

  /** CU02 — Diagramas de un proyecto. */
  async findAllByProject(userId: string, projectId: string): Promise<DiagramResponse[]> {
    await this.findAccessibleProject(userId, projectId);

    const diagrams = await db.orm.public.Diagrams.where({ projectId })
      .orderBy((diagram) => diagram.createdAt.asc())
      .all();

    return diagrams.map((diagram) => this.toDiagramResponse(diagram));
  }

  /**
   * CU02 — Diagrama completo con sus clases (con atributos y métodos) y sus
   * relaciones, en una sola consulta.
   */
  async findOneFull(userId: string, diagramId: string): Promise<FullDiagramResponse> {
    await this.assertDiagramAccess(userId, diagramId);

    const diagram = await db.orm.public.Diagrams.include('umlClasses', (umlClass) =>
      umlClass
        .include('umlAttributes', (attribute) => attribute.orderBy((a) => a.orderIndex.asc()))
        .include('umlMethods', (method) =>
          method
            .include('parameters', (parameter) => parameter.orderBy((p) => p.orderIndex.asc()))
            .orderBy((m) => m.orderIndex.asc()),
        )
        .orderBy((c) => c.createdAt.asc()),
    )
      .include('umlRelationships', (relationship) =>
        relationship.orderBy((r) => r.createdAt.asc()),
      )
      .first({ id: diagramId });

    if (!diagram) {
      throw new NotFoundException('El diagrama indicado no existe.');
    }

    return {
      ...this.toDiagramResponse(diagram),
      classes: diagram.umlClasses.map((umlClass) => ({
        ...this.toClassResponse(umlClass),
        attributes: umlClass.umlAttributes.map((a) => this.toAttributeResponse(a)),
        methods: umlClass.umlMethods.map((m) => this.toMethodResponse(m, m.parameters)),
      })),
      relationships: diagram.umlRelationships.map((r) => this.toRelationshipResponse(r)),
    };
  }

  /**
   * CU02 — Validar el diagrama completo.
   * Se valida siempre sobre lo guardado en PostgreSQL, no sobre lo que el
   * lienzo tenga en pantalla: es el mismo modelo que leerá CU07.
   */
  async validate(userId: string, diagramId: string): Promise<DiagramValidationResponse> {
    return validateDiagram(await this.findOneFull(userId, diagramId));
  }

  /** CU02 — Modificar el nombre o la descripción del diagrama. */
  async update(
    userId: string,
    diagramId: string,
    data: DiagramInput,
  ): Promise<DiagramResponse> {
    await this.assertDiagramAccess(userId, diagramId);

    const changes: { name?: ReturnType<typeof requiredVarchar<150>>; description?: string | null } =
      {};
    if (data?.name !== undefined) {
      changes.name = requiredVarchar(data.name, 'name', NAME_MAX_LENGTH);
    }
    if (data?.description !== undefined) {
      changes.description = optionalText(data.description, 'description');
    }
    assertHasChanges(changes, ['name', 'description']);

    // updated_at lo actualiza el trigger trg_diagrams_updated_at.
    const updated = await db.orm.public.Diagrams.where({ id: diagramId }).update(changes);

    if (!updated) {
      throw new NotFoundException('El diagrama indicado no existe.');
    }

    const response = this.toDiagramResponse(updated);
    this.publish(diagramId, 'diagram.updated', response, userId);

    return response;
  }

  /**
   * CU02 — Eliminar un diagrama.
   * Las claves foráneas son ON DELETE CASCADE, así que PostgreSQL elimina sus
   * clases (con atributos y métodos) y sus relaciones.
   */
  async remove(userId: string, diagramId: string): Promise<void> {
    await this.assertDiagramAccess(userId, diagramId);

    await db.orm.public.Diagrams.where({ id: diagramId }).delete();

    // Quien lo tuviera abierto debe enterarse de que ya no existe.
    this.publish(diagramId, 'diagram.deleted', { id: diagramId }, userId);
  }

  /**
   * Punto único de permisos de CU02: comprueba que el usuario puede trabajar
   * sobre el diagrama y lo devuelve. Lo usan también los servicios de clases y
   * de relaciones. Cuando CU03 incorpore project_members, éste y
   * assertProjectAccess son los únicos sitios a ampliar.
   */
  async assertDiagramAccess(userId: string, diagramId: string): Promise<DiagramRow> {
    const diagram = await db.orm.public.Diagrams.include('project').first({ id: diagramId });

    if (!diagram) {
      throw new NotFoundException('El diagrama indicado no existe.');
    }
    await this.assertProjectAccess(userId, diagram.project);

    return diagram;
  }

  /**
   * Regla de acceso al contenido de un proyecto: su propietario o cualquiera a
   * quien haya invitado como miembro (project_members). La invitación es lo que
   * hace posible que varias personas trabajen sobre el mismo diagrama (CU03).
   */
  async assertProjectAccess(userId: string, project: { id: string; ownerId: string }): Promise<void> {
    if (project.ownerId === userId) {
      return;
    }

    const member = await db.orm.public.ProjectMembers.select('id')
      .where({ projectId: project.id, userId })
      .first();

    if (!member) {
      throw new ForbiddenException('No tiene permisos sobre este proyecto.');
    }
  }

  private async findAccessibleProject(userId: string, projectId: string): Promise<void> {
    const project = await db.orm.public.Projects.select('id', 'ownerId').first({ id: projectId });

    if (!project) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }
    await this.assertProjectAccess(userId, project);
  }

  private toDiagramResponse(diagram: DiagramRow): DiagramResponse {
    return {
      id: diagram.id,
      project_id: diagram.projectId,
      name: diagram.name,
      description: diagram.description,
      created_by: diagram.createdBy,
      created_at: new Date(diagram.createdAt).toISOString(),
      updated_at: new Date(diagram.updatedAt).toISOString(),
    };
  }

  toClassResponse(umlClass: ClassRow): ClassResponse {
    return {
      id: umlClass.id,
      diagram_id: umlClass.diagramId,
      name: umlClass.name,
      stereotype: umlClass.stereotype,
      is_abstract: umlClass.isAbstract,
      visibility: umlClass.visibility,
      pos_x: umlClass.posX,
      pos_y: umlClass.posY,
      width: umlClass.width,
      height: umlClass.height,
      created_at: new Date(umlClass.createdAt).toISOString(),
      updated_at: new Date(umlClass.updatedAt).toISOString(),
    };
  }

  toAttributeResponse(attribute: AttributeRow): AttributeResponse {
    return {
      id: attribute.id,
      class_id: attribute.classId,
      name: attribute.name,
      data_type: attribute.dataType,
      visibility: attribute.visibility,
      is_nullable: attribute.isNullable,
      is_unique: attribute.isUnique,
      default_value: attribute.defaultValue,
      order_index: attribute.orderIndex,
      created_at: new Date(attribute.createdAt).toISOString(),
      updated_at: new Date(attribute.updatedAt).toISOString(),
    };
  }

  /**
   * Los parámetros viajan siempre con su método: un método sin ellos no está
   * completo, y quien recibe el aviso de cambio necesita la firma entera.
   */
  toMethodResponse(method: MethodRow, parameters: ParameterRow[] = []): MethodResponse {
    return {
      id: method.id,
      class_id: method.classId,
      name: method.name,
      return_type: method.returnType,
      visibility: method.visibility,
      order_index: method.orderIndex,
      created_at: new Date(method.createdAt).toISOString(),
      parameters: parameters.map((parameter) => this.toParameterResponse(parameter)),
    };
  }

  toParameterResponse(parameter: ParameterRow): ParameterResponse {
    return {
      id: parameter.id,
      method_id: parameter.methodId,
      name: parameter.name,
      data_type: parameter.dataType,
      order_index: parameter.orderIndex,
      created_at: new Date(parameter.createdAt).toISOString(),
    };
  }

  toRelationshipResponse(relationship: RelationshipRow): RelationshipResponse {
    return {
      id: relationship.id,
      diagram_id: relationship.diagramId,
      source_class_id: relationship.sourceClassId,
      target_class_id: relationship.targetClassId,
      relationship_type: relationship.relationshipType,
      source_multiplicity: relationship.sourceMultiplicity,
      target_multiplicity: relationship.targetMultiplicity,
      name: relationship.name,
      source_role: relationship.sourceRole,
      target_role: relationship.targetRole,
      is_navigable_source: relationship.isNavigableSource,
      is_navigable_target: relationship.isNavigableTarget,
      created_at: new Date(relationship.createdAt).toISOString(),
      updated_at: new Date(relationship.updatedAt).toISOString(),
    };
  }
}
