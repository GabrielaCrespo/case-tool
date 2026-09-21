import { BadRequestException } from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import {
  DEFAULT_VALUE_EXAMPLES,
  OFFERED_DATA_TYPES,
  STEREOTYPES,
  identifierProblem,
  isDataType,
  isDefaultValueCompatible,
} from './uml-catalog.js';
import type { Stereotype } from './uml-catalog.js';

/**
 * Validaciones compartidas por los elementos del diagrama (clases, atributos,
 * métodos y relaciones). Las columnas VARCHAR se tipan como Varchar<N>: un
 * string "marcado" que sólo debe construirse tras comprobar su longitud, que es
 * justo lo que hacen estas funciones.
 */

/** Código de PostgreSQL para violación de restricción única. */
const UNIQUE_VIOLATION = '23505';

/** Multiplicidades admitidas: '1', '0..1', '0..*', '1..*', '2..5', '*'... */
const MULTIPLICITY_PATTERN = /^(\*|\d+|\d+\.\.(\d+|\*))$/;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requiredVarchar<N extends number>(
  value: unknown,
  field: string,
  maxLength: N,
): Varchar<N> {
  if (typeof value !== 'string') {
    throw new BadRequestException(`El campo ${field} es obligatorio y debe ser un texto.`);
  }

  const text = value.trim();
  if (text.length === 0) {
    throw new BadRequestException(`El campo ${field} no puede estar vacío.`);
  }
  if (text.length > maxLength) {
    throw new BadRequestException(
      `El campo ${field} no puede superar los ${maxLength} caracteres.`,
    );
  }

  return text as Varchar<N>;
}

/** Devuelve null cuando el valor es null, undefined o una cadena vacía. */
export function optionalVarchar<N extends number>(
  value: unknown,
  field: string,
  maxLength: N,
): Varchar<N> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`El campo ${field} debe ser un texto.`);
  }

  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  if (text.length > maxLength) {
    throw new BadRequestException(
      `El campo ${field} no puede superar los ${maxLength} caracteres.`,
    );
  }

  return text as Varchar<N>;
}

/**
 * Nombre de una clase, atributo, método o parámetro. Además de las reglas de
 * la columna, tiene que poder convertirse en un identificador Java: es lo que
 * CU07 escribirá literalmente en el código generado.
 */
export function requiredIdentifier<N extends number>(
  value: unknown,
  field: string,
  maxLength: N,
): Varchar<N> {
  const name = requiredVarchar(value, field, maxLength);
  const problem = identifierProblem(name);

  if (problem !== null) {
    throw new BadRequestException(`El campo ${field} no es un nombre válido: ${problem}.`);
  }

  return name;
}

/** Estereotipo de una clase; null cuando no tiene ninguno. */
export function optionalStereotype(value: unknown, field: string): Varchar<50> | null {
  const stereotype = optionalVarchar(value, field, 50);

  if (stereotype !== null && !STEREOTYPES.includes(stereotype as Stereotype)) {
    throw new BadRequestException(
      `El campo ${field} debe ser uno de: ${STEREOTYPES.join(', ')}.`,
    );
  }

  return stereotype;
}

/** Tipo de dato de un atributo: sólo los del catálogo. */
export function requiredDataType(value: unknown, field: string): Varchar<50> {
  const dataType = requiredVarchar(value, field, 50);

  if (!isDataType(dataType)) {
    throw new BadRequestException(
      `El campo ${field} debe ser uno de: ${OFFERED_DATA_TYPES.join(', ')}.`,
    );
  }

  return dataType;
}

/**
 * Tipo de dato cuando puede no haberlo.
 *
 * Un atributo sin tipo es un atributo a medio describir, no un atributo mal
 * formado: un diagrama dibujado en una pizarra suele listar «id, nombre,
 * correo» sin decir de qué son. El nombre sí es obligatorio. Lo que no se
 * hace nunca es rellenar el hueco con un tipo inventado —el modelo guarda lo
 * que se sabe, y el validador del diagrama avisa de lo que falta—.
 */
export function optionalDataType(value: unknown, field: string): Varchar<50> | null {
  const dataType = optionalVarchar(value, field, 50);

  if (dataType !== null && !isDataType(dataType)) {
    throw new BadRequestException(
      `El campo ${field} debe ser uno de: ${OFFERED_DATA_TYPES.join(', ')}.`,
    );
  }

  return dataType;
}

/**
 * Valor por defecto de un atributo. Se comprueba contra el tipo porque un
 * «abc» en una columna INTEGER rompería el backend generado, no este editor.
 */
export function assertDefaultValueMatchesType(
  dataType: string | null,
  defaultValue: string | null,
): void {
  // Sin tipo no hay nada contra lo que comprobar el valor: el aviso lo da el
  // validador del diagrama, que es quien ve que falta el tipo.
  if (dataType === null || defaultValue === null || isDefaultValueCompatible(dataType, defaultValue)) {
    return;
  }

  const example = DEFAULT_VALUE_EXAMPLES[dataType];
  throw new BadRequestException(
    `El valor por defecto «${defaultValue}» no es compatible con el tipo ${dataType}` +
      (example ? `. Ejemplo válido: ${example}.` : '.'),
  );
}

/** Para columnas TEXT, que no tienen longitud máxima. */
export function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`El campo ${field} debe ser un texto.`);
  }

  const text = value.trim();
  return text.length === 0 ? null : text;
}

/**
 * Un UUID mal formado provocaría un error de PostgreSQL (22P02) y por tanto un
 * 500; comprobándolo aquí se responde 400, que es lo que corresponde.
 */
export function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException(`El campo ${field} debe ser un UUID válido.`);
  }

  return value;
}

export function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`El campo ${field} debe ser verdadero o falso.`);
  }

  return value;
}

/** Número real: se usa para las coordenadas pos_x y pos_y. */
export function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`El campo ${field} debe ser un número.`);
  }

  return value;
}

/**
 * Tamaño de una clase en el lienzo (width/height). Null significa «automático
 * según el contenido»: es el valor con el que empieza toda clase antes de que
 * alguien la redimensione a mano.
 */
export function optionalSize(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`El campo ${field} debe ser un número.`);
  }
  if (value < min || value > max) {
    throw new BadRequestException(`El campo ${field} debe estar entre ${min} y ${max}.`);
  }

  return value;
}

/** Entero: se usa para order_index, que ordena atributos y métodos. */
export function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException(`El campo ${field} debe ser un número entero.`);
  }

  return value;
}

export function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new BadRequestException(
      `El campo ${field} debe ser uno de: ${allowed.join(', ')}.`,
    );
  }

  return value as T;
}

/**
 * Forma de una multiplicidad UML. Se expone aparte de optionalMultiplicity
 * porque el asistente de IA (CU04) necesita comprobarla sin lanzar todavía: si
 * una sola multiplicidad viene mal, se rechaza la instrucción entera antes de
 * tocar el diagrama.
 */
export function isMultiplicity(value: string): boolean {
  return MULTIPLICITY_PATTERN.test(value);
}

/** Multiplicidad UML; la columna admite 10 caracteres. */
export function optionalMultiplicity(value: unknown, field: string): Varchar<10> | null {
  const multiplicity = optionalVarchar(value, field, 10);

  if (multiplicity !== null && !isMultiplicity(multiplicity)) {
    throw new BadRequestException(
      `El campo ${field} no es una multiplicidad válida. Ejemplos: 1, 0..1, 0..*, 1..*.`,
    );
  }

  return multiplicity;
}

/** Exige que el PATCH traiga al menos un campo modificable. */
export function assertHasChanges(changes: object, allowed: readonly string[]): void {
  if (Object.keys(changes).length === 0) {
    throw new BadRequestException(
      `Debe indicar al menos un campo a modificar: ${allowed.join(', ')}.`,
    );
  }
}

/**
 * Detecta la violación de un UNIQUE de la base de datos, para traducirla a un
 * 409 en lugar de dejar que se convierta en un 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { sqlState?: unknown; cause?: { code?: unknown } } | null;

  return candidate?.sqlState === UNIQUE_VIOLATION || candidate?.cause?.code === UNIQUE_VIOLATION;
}
