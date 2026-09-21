import type { RelationshipType, UmlRelationship } from '../../../api/types'
import { RefreshIcon, TrashIcon } from '../../../components/icons'
import { Button } from '../../../components/ui/Button'
import { CONTROL_COMPACT } from '../../../components/ui/control-styles'
import { Checkbox } from '../../../components/ui/Field'
import { cn } from '../../../lib/cn'
import { useDiagramStore } from '../../../store/diagram'
import { RelationGlyph } from '../RelationGlyph'
import {
  COMMON_MULTIPLICITIES,
  DATA_RELATIONSHIP_TYPES,
  LIMITS,
  RELATIONSHIP_META,
  isManyToMany,
  isValidMultiplicity,
} from '../uml'
import { CommitInput } from './CommitInput'
import { PanelField, PanelSection, Suggestions } from './PanelBits'

interface RelationshipPropertiesProps {
  relationship: UmlRelationship
  onRequestDelete: () => void
}

export function RelationshipProperties({
  relationship,
  onRequestDelete,
}: RelationshipPropertiesProps) {
  const classes = useDiagramStore((state) => state.classes)
  const updateRelationship = useDiagramStore((state) => state.updateRelationship)

  const meta = RELATIONSHIP_META[relationship.relationship_type]

  // Las cuatro que se dibujan, más la que ya tenga esta relación si es una de
  // las que sólo llegan importadas: quitarla de la lista dejaría el selector
  // enseñando un valor que no está entre sus opciones, y bastaría abrirlo para
  // cambiar sin querer una relación que venía de Enterprise Architect.
  const typeOptions: readonly RelationshipType[] = DATA_RELATIONSHIP_TYPES.some(
    (type) => type === relationship.relationship_type,
  )
    ? DATA_RELATIONSHIP_TYPES
    : [...DATA_RELATIONSHIP_TYPES, relationship.relationship_type]

  const sourceName =
    classes.find((umlClass) => umlClass.id === relationship.source_class_id)?.name ?? '—'
  const targetName =
    classes.find((umlClass) => umlClass.id === relationship.target_class_id)?.name ?? '—'

  function validateMultiplicity(value: string): string | null {
    if (!isValidMultiplicity(value)) {
      return 'Multiplicidad no válida. Ejemplos: 1, 0..1, 0..*, 1..*.'
    }
    if (value.length > LIMITS.multiplicity) return `Máximo ${LIMITS.multiplicity} caracteres.`
    return null
  }

  /** Invierte origen y destino: cambia el sentido de la relación. */
  function swapEnds() {
    void updateRelationship(relationship.id, {
      source_class_id: relationship.target_class_id,
      target_class_id: relationship.source_class_id,
      source_multiplicity: relationship.target_multiplicity,
      target_multiplicity: relationship.source_multiplicity,
      source_role: relationship.target_role,
      target_role: relationship.source_role,
      is_navigable_source: relationship.is_navigable_target,
      is_navigable_target: relationship.is_navigable_source,
    })
  }

  return (
    <>
      <Suggestions id="uml-multiplicities" values={COMMON_MULTIPLICITIES} />

      <PanelSection title="Relación">
        <div className="flex flex-col gap-2.5">
          <PanelField label="Tipo" htmlFor="relationship-type">
            <select
              id="relationship-type"
              value={relationship.relationship_type}
              onChange={(event) =>
                void updateRelationship(relationship.id, {
                  relationship_type: event.target.value as RelationshipType,
                })
              }
              className={cn(CONTROL_COMPACT, 'cursor-pointer')}
            >
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {RELATIONSHIP_META[type].label}
                </option>
              ))}
            </select>
          </PanelField>

          <div className="flex items-center gap-2.5 border border-ink-200 bg-ink-50/60 px-2.5 py-2">
            <RelationGlyph type={relationship.relationship_type} className="h-3 w-11 shrink-0" />
            <p className="text-[11.5px] leading-snug text-ink-600">{meta.hint}</p>
          </div>

          <PanelField label="Nombre de la relación">
            <CommitInput
              value={relationship.name ?? ''}
              ariaLabel="Nombre de la relación"
              placeholder="sin nombre"
              maxLength={LIMITS.relationshipName}
              onCommit={(value) =>
                void updateRelationship(relationship.id, { name: value || null })
              }
            />
          </PanelField>
        </div>
      </PanelSection>

      {/* Muchos a muchos: el modelo lo admite, pero no se convierte en tablas
          tal cual. Aquí sólo se avisa y se dice dónde está la herramienta que
          lo resuelve; la entidad intermedia se crea con el gesto, no
          configurando después una relación que ya está dibujada. */}
      {isManyToMany(relationship) && (
        <PanelSection title="Muchos a muchos">
          <p className="text-[12px] leading-relaxed text-ink-600">
            <span className="font-mono">{sourceName}</span> y{' '}
            <span className="font-mono">{targetName}</span> están unidas con multiplicidad «muchos»
            en los dos extremos, y así no hay forma de convertirlas en tablas. Borre esta relación y
            únalas con la herramienta <strong className="font-semibold">Entidad intermedia</strong>:
            creará entre las dos una tercera entidad con su clave primaria.
          </p>
        </PanelSection>
      )}

      <PanelSection
        title="Extremos"
        action={
          <Button
            size="sm"
            icon={<RefreshIcon className="size-3.5" />}
            onClick={swapEnds}
            className="h-7 px-2 text-[12px]"
            title="Intercambiar origen y destino"
          >
            Invertir
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <EndFields
            heading="Origen"
            className={sourceName}
            multiplicity={relationship.source_multiplicity}
            role={relationship.source_role}
            navigable={relationship.is_navigable_source}
            validateMultiplicity={validateMultiplicity}
            onMultiplicity={(value) =>
              void updateRelationship(relationship.id, { source_multiplicity: value || null })
            }
            onRole={(value) =>
              void updateRelationship(relationship.id, { source_role: value || null })
            }
            onNavigable={(checked) =>
              void updateRelationship(relationship.id, { is_navigable_source: checked })
            }
          />

          <EndFields
            heading="Destino"
            className={targetName}
            multiplicity={relationship.target_multiplicity}
            role={relationship.target_role}
            navigable={relationship.is_navigable_target}
            validateMultiplicity={validateMultiplicity}
            onMultiplicity={(value) =>
              void updateRelationship(relationship.id, { target_multiplicity: value || null })
            }
            onRole={(value) =>
              void updateRelationship(relationship.id, { target_role: value || null })
            }
            onNavigable={(checked) =>
              void updateRelationship(relationship.id, { is_navigable_target: checked })
            }
          />
        </div>
      </PanelSection>

      <div className="p-3">
        <Button
          variant="danger"
          size="sm"
          icon={<TrashIcon className="size-4" />}
          onClick={onRequestDelete}
          className="w-full"
        >
          Eliminar relación
        </Button>
      </div>
    </>
  )
}

interface EndFieldsProps {
  heading: string
  className: string
  multiplicity: string | null
  role: string | null
  navigable: boolean
  validateMultiplicity: (value: string) => string | null
  onMultiplicity: (value: string) => void
  onRole: (value: string) => void
  onNavigable: (checked: boolean) => void
}

/** Los datos de un extremo de la relación: multiplicidad, rol y navegabilidad. */
function EndFields({
  heading,
  className,
  multiplicity,
  role,
  navigable,
  validateMultiplicity,
  onMultiplicity,
  onRole,
  onNavigable,
}: EndFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 border-b border-ink-200 pb-1">
        <span className="text-[11.5px] font-semibold text-ink-600">{heading}</span>
        <span className="truncate font-mono text-[12px] text-ink-800">{className}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PanelField label="Multiplicidad">
          <CommitInput
            value={multiplicity ?? ''}
            ariaLabel={`Multiplicidad del ${heading.toLowerCase()}`}
            mono
            list="uml-multiplicities"
            placeholder="—"
            maxLength={LIMITS.multiplicity}
            validate={validateMultiplicity}
            onCommit={onMultiplicity}
          />
        </PanelField>

        <PanelField label="Rol">
          <CommitInput
            value={role ?? ''}
            ariaLabel={`Rol del ${heading.toLowerCase()}`}
            mono
            placeholder="—"
            maxLength={LIMITS.role}
            onCommit={onRole}
          />
        </PanelField>
      </div>

      <Checkbox
        label="Navegable"
        checked={navigable}
        onChange={(event) => onNavigable(event.target.checked)}
      />
    </div>
  )
}
