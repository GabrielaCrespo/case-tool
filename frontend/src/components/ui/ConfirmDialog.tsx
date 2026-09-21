import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  /** Qué se va a borrar exactamente y qué se lleva por delante. */
  message: string
  confirmLabel: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={onConfirm}
            className="border-danger-700 bg-danger-600 hover:bg-danger-700"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-700">{message}</p>
    </Modal>
  )
}
