/**
 * CU06 — Lo que comparten el generador y el analizador de XMI.
 *
 * XMI es el formato con el que las herramientas UML se pasan modelos entre
 * ellas. Aquí no hay ningún modelo nuevo: el generador lee el diagrama tal
 * como lo devuelve CU02 y el analizador produce una lectura del archivo que
 * después se crea con los mismos servicios del editor. Este módulo sólo
 * contiene las convenciones del formato —cómo se escriben los identificadores,
 * las multiplicidades y los tipos de relación—, que son las que tienen que
 * coincidir en los dos sentidos para que exportar e importar sea reversible.
 *
 * La referencia es XMI 2.1 con UML 2.1, que es lo que exporta Enterprise
 * Architect cuando se elige «XMI 2.1» en su diálogo de exportación.
 */

/** Espacios de nombres de XMI 2.1 / UML 2.1. */
export const XMI_NAMESPACES = {
  uml: 'http://schema.omg.org/spec/UML/2.1',
  xmi: 'http://schema.omg.org/spec/XMI/2.1',
} as const;

export const XMI_VERSION = '2.1';

/**
 * Identificador con la forma que usa Enterprise Architect.
 *
 * Nuestros identificadores son UUID, y EA los suyos los escribe como
 * «EAID_» seguido de un UUID en mayúsculas con guiones bajos. Respetar esa
 * forma no es decorativo: EA reconoce sus propios identificadores y, cuando un
 * archivo vuelve de otra herramienta, puede emparejar los elementos en lugar
 * de duplicarlos.
 */
export function toXmiId(uuid: string, prefix = 'EAID'): string {
  return `${prefix}_${uuid.replace(/-/g, '_').toUpperCase()}`;
}

/** Deshace toXmiId cuando el identificador venía de nosotros. */
export function fromXmiId(id: string): string | null {
  const match = /^[A-Za-z]+_([0-9A-Fa-f_]{36})$/.exec(id.trim());
  if (match === null) return null;

  const uuid = match[1].replace(/_/g, '-').toLowerCase();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
    ? uuid
    : null;
}

/** Tipos de relación del modelo, con su elemento UML equivalente. */
export const RELATIONSHIP_TO_UML: Record<string, string> = {
  ASSOCIATION: 'uml:Association',
  AGGREGATION: 'uml:Association',
  COMPOSITION: 'uml:Association',
  INHERITANCE: 'uml:Generalization',
  REALIZATION: 'uml:Realization',
  DEPENDENCY: 'uml:Dependency',
};

/**
 * Multiplicidad UML partida en sus dos extremos, como la escribe XMI.
 *
 * En XMI cada extremo de una asociación lleva `lowerValue` y `upperValue` por
 * separado, mientras que nosotros guardamos la multiplicidad como un texto
 * («0..*»). Estas dos funciones traducen en un sentido y en el otro.
 */
export interface Bounds {
  lower: string;
  upper: string;
}

export function toBounds(multiplicity: string | null): Bounds | null {
  if (multiplicity === null) return null;

  const text = multiplicity.trim();
  if (text.length === 0) return null;

  if (text === '*') return { lower: '0', upper: '*' };

  const range = /^(\d+)\.\.(\d+|\*)$/.exec(text);
  if (range !== null) {
    return { lower: range[1], upper: range[2] };
  }

  // Un número suelto: «1» es exactamente uno, «3» exactamente tres.
  return /^\d+$/.test(text) ? { lower: text, upper: text } : null;
}

export function fromBounds(bounds: Partial<Bounds>): string | null {
  const lower = bounds.lower?.trim();
  const upper = normalizeUpper(bounds.upper);

  // Sin ninguno de los dos, la relación no declaraba multiplicidad.
  if (lower === undefined && upper === null) return null;

  const low = lower ?? '1';
  const high = upper ?? low;

  if (low === high) return low;
  if (low === '0' && high === '*') return '0..*';

  return `${low}..${high}`;
}

/**
 * «Muchos» se escribe de varias formas según la herramienta y la versión:
 * «*», «-1» (el valor que UML da a unlimited) y «unlimited» son lo mismo.
 */
function normalizeUpper(value: string | undefined): string | null {
  if (value === undefined) return null;

  const text = value.trim();
  if (text.length === 0) return null;

  return text === '-1' || text === '*' || text.toLowerCase() === 'unlimited' ? '*' : text;
}

/**
 * El texto de un archivo, leído con la codificación que él mismo declara.
 *
 * No es un detalle: Enterprise Architect exporta en windows-1252 y lo dice en
 * su primera línea. Leer esos bytes como UTF-8 no da error —el XML sigue
 * siendo válido— pero estropea en silencio todas las letras acentuadas, y una
 * clase «Categoría» entra como «Categor?a» o se queda por el camino al limpiar
 * el nombre. El prólogo siempre es ASCII, así que se puede mirar antes de
 * saber en qué está escrito el resto.
 */
export function decodeXmi(buffer: Buffer): string {
  const declared = /encoding\s*=\s*["']([\w-]+)["']/i
    .exec(buffer.subarray(0, 200).toString('latin1'))?.[1]
    ?.toLowerCase();

  const text =
    declared === undefined || declared === 'utf-8' || declared === 'utf8'
      ? buffer.toString('utf8')
      : decodeAs(buffer, declared);

  // Algunos editores dejan la marca de orden al guardar; delante del «<?xml»
  // hace que el archivo deje de ser XML válido.
  return text.replace(/^﻿/, '');
}

function decodeAs(buffer: Buffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    // Una codificación que Node no conoce: latin1 conserva byte a byte lo que
    // se pueda, en vez de llenarlo todo de caracteres de relleno.
    return buffer.toString('latin1');
  }
}

/** Visibilidades UML; coinciden con las del tipo enumerado uml_visibility. */
export const VISIBILITIES = ['public', 'private', 'protected', 'package'] as const;

export function toVisibility(value: string | undefined, fallback: string): string {
  const text = (value ?? '').trim().toLowerCase();

  return (VISIBILITIES as readonly string[]).includes(text) ? text : fallback;
}

/**
 * Escapa lo que va dentro de un atributo o de un texto XML.
 *
 * Además de los cinco caracteres de siempre se escapa todo lo que no sea ASCII
 * —«Categoría» se escribe «Categor&#237;a»—. El motivo es la codificación: el
 * archivo se declara en windows-1252, que es lo que declaran los de Enterprise
 * Architect, y una «í» escrita en UTF-8 dentro de un archivo que dice ser
 * windows-1252 se lee como dos caracteres raros. Una referencia numérica
 * significa lo mismo en las dos codificaciones, así que el nombre sobrevive
 * sea cual sea la que use quien lo abra.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // La «u» hace que un emoji —dos unidades de código— se escape como uno solo.
    .replace(/[^\x20-\x7e\t\n\r]/gu, (character) => `&#${character.codePointAt(0)};`);
}
