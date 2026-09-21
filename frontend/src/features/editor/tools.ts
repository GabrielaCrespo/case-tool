import type { RelationshipType } from '../../api/types'

/**
 * La clase de asociación no es un tipo de relación del modelo: es la operación
 * que crea una clase intermedia y las dos asociaciones que la unen a las clases
 * enlazadas. En el rail se elige igual que las demás porque para el usuario es
 * el mismo gesto —tirar una línea de una clase a otra—, así que tiene su propia
 * herramienta en lugar de un valor de `relationship_type` que no existe.
 */
export const ASSOCIATION_CLASS_TOOL = 'ASSOCIATION_CLASS'

/**
 * Herramienta activa del editor.
 * «select» mueve y selecciona, «class» coloca una clase en el lienzo, y el
 * resto se usan tirando de un conector de una clase a otra.
 */
export type Tool = 'select' | 'class' | typeof ASSOCIATION_CLASS_TOOL | RelationshipType

/** Se usa enlazando dos clases, sea para relacionarlas o para intercalar una. */
export function isLinkTool(tool: Tool): boolean {
  return tool !== 'select' && tool !== 'class'
}

/** Dibuja una relación del modelo, con su `relationship_type`. */
export function isRelationshipTool(tool: Tool): tool is RelationshipType {
  return isLinkTool(tool) && tool !== ASSOCIATION_CLASS_TOOL
}
