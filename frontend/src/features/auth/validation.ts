/**
 * Validación en el navegador que reproduce la del backend (`auth.service.ts`).
 *
 * No la sustituye: la API sigue siendo la autoridad y sus mensajes se muestran
 * tal cual. Esto sólo evita un viaje al servidor para errores evidentes.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MAX_LENGTH = 150
const EMAIL_MAX_LENGTH = 150
const PASSWORD_MIN_LENGTH = 8
/** bcrypt sólo tiene en cuenta los primeros 72 bytes. */
const PASSWORD_MAX_BYTES = 72

export function validateFullName(value: string): string | undefined {
  const fullName = value.trim()

  if (fullName.length === 0) return 'Escriba su nombre completo.'
  if (fullName.length > NAME_MAX_LENGTH) {
    return `El nombre no puede superar los ${NAME_MAX_LENGTH} caracteres.`
  }
  return undefined
}

export function validateEmail(value: string): string | undefined {
  const email = value.trim()

  if (email.length === 0) return 'Escriba su correo electrónico.'
  if (!EMAIL_PATTERN.test(email)) return 'El correo electrónico no tiene un formato válido.'
  if (email.length > EMAIL_MAX_LENGTH) {
    return `El correo no puede superar los ${EMAIL_MAX_LENGTH} caracteres.`
  }
  return undefined
}

export function validatePassword(value: string): string | undefined {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return `La contraseña no puede superar los ${PASSWORD_MAX_BYTES} bytes.`
  }
  return undefined
}
