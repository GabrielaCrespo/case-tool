import { useState } from 'react'
import type { UmlMethod, Visibility } from '../../../api/types'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from '../../../components/icons'
import { Button, IconButton } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Field'
import { cn } from '../../../lib/cn'
import { useDiagramStore } from '../../../store/diagram'
import {
  DATA_TYPE_NAMES,
  LIMITS,
  VISIBILITY_OPTIONS,
  identifierProblem,
  visibilitySymbol,
} from '../uml'
import { CommitInput } from './CommitInput'
import { PanelField, PanelSelect } from './PanelBits'

interface MethodRowProps {
  method: UmlMethod
  index: number
  total: number
}

const VISIBILITY_CHOICES = VISIBILITY_OPTIONS.map((option) => ({
  value: option.value,
  label: `${option.symbol}  ${option.label}`,
}))

/**
 * Un método con su firma completa: visibilidad, nombre, parámetros y tipo de
 * retorno — «+ buscarPorId(id : Long) : Cliente». La fila se despliega porque
 * los parámetros no caben en una línea del panel.
 */
export function MethodRow({ method, index, total }: MethodRowProps) {
  const classes = useDiagramStore((state) => state.classes)
  const updateMethod = useDiagramStore((state) => state.updateMethod)
  const deleteMethod = useDiagramStore((state) => state.deleteMethod)
  const reorderMethod = useDiagramStore((state) => state.reorderMethod)
  const addParameter = useDiagramStore((state) => state.addParameter)
  const updateParameter = useDiagramStore((state) => state.updateParameter)
  const deleteParameter = useDiagramStore((state) => state.deleteParameter)

  const [open, setOpen] = useState(false)

  // El retorno y los parámetros pueden ser una clase del diagrama, además de
  // un tipo del catálogo: «Cliente buscarPorId(Long id)».
  const classNames = classes.map((umlClass) => umlClass.name)
  const parameterTypes = [...DATA_TYPE_NAMES, ...classNames]
  const returnTypes = ['void', ...parameterTypes]

  /** Un tipo guardado que ya no está en el catálogo se ofrece igualmente. */
  function optionsFor(available: string[], current: string) {
    const names = available.includes(current) ? available : [current, ...available]

    return names.map((name) => ({ value: name, label: name }))
  }

  const preview =
    method.parameters.map((parameter) => `${parameter.name}: ${parameter.data_type}`).join(', ')

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
            className={cn(
              'size-3.5 shrink-0 text-ink-400 transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate font-mono text-[12px] text-ink-800',
              method.is_static && 'underline underline-offset-2',
              method.is_abstract && 'italic',
            )}
          >
            <span className="text-ink-500">{visibilitySymbol(method.visibility)} </span>
            {method.name}({preview})<span className="text-ink-400">: </span>
            <span className="text-ink-600">{method.return_type}</span>
          </span>
        </button>

        <IconButton
          label="Subir método"
          disabled={index === 0}
          onClick={() => void reorderMethod(method.class_id, method.id, -1)}
          className="size-7"
        >
          <ArrowUpIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label="Bajar método"
          disabled={index === total - 1}
          onClick={() => void reorderMethod(method.class_id, method.id, 1)}
          className="size-7"
        >
          <ArrowDownIcon className="size-3.5" />
        </IconButton>
        <IconButton
          label="Eliminar método"
          variant="danger"
          onClick={() => void deleteMethod(method.id)}
          className="size-7"
        >
          <TrashIcon className="size-3.5" />
        </IconButton>
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-ink-200 bg-ink-50/50 px-2.5 py-2.5">
          <PanelField label="Nombre">
            <CommitInput
              value={method.name}
              ariaLabel="Nombre del método"
              mono
              maxLength={LIMITS.methodName}
              validate={(value) =>
                value.length === 0 ? 'El nombre no puede estar vacío.' : identifierProblem(value)
              }
              onCommit={(name) => void updateMethod(method.id, { name })}
            />
          </PanelField>

          <div className="grid grid-cols-2 gap-2">
            <PanelField label="Visibilidad">
              <PanelSelect
                value={method.visibility}
                ariaLabel="Visibilidad del método"
                options={VISIBILITY_CHOICES}
                onChange={(value) =>
                  void updateMethod(method.id, { visibility: value as Visibility })
                }
              />
            </PanelField>

            <PanelField label="Tipo de retorno">
              <PanelSelect
                value={method.return_type}
                ariaLabel="Tipo de retorno"
                mono
                options={optionsFor(returnTypes, method.return_type)}
                onChange={(value) => void updateMethod(method.id, { return_type: value })}
              />
            </PanelField>
          </div>

          {/* Notación UML 2.5 de la operación. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            <Checkbox
              label="Estático (subrayado)"
              checked={method.is_static}
              onChange={(event) =>
                void updateMethod(method.id, { is_static: event.target.checked })
              }
            />
            <Checkbox
              label="Abstracto (cursiva)"
              checked={method.is_abstract}
              onChange={(event) =>
                void updateMethod(method.id, { is_abstract: event.target.checked })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-medium text-ink-500">
                Parámetros
                <span className="ml-1.5 font-mono text-[11px] text-ink-400">
                  {method.parameters.length}
                </span>
              </span>
              <Button
                size="sm"
                icon={<PlusIcon className="size-3.5" />}
                onClick={() => void addParameter(method.id)}
                className="h-7 px-2 text-[12px]"
              >
                Añadir
              </Button>
            </div>

            {method.parameters.length === 0 ? (
              <p className="text-[11.5px] text-ink-500">El método no recibe parámetros.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {method.parameters.map((parameter) => (
                  <li key={parameter.id} className="flex items-center gap-1">
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
                      <CommitInput
                        value={parameter.name}
                        ariaLabel="Nombre del parámetro"
                        mono
                        maxLength={LIMITS.parameterName}
                        validate={(value) =>
                          value.length === 0
                            ? 'El nombre no puede estar vacío.'
                            : method.parameters.some(
                                  (other) =>
                                    other.id !== parameter.id && other.name === value,
                                )
                              ? 'Ya hay un parámetro con ese nombre.'
                              : identifierProblem(value)
                        }
                        onCommit={(name) => void updateParameter(parameter.id, { name })}
                      />
                      <PanelSelect
                        value={parameter.data_type}
                        ariaLabel="Tipo del parámetro"
                        mono
                        options={optionsFor(parameterTypes, parameter.data_type)}
                        onChange={(value) =>
                          void updateParameter(parameter.id, { data_type: value })
                        }
                      />
                    </div>
                    <IconButton
                      label="Eliminar parámetro"
                      variant="danger"
                      onClick={() => void deleteParameter(parameter.id)}
                      className="size-7"
                    >
                      <TrashIcon className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
