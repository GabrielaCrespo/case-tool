import { useEffect, useRef, useState } from 'react'
import { CONTROL_COMPACT } from '../../../components/ui/control-styles'
import { cn } from '../../../lib/cn'

interface CommitInputProps {
  value: string
  ariaLabel: string
  onCommit: (value: string) => void
  placeholder?: string
  maxLength?: number
  mono?: boolean
  /** Lista de sugerencias (id de un <datalist>). */
  list?: string
  /** Devuelve el motivo por el que el valor no vale, o null si vale. */
  validate?: (value: string) => string | null
  className?: string
}

/**
 * Campo del panel de propiedades.
 *
 * Confirma al salir del campo o con Intro, y descarta con Escape: escribir no
 * dispara una petición por cada tecla, y el valor visible siempre es el que se
 * va a guardar.
 */
export function CommitInput({
  value,
  ariaLabel,
  onCommit,
  placeholder,
  maxLength,
  mono = false,
  list,
  validate,
  className,
}: CommitInputProps) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)

  // Mientras se escribe manda el borrador; el resto del tiempo, el valor real.
  useEffect(() => {
    if (!focused.current) {
      setDraft(value)
      setError(null)
    }
  }, [value])

  function commit() {
    focused.current = false

    const next = draft.trim()
    if (next === value.trim()) {
      setDraft(value)
      setError(null)
      return
    }

    const reason = validate?.(next) ?? null
    if (reason) {
      setError(reason)
      return
    }

    setError(null)
    onCommit(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={draft}
        list={list}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(value)
            setError(null)
            focused.current = false
            event.currentTarget.blur()
          }
        }}
        className={cn(
          CONTROL_COMPACT,
          mono && 'font-mono',
          error && 'border-danger-600 bg-danger-100/30',
          className,
        )}
      />
      {error && (
        <p role="alert" className="text-[11.5px] text-danger-700">
          {error}
        </p>
      )}
    </div>
  )
}
