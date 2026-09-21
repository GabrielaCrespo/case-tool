import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { projectsApi } from '../../api/endpoints'
import type { Project } from '../../api/types'
import { AppHeader } from '../../components/AppHeader'
import { FolderIcon, PlusIcon, SearchIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { CONTROL_COMPACT } from '../../components/ui/control-styles'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States'
import { cn } from '../../lib/cn'
import { formatRelative } from '../../lib/format'
import { useResource } from '../../lib/useResource'
import { ProjectDetail } from './ProjectDetail'
import { ProjectFormModal } from './ProjectFormModal'

const NO_PROJECTS: Project[] = []

/**
 * CU01 — Gestionar Proyecto de Diseño.
 *
 * Dos paneles: a la izquierda el índice de proyectos, a la derecha el proyecto
 * abierto con sus diagramas. En móvil sólo se ve uno de los dos a la vez.
 */
export function ProjectsPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()

  const fetchProjects = useCallback(() => projectsApi.list(), [])
  const { resource, reload, updateData } = useResource(
    fetchProjects,
    'No se pudieron cargar los proyectos.',
  )

  const [query, setQuery] = useState('')
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const projects = resource.status === 'ready' ? resource.data : NO_PROJECTS

  const selected = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return projects

    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        (project.description ?? '').toLowerCase().includes(needle),
    )
  }, [projects, query])

  function openCreate() {
    setEditingProject(null)
    setFormOpen(true)
  }

  function onProjectSaved(saved: Project) {
    const isNew = editingProject === null
    updateData((current) =>
      isNew
        ? [saved, ...current]
        : current.map((project) => (project.id === saved.id ? saved : project)),
    )
    if (isNew) navigate(`/proyectos/${saved.id}`)
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader />

      <div className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[320px_1fr]">
        {/* Índice de proyectos */}
        <aside
          className={cn(
            'flex min-h-0 w-full flex-col border-r border-ink-200 bg-white lg:flex',
            projectId ? 'hidden lg:flex' : 'flex',
          )}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-5 pb-3">
            <h1 className="text-[15px] font-semibold tracking-tight text-ink-950">Proyectos</h1>
            <Button
              size="sm"
              variant="primary"
              icon={<PlusIcon className="size-4" />}
              onClick={openCreate}
            >
              Nuevo
            </Button>
          </div>

          <div className="relative px-4 pb-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-[26px] size-4 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar proyecto"
              aria-label="Buscar proyecto"
              className={cn(CONTROL_COMPACT, 'pl-8')}
            />
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto rule-t">
            {resource.status === 'loading' ? (
              <LoadingState label="Cargando proyectos…" />
            ) : resource.status === 'error' ? (
              <ErrorState message={resource.message} onRetry={reload} compact />
            ) : projects.length === 0 ? (
              <EmptyState
                icon={<FolderIcon className="size-5" />}
                title="Sin proyectos todavía"
                message="Un proyecto agrupa los diagramas de un mismo sistema. Cree el primero para empezar."
                action={
                  <Button
                    variant="primary"
                    icon={<PlusIcon className="size-4" />}
                    onClick={openCreate}
                  >
                    Crear proyecto
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<SearchIcon className="size-5" />}
                title="Ningún proyecto coincide"
                message={`No hay proyectos que contengan «${query.trim()}». Pruebe con otro texto.`}
                action={
                  <Button size="sm" onClick={() => setQuery('')}>
                    Limpiar búsqueda
                  </Button>
                }
              />
            ) : (
              <ul>
                {filtered.map((project) => {
                  const active = project.id === projectId
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/proyectos/${project.id}`)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'flex w-full flex-col gap-1 rule-b border-l-2 px-4 py-3 text-left transition-colors',
                          active
                            ? 'border-l-signal-600 bg-signal-50'
                            : 'border-l-transparent hover:bg-ink-50',
                        )}
                      >
                        <span
                          className={cn(
                            'truncate text-[14px] font-medium',
                            active ? 'text-signal-700' : 'text-ink-900',
                          )}
                        >
                          {project.name}
                        </span>
                        <span className="truncate text-[12.5px] text-ink-500">
                          {project.description ?? 'Sin descripción.'}
                        </span>
                        <span className="font-mono text-[11px] text-ink-400">
                          {formatRelative(project.updated_at)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Proyecto abierto */}
        <div className={cn('min-h-0 flex-1 flex-col', projectId ? 'flex' : 'hidden lg:flex')}>
          {selected ? (
            <ProjectDetail
              key={selected.id}
              project={selected}
              onEdit={() => {
                setEditingProject(selected)
                setFormOpen(true)
              }}
              onDeleted={(deletedId) => {
                updateData((current) => current.filter((project) => project.id !== deletedId))
                navigate('/proyectos', { replace: true })
              }}
              onBack={() => navigate('/proyectos')}
            />
          ) : resource.status === 'loading' ? (
            <LoadingState />
          ) : projectId ? (
            <EmptyState
              icon={<FolderIcon className="size-5" />}
              title="Proyecto no encontrado"
              message="El proyecto no existe o ya no tiene acceso a él."
              action={<Button onClick={() => navigate('/proyectos')}>Ver mis proyectos</Button>}
            />
          ) : (
            <EmptyState
              icon={<FolderIcon className="size-5" />}
              title="Seleccione un proyecto"
              message="Elija un proyecto del índice para ver sus diagramas, o cree uno nuevo."
              action={
                <Button
                  variant="primary"
                  icon={<PlusIcon className="size-4" />}
                  onClick={openCreate}
                >
                  Crear proyecto
                </Button>
              }
            />
          )}
        </div>
      </div>

      {/* La clave reinicia el formulario sin necesidad de un efecto. */}
      {formOpen && (
        <ProjectFormModal
          key={editingProject?.id ?? 'nuevo'}
          project={editingProject}
          onClose={() => setFormOpen(false)}
          onSaved={onProjectSaved}
        />
      )}
    </div>
  )
}
