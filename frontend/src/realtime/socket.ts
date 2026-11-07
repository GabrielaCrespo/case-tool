import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

/** Misma URL que la API REST; el gateway vive en el espacio /collaboration. */
const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/**
 * En el despliegue la API vive bajo un prefijo (`https://<dominio>/api`) que
 * Traefik quita antes de llegar al backend. Para socket.io la ruta de la URL no
 * es un camino sino el espacio de nombres: `io('…/api/collaboration')` pediría
 * `/socket.io/…` en la raíz del dominio —que atiende el editor, no el
 * backend— y el espacio `/api/collaboration`, que no existe. Por eso se separan:
 * el origen con el espacio `/collaboration`, y el prefijo en `path`, de modo
 * que la conexión vaya a `/api/socket.io/…` y Traefik la lleve al backend. En
 * local no hay prefijo y queda el `/socket.io` de siempre.
 */
const API_URL = new URL(BASE_URL)
const SOCKET_PATH = `${API_URL.pathname.replace(/\/+$/, '')}/socket.io`

/**
 * CU03 — Conexión con el gateway de colaboración.
 *
 * El token viaja en el handshake: el gateway rechaza cualquier conexión que no
 * lo traiga, igual que la API REST rechaza las peticiones sin cabecera. La
 * reconexión la gestiona socket.io, que reintenta con espera creciente cuando
 * se cae la red o se reinicia el servidor.
 */
export function createCollaborationSocket(token: string): Socket {
  return io(`${API_URL.origin}/collaboration`, {
    path: SOCKET_PATH,
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000,
    timeout: 8000,
  })
}
