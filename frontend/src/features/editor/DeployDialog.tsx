import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { deploymentApi } from '../../api/endpoints'
import type { Deployment, DeploymentStatus } from '../../api/types'
import { AlertIcon, CheckIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/toast-context'
import { useDiagramStore } from '../../store/diagram'
import { QrCode } from './QrCode'

/**
 * Publicar el backend generado.
 *
 * Es el paso siguiente a generarlo y descargarlo: en vez de llevarse un .zip,
 * se deja el backend respondiendo en una URL pública. Hace falta para la
 * aplicación móvil, que necesita una dirección a la que llamar, y por eso el
 * diálogo enseña la URL con un código QR: escanearlo es como se conecta el
 * teléfono sin teclear nada.
 *
 * Construir la imagen y arrancar el contenedor tarda, así que se pregunta
 * periódicamente por el estado, igual que en la generación.
 */

/** Cada cuánto se pregunta por el estado. */
const POLL_MS = 2000

const RUNNING: DeploymentStatus[] = ['PENDING', 'BUILDING', 'STARTING']

const STAGE: Record<DeploymentStatus, string> = {
  PENDING: 'Preparando la publicación…',
  BUILDING: 'Construyendo la imagen del backend…',
  STARTING: 'Arrancando el contenedor…',
  RUNNING: 'El backend está publicado y respondiendo.',
  FAILED: 'No se pudo publicar el backend.',
  STOPPED: 'El backend está dado de baja.',
}

function isRunning(deployment: Deployment | null): boolean {
  return deployment !== null && RUNNING.includes(deployment.status)
}

export function DeployDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const diagram = useDiagramStore((state) => state.diagram)

  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirmingStop, setConfirmingStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [logs, setLogs] = useState<string | null>(null)

  // Al abrir: si este diagrama ya estaba publicado, en qué estado quedó.
  useEffect(() => {
    if (!open || !diagram) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setLogs(null)

      try {
        const current = await deploymentApi.status(diagram!.id)
        if (!cancelled) setDeployment(current)
      } catch {
        // Si no se puede consultar, se deja como si nunca se hubiera
        // publicado: volver a publicar siempre es posible.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [open, diagram])

  // Mientras la publicación esté en marcha se vuelve a preguntar. Cada
  // respuesta cambia `deployment` y vuelve a disparar este efecto, que es lo
  // que encadena las consultas hasta RUNNING o FAILED.
  useEffect(() => {
    if (!open || !diagram || !isRunning(deployment)) return

    const timer = setTimeout(() => {
      deploymentApi
        .status(diagram.id)
        .then(setDeployment)
        .catch(() => undefined)
    }, POLL_MS)

    return () => clearTimeout(timer)
  }, [open, diagram, deployment])

  async function publish() {
    if (!diagram || starting) return

    setStarting(true)
    setLogs(null)
    try {
      setDeployment(await deploymentApi.deploy(diagram.id))
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'No se pudo iniciar la publicación.',
      )
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    if (!diagram || stopping) return

    setStopping(true)
    try {
      setDeployment(await deploymentApi.remove(diagram.id))
      toast.success('Backend dado de baja.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'No se pudo dar de baja.')
    } finally {
      setStopping(false)
      setConfirmingStop(false)
    }
  }

  async function showLogs() {
    if (!diagram) return

    try {
      const { lines } = await deploymentApi.logs(diagram.id)
      setLogs(lines.length > 0 ? lines : 'El contenedor no dejó ninguna línea.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'No se pudieron leer los registros.')
    }
  }

  const running = isRunning(deployment)
  const published = deployment?.status === 'RUNNING'

  return (
    <Modal
      open={open}
      title="Publicar el backend"
      description="Deja el backend generado respondiendo en una dirección pública, que es lo que la aplicación móvil necesita."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {published && (
            <Button variant="secondary" onClick={() => setConfirmingStop(true)}>
              Dar de baja
            </Button>
          )}
          <Button
            variant="primary"
            loading={starting || running}
            disabled={diagram === null || loading}
            onClick={() => void publish()}
          >
            {published ? 'Volver a publicar' : 'Publicar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {running && <Progress status={deployment!.status} />}

        {published && <Published deployment={deployment!} />}

        {deployment?.status === 'FAILED' && (
          <Failed message={deployment.error_message} onLogs={() => void showLogs()} />
        )}

        {logs !== null && (
          <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap break-words border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-700">
            {logs}
          </pre>
        )}

        {!loading && (deployment === null || deployment.status === 'STOPPED') && (
          <p className="text-[13px] leading-relaxed text-ink-600">
            Se construirá una imagen con el backend que generó este diagrama, se le creará su
            propia base de datos y quedará respondiendo bajo{' '}
            <code className="font-mono text-[12px]">/d/{'<'}nombre del diagrama{'>'}</code>. Hay
            que haberlo generado antes; la primera publicación tarda varios minutos porque
            descarga las dependencias de Spring Boot.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmingStop}
        title="Dar de baja el backend"
        message="Se parará el contenedor y se borrará su base de datos con todo lo que se haya guardado desde la aplicación móvil. El diagrama y el proyecto generado no se tocan."
        confirmLabel="Dar de baja"
        loading={stopping}
        onConfirm={() => void stop()}
        onCancel={() => setConfirmingStop(false)}
      />
    </Modal>
  )
}

function Progress({ status }: { status: DeploymentStatus }) {
  return (
    <div className="flex flex-col gap-2 border border-ink-200 px-3 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-800">
        <Spinner className="size-3.5 text-signal-600" />
        {STAGE[status]}
      </p>
      {status === 'BUILDING' && (
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          La imagen se construye compilando el proyecto con Maven dentro de ella. La primera vez
          descarga las dependencias de Spring Boot y puede tardar varios minutos; las siguientes
          reutilizan lo descargado.
        </p>
      )}
    </div>
  )
}

/**
 * La dirección, para copiar y para escanear.
 *
 * El código QR no es un adorno: es como el teléfono se conecta al backend sin
 * que nadie teclee una URL larga en una pantalla pequeña.
 */
function Published({ deployment }: { deployment: Deployment }) {
  const toast = useToast()
  const url = deployment.api_url ?? ''

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
        <CheckIcon className="size-4 shrink-0 text-signal-600" />
        {STAGE.RUNNING}
      </p>

      <div className="flex flex-col gap-3 border border-ink-200 px-3 py-3 sm:flex-row sm:items-center">
        <QrCode value={url} className="mx-auto size-36 shrink-0 sm:mx-0" />

        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[12.5px] text-ink-500">
            Escanee este código desde la aplicación móvil, o copie la dirección:
          </p>
          <code className="break-all font-mono text-[12px] text-ink-800">{url}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(url)
              toast.success('Dirección copiada.')
            }}
            className="self-start text-[12.5px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-900"
          >
            Copiar la dirección
          </button>
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-500">
        La descripción del modelo está en{' '}
        <code className="font-mono text-[12px] text-ink-700">{url}/api/_meta</code>, y es de ahí de
        donde la aplicación móvil saca sus pantallas.
      </p>
    </div>
  )
}

function Failed({ message, onLogs }: { message: string | null; onLogs: () => void }) {
  return (
    <div className="border border-danger-100 bg-danger-100/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger-700">
        <AlertIcon className="size-4 shrink-0" />
        {STAGE.FAILED}
      </p>
      <pre className="scrollbar-thin mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-700">
        {message ?? 'No se dijo por qué.'}
      </pre>
      <button
        type="button"
        onClick={onLogs}
        className="mt-1.5 text-[12.5px] text-ink-600 underline underline-offset-2 transition-colors hover:text-ink-900"
      >
        Ver los registros del contenedor
      </button>
    </div>
  )
}
