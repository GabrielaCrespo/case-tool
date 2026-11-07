import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parseModelJson } from './model-json.js';

/**
 * CU11–CU15 — Cliente del modelo de IA del chat del equipo.
 *
 * Habla con cualquier servidor compatible con la API de chat de OpenAI: Google
 * AI Studio, que es el que se usa, y también Ollama, LM Studio o Groq. Cuál, en
 * qué dirección y con qué modelo lo dice la configuración de CU11
 * (ai_settings), no el código: cambiar de servidor —incluido, más adelante,
 * uno autoalojado— es cambiar esa configuración.
 *
 * No sustituye a GroqService. CU04, CU05 y el dictado siguen con Groq y sus
 * prompts afinados; este cliente sólo atiende al chat.
 *
 * Por la misma razón de que sirva para cualquier servidor, la petición lleva
 * sólo lo que todos entienden: modelo, mensajes y tope de tokens. Nada de
 * `temperature` (Gemini 3 recomienda dejar la suya), ni `response_format`
 * (Gemini no documenta el modo JSON por esta vía y LM Studio lo rechaza), ni
 * `reasoning_effort` (cada familia admite valores distintos). El JSON se
 * recupera del texto, y si viene roto se le pide al modelo que lo repare.
 */

export type AiProvider = 'GEMINI' | 'OPENAI_COMPATIBLE';

/** Dirección del endpoint de Google AI Studio compatible con OpenAI. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * De qué variable de entorno sale la llave de cada proveedor.
 *
 * Fija por proveedor, y no elegible desde la pantalla de CU11: si se pudiera
 * escribir el nombre de la variable, bastaría con poner JWT_SECRET o
 * DATABASE_URL y una URL propia para que el servidor los enviara fuera como
 * si fueran la llave. Ollama y LM Studio no piden llave, por eso la del
 * proveedor genérico es opcional.
 */
export const PROVIDER_KEYS: Record<AiProvider, { env: string; required: boolean }> = {
  GEMINI: { env: 'GEMINI_API_KEY', required: true },
  OPENAI_COMPATIBLE: { env: 'CHAT_LLM_API_KEY', required: false },
};

/**
 * Cuánto se espera una respuesta. Más que en GroqService: los modelos de
 * Gemini 3 piensan siempre antes de contestar, y el contexto del chat —memoria,
 * diagrama y conversación— es mucho más largo que una orden de CU04.
 */
const CHAT_TIMEOUT_MS = 90_000;

/**
 * Lo máximo que se espera tras un 429 antes de darse por vencido: más de lo
 * que tarda en liberarse el minuto de los planes gratuitos, menos de lo que
 * nadie aguanta mirando el chat sin respuesta.
 */
const MAX_RETRY_WAIT_MS = 15_000;

/**
 * Fallos del servidor que se arreglan solos: Google responde 503 «high demand»
 * cuando el modelo está saturado, y pasa a menudo con los modelos nuevos. Se
 * reintenta una vez tras esta espera si el servidor no dice otra.
 */
const TRANSIENT_STATUSES = new Set([500, 502, 503]);
const TRANSIENT_RETRY_MS = 2_500;

/** Lo que se le pide al modelo cuando su JSON no se puede leer. */
const REPAIR_INSTRUCTION =
  'Tu respuesta anterior no es un JSON válido. Devuelve exactamente el mismo contenido como un único ' +
  'objeto JSON válido, sin texto antes ni después y sin bloques de código.';

/** Con qué servidor y modelo se habla. Sale de ai_settings (CU11). */
export interface ChatLlmConnection {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  maxTokens: number;
}

export interface ChatLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletion {
  /** Lo que escribió el modelo; puede venir vacío. */
  content: string;
  /** El modelo que contestó según el servidor, o el que se pidió. */
  model: string;
  /** `stop`, `length`... tal como lo dice el servidor. */
  finishReason: string | null;
}

export interface ChatJsonCompletion {
  value: unknown;
  model: string;
  /** El primer intento no era JSON y hubo que pedir que lo reparase. */
  repaired: boolean;
}

/** La llave de un proveedor: de qué variable sale y si está puesta. */
export interface ApiKeyStatus {
  env: string;
  required: boolean;
  configured: boolean;
}

export function apiKeyStatus(provider: AiProvider): ApiKeyStatus {
  const { env, required } = PROVIDER_KEYS[provider];

  return { env, required, configured: (process.env[env]?.trim() ?? '').length > 0 };
}

interface ChatResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
}

@Injectable()
export class ChatLlmClient {
  private readonly logger = new Logger(ChatLlmClient.name);

  /** Una vuelta de chat, sin interpretar lo que se respondió. */
  async complete(connection: ChatLlmConnection, messages: ChatLlmMessage[]): Promise<ChatCompletion> {
    const raw = await this.post(connection, {
      model: connection.model,
      messages,
      max_tokens: connection.maxTokens,
    });
    const choice = raw.choices?.[0];

    return {
      content: choice?.message?.content ?? '',
      model: raw.model?.trim() || connection.model,
      finishReason: choice?.finish_reason ?? null,
    };
  }

  /**
   * Una vuelta de chat cuya respuesta tiene que ser un objeto JSON.
   *
   * Si lo que llega no se puede leer, se le devuelve al modelo su propia
   * respuesta pidiéndole sólo el objeto, una vez. Pasa a menudo con modelos
   * pequeños y casi nunca dos veces seguidas, y repetir la pregunta entera
   * costaría lo mismo y acertaría menos.
   *
   * La respuesta **no está validada**: es lo que dijo el modelo convertido a
   * objeto. Quien la recibe la tiene que comprobar antes de tocar nada.
   */
  async completeJson(
    connection: ChatLlmConnection,
    messages: ChatLlmMessage[],
  ): Promise<ChatJsonCompletion> {
    const first = this.requireContent(connection, await this.complete(connection, messages));
    const parsed = parseModelJson(first.content);

    if (parsed.ok) {
      return { value: parsed.value, model: first.model, repaired: false };
    }

    this.logger.warn(`JSON ilegible del modelo; se pide que lo repare: ${first.content.slice(0, 300)}`);

    const second = this.requireContent(
      connection,
      await this.complete(connection, [
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: REPAIR_INSTRUCTION },
      ]),
    );
    const repaired = parseModelJson(second.content);

    if (repaired.ok) {
      return { value: repaired.value, model: second.model, repaired: true };
    }

    this.logger.warn(`El modelo tampoco reparó su JSON: ${second.content.slice(0, 300)}`);
    throw new UnprocessableEntityException(
      'El modelo de IA no devolvió una respuesta legible ni al pedírsela de nuevo. Inténtelo otra vez o reformule la pregunta.',
    );
  }

  /**
   * Una respuesta vacía no es JSON roto, y pedir que la repare no serviría.
   * Si se cortó por el tope de tokens, se dice: Gemini 3 piensa antes de
   * contestar y ese pensamiento también cuenta, así que un tope bajo puede
   * agotarse sin que llegue a escribir nada.
   */
  private requireContent(connection: ChatLlmConnection, completion: ChatCompletion): ChatCompletion {
    if (completion.content.trim().length > 0) {
      return completion;
    }
    if (completion.finishReason === 'length') {
      throw new UnprocessableEntityException(
        `El modelo agotó el máximo de ${connection.maxTokens} tokens antes de responder. Súbalo en la configuración del servicio de IA.`,
      );
    }
    throw new UnprocessableEntityException('El modelo de IA devolvió una respuesta vacía. Inténtelo de nuevo.');
  }

  /**
   * Llama al servidor traduciendo cada forma de fallo a un error con sentido:
   * una llave que falta, una mal puesta, un modelo retirado y la cuota agotada
   * se arreglan de forma distinta.
   */
  private async post(connection: ChatLlmConnection, body: unknown): Promise<ChatResponse> {
    const key = apiKeyStatus(connection.provider);

    if (key.required && !key.configured) {
      throw new ServiceUnavailableException(
        `El asistente de IA no está configurado: falta la variable ${key.env} en el servidor.`,
      );
    }

    let response = await this.send(connection, body);

    // Un 429 que se arregla esperando unos segundos, o un servidor saturado,
    // se reintenta una vez; si hace falta esperar más, esperar callando sería
    // peor que decirlo.
    if (response.status === 429 || TRANSIENT_STATUSES.has(response.status)) {
      const detail = await this.detailOf(response);
      const wait =
        this.retryDelayMs(response, detail) ??
        (response.status === 429 ? null : TRANSIENT_RETRY_MS);

      if (wait === null) {
        throw this.errorFor(connection, response.status, detail);
      }
      this.logger.warn(
        `El servicio de IA respondió ${response.status}; se reintenta en ${Math.round(wait / 1000)} s: ${detail}`,
      );
      await new Promise((resume) => setTimeout(resume, wait));
      response = await this.send(connection, body);
    }

    if (!response.ok) {
      throw this.errorFor(connection, response.status, await this.detailOf(response));
    }

    return (await response.json()) as ChatResponse;
  }

  private async send(connection: ChatLlmConnection, body: unknown): Promise<Response> {
    const key = process.env[PROVIDER_KEYS[connection.provider].env]?.trim();

    try {
      return await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException('El modelo de IA tardó demasiado en responder. Inténtelo de nuevo.');
      }
      this.logger.error(`No se pudo contactar con el servicio de IA en ${connection.baseUrl}`, error);
      throw new ServiceUnavailableException(
        `El asistente de IA no está disponible: no se pudo contactar con ${hostOf(connection.baseUrl)}.`,
      );
    }
  }

  /**
   * El mensaje de error que trae la respuesta. Google lo manda a veces dentro
   * de una lista (`[{ "error": … }]`) en lugar de como objeto suelto.
   */
  private async detailOf(response: Response): Promise<string> {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const first = Array.isArray(body) ? (body[0] as unknown) : body;
    const message = (first as { error?: { message?: unknown } } | null)?.error?.message;

    return typeof message === 'string' ? message : '';
  }

  /**
   * Cuánto esperar antes de reintentar, o null si no merece la pena. La
   * cabecera `retry-after` es la respuesta canónica; si no viene, el propio
   * mensaje suele decirlo («try again in 11.2s», «retry in 17s»).
   */
  private retryDelayMs(response: Response, detail: string): number | null {
    const header = Number(response.headers.get('retry-after'));
    const seconds =
      Number.isFinite(header) && header > 0
        ? header
        : Number(/(?:try again|retry) in ([\d.]+)\s*s/i.exec(detail)?.[1]);

    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > MAX_RETRY_WAIT_MS) {
      return null;
    }
    // Un poco más de lo que dice, para no volver justo en el borde.
    return Math.ceil(seconds * 1000) + 500;
  }

  private errorFor(connection: ChatLlmConnection, status: number, detail: string): Error {
    this.logger.error(`El servicio de IA respondió ${status}: ${detail}`);
    const key = PROVIDER_KEYS[connection.provider].env;

    switch (status) {
      case 400:
        // Google responde 400, y no 401, cuando la llave no es válida; el
        // motivo exacto viene en el detalle, así que se enseña.
        return new BadGatewayException(
          `El servicio de IA rechazó la petición${detail ? `: ${detail}` : '.'}`,
        );
      case 401:
      case 403:
        return new ServiceUnavailableException(
          `El asistente de IA no está disponible: el servidor no aceptó la llave ${key}.`,
        );
      case 404:
        return new ServiceUnavailableException(
          `El modelo «${connection.model}» no existe en ${hostOf(connection.baseUrl)} o ya no está disponible. Cámbielo en la configuración del servicio de IA.`,
        );
      case 429:
        return new ServiceUnavailableException(quotaMessage(connection.model, detail));
      case 500:
      case 502:
      case 503:
        return new ServiceUnavailableException(
          `El modelo «${connection.model}» está saturado en este momento. Inténtelo de nuevo en unos segundos.`,
        );
      default:
        return new BadGatewayException('El modelo de IA respondió con un error.');
    }
  }
}

/**
 * Qué decir cuando se acaba la cuota. No es lo mismo el límite por minuto, que
 * se arregla esperando, que el diario: el plan gratuito de Gemini admite muy
 * pocas peticiones al día por modelo (20 para gemini-3.6-flash el 2026-11-07),
 * y entonces esperar un minuto no sirve. Google dice en el detalle si es por
 * día y cuánto falta («Please retry in 10h59m48s»). Como la cuota es por
 * modelo, cambiarlo en la configuración del servicio de IA lo resuelve.
 */
export function quotaMessage(model: string, detail: string): string {
  if (!/per ?day|daily/i.test(detail)) {
    return 'El asistente de IA ha agotado su cuota por ahora. Espere un minuto y vuelva a intentarlo.';
  }

  const wait = /retry in (?:(\d+)h)?(?:(\d+)m)?[\d.]+s/i.exec(detail);
  const hours = Number(wait?.[1] ?? 0);
  const minutes = Number(wait?.[2] ?? 0);
  const when =
    wait === null ? '' : hours > 0 ? `; se renueva en ${hours} h ${minutes} min` : `; se renueva en ${minutes} min`;

  return (
    `El modelo «${model}» agotó la cuota diaria de su plan${when}. ` +
    'Un administrador puede elegir otro modelo en la configuración del servicio de IA: cada modelo tiene su propia cuota.'
  );
}

/** El servidor, sin la ruta: es lo que sirve para nombrarlo en un error. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
