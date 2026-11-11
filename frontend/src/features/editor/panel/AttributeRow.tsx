import { useState } from 'react'
import type { UmlAttribute, Visibility } from '../../../api/types'
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, TrashIcon } from '../../../components/icons'
import { IconButton } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Field'
import { cn } from '../../../lib/cn'
import { useDiagramStore } from '../../../store/diagram'
import {
  DATA_TYPE_NAMES,
  DEFAULT_VALUE_HINTS,
  LIMITS,
  VISIBILITY_OPTIONS,
  attributeNameProblem,
  attributeSuffix,
  isDefaultValueCompatible,
  isValidMultiplicity,
  visibilitySymbol,
} from '../uml'
import { CommitInput } from './CommitInput'
import { PanelField, PanelSelect } from './PanelBits'

const VISIBILITY_CHOICES = VISIBILITY_OPTIONS.map((option) => ({
  value: option.value,
  label: `${option.symbol}  ${option.label}`,
}))

interface AttributeRowProps {
  attribute: UmlAttribute
  index: number
  total: number
  /** Nombres ya usados en la clase: uml_attributes tiene UNIQUE (class_id, name). */
  siblingNames: string[]
}

export function AttributeRow({ attribute, index, total, siblingNames }: AttributeRowProps) {
  const updateAttribute = useDiagramStore((state) => state.updateAttribute)
  const deleteAttribute = useDiagramStore((state) => state.deleteAttribute)
  const reorderAttribute = useDiagramStore((state) => state.reorderAttribute)

  const [open, setOpen] = useState(false)

  function validateName(value: string): string | null {
    if (value.length === 0) return 'El nombre no puede estar vacío.'
    if (value.length > LIMITS.attributeName) return `Máximo ${LIMITS.attributeName} caracteres.`
    if (siblingNames.includes(value)) return 'Ya existe un atributo con ese nombre.'
    // El nombre será el de un campo Java en la entidad generada, y no puede
    // ser el de la clave primaria que la herramienta añade a toda entidad.
    return attributeNameProblem(value)
  }

  /**
   * «Sin tipo» encabeza la lista, y un tipo guardado que ya no está en el
   * catálogo se ofrece igualmente para no perderlo al abrir el desplegable.
   * El valor vacío es el que se traduce a null al guardar.
   */
  const known = attribute.data_type === null || DATA_TYPE_NAMES.includes(attribute.data_type)
  const typeOptions = [
    { value: '', label: 'sin tipo' },
    ...(known ? DATA_TYPE_NAMES : [attribute.data_type as string, ...DATA_TYPE_NAMES]).map(
      (name) => ({ value: name, label: name }),
    ),
  ]

  return (
    <li className="border border-ink-200 bg-white">
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[3px] px-1 py-1 text-left transition-colors hover:bg-ink-50"
        >
          <ChevronDownIcon
            className={cn('size-3.5 shrink-0 text-ink-400 transition-transform', !open && '-rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-800">
            <span className="text-ink-500">{visibilitySymbol(attribute.visibility)} </span>
            {attribute.is_derived && '/'}
            <span className={cn(attribute.is_static && 'underline underline-offset-2')}>
              {attribute.name}
            </span>
            {/* Sin tipo no se escribe el «:»: enseñar «nombre: null» haría
                creer que el tipo es un valor raro en vez de estar por decidir. */}
            {attribute.data_type !== null && (
              <>
                <span className="text-ink-400">: </span>
                <span className="text-ink-600">{attribute.data_type}</span>
              </>
            )}
            <span className="text-ink-500">{attributeSuffix(attribute)}</span>
          </span>
        </button>

        <IconButton
          label="Subir atributo"
          disabled={index === 0}
          onClick={() => void reorderAttribute(attribute.class_id, attribute.id, -1)}
          className="size-7"
        >
          <ArrowUpIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label="Bajar atributo"
          disabled={index === total - 1}
          onClick={() => void reorderAttribute(attribute.class_id, attribute.id, 1)}
          className="size-7"
        >
          <ArrowDownIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label="Eliminar atributo"
          variant="danger"
          onClick={() => void deleteAttribute(attribute.id)}
          className="size-7"
        >
          <TrashIcon className="size-3.5" />
        </IconButton>
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-ink-200 bg-ink-50/50 px-2.5 py-2.5">
          <PanelField label="Nombre">
            <CommitInput
              value={attribute.name}
              ariaLabel="Nombre del atributo"
              mono
              maxLength={LIMITS.attributeName}
              validate={validateName}
              onCommit={(name) => void updateAttribute(attribute.id, { name })}
            />
          </PanelField>

          <div className="grid grid-cols-2 gap-2">
            <PanelField label="Tipo de dato">
              <PanelSelect
                value={attribute.data_type ?? ''}
                ariaLabel="Tipo de dato"
                mono
                options={typeOptions}
                onChange={(dataType) =>
                  void updateAttribute(attribute.id, { data_type: dataType || null })
                }
              />
            </PanelField>

            <PanelField label="Visibilidad">
              <PanelSelect
                value={attribute.visibility}
                ariaLabel="Visibilidad del atributo"
                options={VISIBILITY_CHOICES}
                onChange={(value) =>
                  void updateAttribute(attribute.id, { visibility: value as Visibility })
                }
              />
            </PanelField>
          </div>

          <PanelField label="Valor por defecto">
            <CommitInput
              value={attribute.default_value ?? ''}
              ariaLabel="Valor por defecto"
              mono
              placeholder={
                attribute.data_type === null
                  ? 'sin valor'
                  : (DEFAULT_VALUE_HINTS[attribute.data_type] ?? 'sin valor')
              }
              maxLength={LIMITS.defaultValue}
              // Sin tipo no hay contra qué comprobar el valor; se acepta y ya
              // avisará el validador del diagrama de que falta el tipo.
              validate={(value) =>
                attribute.data_type === null ||
                value.length === 0 ||
                isDefaultValueCompatible(attribute.data_type, value)
                  ? null
                  : `No es un valor de tipo ${attribute.data_type}. Ejemplo: ${
                      DEFAULT_VALUE_HINTS[attribute.data_type] ?? '—'
                    }.`
              }
              onCommit={(value) =>
                void updateAttribute(attribute.id, { default_value: value || null })
              }
            />
          </PanelField>

          <div className="flex flex-col gap-1.5 pt-0.5">
            <Checkbox
              label="Valor único"
              checked={attribute.is_unique}
              onChange={(event) =>
                void updateAttribute(attribute.id, { is_unique: event.target.checked })
              }
            />
            <Checkbox
              label="Admite nulos"
              checked={attribute.is_nullable}
              onChange={(event) =>
                void updateAttribute(attribute.id, { is_nullable: event.target.checked })
              }
            />
          </div>

          {/* Notación UML 2.5 de la propiedad. Cambia cómo se dibuja y viaja en
              el XMI; el generador de código sigue tratando el atributo como
              una columna. */}
          <div className="flex flex-col gap-1.5 border-t border-ink-200 pt-2">
            <span className="text-[10.5px] font-semibold tracking-wider text-ink-500 uppercase">
              Notación UML
            </span>
            <PanelField label="Multiplicidad">
              <CommitInput
                value={attribute.multiplicity ?? ''}
                ariaLabel="Multiplicidad del atributo"
                mono
                placeholder="1 (no se escribe)"
                maxLength={10}
                validate={(value) =>
                  isValidMultiplicity(value)
                    ? null
                    : 'Ejemplos: 0..1, 0..*, 1..*, 2..5, *.'
                }
                onCommit={(value) =>
                  void updateAttribute(attribute.id, { multiplicity: value || null })
                }
              />
            </PanelField>
            <Checkbox
              label="Estático (subrayado)"
              checked={attribute.is_static}
              onChange={(event) =>
                void updateAttribute(attribute.id, { is_static: event.target.checked })
              }
            />
            <Checkbox
              label="Derivado ( / )"
              checked={attribute.is_derived}
              onChange={(event) =>
                void updateAttribute(attribute.id, { is_derived: event.target.checked })
              }
            />
            <Checkbox
              label="Sólo lectura {readOnly}"
              checked={attribute.is_read_only}
              onChange={(event) =>
                void updateAttribute(attribute.id, { is_read_only: event.target.checked })
              }
            />
          </div>
        </div>
      )}
    </li>
  )
}
