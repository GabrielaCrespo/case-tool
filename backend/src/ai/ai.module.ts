import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { AiExecutorService } from './ai-executor.service.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { CloudinaryService } from './cloudinary.service.js';
import { OllamaService } from './ollama.service.js';
import { SpeechToTextService } from './speech-to-text.service.js';

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
 * Cada una tiene su traductor (Whisper para la voz, Qwen3-VL para la imagen) y
 * a partir de ahí comparten intérprete, normalización, validación y ejecución.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiExecutorService,
    OllamaService,
    CloudinaryService,
    SpeechToTextService,
  ],
})
export class AiModule {}
