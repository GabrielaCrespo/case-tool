import type { ValidationIssue } from '../../../api/types'
import { AlertIcon, CheckIcon } from '../../../components/icons'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import { useDiagramStore } from '../../../store/diagram'
import { PanelSection } from './PanelBits'

/**
 * CU02 — Validación del diagrama completo.
 *
 * Valida contra la API, no contra lo que hay en pantalla: el informe habla del
 * modelo guardado, que es el que leerá el generador de backend. Cada aviso
 * lleva al elemento que lo provoca, para poder arreglarlo sin buscarlo.
 */
export function ValidationSection() {
  const validation = useDiagramStore((state) => state.validation)
  const validating = useDiagramStore((state) => state.validating)
  const stale = useDiagramStore((state) => state.validationStale)
  const validate = useDiagramStore((state) => state.validate)
  const select = useDiagramStore((state) => state.select)

  function goTo(issue: ValidationIssue) {
    if (issue.relationship_id) {
      select({ kind: 'relationship', id: issue.relationship_id })
    } else if (issue.class_id) {
      select({ kind: 'class', id: issue.class_id })
    }
  }

  return (
    <PanelSection
      title="Validación"
      action={
        <Button
          size="sm"
          onClick={() => void validate()}
          loading={validating}
          className="h-7 px-2 text-[12px]"
        >
          {validation ? 'Revalidar' : 'Validar'}
        </Button>
      }
    >
      {!validation ? (
        <p className="py-1 text-[12.5px] leading-relaxed text-ink-500">
          Compruebe que el modelo puede convertirse en tablas: nombres, tipos de cada columna,
          claves primarias, multiplicidades y relaciones sin referencias sueltas.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stale && (
            <p className="border border-ink-200 bg-ink-50 px-2 py-1.5 text-[11.5px] leading-snug text-ink-600">
              El diagrama cambió después de validarlo. Vuelva a validar para ver el estado actual.
            </p>
          )}

          <div
            className={cn(
              'flex items-start gap-2 border px-2.5 py-2',
              validation.valid
                ? 'border-ink-200 bg-ink-50/60'
                : 'border-danger-600/40 bg-danger-100/40',
            )}
          >
            {validation.valid ? (
              <CheckIcon className="mt-px size-4 shrink-0 text-ink-600" />
            ) : (
              <AlertIcon className="mt-px size-4 shrink-0 text-danger-700" />
            )}
            <p className="text-[12px] leading-snug text-ink-700">
              {validation.valid
                ? validation.ready_for_generation
                  ? 'El modelo es válido y está listo para generar el backend.'
                  : 'El modelo es válido, pero no hay ninguna entidad que convertir en tabla.'
                : `${validation.errors} ${validation.errors === 1 ? 'error impide' : 'errores impiden'} dar el modelo por válido.`}
              {validation.warnings > 0 && (
                <span className="text-ink-500">
                  {' '}
                  {validation.warnings}{' '}
                  {validation.warnings === 1 ? 'advertencia' : 'advertencias'}.
                </span>
              )}
            </p>
          </div>

          {validation.issues.length > 0 && (
            <ul className="flex flex-col gap-1">
              {validation.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.element_id ?? index}`}>
                  <button
                    type="button"
                    onClick={() => goTo(issue)}
                    className={cn(
                      'flex w-full gap-2 border-l-2 px-2 py-1.5 text-left transition-colors hover:bg-ink-50',
                      issue.severity === 'error'
                        ? 'border-l-danger-600'
                        : 'border-l-pending-600',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-px shrink-0 font-mono text-[9.5px] font-bold uppercase',
                        issue.severity === 'error' ? 'text-danger-700' : 'text-pending-700',
                      )}
                    >
                      {issue.severity === 'error' ? 'ERR' : 'AVI'}
                    </span>
                    <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-700">
                      {issue.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PanelSection>
  )
}
