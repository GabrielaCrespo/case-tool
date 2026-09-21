import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError } from '../../api/client'
import { projectsApi } from '../../api/endpoints'
import type { Project } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { TextArea, TextInput } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { InlineError } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'

/** projects.name está declarado como VARCHAR(150) en PostgreSQL. */
const NAME_MAX_LENGTH = 150

interface ProjectFormModalProps {
  /** Con proyecto se edita; sin él se crea uno nuevo. */
  project: Project | null
  onClose: () => void
  onSaved: (project: Project) => void
}

/**
 * CU01 — Crear y modificar un proyecto.
 * Se monta sólo cuando está abierto, así que el estado arranca ya con los
 * datos del proyecto y no hace falta sincronizarlo después.
 */
export function ProjectFormModal({ project, onClose, onSaved }: ProjectFormModalProps) {
  const toast = useToast()
  const editing = project !== null

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [nameError, setNameError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('El nombre del proyecto no puede estar vacío.')
      return
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      setNameError(`El nombre no puede superar los ${NAME_MAX_LENGTH} caracteres.`)
      return
    }
    setNameError(undefined)

    setSaving(true)
    setFormError(null)
    try {
      const body = { name: trimmed, description: description.trim() || null }
      const saved = editing
        ? await projectsApi.update(project.id, body)
        : await projectsApi.create(body)

      toast.success(editing ? 'Proyecto actualizado.' : 'Proyecto creado.')
      onSaved(saved)
      onClose()
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo guardar el proyecto.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={editing ? 'Editar proyecto' : 'Nuevo proyecto'}
      description={
        editing
          ? 'Cambie el nombre o la descripción del proyecto.'
          : 'Un proyecto agrupa los diagramas de un mismo sistema.'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} form="project-form" type="submit">
            {editing ? 'Guardar cambios' : 'Crear proyecto'}
          </Button>
        </>
      }
    >
      <form id="project-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <InlineError message={formError} />}

        <TextInput
          label="Nombre"
          placeholder="Sistema de facturación"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          error={nameError}
          counter={`${name.length}/${NAME_MAX_LENGTH}`}
          onChange={(event) => setName(event.target.value)}
        />

        <TextArea
          label="Descripción"
          placeholder="Qué modela este proyecto y para quién."
          rows={4}
          value={description}
          hint="Opcional."
          onChange={(event) => setDescription(event.target.value)}
        />
      </form>
    </Modal>
  )
}
