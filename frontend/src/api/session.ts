import type { User } from './types'

/**
 * Sesión persistida en el navegador.
 *
 * localStorage es la única fuente de verdad del token: así el cliente HTTP y el
 * store de autenticación no dependen el uno del otro y no hay ciclos de import.
 */

const TOKEN_KEY = 'case-tool.access_token'
const USER_KEY = 'case-tool.user'

/** Se emite cuando la API responde 401: la sesión ha caducado. */
export const SESSION_EXPIRED_EVENT = 'case-tool:session-expired'

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // Modo privado o almacenamiento bloqueado: se trabaja sin sesión guardada.
    return null
  }
}

export function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function writeSession(token: string, user: User): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    // La sesión seguirá viva en memoria durante esta pestaña.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    // Nada que limpiar.
  }
}

export function notifySessionExpired(): void {
  clearSession()
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}
