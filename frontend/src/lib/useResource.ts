import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'

/**
 * Datos que se piden a la API al montar la pantalla.
 *
 * Los tres estados —cargando, cargado y error— van en un único valor, de modo
 * que no se puede pintar «cargando» y un error a la vez. El estado sólo cambia
 * cuando la promesa responde, nunca de forma síncrona dentro del efecto.
 */
export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

export function useResource<T>(fetcher: () => Promise<T>, fallbackMessage: string) {
  const [resource, setResource] = useState<Resource<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true

    fetcher().then(
      (data) => {
        if (active) setResource({ status: 'ready', data })
      },
      (error: unknown) => {
        if (!active) return
        setResource({
          status: 'error',
          message: error instanceof ApiError ? error.message : fallbackMessage,
        })
      },
    )

    // La respuesta de una petición anterior ya no debe pintarse.
    return () => {
      active = false
    }
  }, [fetcher, fallbackMessage, attempt])

  const reload = useCallback(() => {
    setResource({ status: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  /** Aplica un cambio local sin volver a pedir la lista entera. */
  const updateData = useCallback((change: (current: T) => T) => {
    setResource((current) =>
      current.status === 'ready' ? { status: 'ready', data: change(current.data) } : current,
    )
  }, [])

  return { resource, reload, updateData }
}
