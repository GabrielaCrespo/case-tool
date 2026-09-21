import { RELATIONSHIP_TYPES } from '../../api/types'
import { RELATIONSHIP_META, SELECTED_COLOR } from './uml'
import type { MarkerShape } from './uml'

/**
 * Geometría de los adornos de los extremos de una relación UML.
 * Vive aparte del componente que los dibuja porque las aristas y las
 * miniaturas del rail de herramientas necesitan referenciarlos por id.
 */

export interface MarkerGeometry {
  viewBox: string
  path: string
  refX: number
  refY: number
  width: number
  height: number
  filled: boolean
  closed: boolean
}

export const MARKER_GEOMETRY: Record<Exclude<MarkerShape, 'none'>, MarkerGeometry> = {
  // Punta de flecha abierta, al final de la línea.
  'open-arrow': {
    viewBox: '0 0 10 10',
    path: 'M1 1L9 5L1 9',
    refX: 9,
    refY: 5,
    width: 11,
    height: 11,
    filled: false,
    closed: false,
  },
  // Triángulo hueco de la herencia y la realización, al final de la línea.
  'hollow-triangle': {
    viewBox: '0 0 12 12',
    path: 'M1 1L11 6L1 11Z',
    refX: 11,
    refY: 6,
    width: 14,
    height: 14,
    filled: false,
    closed: true,
  },
  // Rombo de la agregación, en el extremo del «todo».
  'hollow-diamond': {
    viewBox: '0 0 16 10',
    path: 'M1 5L8 1L15 5L8 9Z',
    refX: 1,
    refY: 5,
    width: 17,
    height: 11,
    filled: false,
    closed: true,
  },
  // Rombo relleno de la composición.
  'filled-diamond': {
    viewBox: '0 0 16 10',
    path: 'M1 5L8 1L15 5L8 9Z',
    refX: 1,
    refY: 5,
    width: 17,
    height: 11,
    filled: true,
    closed: true,
  },
}

export const MARKER_SHAPES = Object.keys(MARKER_GEOMETRY) as Array<Exclude<MarkerShape, 'none'>>

/** Un marcador por forma y color; el color indica el tipo de relación. */
export function markerId(shape: Exclude<MarkerShape, 'none'>, colorKey: string): string {
  return `uml-${shape}-${colorKey}`
}

export function markerUrl(shape: MarkerShape, colorKey: string): string | undefined {
  return shape === 'none' ? undefined : `url(#${markerId(shape, colorKey)})`
}

/** Colores para los que hay que generar marcadores: un tipo, o la selección. */
export function markerColorEntries(): Array<[string, string]> {
  const entries: Array<[string, string]> = RELATIONSHIP_TYPES.map((type) => [
    type.toLowerCase(),
    RELATIONSHIP_META[type].color,
  ])
  entries.push(['selected', SELECTED_COLOR])

  return entries
}
