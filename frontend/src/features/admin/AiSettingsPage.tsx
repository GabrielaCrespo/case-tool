import { useCallback, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { assistantApi } from '../../api/endpoints'
import type { AiSettings, AiSettingsInput, AiSettingsTest } from '../../api/types'
import { AppHeader } from '../../components/AppHeader'
import { CheckIcon, ChevronLeftIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { Checkbox, SelectField, TextInput } from '../../components/ui/Field'
import { ErrorState, InlineError, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { cn } from '../../lib/cn'
import { formatRelative } from '../../lib/format'
import { useResource } from '../../lib/useResource'

/** La dirección de Google AI Studio compatible con OpenAI (chat-llm-client.ts). */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

const PROVIDERS: Record<AiSettings['provider'], { label: string; hint: string }> = {
  GEMINI: {
    label: 'Google AI Studio (Gemini)',
    hint: 'La llave sale de la variable GEMINI_API_KEY del servidor.',
  },
  OPENAI_COMPATIBLE: {
    label: 'Servidor compatible con OpenAI',
    hint: 'Ollama, LM Studio u otro. La llave, si hace falta, sale de CHAT_LLM_API_KEY.',
  },
}

/** Lo que se edita en el formulario: los números como texto, mientras se escriben. */
interface Draft {
  provider: AiSettings['provider']
  base_url: string
  model: string
  enabled: boolean
  context_budget: string
  max_tokens: string
}

function draftOf(settings: AiSettings): Draft {
  return {
    provider: settings.provider,
    base_url: settings.base_url,
    model: settings.model,
    enabled: settings.enabled,
    context_budget: String(settings.context_budget),
    max_tokens: String(settings.max_tokens),
  }
}

function inputOf(draft: Draft): AiSettingsInput {
  return {
    provider: draft.provider,
    base_url: draft.base_url.trim(),
    model: draft.model.trim(),
    enabled: draft.enabled,
    context_budget: Number(draft.context_budget),
    max_tokens: Number(draft.max_tokens),
  }
}

/**
 * CU11 — Configurar Servicio de IA (Administrador).
 *
 * Qué modelo atiende el chat del equipo (CU12–CU15), en qué servidor, y si está
 * disponible. Las llaves no se escriben aquí: viven en variables de entorno del
 * servidor y la pantalla sólo dice si están puestas. CU04, CU05 y el dictado no
 * dependen de esto: siguen con Groq.
 *
 * «Probar conexión» usa lo que hay en el formulario sin guardarlo, para poder
 * comprobar un modelo antes de cambiarlo para todo el mundo.
 */
export function AiSettingsPage() {
  const fetchSettings = useCallback(() => assistantApi.settings(), [])
  const { resource, reload } = useResource(fetchSettings, 'No se pudo leer la configuración de la IA.')

  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-white">
        <div className="mx-auto max-w-2xl px-5 py-6 sm:px-8 sm:py-8">
          <Link
            to="/proyectos"
            className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-500 transition-colors hover:text-ink-900"
          >
            <ChevronLeftIcon className="size-4" />
            Proyectos
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">Servicio de IA</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">
            El modelo que responde en el chat del equipo de todos los proyectos. El asistente del
            lienzo, la lectura de imágenes y el dictado no dependen de esto.
          </p>

          <div className="mt-6">
            {resource.status === 'loading' ? (
              <LoadingState label="Leyendo la configuración…" />
            ) : resource.status === 'error' ? (
              <ErrorState message={resource.message} onRetry={reload} />
            ) : (
              <SettingsForm key={resource.data.updated_at ?? 'por-defecto'} settings={resource.data} />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function SettingsForm({ settings: initial }: { settings: AiSettings }) {
  const toast = useToast()
  const [settings, setSettings] = useState(initial)
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [test, setTest] = useState<AiSettingsTest | null>(null)

  const changed = JSON.stringify(inputOf(draft)) !== JSON.stringify(inputOf(draftOf(settings)))
  // La llave depende del proveedor del formulario, no del guardado.
  const keyEnv = draft.provider === 'GEMINI' ? 'GEMINI_API_KEY' : 'CHAT_LLM_API_KEY'
  const keyKnown = draft.provider === settings.provider

  function update(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }))
    setTest(null)
  }

  /** Al cambiar a Gemini se pone su dirección; al cambiar al genérico, hay que escribirla. */
  function changeProvider(provider: AiSettings['provider']) {
    update({
      provider,
      base_url: provider === 'GEMINI' ? GEMINI_BASE_URL : provider === settings.provider ? settings.base_url : '',
    })
  }

  async function runTest() {
    setTesting(true)
    setFormError(null)
    try {
      setTest(await assistantApi.testSettings(inputOf(draft)))
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo probar la conexión.')
    } finally {
      setTesting(false)
    }
  }

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const saved = await assistantApi.updateSettings(inputOf(draft))
      setSettings(saved)
      setDraft(draftOf(saved))
      toast.success('Configuración del servicio de IA guardada.')
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
      {formError && <InlineError message={formError} />}

      <p className="text-[12.5px] text-ink-500">
        {settings.saved && settings.updated_at
          ? `Guardada ${formatRelative(settings.updated_at)}.`
          : 'Todavía no se guardó ninguna configuración: se están usando los valores por defecto.'}
      </p>

      <Checkbox
        label="Asistente de IA disponible en el chat de los proyectos"
        checked={draft.enabled}
        onChange={(event) => update({ enabled: event.target.checked })}
      />

      <SelectField
        label="Proveedor"
        value={draft.provider}
        hint={PROVIDERS[draft.provider].hint}
        onChange={(event) => changeProvider(event.target.value as AiSettings['provider'])}
      >
        {(Object.keys(PROVIDERS) as AiSettings['provider'][]).map((provider) => (
          <option key={provider} value={provider}>
            {PROVIDERS[provider].label}
          </option>
        ))}
      </SelectField>

      <TextInput
        label="Servidor (base_url)"
        mono
        value={draft.base_url}
        placeholder="http://localhost:11434/v1"
        hint="La dirección de la API compatible con OpenAI, sin /chat/completions."
        onChange={(event) => update({ base_url: event.target.value })}
      />

      <TextInput
        label="Modelo"
        mono
        value={draft.model}
        placeholder="gemini-3.6-flash"
        hint="El código del modelo. Google los retira a menudo: si deja de responder, pruebe otro."
        onChange={(event) => update({ model: event.target.value })}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          label="Presupuesto de contexto"
          type="number"
          mono
          value={draft.context_budget}
          hint="Tokens aproximados del proyecto que se le enseñan (2000–1000000)."
          onChange={(event) => update({ context_budget: event.target.value })}
        />
        <TextInput
          label="Tope de la respuesta"
          type="number"
          mono
          value={draft.max_tokens}
          hint="max_tokens (256–65536). Gemini 3 piensa antes de responder y eso también cuenta."
          onChange={(event) => update({ max_tokens: event.target.value })}
        />
      </div>

      <div className="rounded-[3px] border border-ink-200 bg-ink-50 px-3.5 py-3 text-[13px] leading-relaxed text-ink-700">
        <p className="font-semibold text-ink-800">Llave del servidor</p>
        <p className="mt-1">
          Variable <code className="font-mono text-[12px]">{keyEnv}</code>
          {keyKnown ? (
            settings.api_key.configured ? (
              ': configurada.'
            ) : settings.api_key.required ? (
              ': no está configurada; sin ella el chat no puede responder.'
            ) : (
              ': no está configurada (es opcional en este proveedor).'
            )
          ) : (
            '. Pruebe la conexión para saber si está configurada.'
          )}
        </p>
        <p className="mt-1 text-[12px] text-ink-500">
          Las llaves no se guardan en la base ni se muestran: se ponen en el archivo .env del servidor.
        </p>
      </div>

      {test && (
        <div
          role="status"
          className={cn(
            'rounded-[3px] border px-3.5 py-3 text-[13px] leading-relaxed',
            test.ok
              ? 'border-success-600/40 bg-success-100/50 text-success-700'
              : 'border-pending-600/40 bg-pending-100 text-pending-700',
          )}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            {test.ok && <CheckIcon className="size-4" />}
            {test.ok ? 'Conexión correcta' : 'La conexión falló'}
            {test.latency_ms !== null && (
              <span className="font-mono text-[11.5px] font-normal">· {test.latency_ms} ms</span>
            )}
          </p>
          <p className="mt-1">{test.message}</p>
          {test.reply && <p className="mt-1 font-mono text-[12px]">Respuesta: {test.reply}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 pt-4">
        <Button onClick={() => void runTest()} loading={testing} disabled={saving}>
          Probar conexión
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!changed || testing}>
          Guardar
        </Button>
      </div>
    </form>
  )
}
