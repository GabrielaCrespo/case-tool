import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from './ai-settings.service.js';
import { AiSettingsService, DEFAULT_AI_SETTINGS, mergeSettings } from './ai-settings.service.js';
import type { ChatCompletion, ChatLlmClient } from './chat-llm-client.js';
import { GEMINI_BASE_URL } from './chat-llm-client.js';

/**
 * CU11 — Qué configuración se acepta y qué dice la prueba de conexión.
 *
 * Lo que toca la base (leer y guardar la fila, comprobar el administrador) no
 * se prueba aquí; sí todo lo que decide: la validación y la prueba, con el
 * cliente del modelo sustituido por uno de mentira.
 */
const selfHosted: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: 'OPENAI_COMPATIBLE',
  baseUrl: 'http://192.168.1.20:11434/v1',
  model: 'llama3.1',
};

describe('mergeSettings', () => {
  it('cambia sólo lo que llega', () => {
    const next = mergeSettings(DEFAULT_AI_SETTINGS, { model: 'gemini-3.8-flash', max_tokens: 4096 });

    expect(next).toEqual({ ...DEFAULT_AI_SETTINGS, model: 'gemini-3.8-flash', maxTokens: 4096 });
  });

  it('sin cuerpo deja la configuración como estaba', () => {
    expect(mergeSettings(DEFAULT_AI_SETTINGS, undefined)).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('quita la barra final de base_url', () => {
    const next = mergeSettings(DEFAULT_AI_SETTINGS, {
      provider: 'OPENAI_COMPATIBLE',
      base_url: 'http://localhost:1234/v1/',
    });

    expect(next.baseUrl).toBe('http://localhost:1234/v1');
  });

  it('pasar a un servidor compatible exige decir dónde está', () => {
    expect(() => mergeSettings(DEFAULT_AI_SETTINGS, { provider: 'OPENAI_COMPATIBLE' })).toThrow(
      BadRequestException,
    );
  });

  it('volver a Gemini sin base_url no se queda con la dirección del servidor anterior', () => {
    // Si la conservara, la llave de Google viajaría al servidor autoalojado.
    expect(mergeSettings(selfHosted, { provider: 'GEMINI' }).baseUrl).toBe(GEMINI_BASE_URL);
  });

  it.each([
    ['otro protocolo', 'ftp://servidor/v1'],
    ['usuario y contraseña', 'https://yo:secreto@servidor/v1'],
    ['la llave en la URL', 'https://servidor/v1?key=abc'],
    ['algo que no es una dirección', 'no-es-una-url'],
  ])('rechaza una base_url con %s', (_, baseUrl) => {
    expect(() => mergeSettings(DEFAULT_AI_SETTINGS, { base_url: baseUrl })).toThrow(BadRequestException);
  });

  it.each([
    ['un proveedor desconocido', { provider: 'OPENAI' }],
    ['un modelo con espacios', { model: 'gemini 3 flash' }],
    ['un modelo vacío', { model: '  ' }],
    ['enabled que no es booleano', { enabled: 'sí' }],
    ['context_budget fuera de rango', { context_budget: 500 }],
    ['context_budget con decimales', { context_budget: 12000.5 }],
    ['max_tokens como texto', { max_tokens: '4096' }],
    ['max_tokens demasiado bajo', { max_tokens: 64 }],
  ])('rechaza %s', (_, input) => {
    expect(() => mergeSettings(DEFAULT_AI_SETTINGS, input)).toThrow(BadRequestException);
  });
});

describe('AiSettingsService.probe', () => {
  const saved = { gemini: process.env.GEMINI_API_KEY, generic: process.env.CHAT_LLM_API_KEY };
  let complete: ReturnType<typeof vi.fn>;
  let service: AiSettingsService;

  beforeEach(() => {
    complete = vi.fn();
    service = new AiSettingsService({ complete } as unknown as ChatLlmClient);
    process.env.GEMINI_API_KEY = 'llave-de-prueba';
    delete process.env.CHAT_LLM_API_KEY;
  });

  afterEach(() => {
    restore('GEMINI_API_KEY', saved.gemini);
    restore('CHAT_LLM_API_KEY', saved.generic);
  });

  it('sin la llave lo dice sin llamar al modelo', async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await service.probe(DEFAULT_AI_SETTINGS);

    expect(result.ok).toBe(false);
    expect(result.api_key).toEqual({ env: 'GEMINI_API_KEY', required: true, configured: false });
    expect(result.message).toContain('GEMINI_API_KEY');
    expect(result.latency_ms).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('con llave y respuesta, la conexión es correcta', async () => {
    complete.mockResolvedValueOnce({
      content: 'OK',
      model: 'gemini-3.6-flash',
      finishReason: 'stop',
    } satisfies ChatCompletion);

    const result = await service.probe(DEFAULT_AI_SETTINGS);

    expect(result).toMatchObject({ ok: true, reply: 'OK', model: 'gemini-3.6-flash' });
    expect(result.latency_ms).toEqual(expect.any(Number));
    expect(complete).toHaveBeenCalledWith(
      {
        provider: 'GEMINI',
        baseUrl: GEMINI_BASE_URL,
        model: 'gemini-3.6-flash',
        maxTokens: DEFAULT_AI_SETTINGS.maxTokens,
      },
      expect.any(Array),
    );
  });

  it('un fallo del servidor es el resultado de la prueba, no un error', async () => {
    complete.mockRejectedValueOnce(
      new ServiceUnavailableException('El asistente de IA ha agotado su cuota por ahora.'),
    );

    const result = await service.probe(DEFAULT_AI_SETTINGS);

    expect(result).toMatchObject({ ok: false, message: 'El asistente de IA ha agotado su cuota por ahora.' });
  });

  it('avisa si el modelo agota los tokens sin escribir nada', async () => {
    complete.mockResolvedValueOnce({ content: '', model: 'gemini-3.6-flash', finishReason: 'length' });

    const result = await service.probe({ ...DEFAULT_AI_SETTINGS, maxTokens: 256 });

    expect(result.ok).toBe(true);
    expect(result.reply).toBeNull();
    expect(result.message).toContain('max_tokens');
  });

  it('un servidor autoalojado no necesita llave', async () => {
    complete.mockResolvedValueOnce({ content: 'OK', model: 'llama3.1', finishReason: 'stop' });

    const result = await service.probe(selfHosted);

    expect(result.ok).toBe(true);
    expect(result.api_key).toEqual({ env: 'CHAT_LLM_API_KEY', required: false, configured: false });
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
