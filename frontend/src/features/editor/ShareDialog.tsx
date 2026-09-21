import { useEffect, useState } from 'react'
import { membersApi } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { ProjectMember } from '../../api/types'
import { Button, IconButton } from '../../components/ui/Button'
import { CloseIcon } from '../../components/icons'
import { TextInput } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/toast-context'
import { initials } from '../../lib/format'
import { useAuthStore } from '../../store/auth'
import { useDiagramStore } from '../../store/diagram'

/**
 * CU03 — Invitar a otras personas al proyecto.
 *
 * El acceso a un diagrama se hereda del proyecto, así que invitar aquí es lo
 * que permite que varios usuarios entren a la misma sala. Sólo se puede invitar
 * a cuentas ya registradas: no hay envío de correos.
 */
export function ShareDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: string | null
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const me = useAuthStore((state) => state.user)
  const participants = useDiagramStore((state) => state.participants)

  // null mientras se está pidiendo la lista, igual que en el resto de pantallas.
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El estado sólo cambia cuando responde la promesa, nunca dentro del efecto.
  useEffect(() => {
    if (!open || !projectId) return
    let active = true

    membersApi.list(projectId).then(
      (rows) => {
        if (active) setMembers(rows)
      },
      () => {
        if (active) setMembers([])
      },
    )

    return () => {
      active = false
    }
  }, [open, projectId])

  const rows = members ?? []
  const owner = rows.find((member) => member.role === 'OWNER')
  const iAmOwner = owner?.user_id === me?.id

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    if (!projectId || inviting) return

    const value = email.trim()
    if (value.length === 0) {
      setError('Indique el correo de la persona a invitar.')
      return
    }

    setInviting(true)
    setError(null)
    try {
      const member = await membersApi.add(projectId, value)
      setMembers((current) => [...(current ?? []), member])
      setEmail('')
      toast.success(`${member.full_name} ya puede editar este diagrama.`)
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'No se pudo invitar a esa persona.',
      )
    } finally {
      setInviting(false)
    }
  }

  async function revoke(member: ProjectMember) {
    if (!projectId) return

    try {
      await membersApi.remove(projectId, member.user_id)
      setMembers((current) => (current ?? []).filter((row) => row.user_id !== member.user_id))
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : 'No se pudo retirar el acceso.',
      )
    }
  }

  const connectedIds = new Set(participants.map((participant) => participant.user_id))

  return (
    <Modal
      open={open}
      title="Compartir el proyecto"
      description="Quien tenga acceso al proyecto puede editar sus diagramas en tiempo real."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {iAmOwner && (
        <form onSubmit={(event) => void invite(event)} className="flex items-end gap-2">
          <div className="flex-1">
            <TextInput
              label="Correo de la persona"
              type="email"
              placeholder="companero@ejemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={error}
              hint="Debe tener ya una cuenta en la herramienta."
            />
          </div>
          <Button type="submit" variant="primary" disabled={inviting} className="mb-[22px]">
            {inviting ? 'Invitando…' : 'Invitar'}
          </Button>
        </form>
      )}

      <div className={iAmOwner ? 'mt-5' : ''}>
        <h3 className="text-[12.5px] font-semibold tracking-wide text-ink-500 uppercase">
          Con acceso
        </h3>

        {members === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-ink-100">
            {rows.map((member) => {
              const connected = connectedIds.has(member.user_id)

              return (
                <li key={member.user_id} className="flex items-center gap-3 py-2.5">
                  <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-[11px] font-semibold text-ink-700">
                    {initials(member.full_name)}
                    {connected && (
                      <span
                        title="Conectado ahora"
                        className="absolute -right-px -bottom-px size-2.5 rounded-full border border-white bg-success-600"
                      />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink-900">
                      {member.full_name}
                      {member.user_id === me?.id && (
                        <span className="text-ink-400"> (usted)</span>
                      )}
                    </p>
                    <p className="truncate text-[12px] text-ink-500">{member.email}</p>
                  </div>

                  <span className="shrink-0 text-[11.5px] font-medium text-ink-500">
                    {member.role === 'OWNER' ? 'Propietario' : 'Editor'}
                  </span>

                  {iAmOwner && member.role !== 'OWNER' && (
                    <IconButton label="Retirar el acceso" onClick={() => void revoke(member)}>
                      <CloseIcon className="size-4" />
                    </IconButton>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
