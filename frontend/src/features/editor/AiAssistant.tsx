import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiResult } from '../../api/types'
import { AlertIcon, CheckIcon, ImageIcon, MicIcon, SparkIcon, StopIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { CONTROL, CONTROL_OK } from '../../components/ui/control-styles'
import { cn } from '../../lib/cn'
import { useDiagramStore } from '../../store/diagram'
import { useVoiceRecorder } from './useVoiceRecorder'

/**
 * CU04 — Asistir el Diseño mediante IA, escribiendo o hablando.
 * CU05 — Generar Diagrama desde Imagen.
 *
 * Todo comparte ventana porque es la misma idea contada de tres maneras:
 * escribir el cambio, dictarlo o enseñar una foto del diagrama. Lo que ocurre
 * después es idéntico —la API interpreta, valida y escribe en el modelo de
 * CU02— y por eso el resultado se presenta igual en los tres casos.
 *
 * El micrófono no es una pestaña aparte: vive junto al campo de texto, porque
 * dictar no es otra función, es otra forma de escribir la misma instrucción.
 *
 * Nada se decide aquí: esta pantalla recoge la instrucción, enseña lo que ha
 * pasado y deja el lienzo repintado. Quien rechaza una instrucción imposible
 * es el servidor, no este formulario.
 */

/** Imágenes que acepta la API; se repiten aquí para poder filtrar el diálogo. */
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const MAX_COMMAND_LENGTH = 1000

/** Ejemplos que enseñan el tipo de instrucción que el asistente entiende. */
const EXAMPLES = [
  'Crea una entidad Cliente con los atributos id Integer, nombre String y correo String.',
  'Agrega el atributo telefono de tipo String a Cliente.',
  'Un Cliente puede tener muchos Pedidos y cada Pedido pertenece a un solo Cliente.',
  'Haz que Cliente herede de Usuario.',
  'Crea una composición entre Casa y Habitacion.',
  'Mueve Pedido a la derecha de Cliente.',
]

type Tab = 'command' | 'image'

export function AiAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('command')

  return (
    <Modal
      open={open}
      title="Asistente de IA"
      description="Escriba o dicte el cambio que quiere, o suba una imagen de un diagrama."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <div
        role="tablist"
        aria-label="Modo del asistente"
        className="flex gap-1 border-b border-ink-200 pb-2"
      >
        <TabButton active={tab === 'command'} onClick={() => setTab('command')}>
          <SparkIcon className="size-4" />
          Instrucción
        </TabButton>
        <TabButton active={tab === 'image'} onClick={() => setTab('image')}>
          <ImageIcon className="size-4" />
          Desde una imagen
        </TabButton>
      </div>

      <div className="pt-4">{tab === 'command' ? <CommandTab /> : <ImageTab />}</div>
    </Modal>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'bg-signal-50 text-signal-700'
          : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------------- CU04

/**
 * Qué está haciendo el asistente ahora mismo. Se enseña tal cual porque
 * dictar tarda lo suyo y el usuario necesita saber si le están transcribiendo
 * o ya cambiando el diagrama. El estado de la grabación lo lleva el propio
 * grabador, así que no se duplica aquí.
 */
type Phase =
  | { kind: 'idle' }
  /** El audio viaja, se transcribe y se interpreta en una sola petición. */
  | { kind: 'voice' }
  | { kind: 'text' }

function CommandTab() {
  const runAiCommand = useDiagramStore((state) => state.runAiCommand)
  const runAiVoice = useDiagramStore((state) => state.runAiVoice)
  const classes = useDiagramStore((state) => state.classes)

  const [command, setCommand] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [result, setResult] = useState<AiResult | null>(null)
  /** Lo que el micrófono entendió, para que se pueda comprobar. */
  const [transcription, setTranscription] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const busy = phase.kind === 'voice' || phase.kind === 'text'

  const recorder = useVoiceRecorder({
    // La grabación termina y se manda: la API transcribe y, con ese texto,
    // hace exactamente lo mismo que con una instrucción escrita.
    onFinish: (audio, fileName) => {
      void (async () => {
        setPhase({ kind: 'voice' })
        const outcome = await runAiVoice(audio, fileName)
        setPhase({ kind: 'idle' })

        if (outcome === null) return
        setTranscription(outcome.transcription)
        setResult(outcome)
        // La transcripción queda en el campo cuando no se pudo aplicar: así se
        // corrige a mano lo que el micrófono entendió mal, sin repetirlo todo.
        if (outcome.status !== 'APPLIED') setCommand(outcome.transcription)
      })()
    },
  })

  async function send() {
    if (busy || command.trim().length === 0) return

    setPhase({ kind: 'text' })
    setResult(null)
    setTranscription(null)
    const outcome = await runAiCommand(command.trim())
    setPhase({ kind: 'idle' })

    if (outcome === null) return
    setResult(outcome)

    // Sólo se vacía el campo cuando la instrucción se ejecutó: si se rechazó,
    // lo que el usuario necesita es corregir lo que escribió, no reescribirlo.
    if (outcome.status === 'APPLIED') setCommand('')
  }

  function record() {
    if (recorder.state === 'recording') {
      recorder.stop()
      return
    }

    setResult(null)
    setTranscription(null)
    void recorder.start()
  }

  // Si el permiso se deniega o el navegador no puede grabar, el hook vuelve a
  // «idle» por su cuenta y aquí sólo hay que dejar de anunciar la grabación.
  const recording = recorder.state === 'recording'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="ai-command" className="text-[13px] font-medium text-ink-700">
        ¿Qué quiere hacer con el diagrama?
      </label>

      {/* El micrófono va dentro del campo: dictar es otra forma de escribir
          aquí mismo, no otra herramienta. */}
      <div className="relative">
        <textarea
          id="ai-command"
          ref={inputRef}
          rows={3}
          autoFocus
          value={command}
          maxLength={MAX_COMMAND_LENGTH}
          disabled={busy || recording}
          placeholder="Crea una entidad Cliente con id Integer y nombre String."
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            // Enter envía; Mayús+Enter hace un salto de línea, como en
            // cualquier campo de este tipo.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          className={cn(CONTROL, CONTROL_OK, 'resize-y py-2.5 pr-12')}
        />

        <button
          type="button"
          onClick={record}
          disabled={busy || recorder.state === 'requesting'}
          aria-pressed={recording}
          title={recording ? 'Detener la grabación' : 'Dictar la instrucción'}
          aria-label={recording ? 'Detener la grabación' : 'Dictar la instrucción'}
          className={cn(
            'absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-[3px] border transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            recording
              ? 'border-danger-600 bg-danger-100 text-danger-700'
              : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:text-signal-700',
          )}
        >
          {recording ? <StopIcon className="size-4" /> : <MicIcon className="size-4" />}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-ink-500">
          {classes.length === 0
            ? 'El diagrama está vacío: empiece creando una entidad.'
            : `El asistente conoce ${
                classes.length === 1
                  ? 'la entidad del diagrama'
                  : `las ${classes.length} entidades del diagrama`
              }.`}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={recording}
          loading={phase.kind === 'text'}
        >
          {phase.kind === 'text' ? 'Interpretando…' : 'Aplicar'}
        </Button>
      </div>

      {recorder.error && (
        <p role="alert" className="text-[12.5px] text-danger-700">
          {recorder.error}
        </p>
      )}

      {recording && (
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-danger-700">
          <span className="size-2.5 animate-pulse rounded-full bg-danger-600" />
          Grabando… pulse el cuadrado para terminar.
        </p>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-500">
          <Spinner className="size-4" />
          {phase.kind === 'voice'
            ? 'Procesando el audio: transcribiendo e interpretando la instrucción…'
            : 'El modelo está leyendo la instrucción; puede tardar unos segundos.'}
        </p>
      )}

      {transcription !== null && (
        <div className="rounded-[3px] border border-ink-200 bg-ink-50 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-ink-600">Transcripción</p>
          <p className="mt-1 text-[13px] leading-snug text-ink-900">«{transcription}»</p>
        </div>
      )}

      {result && <ResultReport result={result} />}

      {!busy && !recording && result === null && (
        <div className="rounded-[3px] border border-ink-200 bg-ink-50 px-3 py-2.5">
          <p className="text-[12px] font-semibold text-ink-600">Por ejemplo</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setCommand(example)
                    inputRef.current?.focus()
                  }}
                  className="text-left text-[12.5px] leading-snug text-ink-600 underline-offset-2 hover:text-signal-700 hover:underline"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  )
}

// ------------------------------------------------------------------- CU05

function ImageTab() {
  const importFromImage = useDiagramStore((state) => state.importFromImage)

  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AiResult | null>(null)

  // La vista previa no es estado aparte: se deriva del archivo elegido, porque
  // tener dos estados que deben coincidir es tener uno que puede no coincidir.
  const preview = useMemo(() => (file === null ? null : URL.createObjectURL(file)), [file])

  // Una URL de objeto retiene la imagen en memoria hasta que se revoca.
  useEffect(() => {
    if (preview === null) return

    return () => URL.revokeObjectURL(preview)
  }, [preview])

  function choose(selected: File | undefined) {
    setResult(null)

    if (!selected) {
      setFile(null)
      return
    }

    // Se comprueba aquí además de en la API para no hacer subir 20 MB y
    // esperar a que el servidor diga que no.
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) {
      setFile(null)
      setError('El archivo debe ser una imagen PNG, JPG, JPEG o WEBP.')
      return
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setFile(null)
      setError(`La imagen no puede ocupar más de ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
      return
    }

    setError(null)
    setFile(selected)
  }

  async function process() {
    if (file === null || running) return

    setRunning(true)
    setResult(null)
    const outcome = await importFromImage(file)
    setRunning(false)

    if (outcome === null) return
    setResult(outcome)
    if (outcome.status === 'APPLIED') setFile(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-ink-500">
        Suba una foto o una captura de un diagrama de clases —una pizarra, un apunte, una captura
        de otra herramienta—. Se leerán sus entidades, sus atributos y sus relaciones, y se
        añadirán a este mismo diagrama para poder seguir editándolas aquí.
      </p>

      <label
        htmlFor="ai-image"
        className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[3px] border border-dashed border-ink-300 bg-ink-50 px-4 py-6 text-center transition-colors hover:border-signal-600 hover:bg-signal-50"
      >
        <ImageIcon className="size-6 text-ink-400" />
        <span className="text-[13px] font-medium text-ink-800">
          {file ? file.name : 'Elegir una imagen'}
        </span>
        <span className="text-[12px] text-ink-500">PNG, JPG, JPEG o WEBP · hasta 8 MB</span>
      </label>
      <input
        id="ai-image"
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        disabled={running}
        onChange={(event) => {
          choose(event.target.files?.[0])
          // Se limpia el campo para que elegir dos veces la misma imagen
          // vuelva a disparar el cambio: el navegador no avisa si el valor
          // del input no varía.
          event.target.value = ''
        }}
        className="sr-only"
      />

      {error && (
        <p role="alert" className="text-[12.5px] text-danger-700">
          {error}
        </p>
      )}

      {preview && (
        <figure className="overflow-hidden rounded-[3px] border border-ink-200">
          <img src={preview} alt="Vista previa del diagrama" className="max-h-56 w-full object-contain bg-white" />
        </figure>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-ink-500">
          {running ? 'Analizando la imagen…' : 'Se guardará también la imagen original.'}
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={file === null}
          loading={running}
          onClick={() => void process()}
        >
          {running ? 'Procesando…' : 'Procesar imagen'}
        </Button>
      </div>

      {/*
        La espera se dice larga a propósito. Sin GPU, leer un diagrama de ocho
        clases con todos sus atributos ronda los ocho minutos, y anunciar «un
        minuto» hacía que pareciera colgado justo cuando está funcionando.
      */}
      {running && (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-500">
          <Spinner className="size-4" />
          Puede tardar varios minutos: el modelo lee la imagen en este ordenador. No cierre esta
          ventana.
        </p>
      )}

      {result && <ResultReport result={result} />}
    </div>
  )
}

// ------------------------------------------------------------- resultado

/**
 * Lo que ha pasado, dicho en la misma forma para las dos pestañas: qué se
 * hizo, qué no se pudo hacer y qué decidió el sistema por su cuenta.
 */
function ResultReport({ result }: { result: AiResult }) {
  return (
    <div className="flex flex-col gap-2">
      {result.applied.length > 0 && (
        <Report
          tone="success"
          icon={<CheckIcon className="size-4 shrink-0" />}
          title={result.applied.length === 1 ? 'Hecho' : `${result.applied.length} cambios`}
          items={result.applied}
        />
      )}

      {result.rejections.length > 0 && (
        <Report
          tone="danger"
          icon={<AlertIcon className="size-4 shrink-0" />}
          title={
            result.status === 'REJECTED'
              ? 'No se modificó el diagrama'
              : 'No se pudo terminar'
          }
          items={result.rejections}
        />
      )}

      {result.warnings.length > 0 && (
        <Report
          tone="pending"
          icon={<AlertIcon className="size-4 shrink-0" />}
          title="Conviene revisar"
          items={result.warnings}
        />
      )}
    </div>
  )
}

const TONES = {
  success: 'border-success-600/40 bg-success-100 text-success-700',
  danger: 'border-danger-600/40 bg-danger-100 text-danger-700',
  pending: 'border-pending-600/40 bg-pending-100 text-pending-700',
} as const

function Report({
  tone,
  icon,
  title,
  items,
}: {
  tone: keyof typeof TONES
  icon: React.ReactNode
  title: string
  items: string[]
}) {
  return (
    <div className={cn('rounded-[3px] border px-3 py-2.5', TONES[tone])}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        {icon}
        {title}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} className="text-[12.5px] leading-snug">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}
