import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/Field'
import { InlineError } from '../../components/ui/States'
import { useAuthStore } from '../../store/auth'
import { AuthLayout } from './AuthLayout'
import { validateEmail } from './validation'

export function LoginPage() {
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = {
      email: validateEmail(email),
      password: password.length === 0 ? 'Escriba su contraseña.' : undefined,
    }
    setErrors(nextErrors)
    if (nextErrors.email || nextErrors.password) return

    setSubmitting(true)
    setFormError(null)
    try {
      await login(email.trim(), password)
      navigate('/proyectos', { replace: true })
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'No se pudo iniciar sesión. Inténtelo de nuevo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Entre a su espacio de trabajo"
      subtitle="Sus proyectos y diagramas están donde los dejó."
      footer={
        <>
          ¿Todavía no tiene cuenta?{' '}
          <Link
            to="/registro"
            className="font-medium text-signal-600 underline-offset-2 hover:underline"
          >
            Cree una
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <InlineError message={formError} />}

        <TextInput
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="nombre@universidad.edu"
          value={email}
          error={errors.email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextInput
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
          Entrar
        </Button>
      </form>
    </AuthLayout>
  )
}
