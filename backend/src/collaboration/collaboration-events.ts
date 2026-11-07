/**
 * CU03 — Contratos de la colaboración en tiempo real.
 *
 * Los cambios siguen guardándose por la API REST de CU01/CU02; lo que viaja por
 * WebSocket es el aviso de que algo ya quedó guardado, para que el resto de
 * editores lo apliquen en su lienzo sin recargar.
 */

/** Elementos sobre los que se puede tomar un bloqueo de edición. */
export type LockableType = 'class' | 'relationship';

/** Quién tiene tomado un elemento. */
export interface LockHolder {
  user_id: string;
  full_name: string;
  socket_id: string;
}

export interface LockState {
  element_type: LockableType;
  element_id: string;
  holder: LockHolder;
}

/** Un usuario conectado a la sala de un diagrama. */
export interface Participant {
  user_id: string;
  full_name: string;
  email: string;
  /** Un mismo usuario puede tener varias pestañas abiertas. */
  sockets: number;
}

/** Tipos de cambio que se difunden a la sala. */
export type DiagramChangeKind =
  | 'diagram.updated'
  | 'diagram.deleted'
  | 'class.created'
  | 'class.updated'
  | 'class.deleted'
  | 'attribute.created'
  | 'attribute.updated'
  | 'attribute.deleted'
  | 'method.created'
  | 'method.updated'
  | 'method.deleted'
  | 'relationship.created'
  | 'relationship.updated'
  | 'relationship.deleted';

/**
 * Cambio ya persistido en PostgreSQL. `payload` es el mismo objeto que devuelve
 * la API REST, de modo que el cliente aplica exactamente lo que habría recibido
 * al recargar el diagrama.
 */
export interface DiagramChange {
  diagram_id: string;
  kind: DiagramChangeKind;
  /** El recurso afectado; en los borrados, sólo su identificador. */
  payload: unknown;
  /** Quién lo hizo, para poder atribuir el cambio en la interfaz. */
  actor_id: string;
}

/**
 * CU13 — Lo que se difunde a la sala de un proyecto (`project:<id>`).
 *
 * Igual que con los diagramas, lo que viaja ya está guardado: el mensaje es el
 * mismo objeto que devuelve GET /projects/:id/chat. `ai:status` es lo único que
 * no se guarda, porque sólo dice qué está haciendo la IA en este momento.
 */
export type ChatEvent =
  | { kind: 'chat:message'; project_id: string; payload: unknown }
  | { kind: 'chat:updated'; project_id: string; payload: unknown }
  | {
      kind: 'ai:status';
      project_id: string;
      payload: { project_id: string; question_id: string; state: 'thinking' | 'idle' };
    };

/** Nombres de los eventos de socket, compartidos con el frontend. */
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
} as const;
