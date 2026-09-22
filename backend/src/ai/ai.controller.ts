import { Body, Controller, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type {
  AiCommandInput,
  AiResult,
  ImageImportResult,
  UploadedFile as MultipartFile,
  VoiceResult,
} from './ai.service.js';
import { AiService, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from './ai.service.js';

/**
 * CU04 — Asistir el Diseño mediante IA, por texto y por voz.
 * CU05 — Generar Diagrama desde Imagen.
 *
 * Tres operaciones de un mismo asistente: entiende lo que se le escribe, lo
 * que se le dice y lo que se le enseña. Las tres devuelven el diagrama
 * completo ya actualizado, que es lo que el editor necesita para repintar el
 * lienzo.
 */
@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** CU04 — «Crea una clase Cliente con id Integer y nombre String». */
  @Post('interpret')
  interpret(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AiCommandInput,
  ): Promise<AiResult> {
    return this.aiService.interpret(user.id, body);
  }

  /**
   * CU04 por voz — El usuario dicta la instrucción en vez de teclearla.
   *
   * Whisper la convierte en texto y a partir de ahí es exactamente la misma
   * operación que /ai/interpret. La respuesta incluye la transcripción para
   * que el usuario pueda comprobar qué se entendió.
   */
  @Post('voice')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  voice(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: MultipartFile[] | undefined,
    @Body() body: { diagram_id?: unknown; diagramId?: unknown },
  ): Promise<VoiceResult> {
    return this.aiService.interpretVoice(
      user.id,
      body?.diagram_id ?? body?.diagramId,
      fileNamed(files, 'audio'),
    );
  }

  @Post('image-to-uml')
  // El límite se pone también aquí, y no sólo en el servicio: Multer guarda el
  // archivo en memoria mientras lo recibe, así que sin este tope una subida
  // enorme ocuparía la memoria del servidor antes de que nadie la rechazara.
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  imageToUml(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: MultipartFile[] | undefined,
    @Body() body: { diagram_id?: unknown; diagramId?: unknown },
  ): Promise<ImageImportResult> {
    return this.aiService.imageToUml(
      user.id,
      body?.diagram_id ?? body?.diagramId,
      fileNamed(files, 'image'),
    );
  }
}

/**
 * El archivo que llegó en ese campo del formulario.
 *
 * Se recogen todos los adjuntos y se elige aquí, en lugar de pedirle a Multer
 * uno concreto con FileInterceptor: cuando el campo no se llama como Multer
 * espera, éste lanza un error cuyo mensaje NestJS ya no reconoce —Multer 2.4
 * lo cambió a «Unexpected file field»—, y la petición acaba en un 500 en vez
 * de en un aviso. Eligiendo el campo nosotros, un nombre equivocado es
 * simplemente un adjunto que falta, y el servicio lo explica en castellano.
 */
function fileNamed(
  files: MultipartFile[] | undefined,
  field: string,
): MultipartFile | undefined {
  return files?.find((file) => file.fieldname === field);
}
