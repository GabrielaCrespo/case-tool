import type { UmlMethod, UmlRelationship, Visibility } from '../../api/types'
import type { RelationshipType } from '../../api/types'

/**
 * El lenguaje visual de UML.
 *
 * El color de cada tipo de relación no es decoración: es la forma más rápida de
 * distinguir una composición de una herencia en un lienzo lleno. El adorno de
 * cada extremo (rombo, triángulo, punta de flecha) es el de la notación UML.
 */

export type MarkerShape =
  | 'none'
  | 'open-arrow'
  | 'hollow-triangle'
  | 'hollow-diamond'
  | 'filled-diamond'

export interface RelationshipMeta {
  label: string
  /** Texto del rail de herramientas. */
  short: string
  color: string
  dashed: boolean
  sourceMarker: MarkerShape
  targetMarker: MarkerShape
  /** Qué significa, en una frase, para quien aún está aprendiendo UML. */
  hint: string
}

export const RELATIONSHIP_META: Record<RelationshipType, RelationshipMeta> = {
  ASSOCIATION: {
    label: 'Asociación',
    short: 'Asoc.',
    color: '#5a6b85',
    dashed: false,
    sourceMarker: 'none',
    targetMarker: 'none',
    hint: 'Una entidad guarda una referencia a la otra.',
  },
  AGGREGATION: {
    label: 'Agregación',
    short: 'Agreg.',
    color: '#0e7c86',
    dashed: false,
    sourceMarker: 'hollow-diamond',
    targetMarker: 'none',
    hint: 'El todo agrupa partes que existen por su cuenta.',
  },
  COMPOSITION: {
    label: 'Composición',
    short: 'Comp.',
    color: '#0b5fbf',
    dashed: false,
    sourceMarker: 'filled-diamond',
    targetMarker: 'none',
    hint: 'Las partes no viven sin el todo: se borran con él.',
  },
  INHERITANCE: {
    label: 'Herencia',
    short: 'Herencia',
    color: '#4b3be4',
    dashed: false,
    sourceMarker: 'none',
    targetMarker: 'hollow-triangle',
    hint: 'La entidad origen es un tipo de la entidad destino.',
  },
  REALIZATION: {
    label: 'Realización',
    short: 'Realiz.',
    color: '#8a2fa8',
    dashed: true,
    sourceMarker: 'none',
    targetMarker: 'hollow-triangle',
    hint: 'La clase origen implementa la interfaz destino.',
  },
  DEPENDENCY: {
    label: 'Dependencia',
    short: 'Depend.',
    color: '#8493ab',
    dashed: true,
    sourceMarker: 'none',
    targetMarker: 'open-arrow',
    hint: 'La clase origen usa la destino, sin guardarla.',
  },
}

/**
 * Las relaciones que se ofrecen en el rail.
 *
 * No están las seis del modelo. Ésta es una herramienta de diseño de datos, y
 * lo que se dibuja aquí acaba siendo tablas: la realización y la dependencia
 * describen cómo colabora el código, no cómo se guarda, y ninguna de las dos
 * se traduce en una columna ni en una clave foránea. Siguen siendo valores
 * válidos de `relationship_type` —un modelo importado de Enterprise Architect
 * puede traerlas, y entonces se ven y se pueden cambiar desde el panel—, pero
 * no se ofrecen para dibujar.
 */
export const DATA_RELATIONSHIP_TYPES = [
  'ASSOCIATION',
  'AGGREGATION',
  'COMPOSITION',
  'INHERITANCE',
] as const satisfies readonly RelationshipType[]

/**
 * La clase de asociación no es un tipo de relación, así que no está en
 * RELATIONSHIP_META; pero en el rail se presenta como una más y necesita lo
 * mismo que ellas. Comparte el color de la asociación porque eso es lo que
 * acaba habiendo en el lienzo: dos asociaciones hacia la entidad intermedia.
 */
export const ASSOCIATION_CLASS_META = {
  label: 'Entidad intermedia',
  color: RELATIONSHIP_META.ASSOCIATION.color,
  hint: 'Une dos entidades a través de una tercera, para un muchos a muchos.',
} as const

/**
 * Las dos líneas que sostienen a una entidad intermedia.
 *
 * En el modelo una entidad intermedia no es nada especial: es una tabla más,
 * unida a cada lado con una asociación 1 : 0..*, que es lo que CU07 necesita
 * para generar el backend. Pero en UML —y en Enterprise Architect— esa caja se
 * dibuja colgando de la línea que une a las otras dos con un trazo
 * DISCONTINUO, y es así como se reconoce de un vistazo un muchos a muchos ya
 * resuelto. Aquí se marcan esas dos líneas para poder dibujarlas igual.
 *
 * El patrón es el mismo que reconoce el exportador de CU06: la clase no
 * participa en ninguna otra relación y las dos que llegan a ella vienen de
 * clases distintas, con 1 y 0..* o sin multiplicidad ninguna.
 */
export function associationClassLinks(relationships: UmlRelationship[]): Set<string> {
  const touching = new Map<string, UmlRelationship[]>()
  for (const relationship of relationships) {
    // Los dos extremos se cuentan por separado, aunque sean la misma clase:
    // así una relación de una clase consigo misma no se confunde con esto.
    for (const classId of [relationship.source_class_id, relationship.target_class_id]) {
      touching.set(classId, [...(touching.get(classId) ?? []), relationship])
    }
  }

  const links = new Set<string>()

  for (const [classId, all] of touching) {
    const isIntermediate =
      all.length === 2 &&
      all.every(
        (link) =>
          link.relationship_type === 'ASSOCIATION' &&
          link.target_class_id === classId &&
          ((link.source_multiplicity === '1' && link.target_multiplicity === '0..*') ||
            (link.source_multiplicity === null && link.target_multiplicity === null)),
      ) &&
      all[0].source_class_id !== all[1].source_class_id

    if (!isIntermediate) continue

    links.add(all[0].id)
    links.add(all[1].id)
  }

  return links
}

/** Color con el que se resalta el elemento seleccionado. */
export const SELECTED_COLOR = '#4b3be4'

/**
 * Multiplicidades que acepta el backend.
 * El patrón completo es /^(\*|\d+|\d+\.\.(\d+|\*))$/, así que también valen
 * valores como «2..5»; éstas son sólo las habituales.
 */
export const COMMON_MULTIPLICITIES = ['1', '0..1', '0..*', '1..*', '*'] as const

const MULTIPLICITY_PATTERN = /^(\*|\d+|\d+\.\.(\d+|\*))$/

export function isValidMultiplicity(value: string): boolean {
  return value.length === 0 || MULTIPLICITY_PATTERN.test(value)
}

/**
 * Catálogo de tipos de dato, con la traducción que usará el generador.
 *
 * No es una lista de sugerencias: el backend rechaza cualquier tipo que no
 * esté aquí, porque un tipo que CU07 no sepa traducir a Java haría imposible
 * generar el backend Spring Boot.
 */
export const DATA_TYPES = [
  { name: 'String', java: 'String', sql: 'VARCHAR' },
  { name: 'Integer', java: 'Integer', sql: 'INTEGER' },
  { name: 'Long', java: 'Long', sql: 'BIGINT' },
  { name: 'Double', java: 'Double', sql: 'DOUBLE PRECISION' },
  { name: 'Float', java: 'Float', sql: 'REAL' },
  { name: 'Boolean', java: 'Boolean', sql: 'BOOLEAN' },
  { name: 'BigDecimal', java: 'BigDecimal', sql: 'NUMERIC' },
  { name: 'LocalDate', java: 'LocalDate', sql: 'DATE' },
  { name: 'LocalDateTime', java: 'LocalDateTime', sql: 'TIMESTAMP' },
  { name: 'UUID', java: 'UUID', sql: 'UUID' },
] as const

export const DATA_TYPE_NAMES: string[] = DATA_TYPES.map((type) => type.name)

/**
 * La clave primaria que lleva toda entidad.
 *
 * No se dibuja ni se escribe: la pone la herramienta, y por eso ningún
 * atributo puede llamarse así. Se enseña como la primera fila de la caja —una
 * tabla sin su clave primaria no se lee como una tabla— pero no se puede
 * tocar. La razón de que no se defina a mano es que una clave escrita como
 * atributo es lo que rompía la generación: dos atributos marcados como clave,
 * una clave sin tipo o de un tipo que PostgreSQL no puede autogenerar, o una
 * entidad a la que se le olvidó marcar ninguna.
 */
export const PRIMARY_KEY = { name: 'id', dataType: 'Long' } as const

/** ¿Este nombre choca con la clave primaria que pone la herramienta? */
export function isPrimaryKeyName(value: string): boolean {
  return value.trim().toLowerCase() === PRIMARY_KEY.name
}

/**
 * Motivo por el que el nombre no sirve para un atributo, o null si sirve. Es
 * el de cualquier identificador, más la clave primaria, que está reservada.
 */
export function attributeNameProblem(value: string): string | null {
  if (isPrimaryKeyName(value)) {
    return `«${PRIMARY_KEY.name}» está reservado: toda entidad ya tiene esa clave primaria.`
  }

  return identifierProblem(value)
}

/**
 * Tipos heredados del catálogo anterior. El backend los sigue aceptando para no
 * invalidar diagramas ya guardados, pero no se ofrecen al elegir; si un
 * atributo antiguo tiene uno, el selector lo añade sólo para ese atributo.
 */
export const LEGACY_DATA_TYPES = ['Text', 'Date', 'DateTime']

/** Sugerencia de valor por defecto válido, según el tipo. */
export const DEFAULT_VALUE_HINTS: Record<string, string> = {
  Integer: '0',
  Long: '0',
  Double: '0.0',
  Float: '0.0',
  BigDecimal: '0.00',
  Boolean: 'true',
  LocalDate: '2026-01-31',
  Date: '2026-01-31',
  LocalDateTime: '2026-01-31T09:30',
  DateTime: '2026-01-31T09:30',
  UUID: '00000000-0000-0000-0000-000000000000',
}

const DEFAULT_VALUE_PATTERNS: Record<string, RegExp> = {
  Integer: /^-?\d+$/,
  Long: /^-?\d+$/,
  Double: /^-?\d+(\.\d+)?$/,
  Float: /^-?\d+(\.\d+)?$/,
  BigDecimal: /^-?\d+(\.\d+)?$/,
  Boolean: /^(true|false)$/,
  LocalDate: /^\d{4}-\d{2}-\d{2}$/,
  Date: /^\d{4}-\d{2}-\d{2}$/,
  LocalDateTime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/,
  DateTime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}

/** Avisa antes de llamar a la API de un valor por defecto imposible. */
export function isDefaultValueCompatible(dataType: string, value: string): boolean {
  const pattern = DEFAULT_VALUE_PATTERNS[dataType]

  return pattern === undefined || pattern.test(value)
}

/**
 * La clase se convertirá en una tabla.
 *
 * Es la misma regla que el validador de la API y que el generador de CU07: una
 * clase sin estereotipo es una entidad, porque en un diagrama de datos lo que
 * se dibuja son las cosas que hay que guardar. El editor ya no deja elegir
 * estereotipo —aquí todo lo que se dibuja es una tabla—, así que en la
 * práctica esto sólo distingue las clases que llegan por XMI marcadas como
 * interface, enumeration o service desde Enterprise Architect.
 */
export function isPersistent(umlClass: { stereotype: string | null }): boolean {
  return (
    umlClass.stereotype === null ||
    umlClass.stereotype.length === 0 ||
    umlClass.stereotype === 'entity'
  )
}

/** Visibilidad, con el símbolo que UML usa delante del miembro. */
export const VISIBILITY_OPTIONS = [
  { value: 'public', symbol: '+', label: 'public' },
  { value: 'private', symbol: '−', label: 'private' },
  { value: 'protected', symbol: '#', label: 'protected' },
  { value: 'package', symbol: '~', label: 'package' },
] as const satisfies readonly { value: Visibility; symbol: string; label: string }[]

const VISIBILITY_SYMBOLS: Record<string, string> = Object.fromEntries(
  VISIBILITY_OPTIONS.map((option) => [option.value, option.symbol]),
)

export function visibilitySymbol(visibility: string): string {
  return VISIBILITY_SYMBOLS[visibility] ?? '+'
}

/** La firma de un método tal como se escribe en UML. */
export function methodSignature(method: UmlMethod): string {
  const parameters = method.parameters
    .map((parameter) => `${parameter.name}: ${parameter.data_type}`)
    .join(', ')

  return `${method.name}(${parameters}): ${method.return_type}`
}

/** Multiplicidades que significan «muchos». */
export function isMany(multiplicity: string | null): boolean {
  return multiplicity !== null && (multiplicity === '*' || multiplicity.endsWith('..*'))
}

/**
 * Una asociación con «muchos» en los dos extremos. No se puede convertir en
 * tablas tal cual: necesita una clase intermedia.
 */
export function isManyToMany(relationship: UmlRelationship): boolean {
  return (
    relationship.relationship_type === 'ASSOCIATION' &&
    isMany(relationship.source_multiplicity) &&
    isMany(relationship.target_multiplicity)
  )
}

/**
 * Un nombre que pueda convertirse en un identificador Java. Se comprueba aquí
 * además de en la API para poder explicarlo antes de enviar la petición.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
])

/** Devuelve el motivo por el que el nombre no sirve, o null si sirve. */
export function identifierProblem(value: string): string | null {
  if (!IDENTIFIER_PATTERN.test(value)) {
    return 'Use sólo letras, dígitos y _ , sin empezar por un dígito ni usar espacios.'
  }
  if (JAVA_KEYWORDS.has(value)) {
    return `«${value}» es una palabra reservada de Java.`
  }
  return null
}

/** Longitudes máximas de las columnas, para avisar antes de llamar a la API. */
export const LIMITS = {
  className: 150,
  stereotype: 50,
  attributeName: 150,
  dataType: 50,
  defaultValue: 255,
  methodName: 150,
  /** 150: el retorno puede ser una clase del diagrama. */
  returnType: 150,
  parameterName: 150,
  parameterType: 150,
  relationshipName: 150,
  role: 100,
  multiplicity: 10,
} as const
