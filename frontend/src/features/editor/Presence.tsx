import { cn } from '../../lib/cn'
import { initials } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import { useDiagramStore } from '../../store/diagram'

/** Cuántas iniciales caben antes de resumir el resto en un contador. */
const MAX_AVATARS = 4

/**
 * CU03 — Quién está trabajando ahora mismo en este diagrama.
 *
 * Muestra a los conectados y el estado de la conexión propia, que es lo que
 * permite saber si lo que se ve está al día o se perdió la sala.
 */
export function Presence() {
  const participants = useDiagramStore((state) => state.participants)
  const connection = useDiagramStore((state) => state.connection)
  const me = useAuthStore((state) => state.user)

  // El usuario propio va primero; el resto, por nombre.
  const ordered = [...participants].sort((a, b) => {
    if (a.user_id === me?.id) return -1
    if (b.user_id === me?.id) return 1
    return a.full_name.localeCompare(b.full_name)
  })

  const shown = ordered.slice(0, MAX_AVATARS)
  const rest = ordered.length - shown.length

  const connectionLabel =
    connection === 'online'
      ? `${participants.length} ${participants.length === 1 ? 'persona conectada' : 'personas conectadas'}`
      : connection === 'connecting'
        ? 'Conectando con la sala…'
        : 'Sin conexión con la sala'

  return (
    <div className="flex items-center gap-2" title={connectionLabel}>
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          connection === 'online'
            ? 'bg-success-600'
            : connection === 'connecting'
              ? 'animate-pulse bg-pending-600'
              : 'bg-ink-300',
        )}
      />

      <div className="flex items-center -space-x-1.5">
        {shown.map((participant) => {
          const isMe = participant.user_id === me?.id

          return (
            <span
              key={participant.user_id}
              title={isMe ? `${participant.full_name} (usted)` : participant.full_name}
              className={cn(
                'flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold',
                isMe
                  ? 'border-signal-200 bg-signal-50 text-signal-700'
                  : 'border-ink-200 bg-ink-50 text-ink-700',
              )}
            >
              {initials(participant.full_name)}
            </span>
          )
        })}

        {rest > 0 && (
          <span
            title={ordered
              .slice(MAX_AVATARS)
              .map((participant) => participant.full_name)
              .join(', ')}
            className="flex size-7 items-center justify-center rounded-full border border-ink-200 bg-white text-[10.5px] font-semibold text-ink-500"
          >
            +{rest}
          </span>
        )}
      </div>

      <span className="sr-only">{connectionLabel}</span>
    </div>
  )
}
