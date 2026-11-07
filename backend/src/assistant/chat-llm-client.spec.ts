import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatLlmConnection } from './chat-llm-client.js';
import { ChatLlmClient, GEMINI_BASE_URL } from './chat-llm-client.js';

/**
 * CU11–CU15 — El cliente del chat contra un servidor simulado.
 *
 * No se llama a ninguna API de verdad: `fetch` se sustituye por respuestas
 * escritas a mano, así que estas pruebas no gastan cuota ni necesitan llave.
 */
const gemini: ChatLlmConnection = {
  provider: 'GEMINI',
  baseUrl: GEMINI_BASE_URL,
  model: 'gemini-3.6-flash',
  maxTokens: 1024,
};

/** Un servidor autoalojado: con barra final y sin llave. */
const selfHosted: ChatLlmConnection = {
  provider: 'OPENAI_COMPATIBLE',
  baseUrl: 'http://localhost:11434/v1/',
  model: 'llama3.1',
  maxTokens: 1024,
};

const question = [{ role: 'user' as const, content: '¿Qué clases tiene el diagrama?' }];

function completion(content: string | null, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function failure(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** El cuerpo JSON de la llamada número `index` a fetch. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[index][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('ChatLlmClient', () => {
  const saved = { gemini: process.env.GEMINI_API_KEY, generic: process.env.CHAT_LLM_API_KEY };
  const client = new ChatLlmClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'llave-de-prueba';
    delete process.env.CHAT_LLM_API_KEY;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restore('GEMINI_API_KEY', saved.gemini);
    restore('CHAT_LLM_API_KEY', saved.generic);
  });

  it('manda sólo modelo, mensajes y tope, con la llave de Gemini', async () => {
    fetchMock.mockResolvedValueOnce(completion('Tiene CLIENTE y PEDIDO.'));

    const result = await client.complete(gemini, question);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GEMINI_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer llave-de-prueba');
    expect(Object.keys(sentBody(fetchMock)).sort()).toEqual(['max_tokens', 'messages', 'model']);
    expect(sentBody(fetchMock).max_tokens).toBe(1024);
    expect(result).toEqual({
      content: 'Tiene CLIENTE y PEDIDO.',
      model: 'gemini-3.6-flash',
      finishReason: 'stop',
    });
  });

  it('sin la llave obligatoria no llama a nada y nombra la variable', async () => {
    delete process.env.GEMINI_API_KEY;

    const call = client.complete(gemini, question);

    await expect(call).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(call).rejects.toThrow('GEMINI_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un servidor compatible sin llave se llama sin Authorization y sin la barra final', async () => {
    fetchMock.mockResolvedValueOnce(completion('OK'));

    await client.complete(selfHosted, question);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('el JSON dentro de un bloque de código se lee sin pedir reparación', async () => {
    fetchMock.mockResolvedValueOnce(completion('```json\n{"reply":"hola","actions":[]}\n```'));

    const result = await client.completeJson(gemini, question);

    expect(result).toEqual({
      value: { reply: 'hola', actions: [] },
      model: 'gemini-3.6-flash',
      repaired: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repara un JSON roto pidiéndoselo una vez al modelo', async () => {
    const broken = 'Claro: {reply: "hola"';
    fetchMock
      .mockResolvedValueOnce(completion(broken))
      .mockResolvedValueOnce(completion('{"reply":"hola","actions":[]}'));

    const result = await client.completeJson(gemini, question);

    expect(result.value).toEqual({ reply: 'hola', actions: [] });
    expect(result.repaired).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // La segunda vuelta lleva la pregunta, la respuesta rota y la petición.
    const messages = sentBody(fetchMock, 1).messages as { role: string; content: string }[];
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'assistant', content: broken });
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toContain('JSON válido');
  });

  it('si tampoco lo repara, se rinde con un 422 sin un tercer intento', async () => {
    fetchMock
      .mockResolvedValueOnce(completion('no es json'))
      .mockResolvedValueOnce(completion('sigue sin serlo'));

    await expect(client.completeJson(gemini, question)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('una respuesta vacía por el tope de tokens lo dice y no pide reparación', async () => {
    fetchMock.mockResolvedValueOnce(completion('', 'length'));

    await expect(client.completeJson(gemini, question)).rejects.toThrow(
      'agotó el máximo de 1024 tokens',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un modelo que no existe se nombra en el error', async () => {
    fetchMock.mockResolvedValueOnce(failure(404, { error: { message: 'model not found' } }));

    await expect(client.complete(gemini, question)).rejects.toThrow(
      '«gemini-3.6-flash» no existe en generativelanguage.googleapis.com',
    );
  });

  it('el 400 de Google trae el motivo dentro de una lista, y se enseña', async () => {
    fetchMock.mockResolvedValueOnce(
      failure(400, [{ error: { message: 'API key not valid. Please pass a valid API key.' } }]),
    );

    const call = client.complete(gemini, question);

    await expect(call).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call).rejects.toThrow('API key not valid');
  });

  it('un 429 con espera corta se reintenta una vez', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(failure(429, { error: { message: 'quota' } }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(completion('OK'));

    const call = client.complete(gemini, question);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(call).resolves.toMatchObject({ content: 'OK' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un 503 «high demand» de Google se reintenta una vez y se recupera', async () => {
    vi.useFakeTimers();
    const busy = { error: { message: 'This model is currently experiencing high demand.' } };
    fetchMock.mockResolvedValueOnce(failure(503, busy)).mockResolvedValueOnce(completion('OK'));

    const call = client.complete(gemini, question);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(call).resolves.toMatchObject({ content: 'OK' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si sigue saturado, lo dice en vez de «respondió con un error»', async () => {
    vi.useFakeTimers();
    const busy = { error: { message: 'This model is currently experiencing high demand.' } };
    fetchMock.mockResolvedValueOnce(failure(503, busy)).mockResolvedValueOnce(failure(503, busy));

    const call = client.complete(gemini, question);
    const outcome = call.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(3_000);

    const error = await outcome;
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toContain('«gemini-3.6-flash» está saturado');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('la cuota diaria se distingue de la de un minuto, y dice cuándo vuelve', async () => {
    const daily =
      'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash, ' +
      'description: Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 10h59m48.02s.';
    fetchMock.mockResolvedValueOnce(failure(429, [{ error: { message: daily } }]));

    const call = client.complete(gemini, question);

    await expect(call).rejects.toThrow('agotó la cuota diaria de su plan; se renueva en 10 h 59 min');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 429 que pide esperar minutos no se queda esperando', async () => {
    fetchMock.mockResolvedValueOnce(
      failure(429, { error: { message: 'quota' } }, { 'retry-after': '120' }),
    );

    await expect(client.complete(gemini, question)).rejects.toThrow('agotado su cuota');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
