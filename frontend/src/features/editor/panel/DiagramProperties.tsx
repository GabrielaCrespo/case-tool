import { SparkIcon } from '../../../components/icons'
import { Button } from '../../../components/ui/Button'
import { CONTROL_COMPACT } from '../../../components/ui/control-styles'
import { formatRelative } from '../../../lib/format'
import { useDiagramStore } from '../../../store/diagram'
import { RELATIONSHIP_META } from '../uml'
import { CommitInput } from './CommitInput'
import { PanelField, PanelReadout, PanelSection } from './PanelBits'

const NAME_MAX_LENGTH = 150

/** Lo que se ve cuando no hay nada seleccionado: el diagrama en conjunto. */
export function DiagramProperties() {
  const diagram = useDiagramStore((state) => state.diagram)
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)
  const updateDiagram = useDiagramStore((state) => state.updateDiagram)
  const select = useDiagramStore((state) => state.select)
  const inferAttributeTypes = useDiagramStore((state) => state.inferAttributeTypes)

  if (!diagram) return null

  const attributeCount = classes.reduce((total, umlClass) => total + umlClass.attributes.length, 0)
  const untyped = classes.reduce(
    (total, umlClass) =>
      total + umlClass.attributes.filter((attribute) => attribute.data_type === null).length,
    0,
  )

  return (
    <>
      <PanelSection title="Diagrama">
        <div className="flex flex-col gap-2.5">
          <PanelField label="Nombre">
            <CommitInput
              value={diagram.name}
              ariaLabel="Nombre del diagrama"
              maxLength={NAME_MAX_LENGTH}
              validate={(value) => (value.length === 0 ? 'El nombre no puede estar vacío.' : null)}
              onCommit={(name) => void updateDiagram({ name })}
            />
          </PanelField>

          <PanelField label="Descripción" htmlFor="diagram-description">
            <textarea
              id="diagram-description"
              defaultValue={diagram.description ?? ''}
              rows={3}
              placeholder="Qué representa este diagrama."
              onBlur={(event) => {
                const description = event.target.value.trim()
                if (description !== (diagram.description ?? '')) {
                  void updateDiagram({ description: description || null })
                }
              }}
              className={`${CONTROL_COMPACT} resize-y`}
            />
          </PanelField>

          <div className="pt-1">
            <PanelReadout label="Actualizado" value={formatRelative(diagram.updated_at)} />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Contenido">
        <div className="flex flex-col">
          <PanelReadout label="Entidades" value={String(classes.length)} />
          <PanelReadout label="Atributos" value={String(attributeCount)} />
          <PanelReadout label="Relaciones" value={String(relationships.length)} />
        </div>

        {/* Un modelo importado de una imagen o de un XMI llega con columnas sin
            tipo. Ponerlas una a una es lento y el nombre ya lo está diciendo:
            aquí se rellenan todas de una vez y se corrige lo que no encaje. */}
        {untyped > 0 && (
          <div className="mt-3 border-t border-ink-200 pt-3">
            <p className="mb-2 text-[12.5px] leading-snug text-ink-600">
              {untyped === 1
                ? 'Hay 1 atributo sin tipo de dato.'
                : `Hay ${untyped} atributos sin tipo de dato.`}{' '}
              Se puede deducir por el nombre y corregir después lo que haga falta.
            </p>
            <Button
              size="sm"
              icon={<SparkIcon className="size-3.5" />}
              onClick={() => void inferAttributeTypes()}
              className="w-full"
            >
              Deducir tipos
            </Button>
          </div>
        )}
      </PanelSection>

      <PanelSection title="Entidades del diagrama" count={classes.length}>
        {classes.length === 0 ? (
          <p className="py-1 text-[12.5px] leading-relaxed text-ink-500">
            El lienzo está vacío. Haga doble clic donde quiera colocar la primera entidad.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {classes.map((umlClass) => (
              <li key={umlClass.id}>
                <button
                  type="button"
                  onClick={() => select({ kind: 'class', id: umlClass.id })}
                  className="flex w-full items-baseline justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
                >
                  <span className="truncate text-[12.5px] font-medium text-ink-800">
                    {umlClass.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-400">
                    {umlClass.attributes.length}a · {umlClass.methods.length}m
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {relationships.length > 0 && (
        <PanelSection title="Relaciones" count={relationships.length}>
          <ul className="flex flex-col gap-0.5">
            {relationships.map((relationship) => {
              const source = classes.find(
                (umlClass) => umlClass.id === relationship.source_class_id,
              )
              const target = classes.find(
                (umlClass) => umlClass.id === relationship.target_class_id,
              )
              const meta = RELATIONSHIP_META[relationship.relationship_type]

              return (
                <li key={relationship.id}>
                  <button
                    type="button"
                    onClick={() => select({ kind: 'relationship', id: relationship.id })}
                    className="flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-[1px]"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-700">
                      {source?.name ?? '?'} → {target?.name ?? '?'}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-400">{meta.short}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </PanelSection>
      )}
    </>
  )
}
