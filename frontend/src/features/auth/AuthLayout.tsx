import type { ReactNode } from 'react'
import { Logo } from '../../components/Logo'
import { DiagramMark } from './DiagramMark'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* El producto se enseña, no se cuenta: esto es un diagrama de verdad. */}
      <aside className="relative hidden flex-col justify-between border-r border-ink-200 bg-ink-100 px-12 py-10 lg:flex">
        <Logo />
        <DiagramMark className="w-full max-w-[420px] self-center" />
        <p className="max-w-sm text-[13px] leading-relaxed text-ink-600">
          Modele las entidades, los atributos y las relaciones de sus datos. El diagrama es la
          fuente del backend que generará más adelante.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <Logo />
          </div>
          <h1 className="mt-8 text-[26px] leading-tight font-semibold tracking-tight text-ink-950 lg:mt-0">
            {title}
          </h1>
          <p className="mt-2 text-sm text-ink-500">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <div className="mt-7 rule-t pt-5 text-[13px] text-ink-500">{footer}</div>
        </div>
      </main>
    </div>
  )
}
