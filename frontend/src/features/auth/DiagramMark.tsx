/**
 * Un diagrama de clases real, dibujado en SVG.
 *
 * Es lo primero que se ve al entrar y es exactamente lo que hace la
 * herramienta: tres clases, una composición y una asociación con sus
 * multiplicidades. Enseña el producto en lugar de describirlo.
 */
export function DiagramMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 330"
      className={className}
      role="img"
      aria-label="Diagrama de clases con Cliente, Pedido y LineaPedido"
    >
      <defs>
        <marker id="mark-diamond" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto">
          <path d="M11 6L6 9.2 1 6 6 2.8z" fill="#0b5fbf" />
        </marker>
        <pattern id="mark-grid" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="0.8" cy="0.8" r="0.8" fill="#cdd6e3" />
        </pattern>
      </defs>

      <rect width="420" height="330" fill="url(#mark-grid)" />

      {/* Cliente 1 ── * Pedido */}
      <path d="M118 62h92" stroke="#5a6b85" strokeWidth="1.4" fill="none" />
      <text x="124" y="55" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#5a6b85">
        1
      </text>
      <text x="196" y="55" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#5a6b85">
        0..*
      </text>

      {/* Pedido ◆── LineaPedido (composición) */}
      <path
        d="M256 120v46h-96v34"
        stroke="#0b5fbf"
        strokeWidth="1.4"
        fill="none"
        markerEnd="url(#mark-diamond)"
      />
      <text x="262" y="136" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#0b5fbf">
        1
      </text>
      <text x="124" y="196" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#0b5fbf">
        1..*
      </text>

      <ClassBox x={26} y={34} width={92} title="Cliente" rows={['+ nit: String']} />
      <ClassBox
        x={210}
        y={34}
        width={124}
        title="Pedido"
        rows={['+ fecha: Date', '+ total: Double']}
        accent
      />
      <ClassBox
        x={98}
        y={200}
        width={140}
        title="LineaPedido"
        rows={['+ cantidad: Integer', '+ precio: Double']}
      />
    </svg>
  )
}

const ROW_HEIGHT = 20
const HEADER_HEIGHT = 30

function ClassBox({
  x,
  y,
  width,
  title,
  rows,
  accent = false,
}: {
  x: number
  y: number
  width: number
  title: string
  rows: string[]
  accent?: boolean
}) {
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + 8

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#ffffff"
        stroke={accent ? '#4b3be4' : '#2c3a52'}
        strokeWidth="1.3"
      />
      <path
        d={`M${x} ${y + HEADER_HEIGHT}h${width}`}
        stroke={accent ? '#4b3be4' : '#2c3a52'}
        strokeWidth="1.3"
      />
      <text
        x={x + width / 2}
        y={y + 20}
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="13"
        fontWeight="600"
        fill="#141d2e"
      >
        {title}
      </text>
      {rows.map((row, index) => (
        <text
          key={row}
          x={x + 9}
          y={y + HEADER_HEIGHT + 15 + index * ROW_HEIGHT}
          fontFamily="JetBrains Mono, monospace"
          fontSize="10.5"
          fill="#445674"
        >
          {row}
        </text>
      ))}
    </g>
  )
}
