import { BadRequestException, ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';
import type { AiProvider, ApiKeyStatus, ChatLlmConnection } from './chat-llm-client.js';
import { apiKeyStatus, ChatLlmClient, GEMINI_BASE_URL } from './chat-llm-client.js';

/**
 * CU11 — Configurar Servicio de IA (Administrador).
 *
 * Qué modelo atiende el chat del equipo, en qué servidor, y si está
 * disponible. Vive en una sola fila de ai_settings; mientras no exista, se usan
 * los valores de DEFAULT_AI_SETTINGS sin guardarlos, y el primer PATCH la crea.
 *
 * La llave del modelo no pasa nunca por aquí ni por la base: sale de la
 * variable de entorno del proveedor (PROVIDER_KEYS), y lo único que se le
 * enseña al administrador es si está puesta.
 */

/**
 * El Flash marcado como estable en la documentación de Google al 2026-11-07.
 * Google retira modelos a menudo —gemini-2.5-flash se redirige desde el
 * 2026-12-01—, y por eso el modelo se cambia desde CU11 y no aquí.
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash';

/** La configuración en vigor, ya validada. */
export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  enabled: boolean;
  /** Tokens aproximados de contexto que se le enseñan al modelo (CU12). */
  contextBudget: number;
  /** Tope de la respuesta del modelo. */
  maxTokens: number;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'GEMINI',
  baseUrl: GEMINI_BASE_URL,
  model: DEFAULT_MODEL,
  enabled: true,
  contextBudget: 24_000,
  maxTokens: 8_192,
};

/** ai_settings.base_url y ai_settings.model. */
const BASE_URL_MAX_LENGTH = 500;
const MODEL_MAX_LENGTH = 150;

/**
 * Por debajo de 2000 tokens no caben ni las instrucciones con un diagrama
 * mediano; por encima de un millón no hay modelo que lo acepte.
 */
const CONTEXT_BUDGET_RANGE = [2_000, 1_000_000] as const;

/**
 * Por debajo de 256 un modelo que piensa antes de contestar —todos los de
 * Gemini 3— se queda sin tokens antes de escribir nada.
 */
const MAX_TOKENS_RANGE = [256, 65_536] as const;

const PROVIDERS: readonly AiProvider[] = ['GEMINI', 'OPENAI_COMPATIBLE'];

/** Lo que se le pide al modelo al probar la conexión: lo más corto posible. */
const PING_INSTRUCTION = 'Responde únicamente con la palabra OK.';

type AiSettingsRow = Scalars<Models.public_AiSettings>;

export interface AiSettingsInput {
  provider?: unknown;
  base_url?: unknown;
  model?: unknown;
  enabled?: unknown;
  context_budget?: unknown;
  max_tokens?: unknown;
}

export interface AiSettingsResponse {
  provider: AiProvider;
  base_url: string;
  model: string;
  enabled: boolean;
  context_budget: number;
  max_tokens: number;
  api_key: ApiKeyStatus;
  /** false mientras se estén usando los valores por defecto, sin guardar. */
  saved: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export interface AiSettingsTestResponse {
  ok: boolean;
  provider: AiProvider;
  base_url: string;
  model: string;
  api_key: ApiKeyStatus;
  /** Cuánto tardó el servidor en contestar; null si no se llegó a llamarlo. */
  latency_ms: number | null;
  /** Lo que respondió el modelo, recortado. */
  reply: string | null;
  message: string;
}

/** Lo que cualquier usuario puede saber del asistente (GET /ai/status). */
export interface AiStatusResponse {
  enabled: boolean;
  /** Se le puede preguntar: está activado y tiene su llave. */
  available: boolean;
  provider: AiProvider;
  model: string;
  /** Por qué no está disponible, para enseñarlo en el editor. */
  reason: string | null;
}

/** Con qué se llama al modelo según una configuración. */
export function connectionOf(settings: AiSettings): ChatLlmConnection {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    maxTokens: settings.maxTokens,
  };
}

/**
 * Aplica a una configuración los campos que llegan, validándolos. No guarda
 * nada: la usa tanto PATCH /ai/settings como la prueba de conexión, que admite
 * probar unos valores antes de guardarlos.
 *
 * Al cambiar de proveedor sin indicar base_url, Gemini toma su dirección; el
 * genérico no tiene ninguna que suponer, así que la pide. Conservar la del
 * proveedor anterior mandaría la llave de uno al servidor del otro.
 */
export function mergeSettings(current: AiSettings, input: AiSettingsInput | null | undefined): AiSettings {
  const data = input ?? {};
  const next: AiSettings = { ...current };

  if (data.provider !== undefined) {
    if (typeof data.provider !== 'string' || !PROVIDERS.includes(data.provider as AiProvider)) {
      throw new BadRequestException(`provider debe ser uno de: ${PROVIDERS.join(', ')}.`);
    }
    next.provider = data.provider as AiProvider;
  }

  if (data.base_url !== undefined) {
    next.baseUrl = validateBaseUrl(data.base_url);
  } else if (next.provider !== current.provider) {
    if (next.provider !== 'GEMINI') {
      throw new BadRequestException(
        'Al cambiar a un servidor compatible con OpenAI hay que indicar su base_url (por ejemplo, http://localhost:11434/v1).',
      );
    }
    next.baseUrl = GEMINI_BASE_URL;
  }

  if (data.model !== undefined) {
    next.model = validateModel(data.model);
  }
  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      throw new BadRequestException('enabled debe ser true o false.');
    }
    next.enabled = data.enabled;
  }
  if (data.context_budget !== undefined) {
    next.contextBudget = validateInteger('context_budget', data.context_budget, CONTEXT_BUDGET_RANGE);
  }
  if (data.max_tokens !== undefined) {
    next.maxTokens = validateInteger('max_tokens', data.max_tokens, MAX_TOKENS_RANGE);
  }

  return next;
}

function validateBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException('base_url es obligatoria y debe ser un texto.');
  }

  const baseUrl = value.trim().replace(/\/+$/, '');
  if (baseUrl.length > BASE_URL_MAX_LENGTH) {
    throw new BadRequestException(`base_url no puede superar los ${BASE_URL_MAX_LENGTH} caracteres.`);
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new BadRequestException('base_url no es una dirección válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('base_url tiene que empezar por http:// o https://.');
  }
  // Una llave escrita en la URL acabaría guardada en la base y enseñada en la
  // pantalla: justo lo que se evita dejándolas en variables de entorno.
  if (url.username || url.password || url.search || url.hash) {
    throw new BadRequestException(
      'base_url no puede llevar usuario, contraseña ni parámetros: la llave va en una variable de entorno.',
    );
  }

  return baseUrl;
}

function validateModel(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException('model es obligatorio y debe ser un texto.');
  }

  const model = value.trim();
  if (model.length > MODEL_MAX_LENGTH) {
    throw new BadRequestException(`model no puede superar los ${MODEL_MAX_LENGTH} caracteres.`);
  }
  if (/\s/.test(model)) {
    throw new BadRequestException('model no puede llevar espacios: es el código del modelo, como gemini-3.6-flash.');
  }

  return model;
}

function validateInteger(field: string, value: unknown, [min, max]: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new BadRequestException(`${field} debe ser un número entero entre ${min} y ${max}.`);
  }
  return value;
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly llm: ChatLlmClient) {}

  /** La configuración en vigor. La usan el chat (CU12–CU15) y /ai/status. */
  async current(): Promise<AiSettings> {
    const row = await this.findRow();
    return row ? this.fromRow(row) : { ...DEFAULT_AI_SETTINGS };
  }

  /** GET /ai/settings */
  async get(userId: string): Promise<AiSettingsResponse> {
    await this.assertAdmin(userId);
    const row = await this.findRow();

    return this.toResponse(row ? this.fromRow(row) : { ...DEFAULT_AI_SETTINGS }, row);
  }

  /** PATCH /ai/settings — sólo cambia los campos que llegan. */
  async update(userId: string, input: AiSettingsInput): Promise<AiSettingsResponse> {
    await this.assertAdmin(userId);

    const fields = ['provider', 'base_url', 'model', 'enabled', 'context_budget', 'max_tokens'] as const;
    if (!fields.some((field) => input?.[field] !== undefined)) {
      throw new BadRequestException(`Indique al menos un campo a modificar: ${fields.join(', ')}.`);
    }

    const row = await this.findRow();
    const next = mergeSettings(row ? this.fromRow(row) : { ...DEFAULT_AI_SETTINGS }, input);
    const values = {
      provider: next.provider,
      baseUrl: next.baseUrl as Varchar<typeof BASE_URL_MAX_LENGTH>,
      model: next.model as Varchar<typeof MODEL_MAX_LENGTH>,
      enabled: next.enabled,
      contextBudget: next.contextBudget,
      maxTokens: next.maxTokens,
      updatedBy: userId,
      // Como en backend_deployments, la fecha la escribe el servicio y no un
      // disparador, para que la base preparada sólo con Prisma se comporte igual.
      updatedAt: new Date().toISOString(),
    };

    if (row) {
      await db.orm.public.AiSettings.where({ id: row.id }).update(values);
    } else {
      await db.orm.public.AiSettings.create(values);
    }

    return this.toResponse(next, await this.findRow());
  }

  /**
   * POST /ai/settings/test — prueba la configuración guardada, o la que
   * resulta de aplicarle los campos que lleguen, sin guardarla.
   */
  async test(userId: string, input: AiSettingsInput | undefined): Promise<AiSettingsTestResponse> {
    await this.assertAdmin(userId);
    const row = await this.findRow();

    return this.probe(mergeSettings(row ? this.fromRow(row) : { ...DEFAULT_AI_SETTINGS }, input));
  }

  /**
   * Llama al modelo con la pregunta más corta posible. Si falta la llave se
   * dice sin llamar a nada: el error del servidor sería menos claro.
   *
   * No mira `enabled`: probar antes de activar es justo para lo que sirve.
   * Un fallo no es un error de la petición, es el resultado de la prueba, así
   * que se devuelve con ok: false en lugar de lanzarse.
   */
  async probe(settings: AiSettings): Promise<AiSettingsTestResponse> {
    const apiKey = apiKeyStatus(settings.provider);
    const base = {
      provider: settings.provider,
      base_url: settings.baseUrl,
      model: settings.model,
      api_key: apiKey,
    };

    if (apiKey.required && !apiKey.configured) {
      return {
        ...base,
        ok: false,
        latency_ms: null,
        reply: null,
        message: `Falta la variable de entorno ${apiKey.env} en el servidor: sin ella no se puede llamar al modelo.`,
      };
    }

    const started = Date.now();
    try {
      const completion = await this.llm.complete(connectionOf(settings), [
        { role: 'system', content: PING_INSTRUCTION },
        { role: 'user', content: 'OK' },
      ]);
      const reply = completion.content.trim().slice(0, 200);

      return {
        ...base,
        ok: true,
        latency_ms: Date.now() - started,
        reply: reply.length > 0 ? reply : null,
        message:
          reply.length === 0 && completion.finishReason === 'length'
            ? `Hay conexión con ${completion.model}, pero agotó los ${settings.maxTokens} tokens sin escribir nada: conviene subir max_tokens.`
            : `Conexión correcta con ${completion.model}.`,
      };
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw error;
      }
      return {
        ...base,
        ok: false,
        latency_ms: Date.now() - started,
        reply: null,
        message: error.message,
      };
    }
  }

  /** GET /ai/status — para cualquier usuario autenticado; no llama al modelo. */
  async status(): Promise<AiStatusResponse> {
    const settings = await this.current();
    const apiKey = apiKeyStatus(settings.provider);
    const reason = !settings.enabled
      ? 'El administrador desactivó el asistente de IA.'
      : apiKey.required && !apiKey.configured
        ? `El asistente de IA no está configurado: falta la variable ${apiKey.env} en el servidor.`
        : null;

    return {
      enabled: settings.enabled,
      available: reason === null,
      provider: settings.provider,
      model: settings.model,
      reason,
    };
  }

  /** users.is_admin se asigna por SQL; no hay forma de otorgarlo desde la API. */
  private async assertAdmin(userId: string): Promise<void> {
    const user = await db.orm.public.Users.select('isAdmin').where({ id: userId }).first();

    if (!user?.isAdmin) {
      throw new ForbiddenException('Sólo un administrador puede configurar el servicio de IA.');
    }
  }

  /** La fila de configuración. Si alguna vez hubiera dos, manda la primera. */
  private findRow(): Promise<AiSettingsRow | null> {
    return db.orm.public.AiSettings.orderBy((row) => row.createdAt.asc()).first();
  }

  private fromRow(row: AiSettingsRow): AiSettings {
    return {
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      enabled: row.enabled,
      contextBudget: row.contextBudget,
      maxTokens: row.maxTokens,
    };
  }

  private toResponse(settings: AiSettings, row: AiSettingsRow | null): AiSettingsResponse {
    return {
      provider: settings.provider,
      base_url: settings.baseUrl,
      model: settings.model,
      enabled: settings.enabled,
      context_budget: settings.contextBudget,
      max_tokens: settings.maxTokens,
      api_key: apiKeyStatus(settings.provider),
      saved: row !== null,
      updated_by: row?.updatedBy ?? null,
      updated_at: row ? new Date(row.updatedAt).toISOString() : null,
    };
  }
}
