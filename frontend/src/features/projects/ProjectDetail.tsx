import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { diagramsApi, projectsApi } from '../../api/endpoints'
import type { Diagram, Project } from '../../api/types'
import {
  ChevronLeftIcon,
  ClassBoxIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/icons'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { formatDate, formatRelative } from '../../lib/format'
import { useResource } from '../../lib/useResource'
import { DiagramFormModal } from './DiagramFormModal'

const NO_DIAGRAMS: Diagram[] = []

/** Los elementos UML que el archivo traía y esta herramienta no representa. */
function omitted(skipped: string[]): string[] {
  return skipped.length === 0
    ? []
    : [`No se importaron algunos elementos del archivo: ${skipped.join(', ')}.`]
}

/** Qué se va a borrar cuando se pide confirmación. */
type PendingDelete = { kind: 'project' } | { kind: 'diagram'; diagram: Diagram }

interface ProjectDetailProps {
  project: Project
  onEdit: () => void
  onDeleted: (projectId: string) => void
  /** Sólo en móvil: vuelve al índice de proyectos. */
  onBack: () => void
}

export function ProjectDetail({ project, onEdit, onDeleted, onBack }: ProjectDetailProps) {
  const toast = useToast()

  const fetchDiagrams = useCallback(() => diagramsApi.listByProject(project.id), [project.id])
  const { resource, reload, updateData } = useResource(
    fetchDiagrams,
    'No se pudieron cargar los diagramas.',
  )

  const [formOpen, setFormOpen] = useState(false)
  const [editingDiagram, setEditingDiagram] = useState<Diagram | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)

  const diagrams = resource.status === 'ready' ? resource.data : NO_DIAGRAMS

  function openCreate() {
    setEditingDiagram(null)
    setFormOpen(true)
  }

  /**
   * Crea un diagrama nuevo a partir de un archivo.
   *
   * No es la importación desde imagen del asistente: aquí no hay IA que
   * adivine nada, se lee un archivo estructurado. La extensión decide cómo:
   * `.xmi` es el estándar UML con el que se intercambian modelos con otras
   * herramientas (CU06), y `.case.json` es el formato propio, que conserva
   * todo lo que esta herramienta sabe guardar.
   *
   * Siempre nace un diagrama nuevo, así que nada de lo que ya hay se pierde.
   */
  async function importDiagram(file: File | undefined) {
    if (!file || importing) return

    const isXmi = /\.(xmi|xml)$/i.test(file.name)

    setImporting(true)
    try {
      if (isXmi) {
        const { diagram, summary } = await diagramsApi.importXmi(project.id, file)
        updateData((current) => [...current, diagram])

        toast.success(
          `«${diagram.name}»: ${summary.classes} entidades, ${summary.attributes} atributos, ` +
            `${summary.methods} métodos y ${summary.relationships} relaciones.`,
        )
        // Lo que no se pudo traer se dice aparte, para que no parezca que el
        // diagrama importado está completo cuando no lo está.
        for (const warning of [...summary.warnings, ...omitted(summary.skipped)]) {
          toast.info(warning)
        }
      } else {
        const document: unknown = JSON.parse(await file.text())
        const imported = await diagramsApi.importDocument(project.id, document)

        updateData((current) => [...current, imported])
        toast.success(`«${imported.name}» importado con ${imported.classes.length} entidades.`)
      }
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : error instanceof SyntaxError
            ? 'El archivo no contiene JSON válido.'
            : 'No se pudo importar el diagrama.',
      )
    } finally {
      setImporting(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return

    setDeleting(true)
    try {
      if (pendingDelete.kind === 'project') {
        await projectsApi.remove(project.id)
        toast.success('Proyecto eliminado.')
        onDeleted(project.id)
      } else {
        const { id } = pendingDelete.diagram
        await diagramsApi.remove(id)
        updateData((current) => current.filter((diagram) => diagram.id !== id))
        toast.success('Diagrama eliminado.')
      }
      setPendingDelete(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'No se pudo eliminar.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white">
      <header className="rule-b px-5 py-5 sm:px-8 sm:py-7">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-500 transition-colors hover:text-ink-900 lg:hidden"
        >
          <ChevronLeftIcon className="size-4" />
          Proyectos
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl leading-tight font-semibold tracking-tight text-ink-950 sm:text-2xl">
              {project.name}
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-600">
              {project.description ?? 'Sin descripción.'}
            </p>
            <p className="mt-3 font-mono text-[11.5px] text-ink-400">
              Creado {formatDate(project.created_at)} · actualizado{' '}
              {formatRelative(project.updated_at)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" icon={<PencilIcon className="size-4" />} onClick={onEdit}>
              Editar
            </Button>
            <IconButton
              label="Eliminar proyecto"
              variant="danger"
              onClick={() => setPendingDelete({ kind: 'project' })}
            >
              <TrashIcon className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between gap-4 rule-b bg-ink-50/60 px-5 py-3 sm:px-8">
        <h2 className="text-[13px] font-semibold text-ink-700">
          Diagramas
          {resource.status === 'ready' && (
            <span className="ml-2 font-mono text-[12px] font-normal text-ink-400">
              {diagrams.length}
            </span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* El input va oculto y lo abre la etiqueta: un `input type=file` no
              se puede peinar como los demás botones de la interfaz. */}
          <label
            htmlFor="importar-diagrama"
            title="Crear un diagrama a partir de un archivo .xmi o .case.json"
            className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[3px] border border-ink-200 bg-white px-2.5 text-[13px] font-medium text-ink-800 transition-colors hover:border-ink-300 hover:bg-ink-50"
          >
            <UploadIcon className="size-4" />
            {importing ? 'Importando…' : 'Importar'}
          </label>
          <input
            id="importar-diagrama"
            type="file"
            accept=".xmi,.xml,application/json,.json"
            disabled={importing}
            onChange={(event) => {
              void importDiagram(event.target.files?.[0])
              // Se limpia para poder volver a elegir el mismo archivo.
              event.target.value = ''
            }}
            className="sr-only"
          />

          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon className="size-4" />}
            onClick={openCreate}
          >
            Nuevo diagrama
          </Button>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {resource.status === 'loading' ? (
          <LoadingState label="Cargando diagramas…" />
        ) : resource.status === 'error' ? (
          <ErrorState message={resource.message} onRetry={reload} />
        ) : diagrams.length === 0 ? (
          <EmptyState
            icon={<ClassBoxIcon className="size-5" />}
            title="Este proyecto aún no tiene diagramas"
            message="Cree el primer diagrama para empezar a modelar los datos del sistema."
            action={
              <Button
                variant="primary"
                icon={<PlusIcon className="size-4" />}
                onClick={openCreate}
              >
                Crear diagrama
              </Button>
            }
          />
        ) : (
          <ul>
            {diagrams.map((diagram) => (
              <li
                key={diagram.id}
                className="group flex items-center gap-4 rule-b px-5 py-4 transition-colors hover:bg-ink-50/70 sm:px-8"
              >
                <Link to={`/diagramas/${diagram.id}`} className="min-w-0 flex-1 rounded-[3px]">
                  <span className="block truncate text-[14.5px] font-medium text-ink-900">
                    {diagram.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-500">
                    {diagram.description ?? 'Sin descripción.'}
                  </span>
                  <span className="mt-1.5 block font-mono text-[11.5px] text-ink-400">
                    Actualizado {formatRelative(diagram.updated_at)}
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <IconButton
                    label="Editar diagrama"
                    onClick={() => {
                      setEditingDiagram(diagram)
                      setFormOpen(true)
                    }}
                  >
                    <PencilIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Eliminar diagrama"
                    variant="danger"
                    onClick={() => setPendingDelete({ kind: 'diagram', diagram })}
                  >
                    <TrashIcon className="size-4" />
                  </IconButton>
                </div>

                <Link
                  to={`/diagramas/${diagram.id}`}
                  className="hidden shrink-0 rounded-[3px] border border-ink-200 px-3 py-1.5 text-[13px] font-medium text-ink-700 transition-colors hover:border-signal-600 hover:text-signal-600 sm:block"
                >
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {formOpen && (
        <DiagramFormModal
          key={editingDiagram?.id ?? 'nuevo'}
          projectId={project.id}
          diagram={editingDiagram}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) =>
            updateData((current) =>
              editingDiagram
                ? current.map((diagram) => (diagram.id === saved.id ? saved : diagram))
                : [...current, saved],
            )
          }
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'project' ? 'Eliminar proyecto' : 'Eliminar diagrama'}
        message={
          pendingDelete?.kind === 'project'
            ? `Se eliminará «${project.name}» con todos sus diagramas, entidades y relaciones. Esta acción no se puede deshacer.`
            : `Se eliminará «${pendingDelete?.diagram.name ?? ''}» con todas sus entidades y relaciones. Esta acción no se puede deshacer.`
        }
        confirmLabel="Eliminar"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}
