import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, SubmitEvent } from 'react'
import type { AiMode, ChatMessage } from '../../api/types'
import { ChatIcon, CheckIcon, CloseIcon, SendIcon, SparkIcon } from '../../components/icons'
import { Button, IconButton } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { cn } from '../../lib/cn'
import { formatRelative, initials } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import { useChatStore } from '../../store/chat'
import { useDiagramStore } from '../../store/diagram'

/** El mismo tope que aplica el servidor (assistant.service.ts). */
const QUESTION_MAX_LENGTH = 4_000

const EXAMPLES = [
  '¿Qué le falta a este diagrama para poder generar el backend?',
  '¿Qué relación debería haber entre estas dos entidades?',
  '¿Cumple el diseño con los requisitos del proyecto?',
]

/** CU15 — Cómo se llama cada modo de la IA, y qué significa para el equipo. */
const MODES: Record<AiMode, { label: string; hint: string }> = {
  ANSWER: { label: 'Sólo responde', hint: 'Contesta, pero no toca el diagrama.' },
  PROPOSE: {
    label: 'Propone cambios',
    hint: 'Los cambios que proponga aparecen con «Aplicar» y «Descartar».',
  },
  EXECUTE: {
    label: 'Aplica cambios',
    hint: 'Aplica al momento lo que se le pida, en nombre de quien lo pidió.',
  },
}

/**
 * CU12 — Consultar al Asistente de IA.
 * CU13 — Visualizar Conversaciones del Equipo.
 *
 * Un chat por proyecto en el que la IA es un integrante más: cada persona
 * pregunta por su cuenta, pero todo el equipo ve las preguntas y las
 * respuestas en el momento. La IA contesta de una en una y con el contexto del
 * proyecto —memoria, descripción, el diagrama desde el que se pregunta y los
 * demás—, así que las respuestas tardan unos segundos y se anuncia a cuál está
 * respondiendo.
 *
 * CU15 — Según el modo que elija el propietario, la IA sólo responde, propone
 * cambios que cualquiera del equipo aplica o descarta, o los aplica ella.
 */
export function TeamChatPanel({ onClose }: { onClose: () => void }) {
  const messages = useChatStore((state) => state.messages)
  const loadStatus = useChatStore((state) => state.loadStatus)
  const loadError = useChatStore((state) => state.loadError)
  const ai = useChatStore((state) => state.ai)
  const answering = useChatStore((state) => state.answering)
  const reload = useChatStore((state) => state.reload)
  const ask = useChatStore((state) => state.ask)
  const diagram = useDiagramStore((state) => state.diagram)
  const me = useAuthStore((state) => state.user)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Preguntas que todavía no tienen respuesta: la que la IA está pensando y
  // las que esperan su turno.
  const pending = useMemo(() => {
    const answered = new Set(messages.map((message) => message.reply_to).filter(Boolean))
    return new Set(
      messages
        .filter((message) => message.author !== null && !answered.has(message.id))
        .map((message) => message.id),
    )
  }, [messages])

  // Al llegar un mensaje se baja hasta él, salvo que el usuario haya subido a
  // leer algo anterior: entonces no se le arranca de donde estaba.
  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160
    if (nearBottom || messages[messages.length - 1]?.author?.id === me?.id) {
      list.scrollTop = list.scrollHeight
    }
    // Sólo cuando cambia el último mensaje, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, loadStatus])

  const unavailable = ai !== null && !ai.available

  async function submit(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault()
    const content = draft.trim()
    if (content.length === 0 || sending || unavailable) return

    setSending(true)
    setError(null)
    const failure = await ask(content, diagram?.id ?? null)
    setSending(false)

    if (failure) {
      setError(failure)
    } else {
      setDraft('')
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía; Mayús+Enter es un salto de línea, como en cualquier chat.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <aside
      aria-label="Chat del equipo con la IA"
      className="absolute inset-y-0 right-0 z-40 flex w-[92vw] max-w-[380px] flex-col border-l border-ink-200 bg-white shadow-xl"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-ink-200 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <ChatIcon className="size-4 shrink-0 text-ink-500" />
          <h2 className="truncate text-[13px] font-semibold text-ink-900">Chat del equipo</h2>
          {ai && (
            <span
              title={ai.available ? `Responde ${ai.model}` : (ai.reason ?? undefined)}
              className={cn(
                'shrink-0 rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium',
                ai.available ? 'bg-success-100 text-success-700' : 'bg-ink-100 text-ink-500',
              )}
            >
              {ai.available ? 'IA disponible' : 'IA no disponible'}
            </span>
          )}
        </div>
        <IconButton label="Cerrar el chat" onClick={onClose}>
          <CloseIcon className="size-4" />
        </IconButton>
      </header>

      <ModeBar />


      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadStatus === 'loading' || loadStatus === 'idle' ? (
          <LoadingState label="Cargando la conversación…" />
        ) : loadStatus === 'error' ? (
          <ErrorState
            message={loadError ?? 'No se pudo cargar el chat.'}
            onRetry={() => void reload()}
          />
        ) : messages.length === 0 ? (
          <EmptyChat onPick={setDraft} />
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                mine={message.author !== null && message.author.id === me?.id}
                waiting={pending.has(message.id) ? (answering === message.id ? 'thinking' : 'queued') : null}
              />
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-ink-200 p-3">
        {unavailable ? (
          <p className="rounded-[3px] border border-ink-200 bg-ink-50 px-3 py-2 text-[12.5px] leading-snug text-ink-600">
            {ai?.reason ?? 'El asistente de IA no está disponible.'}
          </p>
        ) : (
          <>
            <textarea
              value={draft}
              rows={3}
              maxLength={QUESTION_MAX_LENGTH}
              disabled={sending}
              aria-label="Pregunta para la IA"
              placeholder="Pregunte a la IA sobre el diseño. Todo el equipo verá la pregunta y la respuesta."
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              className="w-full resize-none rounded-[3px] border border-ink-200 px-2.5 py-2 text-[13px] leading-snug text-ink-900 placeholder:text-ink-400 focus:border-signal-600 focus:outline-none disabled:bg-ink-50"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11.5px] text-ink-500">
                {diagram ? `Desde «${diagram.name}» · ` : ''}Enter envía, Mayús+Enter salta de línea
              </p>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={sending}
                disabled={draft.trim().length === 0}
                icon={<SendIcon className="size-4" />}
              >
                Preguntar
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[12.5px] leading-snug text-danger-700">
            {error}
          </p>
        )}
      </form>
    </aside>
  )
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <SparkIcon className="size-6 text-ink-400" />
      <h3 className="mt-3 text-[14px] font-semibold text-ink-900">La IA forma parte del equipo</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">
        Pregúntele sobre este proyecto: conoce sus diagramas, su descripción y lo que el equipo
        haya guardado en su memoria. Todos verán la pregunta y la respuesta.
      </p>
      <ul className="mt-4 flex w-full flex-col gap-1.5">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-[3px] border border-ink-200 px-3 py-2 text-left text-[12.5px] text-ink-700 transition-colors hover:border-signal-200 hover:bg-signal-50"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * CU15 — Qué puede hacer la IA en este proyecto. Lo ve todo el equipo, porque
 * cambia lo que pasa al preguntarle; sólo el propietario lo cambia.
 */
function ModeBar() {
  const mode = useChatStore((state) => state.mode)
  const ownerId = useChatStore((state) => state.ownerId)
  const setMode = useChatStore((state) => state.setMode)
  const me = useAuthStore((state) => state.user)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (mode === null) return null
  const isOwner = ownerId !== null && ownerId === me?.id

  async function change(next: AiMode) {
    setSaving(true)
    setError(null)
    const failure = await setMode(next)
    setSaving(false)
    if (failure) setError(failure)
  }

  return (
    <div className="shrink-0 border-b border-ink-200 bg-ink-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-ink-600">La IA en este proyecto</span>
        {isOwner ? (
          <select
            value={mode}
            disabled={saving}
            aria-label="Qué puede hacer la IA en este proyecto"
            onChange={(event) => void change(event.target.value as AiMode)}
            className="rounded-[3px] border border-ink-200 bg-white px-1.5 py-0.5 text-[12px] text-ink-800 focus:border-signal-600 focus:outline-none"
          >
            {(Object.keys(MODES) as AiMode[]).map((option) => (
              <option key={option} value={option}>
                {MODES[option].label}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[12px] font-medium text-ink-800">{MODES[mode].label}</span>
        )}
      </div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
        {MODES[mode].hint}
        {!isOwner && ' Lo decide el propietario del proyecto.'}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * CU15 — Los cambios que propuso la IA y qué pasó con ellos. Cualquiera del
 * equipo puede aplicarlos o descartarlos; al aplicarlos se vuelven a validar
 * contra el diagrama de ese momento, y si alguien tiene tomado lo que tocan, no
 * se aplica nada y se dice quién.
 */
function ProposalCard({ message }: { message: ChatMessage }) {
  const resolve = useChatStore((state) => state.resolve)
  const mode = useChatStore((state) => state.mode)
  const [busy, setBusy] = useState<'apply' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const summary = message.proposed_actions?.summary ?? []
  const status = message.action_status
  const by = message.resolved_by?.full_name

  async function decide(decision: 'apply' | 'reject') {
    setBusy(decision)
    setError(null)
    const failure = await resolve(message.id, decision)
    setBusy(null)
    if (failure) setError(failure)
  }

  const heading =
    status === 'PROPOSED'
      ? 'Cambios propuestos'
      : status === 'APPLIED'
        ? `Aplicado${by ? ` por ${by}` : ''}`
        : status === 'REJECTED'
          ? `Descartado${by ? ` por ${by}` : ''}`
          : 'No se pudo aplicar'

  // Aplicados, lo que importa es lo que se hizo; si no, lo que se proponía.
  const lines =
    status === 'APPLIED' && message.action_result ? message.action_result.split('\n') : summary

  return (
    <div
      className={cn(
        'mt-1.5 rounded-[3px] border bg-white px-2.5 py-2',
        status === 'PROPOSED'
          ? 'border-signal-200'
          : status === 'APPLIED'
            ? 'border-success-600/40'
            : status === 'FAILED'
              ? 'border-pending-600/40'
              : 'border-ink-200',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 text-[12px] font-semibold',
          status === 'APPLIED'
            ? 'text-success-700'
            : status === 'FAILED'
              ? 'text-pending-700'
              : status === 'REJECTED'
                ? 'text-ink-500'
                : 'text-ink-800',
        )}
      >
        {status === 'APPLIED' && <CheckIcon className="size-3.5" />}
        {heading}
      </p>

      {lines.length > 0 && (
        <ul
          className={cn(
            'mt-1 flex flex-col gap-0.5 text-[12.5px] leading-snug',
            status === 'REJECTED' ? 'text-ink-400 line-through' : 'text-ink-700',
          )}
        >
          {lines.map((line, index) => (
            <li key={index}>· {line}</li>
          ))}
        </ul>
      )}

      {status !== 'APPLIED' && message.action_result && (
        <p
          className={cn(
            'mt-1.5 text-[12px] leading-snug',
            status === 'FAILED' ? 'text-pending-700' : 'text-ink-500',
          )}
        >
          {message.action_result}
        </p>
      )}

      {status === 'PROPOSED' && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'apply'}
            disabled={busy !== null || mode === 'ANSWER'}
            onClick={() => void decide('apply')}
          >
            Aplicar
          </Button>
          <Button
            size="sm"
            loading={busy === 'reject'}
            disabled={busy !== null}
            onClick={() => void decide('reject')}
          >
            Descartar
          </Button>
        </div>
      )}
      {status === 'PROPOSED' && mode === 'ANSWER' && (
        <p className="mt-1.5 text-[11.5px] text-ink-500">
          El propietario dejó a la IA sólo para responder: no se pueden aplicar cambios.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[12px] leading-snug text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Aunque se le pide texto plano, el modelo marca a veces los nombres con
 * `acentos graves` o **asteriscos**. Se muestran como código y negrita en lugar
 * de dejar los signos a la vista; no se interpreta nada más, ni se inserta HTML.
 */
function InlineMarks({ text }: { text: string }) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={index} className="rounded-[2px] bg-white/80 px-1 font-mono text-[12px] text-ink-800">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

function MessageItem({
  message,
  mine,
  waiting,
}: {
  message: ChatMessage
  mine: boolean
  waiting: 'thinking' | 'queued' | null
}) {
  const fromAi = message.author === null
  const failed = message.error_message !== null
  const who = fromAi ? 'IA' : mine ? 'Usted' : message.author!.full_name

  return (
    <li className="flex gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
          fromAi
            ? 'border-signal-200 bg-signal-50 text-signal-700'
            : mine
              ? 'border-signal-200 bg-white text-signal-700'
              : 'border-ink-200 bg-ink-50 text-ink-700',
        )}
      >
        {fromAi ? <SparkIcon className="size-3.5" /> : initials(message.author!.full_name)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-ink-500">
          <span className="font-semibold text-ink-800" title={fromAi && message.model ? message.model : undefined}>
            {who}
          </span>
          {!fromAi && message.diagram_name && <span>en «{message.diagram_name}»</span>}
          <time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString('es')}>
            {formatRelative(message.created_at)}
          </time>
        </p>

        <div
          className={cn(
            'mt-1 rounded-[3px] px-2.5 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap',
            failed
              ? 'border border-pending-600/40 bg-pending-100 text-pending-700'
              : fromAi
                ? 'border border-signal-100 bg-signal-50 text-ink-900'
                : 'border border-ink-200 bg-white text-ink-900',
          )}
        >
          {fromAi ? <InlineMarks text={message.content} /> : message.content}
        </div>

        {fromAi && message.action_status !== 'NONE' && <ProposalCard message={message} />}

        {waiting && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-ink-500">
            {waiting === 'thinking' ? (
              <>
                <Spinner className="size-3.5" />
                La IA está respondiendo…
              </>
            ) : (
              'En cola: la IA responde las preguntas de una en una.'
            )}
          </p>
        )}
      </div>
    </li>
  )
}
