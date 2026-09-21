import { useEffect, useState } from 'react'
import { ApiError } from '../../api/client'
import { backendApi } from '../../api/endpoints'
import type { CodegenJob, CodegenStatus } from '../../api/types'
import { AlertIcon, CheckIcon, DownloadIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/toast-context'
import { useDiagramStore } from '../../store/diagram'

/**
 * CU07 — Generar Backend y CU08 — Descargar Backend.
 *
 * Los dos caben en el mismo diálogo porque para el usuario son un solo gesto:
 * convertir el diagrama en un backend y llevárselo. Lo que los separa es que
 * generar escribe y compila un proyecto entero —y eso tarda—, mientras que
 * descargar sólo empaqueta lo que ya está hecho; por eso se puede volver a
 * descargar sin volver a generar.
 *
 * Antes de generar se enseña lo que dice el validador de CU02: si el modelo
 * tiene errores, el backend los rechazaría igualmente, y es mejor verlos aquí
 * que después de esperar a Maven.
 */

/** Cada cuánto se pregunta por el estado del trabajo. */
const POLL_MS = 1500

const RUNNING: CodegenStatus[] = ['PENDING', 'GENERATING', 'COMPILING']

const STAGE: Record<CodegenStatus, string> = {
  PENDING: 'Preparando el modelo…',
  GENERATING: 'Escribiendo el proyecto Spring Boot…',
  COMPILING: 'Compilando el proyecto con Maven…',
  SUCCESS: 'Backend generado y compilado.',
  FAILED: 'No se pudo generar el backend.',
}

function isRunning(job: CodegenJob | null): boolean {
  return job !== null && RUNNING.includes(job.status)
}

export function GenerateBackendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const diagram = useDiagramStore((state) => state.diagram)
  const validation = useDiagramStore((state) => state.validation)
  const validate = useDiagramStore((state) => state.validate)

  const [job, setJob] = useState<CodegenJob | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Al abrir: qué dice el validador y si ya hay un backend generado de antes.
  useEffect(() => {
    if (!open || !diagram) return

    let cancelled = false

    async function load() {
      setLoading(true)
      void validate()

      try {
        const latest = await backendApi.status(diagram!.id)
        if (!cancelled) setJob(latest)
      } catch {
        // Si no se puede consultar, se deja el diálogo como si no hubiera
        // ningún trabajo previo: generar de nuevo siempre es posible.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [open, diagram, validate])

  // Mientras el trabajo esté en marcha se vuelve a preguntar. Cada respuesta
  // cambia `job` y vuelve a disparar este efecto, que es lo que encadena las
  // consultas hasta que el trabajo llega a SUCCESS o a FAILED.
  useEffect(() => {
    if (!open || !diagram || !isRunning(job)) return

    const timer = setTimeout(() => {
      backendApi
        .status(diagram.id)
        .then(setJob)
        .catch(() => undefined)
    }, POLL_MS)

    return () => clearTimeout(timer)
  }, [open, diagram, job])

  async function generate() {
    if (!diagram || starting) return

    setStarting(true)
    try {
      setJob(await backendApi.generate(diagram.id))
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'No se pudo iniciar la generación.',
      )
    } finally {
      setStarting(false)
    }
  }

  async function download() {
    if (!diagram || downloading) return

    setDownloading(true)
    try {
      const { blob, fileName } = await backendApi.download(diagram.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = fileName ?? 'backend-generado.zip'
      link.click()
      URL.revokeObjectURL(url)

      toast.success('Backend descargado.')
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'No se pudo descargar el backend.',
      )
    } finally {
      setDownloading(false)
    }
  }

  const running = isRunning(job)
  const blocked = validation !== null && !validation.ready_for_generation
  const errors = (validation?.issues ?? []).filter((issue) => issue.severity === 'error')

  return (
    <Modal
      open={open}
      title="Generar el backend"
      description="Un proyecto Spring Boot con JPA y PostgreSQL, escrito a partir de este diagrama."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {job?.status === 'SUCCESS' && (
            <Button
              variant="primary"
              icon={<DownloadIcon className="size-4" />}
              loading={downloading}
              onClick={() => void download()}
            >
              Descargar .zip
            </Button>
          )}
          {job?.status !== 'SUCCESS' && (
            <Button
              variant="primary"
              loading={starting || running}
              disabled={diagram === null || blocked || loading}
              onClick={() => void generate()}
            >
              {job?.status === 'FAILED' ? 'Volver a generar' : 'Generar backend'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {blocked && <Blocked errors={errors.map((issue) => issue.message)} />}

        {running && <Progress status={job!.status} />}

        {job?.status === 'SUCCESS' && (
          <Success job={job} onRegenerate={() => void generate()} regenerating={starting} />
        )}

        {job?.status === 'FAILED' && <Failed message={job.error_message} />}

        {!blocked && job === null && !loading && (
          <p className="text-[13px] leading-relaxed text-ink-600">
            Se generará una entidad JPA por cada entidad del diagrama, con su tabla, su
            repositorio, su servicio y su API REST, más el{' '}
            <code className="font-mono text-[12px]">pom.xml</code> y
            la configuración de PostgreSQL. Después se compila con Maven para comprobar que el
            proyecto funciona; la primera vez puede tardar un par de minutos.
          </p>
        )}
      </div>
    </Modal>
  )
}

function Blocked({ errors }: { errors: string[] }) {
  return (
    <div className="border border-danger-100 bg-danger-100/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger-700">
        <AlertIcon className="size-4 shrink-0" />
        El diagrama todavía no se puede generar
      </p>
      {errors.length > 0 ? (
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-relaxed text-ink-700">
          {errors.slice(0, 6).map((message, index) => (
            <li key={index}>{message}</li>
          ))}
          {errors.length > 6 && <li>y {errors.length - 6} más.</li>}
        </ul>
      ) : (
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700">
          No hay ninguna entidad que convertir en tabla. Dibuje al menos una en el lienzo: si el
          diagrama llegó importado por XMI, puede que todo lo que traiga sean interfaces,
          enumeraciones o servicios, que no generan tabla.
        </p>
      )}
    </div>
  )
}

function Progress({ status }: { status: CodegenStatus }) {
  return (
    <div className="flex flex-col gap-2 border border-ink-200 px-3 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink-800">
        <Spinner className="size-3.5 text-signal-600" />
        {STAGE[status]}
      </p>
      {status === 'COMPILING' && (
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          Maven está compilando el proyecto generado. La primera vez descarga las dependencias
          de Spring Boot y puede tardar un par de minutos; las siguientes son mucho más rápidas.
        </p>
      )}
    </div>
  )
}

function Success({
  job,
  onRegenerate,
  regenerating,
}: {
  job: CodegenJob
  onRegenerate: () => void
  regenerating: boolean
}) {
  const summary = job.summary

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
        <CheckIcon className="size-4 shrink-0 text-signal-600" />
        {STAGE.SUCCESS}
      </p>

      {summary && (
        <dl className="grid grid-cols-3 gap-px border border-ink-200 bg-ink-200">
          <Figure label="Entidades" value={summary.entities} />
          <Figure label="Endpoints" value={summary.endpoints} />
          <Figure label="Archivos" value={summary.files.length} />
        </dl>
      )}

      {summary && (
        <p className="text-[12.5px] leading-relaxed text-ink-500">
          Paquete <code className="font-mono text-[12px] text-ink-700">{summary.base_package}</code>
          . El proyecto compila: se ha comprobado ejecutando Maven sobre él.
        </p>
      )}

      {summary && summary.notes.length > 0 && (
        <div className="border border-pending-600/40 bg-pending-100 px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-pending-700">
            Decisiones que conviene revisar
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-relaxed text-ink-700">
            {summary.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        disabled={regenerating}
        onClick={onRegenerate}
        className="self-start text-[12.5px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-900 disabled:cursor-not-allowed disabled:text-ink-300"
      >
        Volver a generarlo desde el diagrama actual
      </button>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <dt className="text-[11.5px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="text-[17px] font-semibold tabular-nums text-ink-900">{value}</dd>
    </div>
  )
}

function Failed({ message }: { message: string | null }) {
  return (
    <div className="border border-danger-100 bg-danger-100/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger-700">
        <AlertIcon className="size-4 shrink-0" />
        {STAGE.FAILED}
      </p>
      <pre className="scrollbar-thin mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-700">
        {message ?? 'El generador no dijo por qué.'}
      </pre>
    </div>
  )
}
