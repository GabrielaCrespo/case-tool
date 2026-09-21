import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

interface InlineNameProps {
  value: string
  ariaLabel: string
  /** Motivo por el que el nombre no sirve, o null si sirve. */
  validate: (value: string) => string | null
  onCommit: (value: string) => void
  onCancel: () => void
  className?: string
}

/**
 * Escribir el nombre de una entidad o de un atributo sobre el propio lienzo.
 *
 * Es la diferencia entre sentirse delante de un formulario y sentirse delante
 * de una herramienta de modelado: al crear una entidad se escribe su nombre
 * donde está la entidad, no en un panel al otro lado de la pantalla. Enter
 * confirma, Escape cancela, y salir del campo confirma si el nombre vale.
 *
 * El nombre se comprueba aquí antes de enviarlo porque la API lo rechazaría de
 * todas formas —acabará siendo el de una clase o un campo Java—, y es mejor
 * decirlo mientras se escribe que devolver un error después.
 */
export function InlineName({
  value,
  ariaLabel,
  validate,
  onCommit,
  onCancel,
  className,
}: InlineNameProps) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Una vez confirmado o cancelado, salir del campo ya no debe hacer nada. */
  const settled = useRef(false)

  // El nombre recién puesto por la API es «Entidad1» o «atributo1»: se
  // selecciona entero para poder escribir el de verdad encima, sin borrarlo.
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const problem = validate(draft)

  function commit() {
    if (settled.current) return
    settled.current = true

    // Sin cambios no se llama a la API: mover el foco no es editar.
    if (draft !== value) onCommit(draft)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={ariaLabel}
      aria-invalid={problem !== null}
      title={problem ?? undefined}
      autoFocus
      spellCheck={false}
      // `nodrag` y `nopan`: sin ellas React Flow entiende el gesto de
      // seleccionar texto como un arrastre de la caja o del lienzo.
      className={cn(
        'nodrag nopan w-full min-w-0 border bg-white px-1 py-0 outline-none',
        problem === null
          ? 'border-signal-600 text-ink-950'
          : 'border-danger-600 bg-danger-100/40 text-danger-700',
        className,
      )}
      onChange={(event) => setDraft(event.target.value)}
      // El lienzo escucha Supr, V y C en la ventana; mientras se escribe no
      // pueden llegarle, o teclear una «c» cambiaría de herramienta.
      onKeyDown={(event) => {
        event.stopPropagation()

        if (event.key === 'Enter') {
          event.preventDefault()
          if (problem === null) commit()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          settled.current = true
          onCancel()
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => {
        // Un nombre inválido no se guarda: se deja lo que había.
        if (problem !== null) {
          settled.current = true
          onCancel()
          return
        }
        commit()
      }}
    />
  )
}
