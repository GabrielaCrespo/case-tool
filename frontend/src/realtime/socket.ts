import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

/** Misma URL que la API REST; el gateway vive en el espacio /collaboration. */
const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/**
 * CU03 — Conexión con el gateway de colaboración.
 *
 * El token viaja en el handshake: el gateway rechaza cualquier conexión que no
 * lo traiga, igual que la API REST rechaza las peticiones sin cabecera. La
 * reconexión la gestiona socket.io, que reintenta con espera creciente cuando
 * se cae la red o se reinicia el servidor.
 */
export function createCollaborationSocket(token: string): Socket {
  return io(`${BASE_URL}/collaboration`, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000,
    timeout: 8000,
  })
}
