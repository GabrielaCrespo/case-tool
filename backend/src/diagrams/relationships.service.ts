import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { LockRegistryService } from '../collaboration/lock-registry.service.js';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';
import type {
  AttributeResponse,
  ClassResponse,
  RelationshipResponse,
} from './diagrams.service.js';
import { DiagramsService } from './diagrams.service.js';
import {
  assertHasChanges,
  isUniqueViolation,
  optionalMultiplicity,
  optionalVarchar,
  requiredBoolean,
  requiredEnum,
  requiredIdentifier,
  requiredUuid,
} from './validation.js';

const NAME_MAX_LENGTH = 150;
const ROLE_MAX_LENGTH = 100;

/** Valores del tipo enumerado relationship_type de PostgreSQL. */
export const RELATIONSHIP_TYPES = [
  'ASSOCIATION',
  'AGGREGATION',
  'COMPOSITION',
  'INHERITANCE',
  'REALIZATION',
  'DEPENDENCY',
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

type RelationshipRow = Scalars<Models.public_UmlRelationships>;

/** Separación entre la clase intermedia y las dos clases que une. */
const ASSOCIATION_CLASS_OFFSET_Y = 140;

export interface AssociationClassInput {
  source_class_id?: unknown;
  target_class_id?: unknown;
  name?: unknown;
}

/**
 * Resultado de crear una clase de asociación: la clase intermedia recién
 * nacida, con su clave primaria, y las dos asociaciones 1:* que la unen a las
 * dos clases que el usuario enlazó.
 */
export interface AssociationClassResponse {
  class: ClassResponse & { attributes: AttributeResponse[]; methods: [] };
  relationships: RelationshipResponse[];
}

export interface RelationshipInput {
  source_class_id?: unknown;
  target_class_id?: unknown;
  relationship_type?: unknown;
  source_multiplicity?: unknown;
  target_multiplicity?: unknown;
  name?: unknown;
  source_role?: unknown;
  target_role?: unknown;
  is_navigable_source?: unknown;
  is_navigable_target?: unknown;
}

/** CU02 — Relaciones entre clases, con sus multiplicidades. */
@Injectable()
export class RelationshipsService {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly locks: LockRegistryService,
  ) {}

  async create(
    userId: string,
    diagramId: string,
    data: RelationshipInput,
  ): Promise<RelationshipResponse> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const sourceClassId = requiredUuid(data?.source_class_id, 'source_class_id');
    const targetClassId = requiredUuid(data?.target_class_id, 'target_class_id');
    await this.assertClassInDiagram(sourceClassId, diagramId, 'source_class_id');
    await this.assertClassInDiagram(targetClassId, diagramId, 'target_class_id');

    const create: {
      diagramId: string;
      sourceClassId: string;
      targetClassId: string;
      relationshipType: RelationshipType;
      sourceMultiplicity: Varchar<10> | null;
      targetMultiplicity: Varchar<10> | null;
      name: Varchar<typeof NAME_MAX_LENGTH> | null;
      sourceRole: Varchar<typeof ROLE_MAX_LENGTH> | null;
      targetRole: Varchar<typeof ROLE_MAX_LENGTH> | null;
      isNavigableSource?: boolean;
      isNavigableTarget?: boolean;
    } = {
      diagramId,
      sourceClassId,
      targetClassId,
      relationshipType: requiredEnum(
        data?.relationship_type,
        'relationship_type',
        RELATIONSHIP_TYPES,
      ),
      sourceMultiplicity: optionalMultiplicity(data?.source_multiplicity, 'source_multiplicity'),
      targetMultiplicity: optionalMultiplicity(data?.target_multiplicity, 'target_multiplicity'),
      name: optionalVarchar(data?.name, 'name', NAME_MAX_LENGTH),
      sourceRole: optionalVarchar(data?.source_role, 'source_role', ROLE_MAX_LENGTH),
      targetRole: optionalVarchar(data?.target_role, 'target_role', ROLE_MAX_LENGTH),
    };
    // Si no llegan, la base aplica true en ambos casos.
    if (data?.is_navigable_source !== undefined) {
      create.isNavigableSource = requiredBoolean(data.is_navigable_source, 'is_navigable_source');
    }
    if (data?.is_navigable_target !== undefined) {
      create.isNavigableTarget = requiredBoolean(data.is_navigable_target, 'is_navigable_target');
    }

    const relationship = await db.orm.public.UmlRelationships.create(create);

    const response = this.diagramsService.toRelationshipResponse(relationship);
    this.diagramsService.publish(diagramId, 'relationship.created', response, userId);

    return response;
  }

  async update(
    userId: string,
    relationshipId: string,
    data: RelationshipInput,
  ): Promise<RelationshipResponse> {
    const relationship = await this.findAccessibleRelationship(userId, relationshipId);
    // CU03 — Nadie escribe sobre una relación que otro tiene tomada.
    this.locks.assertCanEdit('relationship', relationshipId, userId);

    const changes: {
      sourceClassId?: string;
      targetClassId?: string;
      relationshipType?: RelationshipType;
      sourceMultiplicity?: Varchar<10> | null;
      targetMultiplicity?: Varchar<10> | null;
      name?: Varchar<typeof NAME_MAX_LENGTH> | null;
      sourceRole?: Varchar<typeof ROLE_MAX_LENGTH> | null;
      targetRole?: Varchar<typeof ROLE_MAX_LENGTH> | null;
      isNavigableSource?: boolean;
      isNavigableTarget?: boolean;
    } = {};

    // Si se cambia un extremo, la clase nueva debe estar en el mismo diagrama.
    if (data?.source_class_id !== undefined) {
      const sourceClassId = requiredUuid(data.source_class_id, 'source_class_id');
      await this.assertClassInDiagram(sourceClassId, relationship.diagramId, 'source_class_id');
      changes.sourceClassId = sourceClassId;
    }
    if (data?.target_class_id !== undefined) {
      const targetClassId = requiredUuid(data.target_class_id, 'target_class_id');
      await this.assertClassInDiagram(targetClassId, relationship.diagramId, 'target_class_id');
      changes.targetClassId = targetClassId;
    }
    if (data?.relationship_type !== undefined) {
      changes.relationshipType = requiredEnum(
        data.relationship_type,
        'relationship_type',
        RELATIONSHIP_TYPES,
      );
    }
    if (data?.source_multiplicity !== undefined) {
      changes.sourceMultiplicity = optionalMultiplicity(
        data.source_multiplicity,
        'source_multiplicity',
      );
    }
    if (data?.target_multiplicity !== undefined) {
      changes.targetMultiplicity = optionalMultiplicity(
        data.target_multiplicity,
        'target_multiplicity',
      );
    }
    if (data?.name !== undefined) {
      changes.name = optionalVarchar(data.name, 'name', NAME_MAX_LENGTH);
    }
    if (data?.source_role !== undefined) {
      changes.sourceRole = optionalVarchar(data.source_role, 'source_role', ROLE_MAX_LENGTH);
    }
    if (data?.target_role !== undefined) {
      changes.targetRole = optionalVarchar(data.target_role, 'target_role', ROLE_MAX_LENGTH);
    }
    if (data?.is_navigable_source !== undefined) {
      changes.isNavigableSource = requiredBoolean(data.is_navigable_source, 'is_navigable_source');
    }
    if (data?.is_navigable_target !== undefined) {
      changes.isNavigableTarget = requiredBoolean(data.is_navigable_target, 'is_navigable_target');
    }
    assertHasChanges(changes, [
      'source_class_id',
      'target_class_id',
      'relationship_type',
      'source_multiplicity',
      'target_multiplicity',
      'name',
      'source_role',
      'target_role',
      'is_navigable_source',
      'is_navigable_target',
    ]);

    const updated = await db.orm.public.UmlRelationships.where({ id: relationshipId }).update(
      changes,
    );

    if (!updated) {
      throw new NotFoundException('La relación indicada no existe.');
    }

    const response = this.diagramsService.toRelationshipResponse(updated);
    this.diagramsService.publish(relationship.diagramId, 'relationship.updated', response, userId);

    return response;
  }

  async remove(userId: string, relationshipId: string): Promise<void> {
    const relationship = await this.findAccessibleRelationship(userId, relationshipId);
    this.locks.assertCanEdit('relationship', relationshipId, userId);

    await db.orm.public.UmlRelationships.where({ id: relationshipId }).delete();

    this.diagramsService.publish(
      relationship.diagramId,
      'relationship.deleted',
      { id: relationshipId, diagram_id: relationship.diagramId },
      userId,
    );
  }

  /**
   * CU02 — Enlazar dos clases con una clase de asociación.
   *
   * Es la forma de modelar un muchos a muchos: «Estudiante» y «Materia» no se
   * unen directamente, sino a través de «EstudianteMateria», con «Estudiante 1
   * : 0..* EstudianteMateria» y «Materia 1 : 0..* EstudianteMateria». La clase
   * intermedia es una entidad más del modelo —con su clave primaria «id», como
   * todas—, así que nace vacía: CU07 leerá las tres y generará las tres tablas.
   * Las dos clases originales no se tocan.
   *
   * Se crea de una vez, con el mismo gesto de tirar una línea de una clase a
   * otra, en lugar de dibujar primero una asociación y arreglarla después: lo
   * que el usuario está diciendo al elegir esta herramienta ya es que la
   * relación necesita una clase propia.
   */
  async createAssociationClass(
    userId: string,
    diagramId: string,
    data: AssociationClassInput,
  ): Promise<AssociationClassResponse> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const sourceClassId = requiredUuid(data?.source_class_id, 'source_class_id');
    const targetClassId = requiredUuid(data?.target_class_id, 'target_class_id');
    await this.assertClassInDiagram(sourceClassId, diagramId, 'source_class_id');
    await this.assertClassInDiagram(targetClassId, diagramId, 'target_class_id');

    const source = await db.orm.public.UmlClasses.first({ id: sourceClassId });
    const target = await db.orm.public.UmlClasses.first({ id: targetClassId });
    if (!source || !target) {
      throw new NotFoundException('Alguna de las clases indicadas ya no existe.');
    }

    const name =
      data?.name === undefined || data.name === null || data.name === ''
        ? await this.freeClassName(diagramId, `${source.name}${target.name}`)
        : requiredIdentifier(data.name, 'name', 150);

    // La clase intermedia se coloca entre las dos, algo más abajo, para que no
    // aparezca encima de ninguna.
    const umlClass = await this.createUnique(
      () =>
        db.orm.public.UmlClasses.create({
          // Sin estereotipo, como cualquier otra entidad del lienzo: en un
          // diagrama de datos una clase ya significa «tabla», así que marcarla
          // «entity» aquí la distinguiría de sus hermanas sin distinguir nada.
          diagramId,
          name,
          posX: Math.round((source.posX + target.posX) / 2),
          posY: Math.round((source.posY + target.posY) / 2) + ASSOCIATION_CLASS_OFFSET_Y,
        }),
      `Ya existe una clase llamada «${name}» en el diagrama.`,
    );

    const classResponse = this.diagramsService.toClassResponse(umlClass);
    this.diagramsService.publish(diagramId, 'class.created', classResponse, userId);

    const created: RelationshipResponse[] = [];
    for (const end of [source, target]) {
      const link = await db.orm.public.UmlRelationships.create({
        diagramId,
        sourceClassId: end.id,
        targetClassId: umlClass.id,
        relationshipType: 'ASSOCIATION',
        sourceMultiplicity: '1' as Varchar<10>,
        targetMultiplicity: '0..*' as Varchar<10>,
        name: null,
        sourceRole: null,
        targetRole: null,
      });

      const linkResponse = this.diagramsService.toRelationshipResponse(link);
      created.push(linkResponse);
      this.diagramsService.publish(diagramId, 'relationship.created', linkResponse, userId);
    }

    return {
      class: { ...classResponse, attributes: [], methods: [] },
      relationships: created,
    };
  }

  /** «EstudianteMateria», «EstudianteMateria2»... el primero que esté libre. */
  private async freeClassName(
    diagramId: string,
    preferred: string,
  ): Promise<Varchar<150>> {
    const existing = await db.orm.public.UmlClasses.select('name').where({ diagramId }).all();
    const taken = new Set<string>(existing.map((umlClass) => umlClass.name));

    let candidate = preferred;
    let index = 2;
    while (taken.has(candidate)) {
      candidate = `${preferred}${index}`;
      index += 1;
    }

    return requiredIdentifier(candidate, 'name', 150);
  }

  private async createUnique<T>(operation: () => Promise<T>, message: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(message);
      }
      throw error;
    }
  }

  /**
   * La clave foránea sólo garantiza que la clase exista, no que pertenezca a
   * este diagrama: sin esta comprobación se podría crear una relación entre
   * clases de diagramas distintos.
   */
  private async assertClassInDiagram(
    classId: string,
    diagramId: string,
    field: string,
  ): Promise<void> {
    const umlClass = await db.orm.public.UmlClasses.select('id', 'diagramId').first({
      id: classId,
    });

    if (!umlClass) {
      throw new BadRequestException(`La clase indicada en ${field} no existe.`);
    }
    if (umlClass.diagramId !== diagramId) {
      throw new BadRequestException(
        `La clase indicada en ${field} pertenece a otro diagrama.`,
      );
    }
  }

  private async findAccessibleRelationship(
    userId: string,
    relationshipId: string,
  ): Promise<RelationshipRow> {
    const relationship = await db.orm.public.UmlRelationships.include('diagram', (diagram) =>
      diagram.include('project'),
    ).first({ id: relationshipId });

    const project = relationship?.diagram?.project;
    if (!relationship || !project) {
      throw new NotFoundException('La relación indicada no existe.');
    }
    await this.diagramsService.assertProjectAccess(userId, project);

    return relationship;
  }
}
