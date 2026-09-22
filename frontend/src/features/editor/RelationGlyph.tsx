import type { RelationshipType } from '../../api/types'
import { markerUrl } from './markers'
import { ASSOCIATION_CLASS_META, RELATIONSHIP_META } from './uml'

/**
 * Miniatura de una relación: la línea con sus adornos reales.
 * En el rail de herramientas dice más que cualquier icono, porque es
 * exactamente lo que se va a dibujar en el lienzo.
 */
export function RelationGlyph({
  type,
  className,
}: {
  type: RelationshipType
  className?: string
}) {
  const meta = RELATIONSHIP_META[type]
  const colorKey = type.toLowerCase()

  return (
    <svg viewBox="0 0 44 12" className={className} aria-hidden="true" focusable="false">
      <line
        x1={meta.sourceMarker === 'none' ? 2 : 4}
        y1={6}
        x2={meta.targetMarker === 'none' ? 42 : 40}
        y2={6}
        stroke={meta.color}
        strokeWidth={1.5}
        strokeDasharray={meta.dashed ? '5 4' : undefined}
        markerStart={markerUrl(meta.sourceMarker, colorKey)}
        markerEnd={markerUrl(meta.targetMarker, colorKey)}
      />
    </svg>
  )
}

/**
 * Miniatura de la clase de asociación: la línea entre las dos clases con la
 * caja intermedia en medio, que es exactamente lo que va a aparecer.
 */
export function AssociationClassGlyph({ className }: { className?: string }) {
  const color = ASSOCIATION_CLASS_META.color

  return (
    <svg viewBox="0 0 44 12" className={className} aria-hidden="true" focusable="false">
      {/* Discontinua, como las dos líneas que van a quedar en el lienzo. */}
      <line
        x1={2}
        y1={6}
        x2={42}
        y2={6}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      <rect
        x={16}
        y={2}
        width={12}
        height={8}
        fill="#fff"
        stroke={color}
        strokeWidth={1.5}
      />
    </svg>
  )
}
