import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { AlertIcon, RefreshIcon } from '../icons'
import { Button } from './Button'
import { Spinner } from './Spinner'

/** Carga: se anuncia, no se deja la pantalla en blanco. */
export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 px-6 py-16">
      <Spinner className="size-6 text-signal-600" />
      <p className="text-[13px] text-ink-500">{label}</p>
    </div>
  )
}

/**
 * Vacío: una invitación a actuar, con la acción a un clic.
 * Nunca es sólo un dibujo con una frase.
 */
export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string
  message: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="flex size-11 items-center justify-center border border-ink-200 bg-white text-ink-400">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-500">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/** Error: qué ha fallado y cómo salir de ahí. */
export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-16',
      )}
    >
      <AlertIcon className="size-6 text-danger-600" />
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-700">{message}</p>
      {onRetry && (
        <Button size="sm" icon={<RefreshIcon className="size-4" />} onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

/** Aviso en línea, dentro de un formulario o de un panel. */
export function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-[3px] border border-danger-100 bg-danger-100/50 px-3 py-2 text-[13px] text-danger-700"
    >
      <AlertIcon className="mt-px size-4 shrink-0" />
      <span>{message}</span>
    </p>
  )
}
