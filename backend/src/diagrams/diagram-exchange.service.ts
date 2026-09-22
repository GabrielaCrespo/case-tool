import { BadRequestException, Injectable } from '@nestjs/common';
import { ClassesService } from './classes.service.js';
import type { FullDiagramResponse } from './diagrams.service.js';
import { DiagramsService } from './diagrams.service.js';
import { RelationshipsService } from './relationships.service.js';
import { isPrimaryKeyName } from './uml-catalog.js';

/**
 * Importar y exportar un diagrama como archivo.
 *
 * No tiene nada que ver con CU05. Allí se mira una foto y una IA adivina qué
 * hay dibujado; aquí se lee un archivo que escribió esta misma herramienta, y
 * por tanto no hay nada que adivinar: el archivo dice exactamente qué clases,
 * atributos y relaciones había, y la importación los vuelve a crear. Aquí no
 * interviene ningún modelo de IA.
 *
 * El formato conserva todo lo que hace falta para reconstruir el diagrama tal
 * como estaba, incluidos los atributos que todavía no tienen tipo: exportar e
 * importar no puede rellenar huecos, porque entonces el archivo dejaría de
 * describir el diagrama del que salió.
 *
 * Al importar se crea siempre un diagrama nuevo. Nunca se sobrescribe uno
 * existente: un archivo abierto por equivocación no puede borrar el trabajo de
 * nadie.
 */

/** Marca del formato; permite rechazar un JSON cualquiera. */
const FORMAT = 'CASE-TOOL';

/**
 * Versión del formato. Se guarda para que un archivo antiguo pueda leerse
 * cuando el formato cambie; hoy sólo existe la primera.
 */
const VERSION = '1.0';

const SUPPORTED_VERSIONS = [VERSION];

export interface ExchangeAttribute {
  id: string;
  name: string;
  /** null = el atributo existe pero no se sabe de qué tipo es. */
  type: string | null;
  visibility: string;
  is_nullable: boolean;
  is_unique: boolean;
  default_value: string | null;
  order_index: number;
}

export interface ExchangeParameter {
  name: string;
  type: string;
  order_index: number;
}

export interface ExchangeMethod {
  id: string;
  name: string;
  return_type: string;
  visibility: string;
  order_index: number;
  parameters: ExchangeParameter[];
}

export interface ExchangeNode {
  id: string;
  type: 'class';
  position: { x: number; y: number };
  /** null = tamaño automático, igual que en el lienzo. */
  size: { width: number; height: number } | null;
  data: {
    name: string;
    stereotype: string | null;
    is_abstract: boolean;
    visibility: string;
    attributes: ExchangeAttribute[];
    methods: ExchangeMethod[];
  };
}

export interface ExchangeEdge {
  id: string;
  source: string;
  target: string;
  /** El tipo de relación en minúsculas: association, inheritance… */
  type: string;
  data: {
    sourceMultiplicity: string | null;
    targetMultiplicity: string | null;
    name: string | null;
    sourceRole: string | null;
    targetRole: string | null;
    isNavigableSource: boolean;
    isNavigableTarget: boolean;
  };
}

export interface ExchangeDocument {
  format: typeof FORMAT;
  version: string;
  diagram: { name: string; description: string | null };
  nodes: ExchangeNode[];
  edges: ExchangeEdge[];
}

@Injectable()
export class DiagramExchangeService {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly classesService: ClassesService,
    private readonly relationshipsService: RelationshipsService,
  ) {}

  /**
   * El diagrama guardado, tal cual, en el formato de intercambio.
   * Se lee del modelo de PostgreSQL —el mismo que pinta el lienzo—, así que no
   * hay ningún estado intermedio que pueda quedarse atrás.
   */
  async export(userId: string, diagramId: string): Promise<ExchangeDocument> {
    const diagram = await this.diagramsService.findOneFull(userId, diagramId);

    return {
      format: FORMAT,
      version: VERSION,
      diagram: { name: diagram.name, description: diagram.description },
      nodes: diagram.classes.map((umlClass) => ({
        id: umlClass.id,
        type: 'class',
        position: { x: umlClass.pos_x, y: umlClass.pos_y },
        size:
          umlClass.width === null || umlClass.height === null
            ? null
            : { width: umlClass.width, height: umlClass.height },
        data: {
          name: umlClass.name,
          stereotype: umlClass.stereotype,
          is_abstract: umlClass.is_abstract,
          visibility: umlClass.visibility,
          attributes: umlClass.attributes.map((attribute) => ({
            id: attribute.id,
            name: attribute.name,
            type: attribute.data_type,
            visibility: attribute.visibility,
            is_nullable: attribute.is_nullable,
            is_unique: attribute.is_unique,
            default_value: attribute.default_value,
            order_index: attribute.order_index,
          })),
          methods: umlClass.methods.map((method) => ({
            id: method.id,
            name: method.name,
            return_type: method.return_type,
            visibility: method.visibility,
            order_index: method.order_index,
            parameters: method.parameters.map((parameter) => ({
              name: parameter.name,
              type: parameter.data_type,
              order_index: parameter.order_index,
            })),
          })),
        },
      })),
      edges: diagram.relationships.map((relationship) => ({
        id: relationship.id,
        source: relationship.source_class_id,
        target: relationship.target_class_id,
        type: relationship.relationship_type.toLowerCase(),
        data: {
          sourceMultiplicity: relationship.source_multiplicity,
          targetMultiplicity: relationship.target_multiplicity,
          name: relationship.name,
          sourceRole: relationship.source_role,
          targetRole: relationship.target_role,
          isNavigableSource: relationship.is_navigable_source,
          isNavigableTarget: relationship.is_navigable_target,
        },
      })),
    };
  }

  /**
   * Crea un diagrama nuevo a partir de un archivo exportado.
   *
   * Se construye con los mismos servicios que usa el editor, de modo que cada
   * pieza pasa por las validaciones de CU02: un archivo manipulado a mano no
   * puede meter en la base algo que el editor no habría dejado guardar.
   *
   * El orden importa. Primero todas las clases, porque el tipo de retorno de
   * un método puede ser otra clase del diagrama, y las relaciones necesitan
   * las dos que unen; después su contenido; y al final las relaciones.
   */
  async import(
    userId: string,
    projectId: string,
    payload: unknown,
    nameOverride?: unknown,
  ): Promise<FullDiagramResponse> {
    const document = this.parse(payload);

    const name = this.text(nameOverride) ?? document.diagram.name;
    const diagram = await this.diagramsService.create(userId, projectId, {
      name,
      description: document.diagram.description,
    });

    // Del identificador que traía el archivo al de la clase recién creada: es
    // lo que permite reconstruir las relaciones.
    const classIds = new Map<string, string>();

    for (const node of document.nodes) {
      const created = await this.classesService.createClass(userId, diagram.id, {
        name: node.data.name,
        stereotype: node.data.stereotype,
        is_abstract: node.data.is_abstract,
        visibility: node.data.visibility,
        pos_x: node.position.x,
        pos_y: node.position.y,
        ...(node.size === null ? {} : { width: node.size.width, height: node.size.height }),
      });
      classIds.set(node.id, created.id);
    }

    for (const node of document.nodes) {
      const classId = classIds.get(node.id)!;

      for (const attribute of node.data.attributes) {
        // Un archivo escrito antes de que la clave primaria la pusiera la
        // herramienta puede traer un atributo «id»: se descarta, porque la
        // entidad importada ya tiene el suyo y el alta lo rechazaría.
        if (isPrimaryKeyName(attribute.name)) {
          continue;
        }

        await this.classesService.createAttribute(userId, classId, {
          name: attribute.name,
          // Sin tipo se manda null, no se rellena: es justo lo que distingue
          // «no lo sabemos» de «es un String».
          data_type: attribute.type,
          visibility: attribute.visibility,
          is_nullable: attribute.is_nullable,
          is_unique: attribute.is_unique,
          default_value: attribute.default_value,
        });
      }

      for (const method of node.data.methods) {
        const created = await this.classesService.createMethod(userId, classId, {
          name: method.name,
          return_type: method.return_type,
          visibility: method.visibility,
        });

        for (const parameter of method.parameters) {
          await this.classesService.createParameter(userId, created.id, {
            name: parameter.name,
            data_type: parameter.type,
          });
        }
      }
    }

    for (const edge of document.edges) {
      await this.relationshipsService.create(userId, diagram.id, {
        source_class_id: classIds.get(edge.source),
        target_class_id: classIds.get(edge.target),
        relationship_type: edge.type.toUpperCase(),
        source_multiplicity: edge.data.sourceMultiplicity,
        target_multiplicity: edge.data.targetMultiplicity,
        name: edge.data.name,
        source_role: edge.data.sourceRole,
        target_role: edge.data.targetRole,
        is_navigable_source: edge.data.isNavigableSource,
        is_navigable_target: edge.data.isNavigableTarget,
      });
    }

    return this.diagramsService.findOneFull(userId, diagram.id);
  }

  // ------------------------------------------------------------ validación

  /**
   * Comprueba que el JSON sea un archivo de esta herramienta y tenga la forma
   * esperada, antes de crear nada.
   *
   * Se valida entero de una vez porque la importación crea un diagrama: si se
   * descubriera a mitad que el archivo está roto, quedaría un diagrama a
   * medias que el usuario no pidió.
   */
  private parse(payload: unknown): ExchangeDocument {
    const root = this.record(payload, 'El archivo no contiene un objeto JSON.');

    if (root.format !== FORMAT) {
      throw new BadRequestException(
        `El archivo no es un diagrama de esta herramienta (se esperaba format «${FORMAT}»).`,
      );
    }

    const version = this.text(root.version);
    if (version === null || !SUPPORTED_VERSIONS.includes(version)) {
      throw new BadRequestException(
        `La versión del archivo no es compatible. Versiones admitidas: ${SUPPORTED_VERSIONS.join(', ')}.`,
      );
    }

    const diagram = this.record(root.diagram, 'Falta el apartado «diagram» del archivo.');
    const diagramName = this.text(diagram.name);
    if (diagramName === null) {
      throw new BadRequestException('El archivo no dice cómo se llama el diagrama.');
    }

    if (!Array.isArray(root.nodes)) {
      throw new BadRequestException('Falta la lista «nodes» del archivo.');
    }
    if (!Array.isArray(root.edges)) {
      throw new BadRequestException('Falta la lista «edges» del archivo.');
    }

    const nodes = root.nodes.map((node, index) => this.parseNode(node, index));

    // Dos nodos con el mismo identificador harían ambigua cualquier relación
    // que apunte a él.
    const ids = new Set<string>();
    for (const node of nodes) {
      if (ids.has(node.id)) {
        throw new BadRequestException(`Hay dos clases con el identificador «${node.id}».`);
      }
      ids.add(node.id);
    }

    const edges = root.edges.map((edge, index) => this.parseEdge(edge, index, ids));

    return {
      format: FORMAT,
      version,
      diagram: { name: diagramName, description: this.text(diagram.description) },
      nodes,
      edges,
    };
  }

  private parseNode(value: unknown, index: number): ExchangeNode {
    const where = `La clase nº ${index + 1} del archivo`;
    const node = this.record(value, `${where} no es un objeto.`);

    const id = this.text(node.id);
    if (id === null) {
      throw new BadRequestException(`${where} no tiene identificador.`);
    }

    const data = this.record(node.data, `${where} no tiene datos.`);
    const name = this.text(data.name);
    if (name === null) {
      throw new BadRequestException(`${where} no tiene nombre.`);
    }

    const position = this.record(node.position, `${where} no tiene posición.`);
    const x = this.number(position.x);
    const y = this.number(position.y);
    if (x === null || y === null) {
      throw new BadRequestException(`${where} no tiene una posición válida.`);
    }

    const rawAttributes = Array.isArray(data.attributes) ? data.attributes : [];
    const attributes = rawAttributes.map((attribute, position) =>
      this.parseAttribute(attribute, `${where}, atributo nº ${position + 1},`, position),
    );

    const rawMethods = Array.isArray(data.methods) ? data.methods : [];
    const methods = rawMethods.map((method, position) =>
      this.parseMethod(method, `${where}, método nº ${position + 1},`, position),
    );

    // El tamaño puede faltar: null significa «automático según el contenido»,
    // que es como nace toda clase antes de que alguien la redimensione.
    const size = this.optionalRecord(node.size);
    const width = size === null ? null : this.number(size.width);
    const height = size === null ? null : this.number(size.height);

    return {
      id,
      type: 'class',
      position: { x, y },
      size: width === null || height === null ? null : { width, height },
      data: {
        name,
        stereotype: this.text(data.stereotype),
        is_abstract: data.is_abstract === true,
        visibility: this.text(data.visibility) ?? 'public',
        attributes,
        methods,
      },
    };
  }

  private parseAttribute(value: unknown, where: string, order: number): ExchangeAttribute {
    const attribute = this.record(value, `${where} no es un objeto.`);

    // Lo único obligatorio de un atributo: sin nombre no hay atributo. El tipo
    // puede faltar, y faltar es una respuesta válida.
    const name = this.text(attribute.name);
    if (name === null) {
      throw new BadRequestException(`${where} no tiene nombre.`);
    }

    return {
      id: this.text(attribute.id) ?? `${order}`,
      name,
      type: this.text(attribute.type ?? attribute.data_type),
      visibility: this.text(attribute.visibility) ?? 'private',
      // Por omisión admite nulos, que es el valor con el que nace en la base.
      is_nullable: attribute.is_nullable !== false,
      is_unique: attribute.is_unique === true,
      default_value: this.text(attribute.default_value),
      order_index: this.number(attribute.order_index) ?? order,
    };
  }

  private parseMethod(value: unknown, where: string, order: number): ExchangeMethod {
    const method = this.record(value, `${where} no es un objeto.`);

    const name = this.text(method.name);
    if (name === null) {
      throw new BadRequestException(`${where} no tiene nombre.`);
    }

    const rawParameters = Array.isArray(method.parameters) ? method.parameters : [];

    return {
      id: this.text(method.id) ?? `${order}`,
      name,
      return_type: this.text(method.return_type) ?? 'void',
      visibility: this.text(method.visibility) ?? 'public',
      order_index: this.number(method.order_index) ?? order,
      parameters: rawParameters.map((parameter, position) => {
        const record = this.record(parameter, `${where} tiene un parámetro que no es un objeto.`);
        const parameterName = this.text(record.name);
        const parameterType = this.text(record.type ?? record.data_type);

        if (parameterName === null || parameterType === null) {
          throw new BadRequestException(
            `${where} tiene un parámetro sin nombre o sin tipo; en un método los dos son obligatorios.`,
          );
        }

        return {
          name: parameterName,
          type: parameterType,
          order_index: this.number(record.order_index) ?? position,
        };
      }),
    };
  }

  private parseEdge(value: unknown, index: number, nodeIds: Set<string>): ExchangeEdge {
    const where = `La relación nº ${index + 1} del archivo`;
    const edge = this.record(value, `${where} no es un objeto.`);

    const source = this.text(edge.source);
    const target = this.text(edge.target);
    if (source === null || target === null) {
      throw new BadRequestException(`${where} no indica qué clases une.`);
    }

    // Una relación que apunte a una clase que el archivo no trae dejaría el
    // diagrama importado con una línea hacia ninguna parte.
    if (!nodeIds.has(source)) {
      throw new BadRequestException(`${where} sale de una clase que no está en el archivo.`);
    }
    if (!nodeIds.has(target)) {
      throw new BadRequestException(`${where} llega a una clase que no está en el archivo.`);
    }

    const type = this.text(edge.type);
    if (type === null) {
      throw new BadRequestException(`${where} no dice de qué tipo es.`);
    }

    const data = this.optionalRecord(edge.data) ?? {};

    return {
      id: this.text(edge.id) ?? `${index}`,
      source,
      target,
      type,
      data: {
        sourceMultiplicity: this.text(data.sourceMultiplicity ?? data.source_multiplicity),
        targetMultiplicity: this.text(data.targetMultiplicity ?? data.target_multiplicity),
        name: this.text(data.name),
        sourceRole: this.text(data.sourceRole ?? data.source_role),
        targetRole: this.text(data.targetRole ?? data.target_role),
        isNavigableSource: (data.isNavigableSource ?? data.is_navigable_source) !== false,
        isNavigableTarget: (data.isNavigableTarget ?? data.is_navigable_target) !== false,
      },
    };
  }

  // -------------------------------------------------------------- lectores

  /** Un apartado del archivo que tiene que estar. */
  private record(value: unknown, message: string): Record<string, unknown> {
    const record = this.optionalRecord(value);

    if (record === null) {
      throw new BadRequestException(message);
    }
    return record;
  }

  /** Un apartado que puede faltar, como `size` o el `data` de una relación. */
  private optionalRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private text(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
