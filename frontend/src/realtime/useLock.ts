import { useAuthStore } from '../store/auth'
import { useDiagramStore } from '../store/diagram'
import type { LockableType, LockHolder } from './types'
import { lockKey } from './types'

/**
 * CU03 — Quién tiene tomado un elemento, si no soy yo.
 *
 * Devuelve null cuando está libre o cuando lo tengo yo, que son los dos casos
 * en los que puedo editarlo. Lo usan el lienzo y el panel de propiedades para
 * ponerse en sólo lectura; la API rechaza igualmente la escritura, así que esto
 * es lo que el usuario ve, no lo que lo impide.
 */
export function useLockedByOther(
  elementType: LockableType,
  elementId: string | null | undefined,
): LockHolder | null {
  const locks = useDiagramStore((state) => state.locks)
  const me = useAuthStore((state) => state.user)

  if (!elementId) return null

  const holder = locks[lockKey(elementType, elementId)]

  return holder && holder.user_id !== me?.id ? holder : null
}
