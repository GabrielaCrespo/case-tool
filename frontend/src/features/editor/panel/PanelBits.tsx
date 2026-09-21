import type { ReactNode } from 'react'
import { CONTROL_COMPACT } from '../../../components/ui/control-styles'
import { cn } from '../../../lib/cn'

/** Bloque del panel de propiedades, separado por un filete. */
export function PanelSection({
  title,
  count,
  action,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-b border-ink-200">
      <header className="flex h-9 items-center justify-between gap-2 bg-ink-50/70 px-3">
        <h3 className="text-[11.5px] font-semibold text-ink-600">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-400">{count}</span>
          )}
        </h3>
        {action}
      </header>
      <div className="px-3 py-3">{children}</div>
    </section>
  )
}

/** Etiqueta y control, en dos líneas para que quepa en un panel estrecho. */
export function PanelField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[11.5px] font-medium text-ink-500">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Dato que no se edita: identificadores, coordenadas, fechas. */
export function PanelReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[11.5px] text-ink-500">{label}</span>
      <span className="truncate font-mono text-[11.5px] text-ink-700">{value}</span>
    </div>
  )
}

/**
 * Selector del panel.
 *
 * Los tipos de dato, los estereotipos y las visibilidades son catálogos
 * cerrados —el generador de CU07 no sabría qué hacer con un valor inventado—,
 * así que se eligen de una lista en lugar de escribirse.
 */
export function PanelSelect({
  value,
  ariaLabel,
  onChange,
  options,
  mono = false,
  className,
}: {
  value: string
  ariaLabel: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
  mono?: boolean
  className?: string
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className={cn(CONTROL_COMPACT, 'cursor-pointer', mono && 'font-mono', className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** Sugerencias para un campo de texto libre. */
export function Suggestions({ id, values }: { id: string; values: readonly string[] }) {
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  )
}
