import { Link } from 'react-router-dom'
import { initials } from '../lib/format'
import { useAuthStore } from '../store/auth'
import { LogoutIcon, SparkIcon } from './icons'
import { Logo } from './Logo'
import { IconButton } from './ui/Button'

/** Barra superior de las pantallas de trabajo. El editor tiene la suya. */
export function AppHeader() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 rule-b bg-white px-4 sm:px-6">
      <Link to="/proyectos" className="rounded-[3px]">
        <Logo />
      </Link>

      <div className="flex items-center gap-3">
        {/* CU11 — Sólo quien puede configurar el servicio de IA ve el acceso. */}
        {user?.is_admin && (
          <Link
            to="/admin/ia"
            className="flex items-center gap-1.5 rounded-[3px] border border-ink-200 px-2 py-1.5 text-[12.5px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            <SparkIcon className="size-4" />
            <span className="hidden sm:inline">Servicio de IA</span>
          </Link>
        )}
        {user && (
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center border border-ink-200 bg-ink-50 text-[12px] font-semibold text-ink-700"
            >
              {initials(user.full_name)}
            </span>
            <span className="hidden text-[13px] leading-tight sm:block">
              <span className="block font-medium text-ink-900">{user.full_name}</span>
              <span className="block text-ink-500">{user.email}</span>
            </span>
          </div>
        )}
        <IconButton label="Cerrar sesión" onClick={logout}>
          <LogoutIcon className="size-4" />
        </IconButton>
      </div>
    </header>
  )
}
