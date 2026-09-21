/**
 * CU04/CU05 — Acciones internas del asistente.
 *
 * Este módulo es la frontera entre lo que dice la IA y lo que el sistema está
 * dispuesto a ejecutar. La IA devuelve texto JSON, y ese texto no se toca
 * jamás directamente contra la base de datos: aquí se traduce a un conjunto
 * cerrado de acciones —las que el enunciado de CU04 define— y todo lo que no
 * encaje en ese conjunto se descarta con un motivo legible.
 *
 * Es deliberadamente una función pura, sin acceso a PostgreSQL: lo que hay
 * aquí sólo decide si la respuesta de la IA *tiene forma* de acción. Que la
 * clase exista, que el atributo no esté repetido o que la relación sea posible
 * se comprueba después, contra el modelo guardado (ai-executor.service.ts).
 */

import { DATA_TYPE_NAMES } from '../diagrams/uml-catalog.js';

/** Acciones que el sistema sabe ejecutar. Cualquier otra se rechaza. */
export const AI_ACTIONS = [
  'CREATE_CLASS',
  'UPDATE_CLASS',
  'DELETE_CLASS',
  'ADD_ATTRIBUTE',
  'UPDATE_ATTRIBUTE',
  'DELETE_ATTRIBUTE',
  'CREATE_RELATIONSHIP',
  'UPDATE_RELATIONSHIP',
  'DELETE_RELATIONSHIP',
  'MOVE_CLASS',
] as const;

export type AiActionType = (typeof AI_ACTIONS)[number];

/**
 * Tipos de relación que el asistente puede crear. Es un subconjunto de los del
 * tipo enumerado relationship_type: son los cuatro que CU04 exige y los que se
 * pueden nombrar sin ambigüedad en lenguaje natural.
 */
export const AI_RELATIONSHIP_TYPES = [
  'ASSOCIATION',
  'AGGREGATION',
  'COMPOSITION',
  'INHERITANCE',
] as const;

export type AiRelationshipType = (typeof AI_RELATIONSHIP_TYPES)[number];

/**
 * Cómo se nombra cada relación en las frases que ve el usuario. Vive aquí, y
 * no en el ejecutor, porque lo usan los dos lados del asistente: el que
 * describe lo que se va a hacer y el que explica lo que se leyó en una imagen.
 */
export const RELATIONSHIP_LABELS: Record<AiRelationshipType, string> = {
  ASSOCIATION: 'asociación',
  AGGREGATION: 'agregación',
  COMPOSITION: 'composición',
  INHERITANCE: 'herencia',
};

/** Hacia dónde colocar una clase respecto de otra («debajo de Usuario»). */
export type Direction = 'above' | 'below' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

/**
 * Atributo tal como lo nombra la IA. `type` puede llegar vacío: en una foto
 * (CU05) es normal que el tipo no se lea, y entonces lo decide el sistema.
 */
export interface RawAttribute {
  name: string;
  type: string | null;
}

/**
 * Acción ya con forma reconocible. Los nombres de clase todavía son texto: la
 * traducción a identificadores la hace el ejecutor contra el diagrama real.
 */
export type RawAction =
  | {
      action: 'CREATE_CLASS';
      className: string;
      attributes: RawAttribute[];
      position: Point | null;
    }
  | { action: 'UPDATE_CLASS'; className: string; newName: string }
  | { action: 'DELETE_CLASS'; className: string }
  | { action: 'ADD_ATTRIBUTE'; className: string; attributes: RawAttribute[] }
  | {
      action: 'UPDATE_ATTRIBUTE';
      className: string;
      attributeName: string;
      newName: string | null;
      newType: string | null;
    }
  | { action: 'DELETE_ATTRIBUTE'; className: string; attributeName: string }
  | {
      action: 'CREATE_RELATIONSHIP';
      relationshipType: AiRelationshipType;
      sourceClass: string;
      /**
       * Una sola instrucción puede crear varias relaciones iguales: «Cliente y
       * Administrador heredan de Usuario» son dos herencias hacia el mismo
       * padre. Para una relación normal la lista trae un único destino.
       */
      targetClasses: string[];
      sourceMultiplicity: string | null;
      targetMultiplicity: string | null;
      name: string | null;
    }
  | {
      action: 'UPDATE_RELATIONSHIP';
      sourceClass: string;
      targetClass: string;
      /** Sólo los campos presentes se modifican; `undefined` es «no tocar». */
      relationshipType: AiRelationshipType | undefined;
      sourceMultiplicity: string | null | undefined;
      targetMultiplicity: string | null | undefined;
      name: string | null | undefined;
    }
  | { action: 'DELETE_RELATIONSHIP'; sourceClass: string; targetClass: string }
  | {
      action: 'MOVE_CLASS';
      className: string;
      /** Coordenadas explícitas («x=400 y=250»), si la instrucción las trae. */
      position: Point | null;
      /** O una referencia a otra clase («debajo de Usuario»). */
      reference: { direction: Direction; className: string } | null;
    };

/** Resultado de leer la respuesta de la IA. */
export interface ParsedActions {
  actions: RawAction[];
  /**
   * Motivo por el que no hay nada que ejecutar: o la IA declaró que no
   * entendía la instrucción, o su respuesta no tenía la forma esperada.
   */
  error: string | null;
  /**
   * Acciones que sí venían pero estaban incompletas. Basta con una para no
   * tocar el diagrama: ejecutar «la mitad» de lo que el usuario pidió es peor
   * que no ejecutar nada, porque deja el modelo en un estado que nadie pidió.
   */
  problems: string[];
}

// ---------------------------------------------------------------- sinónimos

/**
 * Equivalencias de tipo de dato.
 *
 * El usuario dicta en castellano y la IA responde en el vocabulario que le
 * suena («int», «texto», «number»), pero uml_attributes.data_type sólo admite
 * los tipos del catálogo, porque CU07 tiene que traducirlos a Java. Traducir
 * aquí evita rechazar una instrucción perfectamente clara por una palabra.
 */
const DATA_TYPE_SYNONYMS: Record<string, string> = {
  string: 'String',
  str: 'String',
  texto: 'String',
  text: 'String',
  varchar: 'String',
  char: 'String',
  character: 'String',

  int: 'Integer',
  integer: 'Integer',
  entero: 'Integer',
  number: 'Integer',
  numero: 'Integer',
  smallint: 'Integer',
  int4: 'Integer',

  long: 'Long',
  bigint: 'Long',
  int8: 'Long',

  double: 'Double',
  doble: 'Double',
  float8: 'Double',

  float: 'Float',
  real: 'Float',

  boolean: 'Boolean',
  bool: 'Boolean',
  booleano: 'Boolean',

  bigdecimal: 'BigDecimal',
  decimal: 'BigDecimal',
  numeric: 'BigDecimal',

  date: 'LocalDate',
  fecha: 'LocalDate',
  localdate: 'LocalDate',

  datetime: 'LocalDateTime',
  timestamp: 'LocalDateTime',
  localdatetime: 'LocalDateTime',
  fechahora: 'LocalDateTime',

  uuid: 'UUID',
  guid: 'UUID',
};

/** Palabras con las que la IA puede nombrar cada tipo de relación. */
const RELATIONSHIP_SYNONYMS: Record<string, AiRelationshipType> = {
  association: 'ASSOCIATION',
  asociacion: 'ASSOCIATION',
  asociación: 'ASSOCIATION',
  aggregation: 'AGGREGATION',
  agregacion: 'AGGREGATION',
  agregación: 'AGGREGATION',
  composition: 'COMPOSITION',
  composicion: 'COMPOSITION',
  composición: 'COMPOSITION',
  inheritance: 'INHERITANCE',
  herencia: 'INHERITANCE',
  generalization: 'INHERITANCE',
  generalizacion: 'INHERITANCE',
  extends: 'INHERITANCE',
};

const DIRECTION_SYNONYMS: Record<string, Direction> = {
  above: 'above',
  arriba: 'above',
  encima: 'above',
  below: 'below',
  abajo: 'below',
  debajo: 'below',
  left: 'left',
  izquierda: 'left',
  right: 'right',
  derecha: 'right',
};

/**
 * Quita tildes y pasa a minúsculas.
 *
 * Sirve para comparar sinónimos y también para buscar clases y atributos por
 * nombre: el usuario dicta «agrega correo a cliente» y el diagrama tiene
 * «Cliente», y sería absurdo no encontrarla por una mayúscula.
 */
export function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const DATA_TYPES_BY_FOLDED = new Map(DATA_TYPE_NAMES.map((name) => [fold(name), name]));

/**
 * Tipo del catálogo equivalente al que dijo la IA, o null si no hay ninguno.
 * No se inventa un tipo por defecto: quien llama decide qué hacer cuando no
 * se reconoce —CU04 rechaza la instrucción, CU05 avisa y usa String—.
 */
export function normalizeDataType(value: string | null): string | null {
  if (value === null) return null;

  const folded = fold(value);

  return DATA_TYPES_BY_FOLDED.get(folded) ?? DATA_TYPE_SYNONYMS[folded] ?? null;
}

export function normalizeRelationshipType(value: string | null): AiRelationshipType | null {
  if (value === null) return null;

  const folded = fold(value);
  const direct = AI_RELATIONSHIP_TYPES.find((type) => fold(type) === folded);

  return direct ?? RELATIONSHIP_SYNONYMS[folded] ?? null;
}

/**
 * Multiplicidad tal como la escribe UML. Se admiten además las formas que la
 * IA suele devolver («0..N», «n», «muchos», «many»), porque significan lo
 * mismo y el usuario no tiene por qué saber cuál espera la base de datos.
 */
export function normalizeMultiplicity(value: string | null): string | null {
  if (value === null) return null;

  const text = value.trim().replace(/\s+/g, '');
  if (text.length === 0) return null;

  const folded = fold(text);
  if (folded === 'muchos' || folded === 'many' || folded === 'n' || folded === '*') {
    return '*';
  }
  if (folded === 'uno' || folded === 'one') {
    return '1';
  }

  // «0..N» y «1..n» son la misma idea que «0..*» y «1..*».
  return text.replace(/\.\.[nN]$/, '..*');
}

// ------------------------------------------------------------- lectura JSON

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Lee el primer campo presente: la IA no siempre usa el mismo nombre. */
function textOf(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coordenadas, vengan anidadas en `position` o sueltas en la acción. */
function pointOf(source: Record<string, unknown>): Point | null {
  const nested = isRecord(source.position) ? source.position : source;
  const x = numberOf(nested.x);
  const y = numberOf(nested.y);

  return x === null || y === null ? null : { x, y };
}

/**
 * Lista de atributos. Se acepta tanto `[{name, type}]` como `["nombre"]`, y
 * también un atributo suelto en `attributeName`/`type`, porque para «Agrega el
 * atributo telefono de tipo String» la IA tiende a responder en singular.
 */
export function attributesOf(source: Record<string, unknown>): RawAttribute[] {
  const list = Array.isArray(source.attributes) ? source.attributes : [];
  const attributes: RawAttribute[] = [];

  for (const entry of list) {
    if (typeof entry === 'string') {
      const name = text(entry);
      if (name !== null) attributes.push({ name, type: null });
      continue;
    }
    if (!isRecord(entry)) continue;

    const name = textOf(entry, 'name', 'nombre', 'attributeName');
    if (name === null) continue;

    attributes.push({ name, type: textOf(entry, 'type', 'dataType', 'data_type', 'tipo') });
  }

  if (attributes.length === 0) {
    const name = textOf(source, 'attributeName', 'attribute_name');
    if (name !== null) {
      attributes.push({ name, type: textOf(source, 'type', 'dataType', 'data_type', 'tipo') });
    }
  }

  return attributes;
}

/** Nombres de clase destino, en singular o en plural. */
function targetClassesOf(source: Record<string, unknown>): string[] {
  const list = Array.isArray(source.targetClasses) ? source.targetClasses : [];
  const names = list.map((entry) => text(entry)).filter((name): name is string => name !== null);

  if (names.length > 0) return names;

  const single = textOf(source, 'targetClass', 'target_class', 'target');
  return single === null ? [] : [single];
}

/**
 * Convierte una entrada de la respuesta de la IA en una acción reconocible.
 * Devuelve el motivo del descarte en lugar de la acción cuando falta algo
 * imprescindible: ese motivo es lo que verá el usuario.
 */
function toAction(entry: unknown): { action: RawAction } | { problem: string } {
  if (!isRecord(entry)) {
    return { problem: 'La IA devolvió una acción que no es un objeto.' };
  }

  const name = textOf(entry, 'action', 'operation', 'type');
  if (name === null) {
    return { problem: 'La IA devolvió una acción sin nombre de operación.' };
  }

  const action = AI_ACTIONS.find((candidate) => candidate === name.toUpperCase().trim());
  if (action === undefined) {
    return { problem: `La operación «${name}» no está entre las que el asistente sabe hacer.` };
  }

  const className = textOf(entry, 'className', 'class_name', 'class', 'clase');

  switch (action) {
    case 'CREATE_CLASS': {
      if (className === null) {
        return { problem: 'Falta el nombre de la clase que hay que crear.' };
      }
      return {
        action: {
          action,
          className,
          attributes: attributesOf(entry),
          position: pointOf(entry),
        },
      };
    }

    case 'UPDATE_CLASS': {
      const newName = textOf(entry, 'newName', 'new_name', 'newClassName', 'nuevoNombre');
      if (className === null || newName === null) {
        return { problem: 'Para renombrar una clase hacen falta el nombre actual y el nuevo.' };
      }
      return { action: { action, className, newName } };
    }

    case 'DELETE_CLASS': {
      if (className === null) {
        return { problem: 'Falta el nombre de la clase que hay que eliminar.' };
      }
      return { action: { action, className } };
    }

    case 'ADD_ATTRIBUTE': {
      const attributes = attributesOf(entry);
      if (className === null || attributes.length === 0) {
        return { problem: 'Para añadir un atributo hacen falta la clase y el atributo.' };
      }
      return { action: { action, className, attributes } };
    }

    case 'UPDATE_ATTRIBUTE': {
      const attributeName = textOf(entry, 'attributeName', 'attribute_name', 'attribute', 'atributo');
      if (className === null || attributeName === null) {
        return { problem: 'Para modificar un atributo hacen falta la clase y el atributo.' };
      }
      const newName = textOf(entry, 'newName', 'new_name', 'nuevoNombre');
      const newType = textOf(entry, 'newType', 'new_type', 'type', 'dataType', 'tipo');
      if (newName === null && newType === null) {
        return {
          problem: `No se indicó qué cambiar del atributo «${attributeName}» de ${className}.`,
        };
      }
      return { action: { action, className, attributeName, newName, newType } };
    }

    case 'DELETE_ATTRIBUTE': {
      const attributeName = textOf(entry, 'attributeName', 'attribute_name', 'attribute', 'atributo');
      if (className === null || attributeName === null) {
        return { problem: 'Para eliminar un atributo hacen falta la clase y el atributo.' };
      }
      return { action: { action, className, attributeName } };
    }

    case 'CREATE_RELATIONSHIP': {
      const relationshipType = normalizeRelationshipType(
        textOf(entry, 'relationshipType', 'relationship_type', 'type', 'tipo'),
      );
      if (relationshipType === null) {
        return {
          problem: `El tipo de relación debe ser uno de: ${AI_RELATIONSHIP_TYPES.join(', ')}.`,
        };
      }

      const sourceClass = textOf(entry, 'sourceClass', 'source_class', 'source', 'origen');
      const targetClasses = targetClassesOf(entry);
      if (sourceClass === null || targetClasses.length === 0) {
        return { problem: 'Una relación necesita una clase de origen y otra de destino.' };
      }

      return {
        action: {
          action,
          relationshipType,
          sourceClass,
          targetClasses,
          sourceMultiplicity: normalizeMultiplicity(
            textOf(entry, 'sourceMultiplicity', 'source_multiplicity'),
          ),
          targetMultiplicity: normalizeMultiplicity(
            textOf(entry, 'targetMultiplicity', 'target_multiplicity'),
          ),
          name: textOf(entry, 'name', 'relationshipName', 'nombre'),
        },
      };
    }

    case 'UPDATE_RELATIONSHIP': {
      const sourceClass = textOf(entry, 'sourceClass', 'source_class', 'source', 'origen');
      const targetClass = textOf(entry, 'targetClass', 'target_class', 'target', 'destino');
      if (sourceClass === null || targetClass === null) {
        return { problem: 'Para modificar una relación hacen falta sus dos clases.' };
      }

      // `undefined` significa «no tocar este extremo»: cambiar sólo una
      // multiplicidad no puede borrar la otra.
      const sourceMultiplicity = has(entry, 'sourceMultiplicity', 'source_multiplicity')
        ? normalizeMultiplicity(textOf(entry, 'sourceMultiplicity', 'source_multiplicity'))
        : undefined;
      const targetMultiplicity = has(entry, 'targetMultiplicity', 'target_multiplicity')
        ? normalizeMultiplicity(textOf(entry, 'targetMultiplicity', 'target_multiplicity'))
        : undefined;
      const relationshipType =
        normalizeRelationshipType(textOf(entry, 'relationshipType', 'relationship_type')) ??
        undefined;
      const name = has(entry, 'name', 'relationshipName')
        ? textOf(entry, 'name', 'relationshipName')
        : undefined;

      if (
        sourceMultiplicity === undefined &&
        targetMultiplicity === undefined &&
        relationshipType === undefined &&
        name === undefined
      ) {
        return {
          problem: `No se indicó qué cambiar de la relación entre ${sourceClass} y ${targetClass}.`,
        };
      }

      return {
        action: {
          action,
          sourceClass,
          targetClass,
          relationshipType,
          sourceMultiplicity,
          targetMultiplicity,
          name,
        },
      };
    }

    case 'DELETE_RELATIONSHIP': {
      const sourceClass = textOf(entry, 'sourceClass', 'source_class', 'source', 'origen');
      const targetClass = textOf(entry, 'targetClass', 'target_class', 'target', 'destino');
      if (sourceClass === null || targetClass === null) {
        return { problem: 'Para eliminar una relación hacen falta sus dos clases.' };
      }
      return { action: { action, sourceClass, targetClass } };
    }

    case 'MOVE_CLASS': {
      if (className === null) {
        return { problem: 'Falta el nombre de la clase que hay que mover.' };
      }

      const position = pointOf(entry);
      const reference = referenceOf(entry);
      if (position === null && reference === null) {
        return {
          problem: `No se entendió a dónde mover la clase «${className}».`,
        };
      }

      return { action: { action, className, position, reference } };
    }
  }
}

/** ¿La IA mencionó este campo, aunque sea con null? */
function has(source: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => Object.hasOwn(source, key));
}

/** «debajo de Usuario» → { direction: 'below', className: 'Usuario' }. */
function referenceOf(
  source: Record<string, unknown>,
): { direction: Direction; className: string } | null {
  const nested = isRecord(source.reference) ? source.reference : source;

  const direction = DIRECTION_SYNONYMS[fold(textOf(nested, 'direction', 'relative', 'direccion') ?? '')];
  const className = textOf(nested, 'className', 'class_name', 'referenceClass', 'relativeTo');

  return direction === undefined || className === null ? null : { direction, className };
}

/**
 * Lee la respuesta completa de la IA de CU04.
 *
 * La IA tiene permitido decir que no entiende: `{"actions": [], "error": "..."}`.
 * Eso no es un fallo del sistema, es la respuesta correcta a una instrucción
 * ambigua, y se le devuelve al usuario tal cual para que la reformule.
 */
export function parseActions(raw: unknown): ParsedActions {
  if (!isRecord(raw)) {
    return { actions: [], error: 'La IA no devolvió una respuesta con la forma esperada.', problems: [] };
  }

  const declared = textOf(raw, 'error', 'message', 'motivo');
  const list = Array.isArray(raw.actions) ? raw.actions : null;

  if (list === null) {
    return {
      actions: [],
      error: declared ?? 'La IA no devolvió ninguna lista de acciones.',
      problems: [],
    };
  }

  const actions: RawAction[] = [];
  const problems: string[] = [];

  for (const entry of list) {
    const result = toAction(entry);
    if ('action' in result) {
      actions.push(result.action);
    } else {
      problems.push(result.problem);
    }
  }

  if (actions.length === 0 && problems.length === 0) {
    return {
      actions: [],
      error: declared ?? 'No se entendió qué había que hacer con el diagrama.',
      problems: [],
    };
  }

  return { actions, error: null, problems };
}

// ------------------------------------------------------------------- CU05

/** Modelo UML leído de una imagen, antes de validarse. */
export interface RawImageModel {
  classes: {
    name: string;
    attributes: RawAttribute[];
    /** Posición relativa en la imagen (0..1), cuando se distingue. */
    position: Point | null;
  }[];
  relationships: {
    relationshipType: AiRelationshipType;
    sourceClass: string;
    targetClass: string;
    sourceMultiplicity: string | null;
    targetMultiplicity: string | null;
  }[];
  /** Lo que se descartó por no ser legible; se le cuenta al usuario. */
  problems: string[];
}

/**
 * Lee la estructura que devuelve Qwen3-VL al mirar la imagen.
 *
 * Aquí, a diferencia de CU04, lo ilegible se descarta en lugar de tumbar la
 * importación entera: de una foto de pizarra se lee lo que se lee, y una
 * relación borrosa no puede impedir que se importen las ocho clases que sí se
 * distinguen. Lo descartado se devuelve en `problems` para poder decírselo.
 */
export function parseImageModel(raw: unknown): RawImageModel {
  const empty: RawImageModel = { classes: [], relationships: [], problems: [] };
  if (!isRecord(raw)) return empty;

  const problems: string[] = [];
  const classes: RawImageModel['classes'] = [];

  for (const entry of Array.isArray(raw.classes) ? raw.classes : []) {
    if (!isRecord(entry)) continue;

    const name = textOf(entry, 'name', 'className', 'nombre');
    if (name === null) {
      problems.push('Se vio una clase sin nombre legible y no se importó.');
      continue;
    }

    classes.push({ name, attributes: attributesOf(entry), position: pointOf(entry) });
  }

  const relationships: RawImageModel['relationships'] = [];

  for (const entry of Array.isArray(raw.relationships) ? raw.relationships : []) {
    if (!isRecord(entry)) continue;

    const sourceClass = textOf(entry, 'sourceClass', 'source_class', 'source', 'from');
    const targetClass = textOf(entry, 'targetClass', 'target_class', 'target', 'to');
    if (sourceClass === null || targetClass === null) {
      problems.push('Se vio una relación sin poder distinguir qué clases une.');
      continue;
    }

    // Si el trazo no permite decidir el tipo, se toma la asociación: es la
    // relación más débil de las cuatro, así que es la que menos afirma de más.
    const relationshipType =
      normalizeRelationshipType(textOf(entry, 'relationshipType', 'relationship_type', 'type')) ??
      'ASSOCIATION';

    relationships.push({
      relationshipType,
      sourceClass,
      targetClass,
      sourceMultiplicity: normalizeMultiplicity(
        textOf(entry, 'sourceMultiplicity', 'source_multiplicity'),
      ),
      targetMultiplicity: normalizeMultiplicity(
        textOf(entry, 'targetMultiplicity', 'target_multiplicity'),
      ),
    });
  }

  return { classes, relationships, problems };
}
