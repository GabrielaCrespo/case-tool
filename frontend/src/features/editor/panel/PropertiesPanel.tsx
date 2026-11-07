import { CloseIcon } from '../../../components/icons'
import { IconButton } from '../../../components/ui/Button'
import { useLockedByOther } from '../../../realtime/useLock'
import { useDiagramStore } from '../../../store/diagram'
import { RELATIONSHIP_META } from '../uml'
import { ClassProperties } from './ClassProperties'
import { DiagramProperties } from './DiagramProperties'
import { RelationshipProperties } from './RelationshipProperties'
import { ValidationSection } from './ValidationSection'

/**
 * Panel de propiedades: muestra lo que se puede cambiar del elemento
 * seleccionado, y los datos del diagrama cuando no hay ninguno.
 */
export function PropertiesPanel({ onRequestDelete }: { onRequestDelete: () => void }) {
  const selection = useDiagramStore((state) => state.selection)
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)
  const select = useDiagramStore((state) => state.select)

  const selectedClass =
    selection?.kind === 'class'
      ? (classes.find((umlClass) => umlClass.id === selection.id) ?? null)
      : null

  const selectedRelationship =
    selection?.kind === 'relationship'
      ? (relationships.find((relationship) => relationship.id === selection.id) ?? null)
      : null

  // CU03 — Si otro usuario tiene tomado el elemento, el panel queda en sólo
  // lectura; la API rechazaría igualmente cualquier cambio.
  const lockedBy = useLockedByOther(
    selection?.kind === 'relationship' ? 'relationship' : 'class',
    selection?.id,
  )

  const heading = selectedClass
    ? 'Entidad seleccionada'
    : selectedRelationship
      ? `${RELATIONSHIP_META[selectedRelationship.relationship_type].label} seleccionada`
      : 'Propiedades del diagrama'

  return (
    <aside
      aria-label="Panel de propiedades"
      // Ocupa el alto que le deja la columna y no más: con `shrink-0` crecía
      // hasta el alto de su contenido, la lista de abajo nunca hacía scroll y
      // su final tapaba la barra de estado en cuanto había relaciones.
      className="flex min-h-0 w-full flex-1 flex-col border-l border-ink-200 bg-white lg:w-[300px]"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-ink-200 px-3">
        <h2 className="truncate text-[13px] font-semibold text-ink-900">{heading}</h2>
        {selection && (
          <IconButton label="Quitar la selección" onClick={() => select(null)}>
            <CloseIcon className="size-4" />
          </IconButton>
        )}
      </header>

      {lockedBy && (
        <p className="shrink-0 border-b border-pending-600/40 bg-pending-100 px-3 py-2 text-[12px] leading-snug text-pending-700">
          <strong className="font-semibold">{lockedBy.full_name}</strong> está editando este
          elemento. Podrá modificarlo cuando termine.
        </p>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {/* `fieldset` deshabilitado: desactiva de una vez todos los campos y
            botones que contiene, sin tener que propagar el estado a cada uno. */}
        <fieldset disabled={lockedBy !== null} className="contents">
          {selectedClass ? (
            <ClassProperties umlClass={selectedClass} onRequestDelete={onRequestDelete} />
          ) : selectedRelationship ? (
            <RelationshipProperties
              relationship={selectedRelationship}
              onRequestDelete={onRequestDelete}
            />
          ) : (
            <DiagramProperties />
          )}
        </fieldset>

        {/* Fuera del fieldset: validar el modelo es sólo leerlo, y debe poder
            hacerse aunque otro tenga tomado el elemento seleccionado. */}
        <ValidationSection />
      </div>
    </aside>
  )
}
