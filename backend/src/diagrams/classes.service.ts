import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { LockRegistryService } from '../collaboration/lock-registry.service.js';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';
import type {
  AttributeResponse,
  ClassResponse,
  MethodResponse,
  ParameterResponse,
} from './diagrams.service.js';
import { DiagramsService } from './diagrams.service.js';
import { VISIBILITIES, isReturnType } from './uml-catalog.js';
import type { Visibility } from './uml-catalog.js';
import {
  assertDefaultValueMatchesType,
  assertHasChanges,
  assertNotPrimaryKeyName,
  isUniqueViolation,
  optionalDataType,
  optionalSize,
  optionalStereotype,
  optionalVarchar,
  requiredAttributeName,
  requiredBoolean,
  requiredEnum,
  requiredIdentifier,
  requiredInteger,
  requiredNumber,
  requiredVarchar,
} from './validation.js';

const NAME_MAX_LENGTH = 150;
const DATA_TYPE_MAX_LENGTH = 50;
/** El retorno puede ser una clase del diagrama, que admite 150 caracteres. */
const TYPE_MAX_LENGTH = 150;
const DEFAULT_VALUE_MAX_LENGTH = 255;

/** Límites del redimensionado manual de una clase en el lienzo. */
const MIN_CLASS_WIDTH = 160;
const MAX_CLASS_WIDTH = 800;
const MIN_CLASS_HEIGHT = 80;
const MAX_CLASS_HEIGHT = 1200;

type ClassRow = Scalars<Models.public_UmlClasses>;
type AttributeRow = Scalars<Models.public_UmlAttributes>;
type MethodRow = Scalars<Models.public_UmlMethods>;
type ParameterRow = Scalars<Models.public_UmlMethodParameters>;

export interface ClassInput {
  name?: unknown;
  stereotype?: unknown;
  is_abstract?: unknown;
  visibility?: unknown;
  pos_x?: unknown;
  pos_y?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * `name` es opcional al crear: si no llega, el servicio pone el primer nombre
 * libre de la serie. `order_index` sólo se atiende al modificar —al crear, el
 * elemento va siempre al final de su lista, porque es el servidor quien sabe
 * qué hermanos hay realmente y así la numeración no depende de lo que un
 * cliente tuviera en pantalla.
 *
 * No hay ningún campo para la clave primaria: la pone la herramienta en todas
 * las entidades (PRIMARY_KEY en uml-catalog.ts) y ningún atributo puede serla.
 */
export interface AttributeInput {
  name?: unknown;
  data_type?: unknown;
  visibility?: unknown;
  is_nullable?: unknown;
  is_unique?: unknown;
  default_value?: unknown;
  order_index?: unknown;
}

export interface MethodInput {
  name?: unknown;
  return_type?: unknown;
  visibility?: unknown;
  order_index?: unknown;
}

export interface ParameterInput {
  name?: unknown;
  data_type?: unknown;
  order_index?: unknown;
}

/**
 * CU02 — Clases del diagrama y su contenido: atributos, métodos y los
 * parámetros de esos métodos.
 * Los permisos se delegan siempre en DiagramsService, que es el punto único.
 */
@Injectable()
export class ClassesService {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly locks: LockRegistryService,
  ) {}

  // --------------------------------------------------------------- clases

  async createClass(userId: string, diagramId: string, data: ClassInput): Promise<ClassResponse> {
    await this.diagramsService.assertDiagramAccess(userId, diagramId);

    const siblings = await db.orm.public.UmlClasses.select('name').where({ diagramId }).all();

    const create: {
      diagramId: string;
      name: Varchar<typeof NAME_MAX_LENGTH>;
      stereotype: Varchar<50> | null;
      isAbstract?: boolean;
      visibility?: Visibility;
      posX?: number;
      posY?: number;
      width?: number | null;
      height?: number | null;
    } = {
      diagramId,
      // «Entidad1», «Entidad2»...: es lo que el usuario va a reemplazar nada
      // más crearla, escribiendo encima sobre el propio lienzo.
      name: this.nameOrDefault(
        data?.name,
        'Entidad',
        siblings.map((sibling) => sibling.name),
      ),
      stereotype: optionalStereotype(data?.stereotype, 'stereotype'),
    };
    // Si no llegan, la base aplica sus valores por defecto (false, public, 0, 0).
    if (data?.is_abstract !== undefined) {
      create.isAbstract = requiredBoolean(data.is_abstract, 'is_abstract');
    }
    if (data?.visibility !== undefined) {
      create.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }
    if (data?.pos_x !== undefined) {
      create.posX = requiredNumber(data.pos_x, 'pos_x');
    }
    if (data?.pos_y !== undefined) {
      create.posY = requiredNumber(data.pos_y, 'pos_y');
    }
    if (data?.width !== undefined) {
      create.width = optionalSize(data.width, 'width', MIN_CLASS_WIDTH, MAX_CLASS_WIDTH);
    }
    if (data?.height !== undefined) {
      create.height = optionalSize(data.height, 'height', MIN_CLASS_HEIGHT, MAX_CLASS_HEIGHT);
    }

    const umlClass = await this.createUnique(
      () => db.orm.public.UmlClasses.create(create),
      'Ya existe una clase con ese nombre en el diagrama.',
    );

    const response = this.diagramsService.toClassResponse(umlClass);
    this.diagramsService.publish(diagramId, 'class.created', response, userId);

    return response;
  }

  /** Modificar una clase, incluida su posición en el lienzo (mover/organizar). */
  async updateClass(userId: string, classId: string, data: ClassInput): Promise<ClassResponse> {
    const current = await this.findAccessibleClass(userId, classId);
    // CU03 — Nadie escribe sobre una clase que otro tiene tomada.
    this.locks.assertCanEdit('class', classId, userId);

    const changes: {
      name?: Varchar<typeof NAME_MAX_LENGTH>;
      stereotype?: Varchar<50> | null;
      isAbstract?: boolean;
      visibility?: Visibility;
      posX?: number;
      posY?: number;
      width?: number | null;
      height?: number | null;
    } = {};
    if (data?.name !== undefined) {
      changes.name = requiredIdentifier(data.name, 'name', NAME_MAX_LENGTH);
    }
    if (data?.stereotype !== undefined) {
      changes.stereotype = optionalStereotype(data.stereotype, 'stereotype');
    }
    if (data?.is_abstract !== undefined) {
      changes.isAbstract = requiredBoolean(data.is_abstract, 'is_abstract');
    }
    if (data?.visibility !== undefined) {
      changes.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }
    if (data?.pos_x !== undefined) {
      changes.posX = requiredNumber(data.pos_x, 'pos_x');
    }
    if (data?.pos_y !== undefined) {
      changes.posY = requiredNumber(data.pos_y, 'pos_y');
    }
    if (data?.width !== undefined) {
      changes.width = optionalSize(data.width, 'width', MIN_CLASS_WIDTH, MAX_CLASS_WIDTH);
    }
    if (data?.height !== undefined) {
      changes.height = optionalSize(data.height, 'height', MIN_CLASS_HEIGHT, MAX_CLASS_HEIGHT);
    }
    assertHasChanges(changes, [
      'name',
      'stereotype',
      'is_abstract',
      'visibility',
      'pos_x',
      'pos_y',
      'width',
      'height',
    ]);

    const updated = await this.createUnique(
      () => db.orm.public.UmlClasses.where({ id: classId }).update(changes),
      'Ya existe una clase con ese nombre en el diagrama.',
    );

    if (!updated) {
      throw new NotFoundException('La clase indicada no existe.');
    }

    const response = this.diagramsService.toClassResponse(updated);
    this.diagramsService.publish(current.diagramId, 'class.updated', response, userId);

    return response;
  }

  /**
   * Eliminar una clase. Sus atributos y métodos caen por ON DELETE CASCADE —y
   * con los métodos, sus parámetros—, y también las relaciones en las que
   * participa como origen o destino: no quedan referencias huérfanas.
   */
  async removeClass(userId: string, classId: string): Promise<void> {
    const current = await this.findAccessibleClass(userId, classId);
    this.locks.assertCanEdit('class', classId, userId);

    await db.orm.public.UmlClasses.where({ id: classId }).delete();

    // La cascada se lleva sus atributos, métodos y relaciones: el cliente hace
    // lo mismo en su lienzo al recibir el aviso.
    this.diagramsService.publish(
      current.diagramId,
      'class.deleted',
      { id: classId, diagram_id: current.diagramId },
      userId,
    );
  }

  // ------------------------------------------------------------ atributos

  async createAttribute(
    userId: string,
    classId: string,
    data: AttributeInput,
  ): Promise<AttributeResponse> {
    const umlClass = await this.findAccessibleClass(userId, classId);
    // El bloqueo de la clase cubre sus atributos y métodos.
    this.locks.assertCanEdit('class', classId, userId);

    // El tipo es opcional: un atributo puede existir antes de saberse de qué
    // tipo es —así llegan los de una foto de pizarra (CU05)—.
    const dataType = optionalDataType(data?.data_type, 'data_type');
    const defaultValue = optionalVarchar(
      data?.default_value,
      'default_value',
      DEFAULT_VALUE_MAX_LENGTH,
    );
    assertDefaultValueMatchesType(dataType, defaultValue);

    const siblings = await db.orm.public.UmlAttributes.select('name', 'orderIndex')
      .where({ classId })
      .all();

    const name = this.nameOrDefault(
      data?.name,
      'atributo',
      siblings.map((sibling) => sibling.name),
    );
    // La serie «atributo1, atributo2...» nunca choca con la clave primaria;
    // un nombre pedido a mano sí puede.
    assertNotPrimaryKeyName(name);

    const create: {
      classId: string;
      name: Varchar<typeof NAME_MAX_LENGTH>;
      dataType: Varchar<typeof DATA_TYPE_MAX_LENGTH> | null;
      defaultValue: Varchar<typeof DEFAULT_VALUE_MAX_LENGTH> | null;
      visibility?: Visibility;
      isNullable?: boolean;
      isUnique?: boolean;
      orderIndex: number;
    } = {
      classId,
      name,
      dataType,
      defaultValue,
      // Al final de la lista, nunca repitiendo el índice de otro: si se repartiera
      // un índice con un hermano, el orden con el que la API devuelve la lista
      // dejaría de estar determinado.
      orderIndex: this.nextOrderIndex(siblings.map((sibling) => sibling.orderIndex)),
    };
    if (data?.visibility !== undefined) {
      create.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }
    if (data?.is_nullable !== undefined) {
      create.isNullable = requiredBoolean(data.is_nullable, 'is_nullable');
    }
    if (data?.is_unique !== undefined) {
      create.isUnique = requiredBoolean(data.is_unique, 'is_unique');
    }

    const attribute = await this.createUnique(
      () => db.orm.public.UmlAttributes.create(create),
      'Ya existe un atributo con ese nombre en la clase.',
    );

    const response = this.diagramsService.toAttributeResponse(attribute);
    this.diagramsService.publish(umlClass.diagramId, 'attribute.created', response, userId);

    return response;
  }

  async updateAttribute(
    userId: string,
    attributeId: string,
    data: AttributeInput,
  ): Promise<AttributeResponse> {
    const owner = await this.findAccessibleAttribute(userId, attributeId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    const changes: {
      name?: Varchar<typeof NAME_MAX_LENGTH>;
      dataType?: Varchar<typeof DATA_TYPE_MAX_LENGTH> | null;
      defaultValue?: Varchar<typeof DEFAULT_VALUE_MAX_LENGTH> | null;
      visibility?: Visibility;
      isNullable?: boolean;
      isUnique?: boolean;
      orderIndex?: number;
    } = {};
    if (data?.name !== undefined) {
      changes.name = requiredAttributeName(data.name, 'name', NAME_MAX_LENGTH);
    }
    // null quita el tipo, que es lo que hace el selector «sin tipo» del panel.
    if (data?.data_type !== undefined) {
      changes.dataType = optionalDataType(data.data_type, 'data_type');
    }
    if (data?.default_value !== undefined) {
      changes.defaultValue = optionalVarchar(
        data.default_value,
        'default_value',
        DEFAULT_VALUE_MAX_LENGTH,
      );
    }
    if (data?.visibility !== undefined) {
      changes.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }
    if (data?.is_nullable !== undefined) {
      changes.isNullable = requiredBoolean(data.is_nullable, 'is_nullable');
    }
    if (data?.is_unique !== undefined) {
      changes.isUnique = requiredBoolean(data.is_unique, 'is_unique');
    }
    if (data?.order_index !== undefined) {
      changes.orderIndex = requiredInteger(data.order_index, 'order_index');
    }
    assertHasChanges(changes, [
      'name',
      'data_type',
      'visibility',
      'is_nullable',
      'is_unique',
      'default_value',
      'order_index',
    ]);

    // El valor por defecto se comprueba contra el tipo resultante: cambiar sólo
    // el tipo puede invalidar un valor que ya estaba guardado.
    assertDefaultValueMatchesType(
      changes.dataType ?? owner.row.dataType,
      changes.defaultValue !== undefined ? changes.defaultValue : owner.row.defaultValue,
    );

    const updated = await this.createUnique(
      () => db.orm.public.UmlAttributes.where({ id: attributeId }).update(changes),
      'Ya existe un atributo con ese nombre en la clase.',
    );

    if (!updated) {
      throw new NotFoundException('El atributo indicado no existe.');
    }

    const response = this.diagramsService.toAttributeResponse(updated);
    this.diagramsService.publish(owner.diagramId, 'attribute.updated', response, userId);

    return response;
  }

  async removeAttribute(userId: string, attributeId: string): Promise<void> {
    const owner = await this.findAccessibleAttribute(userId, attributeId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    await db.orm.public.UmlAttributes.where({ id: attributeId }).delete();

    this.diagramsService.publish(
      owner.diagramId,
      'attribute.deleted',
      { id: attributeId, class_id: owner.classId },
      userId,
    );

    await this.renumberAttributes(userId, owner.classId, owner.diagramId);
  }

  // -------------------------------------------------------------- métodos

  async createMethod(
    userId: string,
    classId: string,
    data: MethodInput,
  ): Promise<MethodResponse> {
    const umlClass = await this.findAccessibleClass(userId, classId);
    this.locks.assertCanEdit('class', classId, userId);

    const siblings = await db.orm.public.UmlMethods.select('name', 'orderIndex')
      .where({ classId })
      .all();

    const create: {
      classId: string;
      name: Varchar<typeof NAME_MAX_LENGTH>;
      returnType?: Varchar<typeof TYPE_MAX_LENGTH>;
      visibility?: Visibility;
      orderIndex: number;
    } = {
      classId,
      name: this.nameOrDefault(
        data?.name,
        'metodo',
        siblings.map((sibling) => sibling.name),
      ),
      orderIndex: this.nextOrderIndex(siblings.map((sibling) => sibling.orderIndex)),
    };
    // Si no llega return_type, la base aplica 'void'.
    if (data?.return_type !== undefined) {
      create.returnType = await this.requiredType(
        data.return_type,
        'return_type',
        umlClass.diagramId,
        { allowVoid: true },
      );
    }
    if (data?.visibility !== undefined) {
      create.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }

    const method = await db.orm.public.UmlMethods.create(create);

    const response = this.diagramsService.toMethodResponse(method);
    this.diagramsService.publish(umlClass.diagramId, 'method.created', response, userId);

    return response;
  }

  async updateMethod(
    userId: string,
    methodId: string,
    data: MethodInput,
  ): Promise<MethodResponse> {
    const owner = await this.findAccessibleMethod(userId, methodId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    const changes: {
      name?: Varchar<typeof NAME_MAX_LENGTH>;
      returnType?: Varchar<typeof TYPE_MAX_LENGTH>;
      visibility?: Visibility;
      orderIndex?: number;
    } = {};
    if (data?.name !== undefined) {
      changes.name = requiredIdentifier(data.name, 'name', NAME_MAX_LENGTH);
    }
    if (data?.return_type !== undefined) {
      changes.returnType = await this.requiredType(
        data.return_type,
        'return_type',
        owner.diagramId,
        { allowVoid: true },
      );
    }
    if (data?.visibility !== undefined) {
      changes.visibility = requiredEnum(data.visibility, 'visibility', VISIBILITIES);
    }
    if (data?.order_index !== undefined) {
      changes.orderIndex = requiredInteger(data.order_index, 'order_index');
    }
    assertHasChanges(changes, ['name', 'return_type', 'visibility', 'order_index']);

    const updated = await db.orm.public.UmlMethods.where({ id: methodId }).update(changes);

    if (!updated) {
      throw new NotFoundException('El método indicado no existe.');
    }

    const response = this.diagramsService.toMethodResponse(
      updated,
      await this.parametersOf(methodId),
    );
    this.diagramsService.publish(owner.diagramId, 'method.updated', response, userId);

    return response;
  }

  async removeMethod(userId: string, methodId: string): Promise<void> {
    const owner = await this.findAccessibleMethod(userId, methodId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    // Sus parámetros caen por ON DELETE CASCADE.
    await db.orm.public.UmlMethods.where({ id: methodId }).delete();

    this.diagramsService.publish(
      owner.diagramId,
      'method.deleted',
      { id: methodId, class_id: owner.classId },
      userId,
    );

    await this.renumberMethods(userId, owner.classId, owner.diagramId);
  }

  // ----------------------------------------------------------- parámetros

  /**
   * Los parámetros no se difunden por su cuenta: se avisa del método entero,
   * porque lo que el resto de editores tiene que redibujar es la firma
   * completa —«actualizar(nombre : String) : void»—, no una pieza suelta.
   */
  async createParameter(
    userId: string,
    methodId: string,
    data: ParameterInput,
  ): Promise<ParameterResponse> {
    const owner = await this.findAccessibleMethod(userId, methodId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    const siblings = await db.orm.public.UmlMethodParameters.select('name', 'orderIndex')
      .where({ methodId })
      .all();

    const create: {
      methodId: string;
      name: Varchar<typeof NAME_MAX_LENGTH>;
      dataType: Varchar<typeof TYPE_MAX_LENGTH>;
      orderIndex: number;
    } = {
      methodId,
      name: this.nameOrDefault(
        data?.name,
        'parametro',
        siblings.map((sibling) => sibling.name),
      ),
      dataType: await this.requiredType(data?.data_type, 'data_type', owner.diagramId, {
        allowVoid: false,
      }),
      orderIndex: this.nextOrderIndex(siblings.map((sibling) => sibling.orderIndex)),
    };

    const parameter = await this.createUnique(
      () => db.orm.public.UmlMethodParameters.create(create),
      'Ya existe un parámetro con ese nombre en el método.',
    );

    await this.publishMethod(userId, owner);

    return this.diagramsService.toParameterResponse(parameter);
  }

  async updateParameter(
    userId: string,
    parameterId: string,
    data: ParameterInput,
  ): Promise<ParameterResponse> {
    const owner = await this.findAccessibleParameter(userId, parameterId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    const changes: {
      name?: Varchar<typeof NAME_MAX_LENGTH>;
      dataType?: Varchar<typeof TYPE_MAX_LENGTH>;
      orderIndex?: number;
    } = {};
    if (data?.name !== undefined) {
      changes.name = requiredIdentifier(data.name, 'name', NAME_MAX_LENGTH);
    }
    if (data?.data_type !== undefined) {
      changes.dataType = await this.requiredType(
        data.data_type,
        'data_type',
        owner.diagramId,
        { allowVoid: false },
      );
    }
    if (data?.order_index !== undefined) {
      changes.orderIndex = requiredInteger(data.order_index, 'order_index');
    }
    assertHasChanges(changes, ['name', 'data_type', 'order_index']);

    const updated = await this.createUnique(
      () => db.orm.public.UmlMethodParameters.where({ id: parameterId }).update(changes),
      'Ya existe un parámetro con ese nombre en el método.',
    );

    if (!updated) {
      throw new NotFoundException('El parámetro indicado no existe.');
    }

    await this.publishMethod(userId, owner);

    return this.diagramsService.toParameterResponse(updated);
  }

  async removeParameter(userId: string, parameterId: string): Promise<void> {
    const owner = await this.findAccessibleParameter(userId, parameterId);
    this.locks.assertCanEdit('class', owner.classId, userId);

    await db.orm.public.UmlMethodParameters.where({ id: parameterId }).delete();

    await this.renumberParameters(owner.row.id);
    await this.publishMethod(userId, owner);
  }

  // ------------------------------------------------------------- permisos

  /** La clase es accesible si el usuario tiene acceso a su proyecto. */
  async findAccessibleClass(userId: string, classId: string): Promise<ClassRow> {
    const umlClass = await db.orm.public.UmlClasses.include('diagram', (diagram) =>
      diagram.include('project'),
    ).first({ id: classId });

    // El proyecto se alcanza por claves foráneas NOT NULL; si aun así no se
    // puede resolver, no se concede acceso.
    const project = umlClass?.diagram?.project;
    if (!umlClass || !project) {
      throw new NotFoundException('La clase indicada no existe.');
    }
    await this.diagramsService.assertProjectAccess(userId, project);

    return umlClass;
  }

  /**
   * Devuelve además el diagrama al que pertenece: hace falta para saber a qué
   * sala difundir el cambio (CU03) y para comprobar el bloqueo de su clase.
   */
  private async findAccessibleAttribute(
    userId: string,
    attributeId: string,
  ): Promise<{ row: AttributeRow; classId: string; diagramId: string }> {
    const attribute = await db.orm.public.UmlAttributes.include('class', (umlClass) =>
      umlClass.include('diagram', (diagram) => diagram.include('project')),
    ).first({ id: attributeId });

    const parent = attribute?.class;
    const project = parent?.diagram?.project;
    if (!attribute || !parent || !project) {
      throw new NotFoundException('El atributo indicado no existe.');
    }
    await this.diagramsService.assertProjectAccess(userId, project);

    return { row: attribute, classId: parent.id, diagramId: parent.diagramId };
  }

  private async findAccessibleMethod(
    userId: string,
    methodId: string,
  ): Promise<{ row: MethodRow; classId: string; diagramId: string }> {
    const method = await db.orm.public.UmlMethods.include('class', (umlClass) =>
      umlClass.include('diagram', (diagram) => diagram.include('project')),
    ).first({ id: methodId });

    const parent = method?.class;
    const project = parent?.diagram?.project;
    if (!method || !parent || !project) {
      throw new NotFoundException('El método indicado no existe.');
    }
    await this.diagramsService.assertProjectAccess(userId, project);

    return { row: method, classId: parent.id, diagramId: parent.diagramId };
  }

  private async findAccessibleParameter(
    userId: string,
    parameterId: string,
  ): Promise<{ row: MethodRow; classId: string; diagramId: string }> {
    const parameter = await db.orm.public.UmlMethodParameters.select('id', 'methodId').first({
      id: parameterId,
    });

    if (!parameter) {
      throw new NotFoundException('El parámetro indicado no existe.');
    }

    return this.findAccessibleMethod(userId, parameter.methodId);
  }

  // -------------------------------------------------------------- comunes

  private async parametersOf(methodId: string): Promise<ParameterRow[]> {
    return db.orm.public.UmlMethodParameters.where({ methodId })
      .orderBy((parameter) => parameter.orderIndex.asc())
      .all();
  }

  /**
   * Nombre que se guarda: el que pida quien crea el elemento o, si no pide
   * ninguno, el primero libre de la forma «prefijo1», «prefijo2»...
   *
   * Se busca siempre desde 1 para que la numeración quede consecutiva también
   * después de borrar: si se borró «atributo2», el siguiente ocupa ese hueco en
   * lugar de saltar a un número mayor. Y se resuelve aquí, no en el cliente,
   * porque el cliente sólo conoce lo que tiene en pantalla: dos altas seguidas
   * antes de que la primera responda —o dos personas creando a la vez— elegirían
   * el mismo número, y el UNIQUE de la base tumbaría la segunda, que es
   * exactamente el hueco que el usuario ve en la numeración.
   */
  private nameOrDefault(
    requested: unknown,
    prefix: string,
    takenNames: readonly string[],
  ): Varchar<typeof NAME_MAX_LENGTH> {
    if (requested !== undefined && requested !== null && requested !== '') {
      return requiredIdentifier(requested, 'name', NAME_MAX_LENGTH);
    }

    const taken = new Set(takenNames);
    let index = 1;
    while (taken.has(`${prefix}${index}`)) index += 1;

    return requiredIdentifier(`${prefix}${index}`, 'name', NAME_MAX_LENGTH);
  }

  /**
   * Posición al final de la lista. Se toma el máximo y no la cantidad de
   * elementos: con la cantidad, el alta siguiente a un borrado intermedio
   * comparte índice con el último, y entonces el orden en que la API devuelve
   * la lista deja de estar determinado.
   */
  private nextOrderIndex(indexes: number[]): number {
    return indexes.length === 0 ? 0 : Math.max(...indexes) + 1;
  }

  /**
   * Deja order_index en 0, 1, 2... después de borrar un elemento de la lista.
   * Sin esto quedan huecos que se arrastran en PostgreSQL, y el modelo que lee
   * CU07 dependería de un orden que ya no es el que el usuario ve.
   */
  private async renumberAttributes(
    userId: string,
    classId: string,
    diagramId: string,
  ): Promise<void> {
    const rows = await db.orm.public.UmlAttributes.where({ classId }).all();
    rows.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));

    for (const [index, row] of rows.entries()) {
      if (row.orderIndex === index) continue;

      const updated = await db.orm.public.UmlAttributes.where({ id: row.id }).update({
        orderIndex: index,
      });
      if (updated) {
        this.diagramsService.publish(
          diagramId,
          'attribute.updated',
          this.diagramsService.toAttributeResponse(updated),
          userId,
        );
      }
    }
  }

  private async renumberMethods(
    userId: string,
    classId: string,
    diagramId: string,
  ): Promise<void> {
    const rows = await db.orm.public.UmlMethods.where({ classId }).all();
    rows.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));

    for (const [index, row] of rows.entries()) {
      if (row.orderIndex === index) continue;

      const updated = await db.orm.public.UmlMethods.where({ id: row.id }).update({
        orderIndex: index,
      });
      if (updated) {
        this.diagramsService.publish(
          diagramId,
          'method.updated',
          this.diagramsService.toMethodResponse(updated, await this.parametersOf(updated.id)),
          userId,
        );
      }
    }
  }

  /**
   * Los parámetros no se difunden por su cuenta: quien llama a esto avisa
   * después del método entero, que es lo que el resto tiene que redibujar.
   */
  private async renumberParameters(methodId: string): Promise<void> {
    const rows = await db.orm.public.UmlMethodParameters.where({ methodId }).all();
    rows.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name));

    for (const [index, row] of rows.entries()) {
      if (row.orderIndex === index) continue;

      await db.orm.public.UmlMethodParameters.where({ id: row.id }).update({ orderIndex: index });
    }
  }

  /** Difunde el método entero tras cambiar uno de sus parámetros. */
  private async publishMethod(
    userId: string,
    owner: { row: MethodRow; diagramId: string },
  ): Promise<void> {
    const response = this.diagramsService.toMethodResponse(
      owner.row,
      await this.parametersOf(owner.row.id),
    );

    this.diagramsService.publish(owner.diagramId, 'method.updated', response, userId);
  }

  /**
   * Tipo de un retorno o de un parámetro: uno del catálogo, o el nombre de una
   * clase del mismo diagrama —«Cliente buscarPorId(Long id)»—. Cualquier otro
   * texto se rechaza, porque CU07 no sabría traducirlo a Java.
   */
  private async requiredType(
    value: unknown,
    field: string,
    diagramId: string,
    options: { allowVoid: boolean },
  ): Promise<Varchar<typeof TYPE_MAX_LENGTH>> {
    // «void» se comprueba antes que nada: es un tipo válido en UML y en Java,
    // pero también una palabra reservada, así que no pasaría por la regla de
    // los identificadores.
    const candidate = requiredVarchar(value, field, TYPE_MAX_LENGTH);
    if (candidate === 'void') {
      if (!options.allowVoid) {
        throw new BadRequestException(`El campo ${field} no puede ser void.`);
      }
      return candidate;
    }

    const type = requiredIdentifier(candidate, field, TYPE_MAX_LENGTH);
    if (isReturnType(type)) {
      return type;
    }

    const umlClass = await db.orm.public.UmlClasses.select('id')
      .where({ diagramId, name: type })
      .first();

    if (!umlClass) {
      throw new BadRequestException(
        `El campo ${field} debe ser un tipo del catálogo o una clase del diagrama; «${type}» no es ninguno de los dos.`,
      );
    }

    return type;
  }

  /**
   * Traduce la violación del UNIQUE de la base de datos a un 409 legible.
   * La comprobación previa no basta: dos peticiones simultáneas con el mismo
   * nombre sólo las distingue la restricción de la base.
   */
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
}
