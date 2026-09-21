/**
 * CU02 — Catálogo del modelo UML.
 *
 * Aquí vive lo que el diagrama puede contener: qué tipos de dato existen, qué
 * visibilidades, qué estereotipos y qué es un nombre válido. Es deliberadamente
 * el único sitio donde se decide eso, porque CU07 generará el backend Spring
 * Boot leyendo el modelo guardado: un tipo que no esté aquí sería un tipo que
 * el generador no sabría traducir a Java.
 */

/** Visibilidad de clases, atributos y métodos (tipo enumerado uml_visibility). */
export const VISIBILITIES = ['public', 'private', 'protected', 'package'] as const;

export type Visibility = (typeof VISIBILITIES)[number];

/**
 * Estereotipos admitidos. «abstract» no está: ser abstracta no es lo que la
 * clase representa, sino una característica suya, y para eso está is_abstract.
 * La ausencia de estereotipo se guarda como NULL.
 */
export const STEREOTYPES = ['entity', 'interface', 'service', 'enumeration'] as const;

export type Stereotype = (typeof STEREOTYPES)[number];

/** Correspondencia de un tipo UML con Java y con PostgreSQL. */
export interface DataTypeMapping {
  /** Tipo Java que generará CU07. */
  java: string;
  /** Columna PostgreSQL equivalente. */
  sql: string;
  /**
   * Tipo heredado de una versión anterior del editor: se sigue aceptando para
   * no invalidar diagramas ya guardados, pero no se ofrece al elegir.
   */
  legacy?: boolean;
}

/**
 * Tipos de dato de los atributos, con su traducción.
 * El orden es el que se ofrece en la interfaz.
 */
export const DATA_TYPES: Record<string, DataTypeMapping> = {
  String: { java: 'String', sql: 'VARCHAR' },
  Integer: { java: 'Integer', sql: 'INTEGER' },
  Long: { java: 'Long', sql: 'BIGINT' },
  Double: { java: 'Double', sql: 'DOUBLE PRECISION' },
  Float: { java: 'Float', sql: 'REAL' },
  Boolean: { java: 'Boolean', sql: 'BOOLEAN' },
  BigDecimal: { java: 'BigDecimal', sql: 'NUMERIC' },
  LocalDate: { java: 'LocalDate', sql: 'DATE' },
  LocalDateTime: { java: 'LocalDateTime', sql: 'TIMESTAMP' },
  UUID: { java: 'UUID', sql: 'UUID' },

  // Heredados del catálogo anterior, con la traducción que les corresponde.
  Text: { java: 'String', sql: 'TEXT', legacy: true },
  Date: { java: 'LocalDate', sql: 'DATE', legacy: true },
  DateTime: { java: 'LocalDateTime', sql: 'TIMESTAMP', legacy: true },
};

export const DATA_TYPE_NAMES = Object.keys(DATA_TYPES);

/** Los que se ofrecen al elegir un tipo; los heredados no aparecen. */
export const OFFERED_DATA_TYPES = DATA_TYPE_NAMES.filter((name) => !DATA_TYPES[name].legacy);

export function isDataType(value: string): boolean {
  return Object.hasOwn(DATA_TYPES, value);
}

/** Tipo de retorno de un método: los de arriba, más «void». */
export function isReturnType(value: string): boolean {
  return value === 'void' || isDataType(value);
}

/**
 * Un nombre que pueda convertirse en un identificador Java.
 * Se exige además que no sea una palabra reservada del lenguaje: «class» o
 * «new» serían nombres imposibles en el código generado.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while',
  // Literales: tampoco pueden ser un identificador.
  'true', 'false', 'null',
]);

export function isJavaIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value) && !JAVA_KEYWORDS.has(value);
}

/** Motivo por el que un nombre no sirve, o null si sirve. */
export function identifierProblem(value: string): string | null {
  if (!IDENTIFIER_PATTERN.test(value)) {
    return 'sólo puede tener letras, dígitos y _ , y no puede empezar por un dígito';
  }
  if (JAVA_KEYWORDS.has(value)) {
    return `«${value}» es una palabra reservada de Java`;
  }
  return null;
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
};

/** Ejemplo de valor por defecto válido, para poder explicar el error. */
export const DEFAULT_VALUE_EXAMPLES: Record<string, string> = {
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
};

/**
 * Comprueba que el valor por defecto pueda escribirse en una columna de ese
 * tipo. String y Text admiten cualquier texto, así que no tienen patrón.
 */
export function isDefaultValueCompatible(dataType: string, value: string): boolean {
  const pattern = DEFAULT_VALUE_PATTERNS[dataType];

  return pattern === undefined || pattern.test(value);
}
