import { cn } from '../lib/cn'

/**
 * La marca es la propia caja de clase UML: encabezado y dos compartimentos.
 * Es el objeto que la herramienta edita, así que sirve de logotipo sin
 * necesidad de inventar un símbolo ajeno al producto.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="17" fill="#fff" stroke="#141d2e" strokeWidth="1.6" />
        <path d="M2.5 9.5h19" stroke="#141d2e" strokeWidth="1.6" />
        <path d="M2.5 15h19" stroke="#4b3be4" strokeWidth="1.6" />
      </svg>
      {!compact && (
        <span className="text-[15px] font-bold tracking-[-0.01em] text-ink-950">Trazo</span>
      )}
    </span>
  )
}
