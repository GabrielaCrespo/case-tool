import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

export interface ToastApi {
  /** Confirma en pasado lo que la acción prometía: «Publicar» → «Publicado». */
  success: (message: string) => void
  /** Explica qué falló; el mensaje llega tal cual desde la API. */
  error: (message: string) => void
  info: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast debe usarse dentro de <ToastProvider>.')
  }

  return context
}
