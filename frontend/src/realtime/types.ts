import type { Diagram, UmlAttribute, UmlClass, UmlMethod, UmlRelationship } from '../api/types'

/**
 * CU03 — Contratos de la colaboración en tiempo real.
 *
 * Reproducen `collaboration-events.ts` del backend. Lo que viaja por el socket
 * es el aviso de un cambio que la API REST ya guardó en PostgreSQL, con el
 * mismo objeto que habría devuelto la petición HTTP.
 */

export type LockableType = 'class' | 'relationship'

export interface LockHolder {
  user_id: string
  full_name: string
  socket_id: string
}

export interface LockState {
  element_type: LockableType
  element_id: string
  holder: LockHolder
}

export interface Participant {
  user_id: string
  full_name: string
  email: string
  /** Un mismo usuario puede tener varias pestañas abiertas. */
  sockets: number
}

/** Los borrados sólo viajan con lo necesario para quitarlo del lienzo. */
interface DeletedRef {
  id: string
}

interface DeletedChild extends DeletedRef {
  class_id: string
}

export type DiagramChange =
  | { kind: 'diagram.updated'; payload: Diagram; actor_id: string; diagram_id: string }
  | { kind: 'diagram.deleted'; payload: DeletedRef; actor_id: string; diagram_id: string }
  | { kind: 'class.created'; payload: UmlClass; actor_id: string; diagram_id: string }
  | { kind: 'class.updated'; payload: UmlClass; actor_id: string; diagram_id: string }
  | { kind: 'class.deleted'; payload: DeletedRef; actor_id: string; diagram_id: string }
  | { kind: 'attribute.created'; payload: UmlAttribute; actor_id: string; diagram_id: string }
  | { kind: 'attribute.updated'; payload: UmlAttribute; actor_id: string; diagram_id: string }
  | { kind: 'attribute.deleted'; payload: DeletedChild; actor_id: string; diagram_id: string }
  | { kind: 'method.created'; payload: UmlMethod; actor_id: string; diagram_id: string }
  | { kind: 'method.updated'; payload: UmlMethod; actor_id: string; diagram_id: string }
  | { kind: 'method.deleted'; payload: DeletedChild; actor_id: string; diagram_id: string }
  | { kind: 'relationship.created'; payload: UmlRelationship; actor_id: string; diagram_id: string }
  | { kind: 'relationship.updated'; payload: UmlRelationship; actor_id: string; diagram_id: string }
  | { kind: 'relationship.deleted'; payload: DeletedRef; actor_id: string; diagram_id: string }

/** Nombres de los eventos, iguales a los del gateway. */
export const COLLABORATION_EVENTS = {
  join: 'diagram:join',
  leave: 'diagram:leave',
  presence: 'presence:state',
  locks: 'locks:state',
  lockAcquire: 'lock:acquire',
  lockRelease: 'lock:release',
  lockChanged: 'lock:changed',
  changed: 'diagram:changed',
  // CU13 — El chat del equipo, en la sala del proyecto.
  chatMessage: 'chat:message',
  chatUpdated: 'chat:updated',
  aiStatus: 'ai:status',
} as const

/** CU13 — A qué pregunta está respondiendo la IA ahora. */
export interface AiStatusEvent {
  project_id: string
  question_id: string
  state: 'thinking' | 'idle'
}

export interface JoinAck {
  ok: boolean
  message?: string
  participants?: Participant[]
  locks?: LockState[]
}

export interface LockAck {
  granted: boolean
  holder?: LockHolder
  message?: string
}

export interface LockChanged {
  element_type: LockableType
  element_id: string
  holder: LockHolder | null
}

/** Clave con la que se indexan los bloqueos en el store. */
export function lockKey(elementType: LockableType, elementId: string): string {
  return `${elementType}:${elementId}`
}
