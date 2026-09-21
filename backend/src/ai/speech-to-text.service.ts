import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * CU04 — Convertir voz en texto.
 *
 * Este servicio hace una sola cosa: entrega el audio al servicio local de
 * Faster-Whisper y devuelve la frase que se dictó. Aquí no hay ni una línea
 * sobre clases, atributos o relaciones, y es deliberado: la voz no es una
 * segunda manera de editar el diagrama, es una segunda manera de escribir la
 * instrucción. Una vez que hay texto, sigue el mismo camino que si se hubiera
 * tecleado —el mismo prompt, la misma normalización, la misma validación y los
 * mismos servicios de CU02—.
 *
 * La transcripción corre en Python porque Faster-Whisper es una librería de
 * Python; NestJS sigue siendo el backend y le pide el texto por HTTP local.
 * Ni el audio ni la transcripción salen de la máquina.
 */

const DEFAULT_URL = 'http://127.0.0.1:8001';

/**
 * Transcribir unos segundos de audio con el modelo «small» en CPU ronda los
 * diez o quince segundos; el margen es para la primera petición, que además
 * puede estar esperando a que el modelo termine de cargarse.
 */
const TRANSCRIBE_TIMEOUT_MS = 180_000;

interface TranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  error?: string;
}

export interface Transcription {
  text: string;
  /** Segundos de audio, para poder dejar constancia de qué se dictó. */
  duration: number;
}

@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);

  private get baseUrl(): string {
    return (process.env.SPEECH_URL?.trim() || DEFAULT_URL).replace(/\/+$/, '');
  }

  /**
   * El audio viaja en crudo en el cuerpo de la petición, con su Content-Type.
   * No se envuelve en multipart porque no hay nada más que enviar, y así el
   * servicio de Python no necesita ninguna librería para leerlo.
   */
  async transcribe(audio: Buffer, mimeType: string): Promise<Transcription> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException(
          'La transcripción tardó demasiado. Pruebe con una grabación más corta.',
        );
      }
      this.logger.error(`No se pudo contactar con el servicio de voz en ${this.baseUrl}`, error);
      throw new ServiceUnavailableException(
        `El servicio de transcripción no está disponible en ${this.baseUrl}. Compruebe que está en marcha.`,
      );
    }

    const body = (await response.json().catch(() => null)) as TranscriptionResponse | null;

    if (!response.ok) {
      const detail = body?.error ?? `respuesta ${response.status}`;
      this.logger.error(`El servicio de voz respondió con un error: ${detail}`);

      throw response.status >= 500
        ? new BadGatewayException('No se pudo procesar el audio.')
        : new UnprocessableEntityException(detail);
    }

    const text = body?.text?.trim() ?? '';
    if (text.length === 0) {
      // Silencio, ruido o un micrófono que no capturó nada. No es un fallo del
      // sistema, así que se dice con claridad en lugar de devolver un 500.
      throw new UnprocessableEntityException(
        'No se entendió nada en la grabación. Hable más cerca del micrófono e inténtelo de nuevo.',
      );
    }

    return { text, duration: body?.duration ?? 0 };
  }
}
