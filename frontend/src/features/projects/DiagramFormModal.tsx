import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { ApiError } from '../../api/client'
import { diagramsApi } from '../../api/endpoints'
import type { Diagram } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { TextArea, TextInput } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { InlineError } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'

/** diagrams.name está declarado como VARCHAR(150). */
const NAME_MAX_LENGTH = 150

interface DiagramFormModalProps {
  projectId: string
  /** Con diagrama se edita; sin él se crea uno nuevo en el proyecto. */
  diagram: Diagram | null
  onClose: () => void
  onSaved: (diagram: Diagram) => void
}

/** CU02 — Crear y modificar un diagrama dentro de un proyecto. */
export function DiagramFormModal({
  projectId,
  diagram,
  onClose,
  onSaved,
}: DiagramFormModalProps) {
  const toast = useToast()
  const editing = diagram !== null

  const [name, setName] = useState(diagram?.name ?? '')
  const [description, setDescription] = useState(diagram?.description ?? '')
  const [nameError, setNameError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('El nombre del diagrama no puede estar vacío.')
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
        ? await diagramsApi.update(diagram.id, body)
        : await diagramsApi.create(projectId, body)

      toast.success(editing ? 'Diagrama actualizado.' : 'Diagrama creado.')
      onSaved(saved)
      onClose()
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo guardar el diagrama.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={editing ? 'Editar diagrama' : 'Nuevo diagrama'}
      description={
        editing
          ? 'Cambie el nombre o la descripción del diagrama.'
          : 'Se abrirá vacío, listo para colocar la primera entidad.'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} form="diagram-form" type="submit">
            {editing ? 'Guardar cambios' : 'Crear diagrama'}
          </Button>
        </>
      }
    >
      <form id="diagram-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <InlineError message={formError} />}

        <TextInput
          label="Nombre"
          placeholder="Modelo de dominio"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          error={nameError}
          counter={`${name.length}/${NAME_MAX_LENGTH}`}
          onChange={(event) => setName(event.target.value)}
        />

        <TextArea
          label="Descripción"
          placeholder="Qué parte del sistema representa este diagrama."
          rows={4}
          value={description}
          hint="Opcional."
          onChange={(event) => setDescription(event.target.value)}
        />
      </form>
    </Modal>
  )
}
