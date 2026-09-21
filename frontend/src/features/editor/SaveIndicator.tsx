import { AlertIcon, CheckIcon } from '../../components/icons'
import { Spinner } from '../../components/ui/Spinner'
import { useDiagramStore } from '../../store/diagram'

/**
 * Estado del guardado.
 *
 * No hay botón de guardar: cada cambio viaja a la API en el momento, así que
 * lo que hace falta es saber si todo está a salvo o si algo no llegó.
 */
export function SaveIndicator() {
  const pending = useDiagramStore((state) => state.pending)
  const saveError = useDiagramStore((state) => state.saveError)
  const reloading = useDiagramStore((state) => state.reloading)

  // Tras reconectar se relee el diagrama sin quitarlo de la pantalla; aquí se
  // dice, para que nadie tome por definitivo lo que aún puede cambiar.
  if (reloading) {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-500">
        <Spinner className="size-3.5" />
        Actualizando…
      </span>
    )
  }

  if (pending > 0) {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-pending-700">
        <Spinner className="size-3.5" />
        Guardando…
      </span>
    )
  }

  if (saveError) {
    return (
      <span
        title={saveError}
        className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger-700"
      >
        <AlertIcon className="size-3.5" />
        Sin guardar
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-500">
      <CheckIcon className="size-3.5 text-success-600" />
      Guardado
    </span>
  )
}
