import { create } from 'zustand'
import { authApi } from '../api/endpoints'
import { clearSession, readToken, readUser, writeSession } from '../api/session'
import type { User } from '../api/types'

interface AuthState {
  user: User | null
  token: string | null
  /** Mientras se revalida el token guardado no se sabe si hay sesión. */
  checking: boolean
  login: (email: string, password: string) => Promise<void>
  register: (fullName: string, email: string, password: string) => Promise<void>
  logout: () => void
  /** Comprueba contra GET /auth/me que el token guardado sigue siendo válido. */
  restore: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: readUser(),
  token: readToken(),
  checking: Boolean(readToken()),

  async login(email, password) {
    const response = await authApi.login({ email, password })
    writeSession(response.access_token, response.user)
    set({ user: response.user, token: response.access_token, checking: false })
  },

  async register(fullName, email, password) {
    const response = await authApi.register({ full_name: fullName, email, password })
    writeSession(response.access_token, response.user)
    set({ user: response.user, token: response.access_token, checking: false })
  },

  logout() {
    clearSession()
    set({ user: null, token: null, checking: false })
  },

  async restore() {
    if (!get().token) {
      set({ checking: false })
      return
    }

    try {
      const user = await authApi.me()
      writeSession(get().token as string, user)
      set({ user, checking: false })
    } catch {
      // Token caducado o cuenta borrada: el cliente ya limpió la sesión.
      set({ user: null, token: null, checking: false })
    }
  },
}))

/** Cierra la sesión en memoria cuando la API devuelve 401 en cualquier punto. */
export function handleSessionExpired(): void {
  useAuthStore.setState({ user: null, token: null, checking: false })
}
