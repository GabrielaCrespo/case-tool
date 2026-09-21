import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SESSION_EXPIRED_EVENT } from './api/session'
import { ToastProvider } from './components/ui/ToastProvider'
import { LoadingState } from './components/ui/States'
import { EditorPage } from './features/editor/EditorPage'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { handleSessionExpired, useAuthStore } from './store/auth'
import type { ReactNode } from 'react'

export default function App() {
  const restore = useAuthStore((state) => state.restore)

  // El token guardado puede haber caducado: se comprueba al arrancar.
  useEffect(() => {
    void restore()
  }, [restore])

  // Cualquier 401 posterior cierra la sesión desde el cliente HTTP.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
  }, [])

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/entrar"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          <Route
            path="/registro"
            element={
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            }
          />
          <Route
            path="/proyectos"
            element={
              <RequireAuth>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/proyectos/:projectId"
            element={
              <RequireAuth>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/diagramas/:diagramId"
            element={
              <RequireAuth>
                <EditorPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/proyectos" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}

/** Rutas privadas: sin sesión se manda a la pantalla de entrada. */
function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const checking = useAuthStore((state) => state.checking)
  const location = useLocation()

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState label="Comprobando la sesión…" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/entrar" state={{ from: location.pathname }} replace />
  }

  return children
}

/** Quien ya tiene sesión no necesita ver entrar ni registro. */
function GuestOnly({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)

  if (user) {
    return <Navigate to="/proyectos" replace />
  }

  return children
}
