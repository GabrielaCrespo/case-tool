import { create } from 'zustand'
import { ApiError } from '../api/client'
import { assistantApi, chatApi, projectsApi } from '../api/endpoints'
import type { AiMode, AiStatus, ChatMessage } from '../api/types'
import type { AiStatusEvent } from '../realtime/types'
import { useAuthStore } from './auth'

/**
 * CU12/CU13 — Estado del chat del equipo con la IA.
 *
 * El chat es del proyecto, no del diagrama: se carga al abrir cualquiera de sus
 * diagramas y recibe por la sala del proyecto (useCollaboration) los mensajes
 * de todos —preguntas, respuestas de la IA— y a qué pregunta está respondiendo
 * la IA en cada momento.
 *
 * Los mensajes se guardan por identificador: la pregunta propia llega dos
 * veces —en la respuesta del POST y por la sala— y no debe verse dos veces.
 */

export type ChatLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ChatStore {
  projectId: string | null
  messages: ChatMessage[]
  loadStatus: ChatLoadStatus
  loadError: string | null
  /** Si al asistente se le puede preguntar, y si no, por qué. */
  ai: AiStatus | null
  /** CU15 — Qué puede hacer la IA en el proyecto, y quién lo decide. */
  mode: AiMode | null
  ownerId: string | null
  /** La pregunta a la que la IA está respondiendo ahora mismo. */
  answering: string | null
  open: boolean
  /** Mensajes de otros llegados con el panel cerrado. */
  unread: number

  load: (projectId: string) => Promise<void>
  /** Al reconectar: pudieron llegar mensajes mientras no había sala. */
  reload: () => Promise<void>
  receive: (message: ChatMessage) => void
  applyStatus: (event: AiStatusEvent) => void
  /** Devuelve el motivo si no se pudo preguntar, o null. */
  ask: (content: string, diagramId: string | null) => Promise<string | null>
  /** CU15 — Aplicar o descartar una propuesta; devuelve el motivo si no se pudo. */
  resolve: (messageId: string, decision: 'apply' | 'reject') => Promise<string | null>
  /** CU15 — Sólo el propietario; devuelve el motivo si no se pudo. */
  setMode: (mode: AiMode) => Promise<string | null>
  setOpen: (open: boolean) => void
  reset: () => void
}

function byDate(a: ChatMessage, b: ChatMessage): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

const initialState = {
  projectId: null,
  messages: [],
  loadStatus: 'idle' as ChatLoadStatus,
  loadError: null,
  ai: null,
  mode: null,
  ownerId: null,
  answering: null,
  open: false,
  unread: 0,
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...initialState,

  async load(projectId) {
    if (get().projectId === projectId && get().loadStatus !== 'error') return

    set({ ...initialState, projectId, open: get().open, loadStatus: 'loading' })
    await get().reload()
  },

  async reload() {
    const projectId = get().projectId
    if (!projectId) return

    try {
      const [messages, ai, project] = await Promise.all([
        chatApi.list(projectId),
        assistantApi.status(),
        projectsApi.get(projectId),
      ])
      // Mientras se cargaba pudo cambiarse de proyecto.
      if (get().projectId !== projectId) return
      set({
        messages: [...messages].sort(byDate),
        ai,
        mode: project.ai_mode,
        ownerId: project.owner_id,
        loadStatus: 'ready',
        loadError: null,
      })
    } catch (error) {
      if (get().projectId !== projectId) return
      set({
        loadStatus: 'error',
        loadError: error instanceof ApiError ? error.message : 'No se pudo cargar el chat del equipo.',
      })
    }
  },

  receive(message) {
    const { projectId, messages, open, unread } = get()
    if (message.project_id !== projectId) return

    const known = messages.some((existing) => existing.id === message.id)
    const next = known
      ? messages.map((existing) => (existing.id === message.id ? message : existing))
      : [...messages, message].sort(byDate)

    const mine = message.author !== null && message.author.id === useAuthStore.getState().user?.id
    set({ messages: next, unread: !known && !open && !mine ? unread + 1 : unread })
  },

  applyStatus(event) {
    if (event.project_id !== get().projectId) return

    if (event.state === 'thinking') {
      set({ answering: event.question_id })
    } else if (get().answering === event.question_id) {
      set({ answering: null })
    }
  },

  async ask(content, diagramId) {
    const projectId = get().projectId
    if (!projectId) return 'No hay un proyecto abierto.'

    try {
      get().receive(await chatApi.ask(projectId, { content, diagram_id: diagramId }))
      return null
    } catch (error) {
      // Si la IA dejó de estar disponible, el panel tiene que saberlo.
      if (error instanceof ApiError && error.status === 503) {
        void assistantApi.status().then((ai) => set({ ai }), () => undefined)
      }
      return error instanceof ApiError ? error.message : 'No se pudo enviar la pregunta.'
    }
  },

  async resolve(messageId, decision) {
    try {
      const message =
        decision === 'apply' ? await chatApi.apply(messageId) : await chatApi.reject(messageId)
      get().receive(message)
      return null
    } catch (error) {
      return error instanceof ApiError ? error.message : 'No se pudo resolver la propuesta.'
    }
  },

  async setMode(mode) {
    const projectId = get().projectId
    if (!projectId) return 'No hay un proyecto abierto.'

    try {
      const project = await projectsApi.update(projectId, { ai_mode: mode })
      set({ mode: project.ai_mode })
      return null
    } catch (error) {
      return error instanceof ApiError ? error.message : 'No se pudo cambiar el modo de la IA.'
    }
  },

  setOpen(open) {
    set(open ? { open, unread: 0 } : { open })
  },

  reset() {
    set({ ...initialState })
  },
}))
