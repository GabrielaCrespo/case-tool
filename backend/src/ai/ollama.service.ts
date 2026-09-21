import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * CU04/CU05 — Cliente de Ollama.
 *
 * Es el único punto del proyecto que habla con el modelo. Se usa la API HTTP
 * de Ollama directamente, sin librería: son dos llamadas, `fetch` ya viene con
 * Node y añadir una dependencia para esto no compraría nada.
 *
 * El mismo modelo —Qwen3-VL— atiende las dos cosas: interpreta la instrucción
 * escrita de CU04 y mira la imagen de CU05. Es un modelo de visión, así que
 * sabe hacer ambas, y tener uno solo evita pedirle al usuario que descargue
 * dos modelos de varios gigabytes para usar la herramienta.
 *
 * La respuesta que devuelve **no está validada**: es lo que dijo el modelo,
 * convertido a objeto. Quien la recibe está obligado a normalizarla y
 * validarla antes de tocar el diagrama (uml-actions.ts, ai-executor.service.ts).
 */

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-vl:4b-instruct';

/**
 * Cuánto se espera al modelo.
 *
 * Interpretar una instrucción escrita es cuestión de segundos. Mirar una
 * imagen en CPU no: un diagrama de ocho clases con todos sus atributos ronda
 * los cinco minutos en un portátil sin GPU, y el tope tiene que dar margen
 * para eso o CU05 no llega a terminar nunca en las máquinas donde se usa.
 */
const TEXT_TIMEOUT_MS = 120_000;
const VISION_TIMEOUT_MS = 600_000;

/** Un trozo de la respuesta de POST /api/chat leída en streaming. */
interface OllamaChatChunk {
  message?: { content?: string };
  error?: string;
  done?: boolean;
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  private get baseUrl(): string {
    return (process.env.OLLAMA_URL?.trim() || DEFAULT_URL).replace(/\/+$/, '');
  }

  private get model(): string {
    return process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL;
  }

  /** El modelo que se está usando, para poder nombrarlo en los errores. */
  get modelName(): string {
    return this.model;
  }

  /**
   * Pide una respuesta en JSON. `images` son los bytes de la imagen en base64
   * —así los quiere Ollama— y sólo se envían en CU05.
   */
  async askJson(
    system: string,
    user: string,
    images: string[] = [],
  ): Promise<unknown> {
    const body = {
      model: this.model,
      /*
       * Se lee en streaming aunque la respuesta se use entera al final.
       *
       * No es por enseñar el texto según llega: es que sin streaming Ollama no
       * manda ni una cabecera hasta haber terminado de generar, y el cliente
       * HTTP de Node (undici) corta por su cuenta a los cinco minutos de
       * espera de cabeceras. Ese corte no lo controla el tope de aquí abajo y
       * hacía fallar CU05 con las imágenes que tardan más de eso. Con
       * streaming las cabeceras llegan al instante y quien decide cuánto se
       * espera vuelve a ser este servicio.
       */
      stream: true,
      // `format: json` obliga al modelo a devolver un objeto JSON válido; sin
      // esto acaba escribiendo explicaciones alrededor que habría que recortar.
      format: 'json',
      options: {
        // La misma instrucción debe producir siempre la misma acción: esto no
        // es una conversación, es la interpretación de una orden.
        temperature: 0,
      },
      messages: [
        { role: 'system', content: system },
        images.length > 0
          ? { role: 'user', content: user, images }
          : { role: 'user', content: user },
      ],
    };

    const timeout = images.length > 0 ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS;
    const content = await this.post('/api/chat', body, timeout);

    if (content.trim().length === 0) {
      throw new UnprocessableEntityException(
        'El modelo de IA devolvió una respuesta vacía. Inténtelo de nuevo.',
      );
    }

    return this.toJson(content);
  }

  /**
   * Llama a Ollama traduciendo cada forma de fallo a un error con sentido para
   * quien está usando el editor: «no está encendido» y «no tiene el modelo»
   * son problemas distintos y se arreglan de forma distinta.
   */
  private async post(path: string, body: unknown, timeoutMs: number): Promise<string> {
    // Un solo AbortSignal para toda la operación: corta igual si Ollama no
    // contesta que si se queda generando a medias.
    const abort = AbortSignal.timeout(timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw this.timedOut();
      }
      this.logger.error(`No se pudo contactar con Ollama en ${this.baseUrl}`, error);
      throw new ServiceUnavailableException(
        `El asistente de IA no está disponible: no se pudo contactar con Ollama en ${this.baseUrl}. Compruebe que está en marcha.`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      // Ollama responde 404 cuando el modelo no está descargado.
      if (response.status === 404) {
        throw new ServiceUnavailableException(
          `El modelo «${this.model}» no está disponible en Ollama. Descárguelo con: ollama pull ${this.model}`,
        );
      }
      this.logger.error(`Ollama respondió ${response.status}: ${detail}`);
      throw new BadGatewayException('El modelo de IA respondió con un error.');
    }

    return this.readStream(response);
  }

  /**
   * Junta la respuesta que llega troceada.
   *
   * Ollama escribe una línea de JSON por cada fragmento generado, así que hay
   * que partir por saltos de línea y quedarse con el trozo incompleto del
   * final hasta que llegue el resto: un fragmento cortado a la mitad no es
   * JSON y rompería la lectura.
   */
  private async readStream(response: Response): Promise<string> {
    if (response.body === null) {
      throw new BadGatewayException('El modelo de IA devolvió una respuesta vacía.');
    }

    const decoder = new TextDecoder();
    let content = '';
    let pending = '';

    const take = (line: string): void => {
      if (line.trim().length === 0) return;

      let chunk: OllamaChatChunk;
      try {
        chunk = JSON.parse(line) as OllamaChatChunk;
      } catch {
        // Una línea ilegible no invalida lo ya recibido; se anota y se sigue.
        this.logger.warn(`Fragmento ilegible de Ollama: ${line.slice(0, 200)}`);
        return;
      }

      if (chunk.error !== undefined) {
        throw new BadGatewayException(`El modelo de IA respondió con un error: ${chunk.error}`);
      }
      content += chunk.message?.content ?? '';
    };

    try {
      for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(part, { stream: true });

        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) take(line);
      }
      take(pending);
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw this.timedOut();
      }
      throw error;
    }

    return content;
  }

  private timedOut(): GatewayTimeoutException {
    return new GatewayTimeoutException(
      'El modelo de IA tardó demasiado en responder. Pruebe con una instrucción más corta o con una imagen más pequeña.',
    );
  }

  /**
   * Convierte a objeto lo que escribió el modelo.
   *
   * Con `format: json` debería bastar con JSON.parse, pero un modelo pequeño
   * se escapa a veces: envuelve el objeto en un bloque de código o añade una
   * frase antes. Recortar hasta las llaves exteriores recupera esos casos sin
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
