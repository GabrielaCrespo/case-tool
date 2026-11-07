import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { AiSettingsController } from './ai-settings.controller.js';
import { AiSettingsService } from './ai-settings.service.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ChatLlmClient } from './chat-llm-client.js';
import { ProjectMemoryController } from './project-memory.controller.js';
import { ProjectMemoryService } from './project-memory.service.js';

/**
 * Segundo parcial — la IA como integrante del equipo (CU11–CU15).
 *
 * CU11 — Configurar Servicio de IA: qué modelo atiende el chat y dónde.
 * CU12 — Consultar al Asistente de IA, con el contexto del proyecto.
 * CU13 — Visualizar Conversaciones del Equipo (el aviso a la sala lo da el
 *        gateway de CU03 con ChatEventsService).
 * CU14 — Gestionar Memoria del Proyecto: lo que la IA recuerda del proyecto.
 * CU15 — Delegar Ejecución de Tareas a la IA.
 *
 * El chat tiene su propio cliente (ChatLlmClient) y no usa el de AiModule: CU04,
 * CU05 y el dictado siguen con Groq y sus prompts afinados, y el chat se puede
 * llevar a otro servidor sin tocarlos. Lo que sí comparte es lo que escribe en
 * el diagrama: el ejecutor de AiModule y, a través de él, los servicios de
 * DiagramsModule, así que un cambio de la IA es indistinguible de uno hecho a
 * mano —validación, bloqueos y aviso a la sala incluidos—.
 */
@Module({
  // AuthModule aporta el AuthGuard que protege estas rutas.
  imports: [AuthModule, DiagramsModule, AiModule],
  controllers: [AiSettingsController, AssistantController, ProjectMemoryController],
  providers: [AiSettingsService, AssistantService, ProjectMemoryService, ChatLlmClient],
})
export class AssistantModule {}
