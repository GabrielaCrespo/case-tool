import { notifySessionExpired, readToken } from './session'

/** URL de la API NestJS. Se configura con VITE_API_URL. */
const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/**
 * Error de la API con el código HTTP y el mensaje que devuelve NestJS.
 * El backend valida cada campo y responde mensajes en castellano listos para
 * mostrarse, así que la interfaz los usa tal cual en lugar de inventar otros.
 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Forma de los errores del filtro de excepciones de NestJS. */
interface NestErrorBody {
  message?: string | string[]
  error?: string
}

function messageFrom(body: unknown, status: number): string {
  const nest = body as NestErrorBody | null

  if (Array.isArray(nest?.message)) {
    return nest.message.join(' ')
  }
  if (typeof nest?.message === 'string' && nest.message.length > 0) {
    return nest.message
  }
  if (typeof nest?.error === 'string' && nest.error.length > 0) {
    return nest.error
  }

  return `La API respondió con un error ${status}.`
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /**
   * Cuerpo multipart, para subir la imagen de CU05. Va aparte de `body`
   * porque su Content-Type no se puede escribir a mano: lleva un «boundary»
   * que sólo conoce el navegador, y ponerlo nosotros rompe la subida.
   */
  form?: FormData
  /** La respuesta es un archivo de texto (XML), no JSON. */
  asText?: boolean
  /** Las rutas de autenticación se llaman sin token. */
  anonymous?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, form, asText = false, anonymous = false } = options

  const headers: Record<string, string> = {}
  if (body !== undefined && form === undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (!anonymous) {
    const token = readToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
  } catch {
    // fetch sólo falla así cuando no hay red o el servidor no responde.
    throw new ApiError(0, 'No se pudo contactar con el servidor. Compruebe que la API está en marcha.')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const raw = await response.text()

  // Un archivo se devuelve sin tocar; un error, en cambio, sigue llegando como
  // JSON de NestJS, así que sólo se salta la interpretación cuando todo fue
  // bien.
  if (asText && response.ok) {
    return raw as T
  }

  const parsed: unknown = raw.length > 0 ? safeJson(raw) : null

  if (!response.ok) {
    // Token ausente, caducado o de una cuenta borrada: se cierra la sesión.
    if (response.status === 401 && !anonymous) {
      notifySessionExpired()
    }
    throw new ApiError(response.status, messageFrom(parsed, response.status))
  }

  return parsed as T
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return { message: raw }
  }
}

/**
 * Descarga un archivo binario, como el .zip del backend generado (CU08).
 *
 * No pasa por `request`: aquélla lee el cuerpo con `text()`, y un .zip leído
 * como texto llega corrupto. Un error sí sigue siendo JSON de NestJS, así que
 * se interpreta igual que en el resto de llamadas.
 */
async function requestFile(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const headers: Record<string, string> = {}
  const token = readToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { headers })
  } catch {
    throw new ApiError(0, 'No se pudo contactar con el servidor. Compruebe que la API está en marcha.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired()
    }
    const raw = await response.text()
    throw new ApiError(
      response.status,
      messageFrom(raw.length > 0 ? safeJson(raw) : null, response.status),
    )
  }

  // El servidor expone el nombre en una cabecera propia: fetch no puede leer
  // Content-Disposition a menos que se exponga expresamente.
  return { blob: await response.blob(), fileName: response.headers.get('X-File-Name') }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /**
   * Para respuestas que no son JSON, como el XMI de CU06: se devuelve el
   * cuerpo tal cual, sin intentar interpretarlo.
   */
  getText: (path: string) => request<string>(path, { asText: true }),
  /** Respuestas binarias: el .zip del backend generado (CU08). */
  getFile: (path: string) => requestFile(path),
  post: <T>(path: string, body?: unknown, anonymous = false) =>
    request<T>(path, { method: 'POST', body, anonymous }),
  /** POST multipart/form-data: CU05 sube así la imagen del diagrama. */
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  /**
   * Casi todos los borrados no devuelven nada, pero alguno sí: dar de baja un
   * despliegue contesta con cómo quedó. Por eso el tipo es opcional y su valor
   * por defecto es «nada».
   */
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
}
