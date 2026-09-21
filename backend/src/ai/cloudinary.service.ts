import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * CU05 — Almacenamiento de las imágenes en Cloudinary.
 *
 * La imagen original se guarda fuera de PostgreSQL: en la base sólo queda la
 * referencia (URL y public_id). Una columna con el binario de una foto de
 * pizarra haría crecer la base sin que nada del modelo UML dependa de ella.
 *
 * Se firma la subida desde el servidor con la API HTTP de Cloudinary en lugar
 * de usar su SDK: es una petición con una firma SHA-1 y no merece una
 * dependencia más. Las credenciales llegan por CLOUDINARY_URL, nunca escritas
 * en el código.
 */

/** Carpeta lógica donde viven las imágenes de los diagramas. */
const FOLDER = 'case-tool/diagrams';

const UPLOAD_TIMEOUT_MS = 60_000;

interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Lo que se guarda para poder volver a la imagen original. */
export interface UploadedImage {
  cloudinaryPublicId: string;
  imageUrl: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
}

/** Campos de la respuesta de Cloudinary que se usan. */
interface CloudinaryUploadResponse {
  public_id?: string;
  secure_url?: string;
  url?: string;
  error?: { message?: string };
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  /**
   * CLOUDINARY_URL tiene la forma cloudinary://<api_key>:<api_secret>@<cloud_name>.
   * Se lee en cada subida y no al arrancar, para que la falta de configuración
   * sólo impida usar CU05 y no levantar toda la aplicación.
   */
  private credentials(): CloudinaryCredentials {
    const raw = process.env.CLOUDINARY_URL?.trim();

    if (!raw) {
      throw new ServiceUnavailableException(
        'Falta la variable de entorno CLOUDINARY_URL: sin ella no se pueden subir imágenes.',
      );
    }

    const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(raw);
    if (!match) {
      throw new ServiceUnavailableException(
        'CLOUDINARY_URL no tiene el formato cloudinary://<api_key>:<api_secret>@<cloud_name>.',
      );
    }

    return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
  }

  /**
   * Firma que exige Cloudinary: los parámetros que se envían, ordenados
   * alfabéticamente, concatenados y con el secreto al final. `file` y `api_key`
   * quedan fuera de la firma, como indica su documentación.
   */
  private sign(params: Record<string, string>, apiSecret: string): string {
    const payload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');

    return createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
  }

  /** Sube la imagen y devuelve lo necesario para referenciarla después. */
  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<UploadedImage> {
    const { cloudName, apiKey, apiSecret } = this.credentials();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signed = { folder: FOLDER, timestamp };

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
    form.append('api_key', apiKey);
    form.append('folder', signed.folder);
    form.append('timestamp', signed.timestamp);
    form.append('signature', this.sign(signed, apiSecret));

    let response: Response;
    try {
      response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException('Cloudinary tardó demasiado en aceptar la imagen.');
      }
      this.logger.error('No se pudo contactar con Cloudinary', error);
      throw new BadGatewayException('No se pudo contactar con Cloudinary para guardar la imagen.');
    }

    const body = (await response.json().catch(() => null)) as CloudinaryUploadResponse | null;

    if (!response.ok || !body?.public_id) {
      const detail = body?.error?.message ?? `respuesta ${response.status}`;
      this.logger.error(`Cloudinary rechazó la subida: ${detail}`);
      throw new BadGatewayException(`Cloudinary no pudo guardar la imagen (${detail}).`);
    }

    const url = body.secure_url ?? body.url;
    if (!url) {
      throw new BadGatewayException('Cloudinary no devolvió la dirección de la imagen.');
    }

    return {
      cloudinaryPublicId: body.public_id,
      imageUrl: url,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    };
  }

  /**
   * La misma imagen, reducida para que el modelo pueda mirarla en un tiempo
   * razonable.
   *
   * Lo que tarda Qwen3-VL depende del tamaño de la imagen, y de forma nada
   * suave: una captura de 1920 px tarda el doble que una de 900, y una foto de
   * móvil de 4000 px se va de cualquier espera aceptable. Leer un diagrama de
   * clases no necesita esa resolución —a 1280 px de ancho el texto de las
   * cajas se lee igual—, así que se analiza una versión reducida.
   *
   * La reducción la hace Cloudinary al servirla: la imagen ya está subida y
   * basta con pedir la URL con la transformación, sin librerías de imagen en
   * el servidor ni una segunda copia guardada. El original no se toca, que es
   * lo que queda referenciado en photo_import_jobs.
   *
   * Devuelve null si algo falla; quien llama usa entonces los bytes que subió
   * el usuario, porque tardar de más es mejor que no importar nada.
   */
  async readScaled(image: UploadedImage, maxWidth: number): Promise<Buffer | null> {
    // «c_limit» sólo reduce: una imagen ya pequeña se sirve tal cual.
    const url = image.imageUrl.replace('/image/upload/', `/image/upload/c_limit,w_${maxWidth}/`);

    if (url === image.imageUrl) {
      this.logger.warn(`No se pudo componer la URL reducida de ${image.cloudinaryPublicId}`);
      return null;
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn(`Cloudinary devolvió ${response.status} al pedir la imagen reducida`);
        return null;
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      this.logger.warn(`No se pudo descargar la imagen reducida: ${String(error)}`);
      return null;
    }
  }
}
