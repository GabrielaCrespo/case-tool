import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChatIcon,
  ChevronLeftIcon,
  CloudIcon,
  DownloadIcon,
  ServerIcon,
  SparkIcon,
  UsersIcon,
} from '../../components/icons'
import { Logo } from '../../components/Logo'
import { cn } from '../../lib/cn'
import { useChatStore } from '../../store/chat'
import { useDiagramStore } from '../../store/diagram'
import { AiAssistant } from './AiAssistant'
import { DeployDialog } from './DeployDialog'
import { ExportDialog } from './ExportDialog'
import { GenerateBackendDialog } from './GenerateBackendDialog'
import { Presence } from './Presence'
import { SaveIndicator } from './SaveIndicator'
import { ShareDialog } from './ShareDialog'

const NAME_MAX_LENGTH = 150

/**
 * Cabecera del editor: dónde estoy, cómo se llama el diagrama y si está
 * guardado. A la derecha, quién está conectado (CU03), el asistente de IA,
 * que entiende instrucciones escritas (CU04) e imágenes de diagramas (CU05), y
 * el chat del equipo con la IA (CU12/CU13).
 */
export function EditorTopBar({ projectId }: { projectId: string | null }) {
  const diagram = useDiagramStore((state) => state.diagram)
  const updateDiagram = useDiagramStore((state) => state.updateDiagram)
  const chatOpen = useChatStore((state) => state.open)
  const unread = useChatStore((state) => state.unread)
  const setChatOpen = useChatStore((state) => state.setOpen)

  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function startEditing() {
    setDraft(diagram?.name ?? '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const name = draft.trim()
    if (!diagram || name.length === 0 || name === diagram.name) return

    void updateDiagram({ name })
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-3 sm:px-4">
      <Link
        to={projectId ? `/proyectos/${projectId}` : '/proyectos'}
        className="flex shrink-0 items-center gap-1 rounded-[3px] px-1 py-1 text-ink-500 transition-colors hover:text-ink-900"
        title="Volver al proyecto"
      >
        <ChevronLeftIcon className="size-4" />
        <Logo compact />
      </Link>

      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-ink-200" />

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={NAME_MAX_LENGTH}
            aria-label="Nombre del diagrama"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(false)
            }}
            className="w-full max-w-md rounded-[3px] border border-signal-600 px-2 py-1 text-[15px] font-semibold text-ink-950 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            title="Cambiar el nombre del diagrama"
            className="max-w-full truncate rounded-[3px] px-2 py-1 text-left text-[15px] font-semibold tracking-tight text-ink-950 transition-colors hover:bg-ink-50"
          >
            {diagram?.name ?? 'Diagrama'}
          </button>
        )}
      </div>

      <SaveIndicator />

      <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-ink-200 sm:block" />

      {/* CU03 — Quién está conectado a este diagrama ahora mismo. */}
      <div className="hidden items-center gap-2 sm:flex">
        <Presence />
        <button
          type="button"
          onClick={() => setSharing(true)}
          title="Invitar a otras personas a este proyecto"
          className="flex items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
        >
          <UsersIcon className="size-4" />
          <span className="hidden lg:inline">Invitar</span>
        </button>
      </div>

      <ShareDialog projectId={projectId} open={sharing} onClose={() => setSharing(false)} />

      {/* Guardar el diagrama como archivo, en JSON propio o en XMI (CU06). No
          se parece a importar una imagen (CU05): aquí no hay IA, sólo el
          modelo guardado escrito en un formato u otro. */}
      <button
        type="button"
        disabled={diagram === null}
        onClick={() => setExporting(true)}
        title="Descargar este diagrama como archivo .case.json o .xmi"
        className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
      >
        <DownloadIcon className="size-4" />
        <span className="hidden lg:inline">Exportar</span>
      </button>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />

      {/* CU07 y CU08 — Convertir el diagrama en un backend Spring Boot y
          llevárselo comprimido. Va aquí, junto a exportar, porque las dos son
          formas de sacar el diagrama de la herramienta; la diferencia es que
          esto no saca el modelo, sino el programa que sale de él. */}
      <button
        type="button"
        disabled={diagram === null}
        onClick={() => setGenerating(true)}
        title="Generar el backend Spring Boot de este diagrama y descargarlo"
        className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
      >
        <ServerIcon className="size-4" />
        <span className="hidden lg:inline">Backend</span>
      </button>

      <GenerateBackendDialog open={generating} onClose={() => setGenerating(false)} />

      {/* Publicar lo generado: dejarlo respondiendo en una dirección pública.
          Va justo después de generar porque es su continuación, y hace falta
          para CU09: la aplicación móvil necesita una URL a la que llamar. */}
      <button
        type="button"
        disabled={diagram === null}
        onClick={() => setDeploying(true)}
        title="Publicar el backend generado en una dirección pública"
        className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
      >
        <CloudIcon className="size-4" />
        <span className="hidden lg:inline">Publicar</span>
      </button>

      <DeployDialog open={deploying} onClose={() => setDeploying(false)} />

      {/* CU04 y CU05 — Instrucciones en lenguaje natural e importar desde una
          imagen. Se deshabilita mientras no haya diagrama cargado: las dos
          operaciones necesitan saber sobre cuál se está trabajando. */}
      <button
        type="button"
        disabled={diagram === null}
        onClick={() => setAssisting(true)}
        title="Escribir o dictar el cambio, o crear el diagrama desde una imagen"
        className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-400"
      >
        <SparkIcon className="size-4" />
        <span className="hidden lg:inline">Asistente</span>
      </button>

      <AiAssistant open={assisting} onClose={() => setAssisting(false)} />

      {/* CU12 y CU13 — El chat del equipo, donde la IA es un integrante más.
          No es el asistente de al lado: aquél cambia el diagrama al momento y
          sólo lo ve quien lo usa; en el chat se pregunta y todo el equipo lee
          la conversación. El contador avisa de lo que llegó con el chat
          cerrado. */}
      <button
        type="button"
        disabled={projectId === null}
        onClick={() => setChatOpen(!chatOpen)}
        aria-pressed={chatOpen}
        title="Chat del equipo con la IA"
        className={cn(
          'relative flex shrink-0 items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:text-ink-400',
          chatOpen
            ? 'border-signal-200 bg-signal-50 text-signal-700'
            : 'border-ink-200 text-ink-700 hover:bg-ink-50',
        )}
      >
        <ChatIcon className="size-4" />
        <span className="hidden lg:inline">Chat</span>
        {unread > 0 && !chatOpen && (
          <span className="absolute -top-1.5 -right-1.5 flex min-w-4 items-center justify-center rounded-full bg-signal-600 px-1 text-[10px] leading-4 font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </header>
  )
}
