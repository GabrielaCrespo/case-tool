import { useId } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/cn'
import { CONTROL, CONTROL_ERROR, CONTROL_OK } from './control-styles'

interface FieldProps {
  label: string
  htmlFor: string
  error?: string | null
  hint?: string
  /** Cuenta de caracteres frente al límite de la columna en PostgreSQL. */
  counter?: string
  children: ReactNode
}

export function Field({ label, htmlFor, error, hint, counter, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-700">
          {label}
        </label>
        {counter && <span className="font-mono text-[11px] text-ink-400">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger-700">
          {error}
        </p>
      ) : (
        hint && <p className="text-[12.5px] text-ink-500">{hint}</p>
      )}
    </div>
  )
}

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  error?: string | null
  hint?: string
  counter?: string
  /** Para nombres de clase, atributo o tipo: se leen como código. */
  mono?: boolean
}

export function TextInput({ label, error, hint, counter, mono, className, ...props }: TextInputProps) {
  const generated = useId()
  const id = props.id ?? generated

  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} counter={counter}>
      <input
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(
          CONTROL,
          'h-10',
          error ? CONTROL_ERROR : CONTROL_OK,
          mono && 'font-mono',
          className,
        )}
      />
    </Field>
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string | null
  hint?: string
  counter?: string
}

export function TextArea({ label, error, hint, counter, className, ...props }: TextAreaProps) {
  const generated = useId()
  const id = props.id ?? generated

  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} counter={counter}>
      <textarea
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, 'resize-y py-2.5', error ? CONTROL_ERROR : CONTROL_OK, className)}
      />
    </Field>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string | null
  hint?: string
  children: ReactNode
}

export function SelectField({ label, error, hint, className, children, ...props }: SelectFieldProps) {
  const generated = useId()
  const id = props.id ?? generated

  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <select
        {...props}
        id={id}
        className={cn(CONTROL, 'h-10 cursor-pointer pr-8', error ? CONTROL_ERROR : CONTROL_OK, className)}
      >
        {children}
      </select>
    </Field>
  )
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  const generated = useId()
  const id = props.id ?? generated

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        {...props}
        id={id}
        type="checkbox"
        className="size-4 cursor-pointer rounded-[2px] border-ink-300 accent-signal-600"
      />
      <label htmlFor={id} className="cursor-pointer text-[13px] text-ink-700 select-none">
        {label}
      </label>
    </div>
  )
}
