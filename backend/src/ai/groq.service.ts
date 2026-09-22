import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * CU04/CU05 — Cliente del modelo de IA.
 *
 * Es el único punto del proyecto que habla con el modelo, y atiende las tres
 * entradas del asistente: la instrucción escrita de CU04, el audio dictado y
 * la imagen del diagrama de CU05. Se usa la API HTTP de Groq directamente, sin
 * librería: es compatible con la de OpenAI, `fetch` ya viene con Node y añadir
 * una dependencia para tres llamadas no compraría nada.
 *
 * Antes esto era Ollama con Qwen3-VL corriendo en la máquina del usuario, y se
 * cambió por dos razones que iban juntas: leer una imagen tardaba minutos en
 * CPU —83 s un diagrama simple y unos cinco minutos uno de ocho clases— y el
 * backend tiene que poder desplegarse en una instancia sin GPU, donde un modelo
 * de visión no cabe. No queda respaldo local: sin conexión el asistente de IA
 * no funciona, mientras que el diseño manual, el XMI y la generación del
 * backend siguen sin necesitarla.
 *
 * El modelo de visión que se usa es un Qwen multimodal, la misma familia que el
 * de antes y por tanto la misma a la que están afinados los prompts, pero de
 * 27B en lugar de 4B y alojado.
 *
 * La respuesta que devuelve **no está validada**: es lo que dijo el modelo,
 * convertido a objeto. Quien la recibe está obligado a normalizarla y validarla
 * antes de tocar el diagrama (uml-actions.ts, ai-executor.service.ts).
 */

const DEFAULT_URL = 'https://api.groq.com/openai/v1';

/**
 * Un modelo por capacidad, y los tres en variables de entorno.
 *
 * Son dos modelos distintos para el texto y la imagen a pesar de que el de
 * visión sabe hacer las dos cosas, y es a propósito: **cada modelo tiene su
 * propia cuota**. En el plan gratuito el límite es de mil tokens de salida por
 * minuto y por modelo, y una instrucción de CU04 se estima en unos 770; con un
 * solo modelo para todo, leer una imagen dejaba a la siguiente instrucción sin
 * cuota. Repartidos, cada caso de uso tiene la suya.
 *
 * La imagen la lee un Qwen multimodal —la misma familia para la que están
 * escritos los prompts, comprobado con el banco— y el texto un GPT-OSS, que es
 * más rápido y acierta igual en lo delicado, incluida la orientación de la
 * herencia. El de visión está catalogado como «preview» en Groq, así que puede
 * cambiar de nombre o retirarse; el día que pase se cambia la variable.
 */
const DEFAULT_TEXT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_VISION_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_AUDIO_MODEL = 'whisper-large-v3-turbo';

/** Idioma del dictado. Decírselo a Whisper transcribe mejor y más rápido. */
const DEFAULT_AUDIO_LANGUAGE = 'es';

/**
 * Cuánto piensa cada modelo antes de responder.
 *
 * Lo menos posible: esto no es una conversación, es la interpretación de una
 * orden con un formato fijo, y pensar sólo añade segundos y tokens. Va por
 * capacidad porque cada familia admite valores distintos —los Qwen aceptan
 * «none» y los GPT-OSS sólo low, medium o high—, de modo que cambiar un modelo
 * no obliga a recordar que había que cambiar también el otro ajuste.
 */
const DEFAULT_TEXT_REASONING = 'low';
const DEFAULT_VISION_REASONING = 'none';

/**
 * Cuánto se espera. Con el modelo alojado la respuesta llega en segundos, así
 * que estos topes son para una red mala, no para el modelo: lo que hay detrás
 * de ellos es un usuario esperando delante del lienzo.
 */
const TEXT_TIMEOUT_MS = 60_000;
const VISION_TIMEOUT_MS = 120_000;
const AUDIO_TIMEOUT_MS = 120_000;

/** Tope de la respuesta. Un diagrama grande en JSON no llega a esto. */
const MAX_COMPLETION_TOKENS = 8_192;

/**
 * Lo máximo que se espera tras un 429 antes de darse por vencido. Quince
 * segundos es más de lo que tarda en liberarse el minuto del plan gratuito y
 * menos de lo que nadie aguanta mirando una pantalla sin respuesta.
 */
const MAX_RETRY_WAIT_MS = 15_000;

/** Extensión que se le pone al audio; la API la exige para reconocer el formato. */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

interface TranscriptionResponse {
  text?: string;
  duration?: number;
  error?: { message?: string };
}

export interface Transcription {
  text: string;
  /** Segundos de audio, para poder dejar constancia de qué se dictó. */
  duration: number;
}

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);

  private get baseUrl(): string {
    return (process.env.GROQ_URL?.trim() || DEFAULT_URL).replace(/\/+$/, '');
  }

  private get apiKey(): string {
    const key = process.env.GROQ_API_KEY?.trim();

    if (!key) {
      // Es un error de configuración, no del usuario, pero se le dice con
      // claridad: sin clave el asistente no puede funcionar y no hay nada que
      // pueda reintentar.
      throw new ServiceUnavailableException(
        'El asistente de IA no está configurado: falta la variable GROQ_API_KEY en el servidor.',
      );
    }
    return key;
  }

  private get textModel(): string {
    return process.env.GROQ_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  }

  private get visionModel(): string {
    return process.env.GROQ_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
  }

  private get audioModel(): string {
    return process.env.GROQ_AUDIO_MODEL?.trim() || DEFAULT_AUDIO_MODEL;
  }

  /** El modelo que se está usando, para poder nombrarlo en los errores. */
  get modelName(): string {
    return this.textModel;
  }

  /**
   * Pide una respuesta en JSON.
   *
   * `imageUrl` sólo llega en CU05 y admite las dos formas que acepta la API:
   * una URL pública o la imagen entera codificada en una URL de datos. Se usa
   * la segunda, porque la imagen no se guarda en ninguna parte y por tanto no
   * hay URL que servir: viaja dentro de esta misma petición y se descarta.
   */
  async askJson(system: string, user: string, imageUrl: string | null = null): Promise<unknown> {
    /*
     * Se pide «json_object» y no un esquema.
     *
     * Con un esquema la API rechazaría cualquier variación de la forma, y las
     * variaciones aquí son recuperables: uml-actions.ts admite sinónimos de
     * cada campo —`className`, `class_name`, `clase`— precisamente porque un
     * modelo los intercambia. Un esquema convertiría esas respuestas, hoy
     * aprovechables, en un fallo duro.
     */
    const body = {
      model: imageUrl === null ? this.textModel : this.visionModel,
      temperature: 0,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      reasoning_effort:
        imageUrl === null
          ? process.env.GROQ_TEXT_REASONING?.trim() || DEFAULT_TEXT_REASONING
          : process.env.GROQ_VISION_REASONING?.trim() || DEFAULT_VISION_REASONING,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            imageUrl === null
              ? user
              : [
                  { type: 'text', text: user },
                  { type: 'image_url', image_url: { url: imageUrl } },
                ],
        },
      ],
    };

    const raw = await this.post<ChatResponse>(
      '/chat/completions',
      body,
      imageUrl === null ? TEXT_TIMEOUT_MS : VISION_TIMEOUT_MS,
    );
    const content = raw.choices?.[0]?.message?.content ?? '';

    if (content.trim().length === 0) {
      throw new UnprocessableEntityException(
        'El modelo de IA devolvió una respuesta vacía. Inténtelo de nuevo.',
      );
    }

    return this.toJson(content);
  }

  /**
   * CU04 por voz: convierte la grabación en la frase que se dictó.
   *
   * Aquí no hay nada de UML. Una vez que hay texto, sigue el mismo camino que
   * si se hubiera tecleado: el mismo prompt, la misma normalización y la misma
   * validación.
   */
  async transcribe(audio: Buffer, mimeType: string): Promise<Transcription> {
    const extension = AUDIO_EXTENSIONS[mimeType] ?? 'webm';
    const form = new FormData();

    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `dictado.${extension}`);
    form.append('model', this.audioModel);
    // «verbose_json» es la única forma que trae la duración, y se usa para
    // dejar constancia en ai_command_logs de qué se dictó.
    form.append('response_format', 'verbose_json');
    form.append('language', process.env.GROQ_AUDIO_LANGUAGE?.trim() || DEFAULT_AUDIO_LANGUAGE);

    const raw = await this.post<TranscriptionResponse>(
      '/audio/transcriptions',
      form,
      AUDIO_TIMEOUT_MS,
    );
    const text = raw.text?.trim() ?? '';

    if (text.length === 0) {
      // Silencio, ruido o un micrófono que no capturó nada. No es un fallo del
      // sistema, así que se dice con claridad en lugar de devolver un 500.
      throw new UnprocessableEntityException(
        'No se entendió nada en la grabación. Hable más cerca del micrófono e inténtelo de nuevo.',
      );
    }

    return { text, duration: raw.duration ?? 0 };
  }

  /**
   * Llama a la API traduciendo cada forma de fallo a un error con sentido para
   * quien está usando el editor: una clave mal puesta, la cuota del plan
   * agotada y quedarse sin internet son problemas distintos y se arreglan de
   * forma distinta.
   *
   * `body` es un objeto JSON en las llamadas de chat y un FormData en la de
   * audio, que es lo que exige el endpoint de transcripción.
   */
  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    let response = await this.send(path, body, timeoutMs);

    /*
     * Un 429 no es siempre un fallo: en el plan gratuito el límite es de mil
     * tokens de salida por minuto, y basta con leer una imagen y dictar un par
     * de instrucciones seguidas para topar con él. La API dice en el propio
     * error cuántos segundos faltan para que vuelva a haber sitio, así que se
     * espera eso y se reintenta una vez, en lugar de enseñarle al usuario un
     * error por algo que se arregla solo en unos segundos.
     *
     * Se reintenta una sola vez y sólo si la espera es corta: si hacen falta
     * dos minutos, esperar callando sería peor que decirlo.
     */
    if (response.status === 429) {
      const detail = await this.detailOf(response);
      const wait = this.retryDelayMs(response, detail);

      if (wait !== null) {
        this.logger.warn(`Cuota al límite; se reintenta en ${Math.round(wait / 1000)} s: ${detail}`);
        await new Promise((resume) => setTimeout(resume, wait));
        response = await this.send(path, body, timeoutMs);
      } else {
        throw this.errorFor(response.status, detail);
      }
    }

    if (!response.ok) {
      throw this.errorFor(response.status, await this.detailOf(response));
    }

    return (await response.json()) as T;
  }

  /**
   * Una llamada, sin interpretar el resultado.
   *
   * `body` es un objeto JSON en las llamadas de chat y un FormData en la de
   * audio, que es lo que exige el endpoint de transcripción.
   */
  private async send(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const isForm = body instanceof FormData;

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          // Con FormData lo pone el propio fetch, con su «boundary».
          ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        },
        body: isForm ? (body as FormData) : JSON.stringify(body),
        // Un solo AbortSignal por intento: corta igual si la API no contesta
        // que si se queda a medias enviando.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException(
          'El modelo de IA tardó demasiado en responder. Inténtelo de nuevo.',
        );
      }
      this.logger.error(`No se pudo contactar con la API de IA en ${this.baseUrl}`, error);
      throw new ServiceUnavailableException(
        'El asistente de IA no está disponible: no se pudo contactar con el servicio. Compruebe la conexión a internet.',
      );
    }
  }

  /** El mensaje de error que trae la respuesta, si trae alguno. */
  private async detailOf(response: Response): Promise<string> {
    return response
      .clone()
      .json()
      .then((body) => (body as ChatResponse)?.error?.message ?? '')
      .catch(() => '');
  }

  /**
   * Cuánto esperar antes de reintentar, o null si no merece la pena.
   *
   * La cabecera `retry-after` es la respuesta canónica; cuando no viene, el
   * propio mensaje dice «Please try again in 11.28s». Un «Request too large»
   * no lleva espera porque no la arregla el tiempo: la petición no cabe en el
   * plan, y reintentarla daría el mismo error.
   */
  private retryDelayMs(response: Response, detail: string): number | null {
    const header = Number(response.headers.get('retry-after'));
    const seconds = Number.isFinite(header) && header > 0
      ? header
      : Number(/try again in ([\d.]+)s/i.exec(detail)?.[1]);

    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > MAX_RETRY_WAIT_MS) {
      return null;
    }
    // Un pelín más de lo que dice, para no volver justo en el borde.
    return Math.ceil(seconds * 1000) + 500;
  }

  /** El error que corresponde a cada respuesta de la API. */
  private errorFor(status: number, detail: string): Error {
    this.logger.error(`La API de IA respondió ${status}: ${detail}`);

    switch (status) {
      case 401:
      case 403:
        return new ServiceUnavailableException(
          'El asistente de IA no está disponible: la clave GROQ_API_KEY no es válida.',
        );
      case 404:
        return new ServiceUnavailableException(
          `El modelo «${this.modelName}» no existe o ya no está disponible. Revise las variables GROQ_TEXT_MODEL y GROQ_VISION_MODEL.`,
        );
      case 413:
        return new UnprocessableEntityException(
          'El archivo es demasiado grande para el modelo de IA. Pruebe con una imagen o una grabación más pequeña.',
        );
      case 429:
        return new ServiceUnavailableException(
          'El asistente de IA ha agotado su cuota por ahora. Espere un minuto y vuelva a intentarlo.',
        );
      default:
        return new BadGatewayException('El modelo de IA respondió con un error.');
    }
  }

  /**
   * Convierte a objeto lo que escribió el modelo.
   *
   * Con `response_format: json_object` debería bastar con JSON.parse, pero un
   * modelo se escapa a veces: envuelve el objeto en un bloque de código, añade
   * una frase antes, o deja un bloque de razonamiento aunque se le haya pedido
   * que no razone. Recortar hasta las llaves exteriores recupera esos casos sin
   * tener que rechazar la instrucción del usuario.
   */
  private toJson(content: string): unknown {
    const cleaned = content
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/```(?:json)?/gi, '')
      .trim();

    const candidates = [cleaned, this.betweenBraces(cleaned)];

    for (const candidate of candidates) {
      if (candidate === null) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }

    this.logger.warn(`Respuesta no interpretable del modelo: ${content.slice(0, 500)}`);
    throw new UnprocessableEntityException(
      'El modelo de IA no devolvió un JSON válido. Inténtelo de nuevo o reformule la instrucción.',
    );
  }

  private betweenBraces(content: string): string | null {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');

    return start >= 0 && end > start ? content.slice(start, end + 1) : null;
  }
}
