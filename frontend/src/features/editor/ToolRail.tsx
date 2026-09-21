import { ClassBoxIcon, CursorIcon } from '../../components/icons'
import { cn } from '../../lib/cn'
import { AssociationClassGlyph, RelationGlyph } from './RelationGlyph'
import { ASSOCIATION_CLASS_TOOL } from './tools'
import type { Tool } from './tools'
import { ASSOCIATION_CLASS_META, DATA_RELATIONSHIP_TYPES, RELATIONSHIP_META } from './uml'

interface ToolRailProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
}

/**
 * Paleta de herramientas del editor.
 *
 * Cada relación se presenta con su propio trazo en lugar de con un icono
 * genérico: quien está aprendiendo UML reconoce antes el rombo relleno de la
 * composición que la palabra «composición».
 */
export function ToolRail({ tool, onToolChange }: ToolRailProps) {
  return (
    <nav
      aria-label="Herramientas del diagrama"
      className="scrollbar-thin flex shrink-0 gap-1 overflow-x-auto border-r border-ink-200 bg-white p-2 lg:w-[172px] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
    >
      <ToolButton
        active={tool === 'select'}
        onClick={() => onToolChange('select')}
        title="Seleccionar y mover  ·  V"
      >
        <CursorIcon className="size-4 shrink-0" />
        <span className="hidden lg:inline">Seleccionar</span>
      </ToolButton>

      <ToolButton
        active={tool === 'class'}
        onClick={() => onToolChange('class')}
        title="Añadir entidad  ·  E  ·  o doble clic en el lienzo"
      >
        <ClassBoxIcon className="size-4 shrink-0" />
        <span className="hidden lg:inline">Entidad</span>
      </ToolButton>

      <p className="hidden px-2 pt-4 pb-1.5 text-[11px] font-semibold text-ink-400 lg:block">
        Relaciones
      </p>
      <span aria-hidden="true" className="mx-1 w-px shrink-0 bg-ink-200 lg:hidden" />

      {DATA_RELATIONSHIP_TYPES.map((type) => (
        <ToolButton
          key={type}
          active={tool === type}
          onClick={() => onToolChange(type)}
          title={`${RELATIONSHIP_META[type].label} — ${RELATIONSHIP_META[type].hint}`}
        >
          <RelationGlyph type={type} className="h-3 w-9 shrink-0" />
          <span className="hidden lg:inline">{RELATIONSHIP_META[type].label}</span>
        </ToolButton>
      ))}

      {/* Se usa igual que las relaciones —de una entidad a otra—, pero va
          aparte porque no dibuja una línea: crea una entidad. */}
      <p className="hidden px-2 pt-4 pb-1.5 text-[11px] font-semibold text-ink-400 lg:block">
        Muchos a muchos
      </p>
      <span aria-hidden="true" className="mx-1 w-px shrink-0 bg-ink-200 lg:hidden" />

      <ToolButton
        active={tool === ASSOCIATION_CLASS_TOOL}
        onClick={() => onToolChange(ASSOCIATION_CLASS_TOOL)}
        title={`${ASSOCIATION_CLASS_META.label} — ${ASSOCIATION_CLASS_META.hint}`}
      >
        <AssociationClassGlyph className="h-3 w-9 shrink-0" />
        <span className="hidden lg:inline">{ASSOCIATION_CLASS_META.label}</span>
      </ToolButton>
    </nav>
  )
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-[3px] border px-2.5 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-signal-600 bg-signal-50 text-signal-700'
          : 'border-transparent text-ink-600 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  )
}
