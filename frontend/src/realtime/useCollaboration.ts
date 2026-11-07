import { useEffect, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import type { ChatMessage } from '../api/types'
import { useAuthStore } from '../store/auth'
import { useChatStore } from '../store/chat'
import { useDiagramStore } from '../store/diagram'
import { createCollaborationSocket } from './socket'
import type {
  AiStatusEvent,
  DiagramChange,
  JoinAck,
  LockableType,
  LockAck,
  LockChanged,
  Participant,
} from './types'
import { COLLABORATION_EVENTS } from './types'

interface Held {
  type: LockableType
  id: string
}

/**
 * Pide el elemento en exclusiva y anota si este cliente se lo quedó.
 *
 * Si lo tiene otro no se marca como propio: el panel se queda en sólo lectura y
 * la API rechazaría igualmente la escritura.
 */
function acquireLock(socket: Socket, element: Held): void {
  socket.emit(
    COLLABORATION_EVENTS.lockAcquire,
    { element_type: element.type, element_id: element.id },
    (ack: LockAck) => {
      useDiagramStore.getState().setHeldLock(element.type, element.id, ack?.granted === true)
    },
  )
}

/**
 * CU03 — Colaborar en el Diseño del Diagrama.
 *
 * Conecta el editor con la sala del diagrama: mantiene la lista de usuarios
 * conectados, aplica los cambios que hacen los demás y toma en exclusiva el
 * elemento seleccionado para que dos personas no editen lo mismo a la vez.
 *
 * Los cambios propios siguen guardándose por la API REST (CU02); aquí sólo se
 * recibe lo que ya está guardado.
 *
 * CU13 — Por la misma conexión llega el chat del equipo: al entrar en un
 * diagrama el servidor une también a la sala de su proyecto, y de ahí vienen
 * las preguntas de los demás, las respuestas de la IA y a cuál está
 * respondiendo.
 */
export function useCollaboration(diagramId: string | undefined) {
  const token = useAuthStore((state) => state.token)
  const selection = useDiagramStore((state) => state.selection)

  const socketRef = useRef<Socket | null>(null)
  const heldRef = useRef<Held | null>(null)

  useEffect(() => {
    if (!diagramId || !token) return

    const socket = createCollaborationSocket(token)
    socketRef.current = socket
    useDiagramStore.getState().setConnection('connecting')

    // Distingue la primera entrada de las reconexiones posteriores.
    let joined = false

    function join() {
      socket.emit(COLLABORATION_EVENTS.join, { diagram_id: diagramId }, (ack: JoinAck) => {
        const store = useDiagramStore.getState()

        if (!ack?.ok) {
          store.setConnection('offline')
          return
        }

        store.setParticipants(ack.participants ?? [])
        store.setLocks(ack.locks ?? [])
        store.setConnection('online')

        // Al reconectar se recarga el diagrama: mientras no había conexión
        // pudieron llegar cambios cuyos avisos este cliente no recibió.
        if (joined && diagramId) {
          void store.load(diagramId, { preserveSelection: true })
          // Y hay que volver a tomar lo que siga seleccionado: el bloqueo
          // anterior murió con la conexión, así que el elemento que el usuario
          // tiene abierto en el panel estaría libre para cualquiera.
          const selected = store.selection
          heldRef.current = selected ? { type: selected.kind, id: selected.id } : null
          if (heldRef.current) acquireLock(socket, heldRef.current)
          // Igual con el chat: lo dicho mientras no había sala no llegó.
          void useChatStore.getState().reload()
        }
        joined = true
      })
    }

    socket.on('connect', join)

    socket.on('disconnect', () => {
      // Los bloqueos que tuviera este cliente los suelta el servidor, así que
      // hay que olvidarlos también aquí: mientras el store los diera por
      // propios, seguiría descartando los cambios que otros hicieran sobre esos
      // mismos elementos. Al reconectar, `join` devuelve el estado real.
      heldRef.current = null
      const store = useDiagramStore.getState()
      store.clearHeldLocks()
      store.setConnection('offline')
    })

    socket.on('connect_error', () => {
      useDiagramStore.getState().setConnection('offline')
    })

    socket.on(COLLABORATION_EVENTS.presence, (payload: { participants: Participant[] }) => {
      useDiagramStore.getState().setParticipants(payload?.participants ?? [])
    })

    socket.on(COLLABORATION_EVENTS.lockChanged, (change: LockChanged) => {
      useDiagramStore.getState().applyLockChange(change)
    })

    socket.on(COLLABORATION_EVENTS.changed, (change: DiagramChange) => {
      useDiagramStore.getState().applyRemoteChange(change)
    })

    // CU13 — Un mensaje nuevo y uno que cambió (una propuesta aplicada) se
    // tratan igual: el store los guarda por identificador.
    const receiveMessage = (message: ChatMessage) => useChatStore.getState().receive(message)
    socket.on(COLLABORATION_EVENTS.chatMessage, receiveMessage)
    socket.on(COLLABORATION_EVENTS.chatUpdated, receiveMessage)
    socket.on(COLLABORATION_EVENTS.aiStatus, (event: AiStatusEvent) => {
      useChatStore.getState().applyStatus(event)
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
      heldRef.current = null

      const store = useDiagramStore.getState()
      store.setConnection('offline')
      store.setParticipants([])
      store.clearHeldLocks()
    }
  }, [diagramId, token])

  /**
   * El elemento seleccionado se toma en exclusiva mientras dure la selección:
   * es el momento en que el usuario puede editarlo desde el panel.
   */
  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    const current: Held | null = selection
      ? { type: selection.kind, id: selection.id }
      : null
    const previous = heldRef.current
    const same = previous && current && previous.type === current.type && previous.id === current.id
    if (same) return

    const store = useDiagramStore.getState()

    if (previous) {
      socket.emit(COLLABORATION_EVENTS.lockRelease, {
        element_type: previous.type,
        element_id: previous.id,
      })
      store.setHeldLock(previous.type, previous.id, false)
    }

    if (current) {
      acquireLock(socket, current)
    }

    heldRef.current = current
  }, [selection])
}
