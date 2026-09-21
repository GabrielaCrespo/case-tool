import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { AlertIcon, CheckIcon, CloseIcon } from '../icons'
import { ToastContext } from './toast-context'
import type { Toast, ToastTone } from './toast-context'

const TONES: Record<ToastTone, { border: string; icon: ReactNode }> = {
  success: {
    border: 'border-l-success-600',
    icon: <CheckIcon className="size-4 text-success-600" />,
  },
  error: { border: 'border-l-danger-600', icon: <AlertIcon className="size-4 text-danger-600" /> },
  info: { border: 'border-l-signal-600', icon: <AlertIcon className="size-4 text-signal-600" /> },
}

const DISMISS_AFTER_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, tone, message }])
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 border border-ink-200 border-l-2 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(12,18,32,0.08)]',
              TONES[toast.tone].border,
            )}
          >
            <span className="mt-px shrink-0">{TONES[toast.tone].icon}</span>
            <p className="flex-1 text-[13px] leading-snug text-ink-800">{toast.message}</p>
            <button
              type="button"
              aria-label="Descartar"
              onClick={() => dismiss(toast.id)}
              className="-mt-0.5 -mr-1 shrink-0 p-1 text-ink-400 transition-colors hover:text-ink-700"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
