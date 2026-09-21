import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/Field'
import { InlineError } from '../../components/ui/States'
import { useAuthStore } from '../../store/auth'
import { AuthLayout } from './AuthLayout'
import { validateEmail, validateFullName, validatePassword } from './validation'

export function RegisterPage() {
  const register = useAuthStore((state) => state.register)
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors = {
      fullName: validateFullName(fullName),
      email: validateEmail(email),
      password: validatePassword(password),
    }
    setErrors(nextErrors)
    if (nextErrors.fullName || nextErrors.email || nextErrors.password) return

    setSubmitting(true)
    setFormError(null)
    try {
      await register(fullName.trim(), email.trim(), password)
      navigate('/proyectos', { replace: true })
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'No se pudo crear la cuenta. Inténtelo de nuevo.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Cree su cuenta"
      subtitle="Empiece a modelar en menos de un minuto."
      footer={
        <>
          ¿Ya tiene cuenta?{' '}
          <Link
            to="/entrar"
            className="font-medium text-signal-600 underline-offset-2 hover:underline"
          >
            Entre
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <InlineError message={formError} />}

        <TextInput
          label="Nombre completo"
          autoComplete="name"
          placeholder="Gabriela Pérez"
          maxLength={150}
          value={fullName}
          error={errors.fullName}
          counter={`${fullName.length}/150`}
          onChange={(event) => setFullName(event.target.value)}
        />

        <TextInput
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="nombre@universidad.edu"
          maxLength={150}
          value={email}
          error={errors.email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextInput
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          value={password}
          error={errors.password}
          hint="Al menos 8 caracteres."
          onChange={(event) => setPassword(event.target.value)}
        />

        <Button type="submit" variant="primary" loading={submitting} className="mt-1 w-full">
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  )
}
