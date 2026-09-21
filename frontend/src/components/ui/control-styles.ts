/**
 * Clases compartidas por los controles de formulario.
 * Viven fuera de los componentes porque el panel de propiedades del editor
 * usa controles compactos, sin etiqueta encima, con el mismo aspecto.
 */

export const CONTROL =
  'w-full rounded-[3px] border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 ' +
  'transition-colors focus:border-signal-600 focus:outline-none disabled:bg-ink-50 disabled:text-ink-400'

export const CONTROL_OK = 'border-ink-200 hover:border-ink-300'

export const CONTROL_ERROR = 'border-danger-600 bg-danger-100/30'

/** Variante estrecha para el panel lateral del editor. */
export const CONTROL_COMPACT =
  'w-full rounded-[3px] border border-ink-200 bg-white px-2 py-1.5 text-[13px] text-ink-900 ' +
  'placeholder:text-ink-400 transition-colors hover:border-ink-300 focus:border-signal-600 focus:outline-none'
