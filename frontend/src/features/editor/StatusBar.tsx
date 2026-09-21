import { useDiagramStore } from '../../store/diagram'
import { ASSOCIATION_CLASS_TOOL, isRelationshipTool } from './tools'
import type { Tool } from './tools'
import { RELATIONSHIP_META } from './uml'

/** Qué hace la herramienta activa ahora mismo. */
function hintFor(tool: Tool): string {
  if (tool === 'class') return 'Haga clic en el lienzo para colocar la entidad.'
  if (tool === ASSOCIATION_CLASS_TOOL) {
    return 'Arrastre de una entidad a otra: nacerá entre las dos la entidad intermedia.'
  }
  if (isRelationshipTool(tool)) {
    return `Arrastre de una entidad a otra para crear una ${RELATIONSHIP_META[tool].label.toLowerCase()}.`
  }
  return 'Doble clic en el lienzo para crear una entidad. Doble clic en un nombre para cambiarlo.'
}

export function StatusBar({ tool }: { tool: Tool }) {
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-4 border-t border-ink-200 bg-white px-3 text-[11.5px] text-ink-500">
      <p className="truncate">{hintFor(tool)}</p>

      <div className="flex shrink-0 items-center gap-3 font-mono">
        <span>
          {classes.length} {classes.length === 1 ? 'entidad' : 'entidades'}
        </span>
        <span aria-hidden="true" className="h-3 w-px bg-ink-200" />
        <span>
          {relationships.length} {relationships.length === 1 ? 'relación' : 'relaciones'}
        </span>
        <span aria-hidden="true" className="hidden h-3 w-px bg-ink-200 sm:block" />
        <span className="hidden sm:inline">V · E · Supr</span>
      </div>
    </footer>
  )
}
