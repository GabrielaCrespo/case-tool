import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { AiExecutorService } from './ai-executor.service.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { GroqService } from './groq.service.js';

/**
 * CU04 — Asistir el Diseño mediante IA (por texto y por voz).
 * CU05 — Generar Diagrama desde Imagen.
 *
 * El módulo no aporta modelo propio: toma prestados de DiagramsModule los
 * mismos servicios con los que edita el lienzo, de modo que lo que hace el
 * asistente es indistinguible de lo que haría el usuario a mano —incluidos
 * los avisos a la sala de CU03 y las validaciones de CU02—.
 *
 * Las tres entradas —texto, voz e imagen— se distinguen sólo en cómo llegan.
 * Las tres las atiende el mismo cliente (GroqService: un modelo para el texto,
 * uno multimodal para la imagen y Whisper para el audio) y a partir de ahí
 * comparten intérprete, normalización, validación y ejecución.
 *
 * Ni el audio ni la imagen se guardan: se usan una vez, en la petición en la
 * que llegan, y se descartan.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  controllers: [AiController],
  providers: [AiService, AiExecutorService, GroqService],
  // CU15 — El chat del equipo aplica sus propuestas con este mismo ejecutor:
  // la misma validación y los mismos servicios que una instrucción de CU04.
  exports: [AiExecutorService],
})
export class AiModule {}
