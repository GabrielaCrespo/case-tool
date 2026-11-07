import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type {
  ChatHistoryQuery,
  ChatMessageResponse,
  ChatQuestionInput,
} from './assistant.service.js';
import { AssistantService } from './assistant.service.js';

/**
 * CU12 — Consultar al Asistente de IA.
 * CU13 — Visualizar Conversaciones del Equipo.
 * CU15 — Delegar Ejecución de Tareas a la IA.
 *
 * El chat es del proyecto: lo leen y escriben su propietario y sus invitados.
 * Preguntar devuelve la pregunta guardada; la respuesta de la IA llega
 * después como otro mensaje. Cuando esa respuesta propone cambios, cualquiera
 * del equipo los aplica o los descarta.
 */
@Controller()
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('projects/:projectId/chat')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ChatHistoryQuery,
  ): Promise<ChatMessageResponse[]> {
    return this.assistant.list(user.id, projectId, query);
  }

  @Post('projects/:projectId/chat')
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: ChatQuestionInput,
  ): Promise<ChatMessageResponse> {
    return this.assistant.ask(user.id, projectId, body);
  }

  /** CU15 — Aplicar los cambios que propuso la IA, revalidándolos. */
  @Post('chat/:messageId/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<ChatMessageResponse> {
    return this.assistant.apply(user.id, messageId);
  }

  /** CU15 — Descartar los cambios que propuso la IA. */
  @Post('chat/:messageId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<ChatMessageResponse> {
    return this.assistant.reject(user.id, messageId);
  }
}
