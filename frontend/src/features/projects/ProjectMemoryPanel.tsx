import { useCallback, useState } from 'react'
import type { ReactNode, SubmitEvent } from 'react'
import { ApiError } from '../../api/client'
import { memoryApi } from '../../api/endpoints'
import type { MemoryEntry, MemoryKind, Project } from '../../api/types'
import { PencilIcon, PlusIcon, SparkIcon, TrashIcon } from '../../components/icons'
import { Button, IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { SelectField, TextArea, TextInput } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { ErrorState, InlineError, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { formatRelative } from '../../lib/format'
import { useResource } from '../../lib/useResource'

/** project_memory_entries.title es VARCHAR(200); el contenido, el mismo tope que el servidor. */
const TITLE_MAX_LENGTH = 200
const CONTENT_MAX_LENGTH = 8_000

const KINDS: Record<MemoryKind, { heading: string; singular: string; empty: string; placeholder: string }> = {
  DECISION: {
    heading: 'Decisiones técnicas',
    singular: 'Decisión técnica',
    empty: 'Todavía no hay decisiones técnicas.',
    placeholder: 'Los montos se guardan en bolivianos, con BigDecimal y dos decimales.',
  },
  REQUIREMENT: {
    heading: 'Requisitos',
    singular: 'Requisito',
    empty: 'Todavía no hay requisitos.',
    placeholder: 'Un cliente puede comprar a crédito y pagar en cuotas.',
  },
  SUMMARY: {
    heading: 'Resúmenes de conversaciones',
    singular: 'Resumen',
    empty: 'Todavía no hay resúmenes: el propietario puede pedírselos a la IA.',
    placeholder: '- Se decidió…',
  },
}

const ORDER: MemoryKind[] = ['DECISION', 'REQUIREMENT', 'SUMMARY']

/**
 * CU14 — Gestionar Memoria del Proyecto.
 *
 * Lo que la IA del chat tiene en cuenta en cada respuesta además de la propia
 * conversación: la descripción del proyecto, las decisiones técnicas y los
 * requisitos que fija el equipo, los resúmenes de conversaciones anteriores y
 * los diagramas, que se leen del modelo y por eso siempre están al día.
 *
 * La ve todo el equipo; la cambia el propietario, que es también quien pide a
 * la IA que resuma el chat. El resumen no se hace solo: se pide con un botón y
 * queda como una entrada más, que se puede corregir o borrar.
 */
export function ProjectMemoryPanel({
  project,
  onEditDescription,
}: {
  project: Project
  onEditDescription: () => void
}) {
  const toast = useToast()
  const fetchMemory = useCallback(() => memoryApi.get(project.id), [project.id])
  const { resource, reload, updateData } = useResource(
    fetchMemory,
    'No se pudo cargar la memoria del proyecto.',
  )

  const [editing, setEditing] = useState<{ entry: MemoryEntry | null; kind: MemoryKind } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MemoryEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [summarizing, setSummarizing] = useState(false)

  if (resource.status === 'loading') return <LoadingState label="Cargando la memoria del proyecto…" />
  if (resource.status === 'error') return <ErrorState message={resource.message} onRetry={reload} />

  const memory = resource.data
  const canEdit = memory.can_edit

  async function summarize() {
    setSummarizing(true)
    try {
      const entry = await memoryApi.summarize(project.id)
      updateData((current) => ({ ...current, entries: [...current.entries, entry] }))
      toast.success('La IA resumió la conversación y quedó guardada en la memoria.')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'No se pudo resumir la conversación.')
    } finally {
      setSummarizing(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await memoryApi.remove(pendingDelete.id)
      updateData((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.id !== pendingDelete.id),
      }))
      setPendingDelete(null)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'No se pudo borrar la entrada.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 rule-b px-5 py-4 sm:px-8">
        <p className="max-w-2xl text-[13px] leading-relaxed text-ink-600">
          Lo que la IA del chat tiene en cuenta en cada respuesta, además de lo que se hable en él.
          {!canEdit && ' Sólo el propietario del proyecto la cambia.'}
        </p>
        {canEdit && (
          <Button
            size="sm"
            icon={<SparkIcon className="size-4" />}
            loading={summarizing}
            onClick={() => void summarize()}
            title="La IA resume lo que se habló en el chat desde el último resumen"
          >
            Resumir conversación
          </Button>
        )}
      </div>

      <MemorySection
        heading="Descripción del proyecto"
        action={
          canEdit && (
            <Button size="sm" icon={<PencilIcon className="size-4" />} onClick={onEditDescription}>
              Editar
            </Button>
          )
        }
      >
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-700">
          {project.description ?? 'Sin descripción. Contarle a la IA de qué trata el sistema mejora mucho sus respuestas.'}
        </p>
      </MemorySection>

      {ORDER.map((kind) => {
        const entries = memory.entries.filter((entry) => entry.kind === kind)

        return (
          <MemorySection
            key={kind}
            heading={KINDS[kind].heading}
            count={entries.length}
            action={
              canEdit && (
                <Button
                  size="sm"
                  icon={<PlusIcon className="size-4" />}
                  onClick={() => setEditing({ entry: null, kind })}
                >
                  Agregar
                </Button>
              )
            }
          >
            {entries.length === 0 ? (
              <p className="text-[13px] text-ink-400">{KINDS[kind].empty}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="group rounded-[3px] border border-ink-200 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-[13.5px] font-semibold text-ink-900">{entry.title}</h4>
                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                          <IconButton
                            label="Editar entrada"
                            onClick={() => setEditing({ entry, kind: entry.kind })}
                          >
                            <PencilIcon className="size-4" />
                          </IconButton>
                          <IconButton
                            label="Borrar entrada"
                            variant="danger"
                            onClick={() => setPendingDelete(entry)}
                          >
                            <TrashIcon className="size-4" />
                          </IconButton>
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-700">
                      {entry.content}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-ink-400">
                      {entry.created_by.full_name} · actualizado {formatRelative(entry.updated_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </MemorySection>
        )
      })}

      <MemorySection heading="Diagramas" count={memory.diagrams.length}>
        <p className="mb-2 text-[12.5px] text-ink-500">
          La IA los lee directamente del modelo en cada pregunta, así que siempre están al día.
        </p>
        {memory.diagrams.length === 0 ? (
          <p className="text-[13px] text-ink-400">Este proyecto todavía no tiene diagramas.</p>
        ) : (
          <ul className="flex flex-col">
            {memory.diagrams.map((diagram) => (
              <li
                key={diagram.id}
                className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1.5 last:border-b-0"
              >
                <span className="truncate text-[13.5px] text-ink-800">{diagram.name}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-ink-400">
                  {diagram.classes} {diagram.classes === 1 ? 'entidad' : 'entidades'} ·{' '}
                  {diagram.relationships} {diagram.relationships === 1 ? 'relación' : 'relaciones'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </MemorySection>

      {editing && (
        <MemoryEntryModal
          key={editing.entry?.id ?? `nueva-${editing.kind}`}
          projectId={project.id}
          entry={editing.entry}
          initialKind={editing.kind}
          onClose={() => setEditing(null)}
          onSaved={(saved) =>
            updateData((current) => ({
              ...current,
              entries: current.entries.some((entry) => entry.id === saved.id)
                ? current.entries.map((entry) => (entry.id === saved.id ? saved : entry))
                : [...current.entries, saved],
            }))
          }
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Borrar entrada de memoria"
        message={`Se borrará «${pendingDelete?.title ?? ''}». La IA dejará de tenerla en cuenta en sus respuestas.`}
        confirmLabel="Borrar"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function MemorySection({
  heading,
  count,
  action,
  children,
}: {
  heading: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rule-b px-5 py-4 sm:px-8">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink-700">
          {heading}
          {count !== undefined && (
            <span className="ml-2 font-mono text-[12px] font-normal text-ink-400">{count}</span>
          )}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** CU14 — Crear o corregir una entrada de la memoria. */
function MemoryEntryModal({
  projectId,
  entry,
  initialKind,
  onClose,
  onSaved,
}: {
  projectId: string
  entry: MemoryEntry | null
  initialKind: MemoryKind
  onClose: () => void
  onSaved: (entry: MemoryEntry) => void
}) {
  const editing = entry !== null
  const [kind, setKind] = useState<MemoryKind>(entry?.kind ?? initialKind)
  const [title, setTitle] = useState(entry?.title ?? '')
  const [content, setContent] = useState(entry?.content ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (title.trim().length === 0 || content.trim().length === 0) {
      setFormError('El título y el contenido son obligatorios.')
      return
    }

    setSaving(true)
    setFormError(null)
    try {
      const body = { kind, title: title.trim(), content: content.trim() }
      const saved = editing
        ? await memoryApi.update(entry.id, body)
        : await memoryApi.create(projectId, body)
      onSaved(saved)
      onClose()
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo guardar la entrada.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={editing ? 'Editar entrada de memoria' : `Nueva entrada: ${KINDS[kind].singular.toLowerCase()}`}
      description="La IA del chat la tendrá en cuenta en todas sus respuestas sobre este proyecto."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} form="memory-form" type="submit">
            {editing ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </>
      }
    >
      <form id="memory-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <InlineError message={formError} />}

        <SelectField
          label="Tipo"
          value={kind}
          onChange={(event) => setKind(event.target.value as MemoryKind)}
        >
          {ORDER.map((option) => (
            <option key={option} value={option}>
              {KINDS[option].singular}
            </option>
          ))}
        </SelectField>

        <TextInput
          label="Título"
          maxLength={TITLE_MAX_LENGTH}
          value={title}
          counter={`${title.length}/${TITLE_MAX_LENGTH}`}
          onChange={(event) => setTitle(event.target.value)}
        />

        <TextArea
          label="Contenido"
          rows={6}
          maxLength={CONTENT_MAX_LENGTH}
          placeholder={KINDS[kind].placeholder}
          value={content}
          counter={`${content.length}/${CONTENT_MAX_LENGTH}`}
          onChange={(event) => setContent(event.target.value)}
        />
      </form>
    </Modal>
  )
}
