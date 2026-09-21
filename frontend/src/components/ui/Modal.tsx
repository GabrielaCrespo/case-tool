import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '../icons'
import { IconButton } from './Button'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, title, description, onClose, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape cierra, y el foco entra en el diálogo para quien navega con teclado.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    const firstControl = panelRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button',
    )
    firstControl?.focus()

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-950/35"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col border border-ink-300 bg-white sm:rounded-[3px]"
      >
        <header className="flex items-start justify-between gap-4 rule-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
          </div>
          <IconButton label="Cerrar" onClick={onClose}>
            <CloseIcon className="size-4" />
          </IconButton>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && <footer className="flex justify-end gap-2 rule-t px-5 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
