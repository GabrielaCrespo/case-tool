import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { UmlRelationship } from '../../api/types'
import { markerUrl } from './markers'
import { RELATIONSHIP_META, SELECTED_COLOR } from './uml'
import type { MarkerShape } from './uml'

export type UmlEdgeData = {
  relationship: UmlRelationship
}

export type UmlEdgeType = Edge<UmlEdgeData, 'uml'>

/** Separación de las etiquetas respecto al extremo de la línea. */
function endOffset(position: Position): { dx: number; dy: number } {
  switch (position) {
    case Position.Top:
      return { dx: 15, dy: -18 }
    case Position.Bottom:
      return { dx: 15, dy: 18 }
    case Position.Left:
      return { dx: -24, dy: -11 }
    default:
      return { dx: 24, dy: -11 }
  }
}

/**
 * Una relación UML.
 *
 * El trazo va en ortogonal, como en cualquier herramienta CASE, y los adornos
 * de los extremos salen de la notación: rombo en el «todo» de una composición o
 * agregación, triángulo hueco apuntando a la superclase en una herencia.
 */
export function UmlRelationEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<UmlEdgeType>) {
  const relationship = data?.relationship
  if (!relationship) return null

  const meta = RELATIONSHIP_META[relationship.relationship_type]
  const color = selected ? SELECTED_COLOR : meta.color
  const colorKey = selected ? 'selected' : relationship.relationship_type.toLowerCase()

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 2,
  })

  // En una asociación, la punta de flecha sólo aparece cuando la navegabilidad
  // es de un solo sentido: si va en ambos, UML la dibuja sin puntas.
  let sourceShape: MarkerShape = meta.sourceMarker
  let targetShape: MarkerShape = meta.targetMarker
  if (relationship.relationship_type === 'ASSOCIATION') {
    const { is_navigable_source: fromSource, is_navigable_target: toTarget } = relationship
    if (toTarget && !fromSource) targetShape = 'open-arrow'
    if (fromSource && !toTarget) sourceShape = 'open-arrow'
  }

  const sourceLabel = endOffset(sourcePosition)
  const targetLabel = endOffset(targetPosition)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={22}
        markerStart={markerUrl(sourceShape, colorKey)}
        markerEnd={markerUrl(targetShape, colorKey)}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.2 : 1.5,
          strokeDasharray: meta.dashed ? '7 5' : undefined,
        }}
      />

      <EdgeLabelRenderer>
        <EndLabel
          x={sourceX + sourceLabel.dx}
          y={sourceY + sourceLabel.dy}
          multiplicity={relationship.source_multiplicity}
          role={relationship.source_role}
          color={color}
        />
        <EndLabel
          x={targetX + targetLabel.dx}
          y={targetY + targetLabel.dy}
          multiplicity={relationship.target_multiplicity}
          role={relationship.target_role}
          color={color}
        />

        {relationship.name && (
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded-[2px] border border-ink-200 bg-white/95 px-1.5 py-px text-[11px] font-medium text-ink-700"
          >
            {relationship.name}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

/** Multiplicidad y rol de un extremo de la relación. */
function EndLabel({
  x,
  y,
  multiplicity,
  role,
  color,
}: {
  x: number
  y: number
  multiplicity: string | null
  role: string | null
  color: string
}) {
  if (!multiplicity && !role) return null

  return (
    <div
      style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
      className="pointer-events-none absolute flex flex-col items-center leading-tight"
    >
      {multiplicity && (
        <span className="font-mono text-[11px] font-medium" style={{ color }}>
          {multiplicity}
        </span>
      )}
      {role && <span className="text-[10.5px] text-ink-500 italic">{role}</span>}
    </div>
  )
}
