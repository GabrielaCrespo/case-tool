import { MARKER_GEOMETRY, MARKER_SHAPES, markerColorEntries, markerId } from './markers'

/**
 * Los adornos de los extremos de las relaciones, en notación UML.
 *
 * Se definen una sola vez como <marker> de SVG y se referencian por id desde
 * cada arista: así el triángulo de la herencia o el rombo de la composición se
 * dibujan siempre igual y orientados según la dirección de la línea.
 */
export function UmlMarkers() {
  return (
    <svg className="pointer-events-none absolute size-0" aria-hidden="true" focusable="false">
      <defs>
        {markerColorEntries().map(([colorKey, color]) =>
          MARKER_SHAPES.map((shape) => {
            const geometry = MARKER_GEOMETRY[shape]
            return (
              <marker
                key={markerId(shape, colorKey)}
                id={markerId(shape, colorKey)}
                viewBox={geometry.viewBox}
                refX={geometry.refX}
                refY={geometry.refY}
                markerWidth={geometry.width}
                markerHeight={geometry.height}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d={geometry.path}
                  fill={geometry.filled ? color : geometry.closed ? '#ffffff' : 'none'}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeLinejoin="miter"
                  strokeLinecap="round"
                />
              </marker>
            )
          }),
        )}
      </defs>
    </svg>
  )
}
