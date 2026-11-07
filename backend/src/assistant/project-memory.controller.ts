import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type {
  MemoryEntryInput,
  MemoryEntryResponse,
  ProjectMemoryResponse,
} from './project-memory.service.js';
import { ProjectMemoryService } from './project-memory.service.js';

/**
 * CU14 — Gestionar Memoria del Proyecto (Propietario).
 *
 * La lee cualquiera del equipo; la crea, cambia y borra el propietario, que es
 * también quien pide a la IA que resuma la conversación del chat.
 */
@Controller()
@UseGuards(AuthGuard)
export class ProjectMemoryController {
  constructor(private readonly memory: ProjectMemoryService) {}

  @Get('projects/:projectId/memory')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectMemoryResponse> {
    return this.memory.get(user.id, projectId);
  }

  @Post('projects/:projectId/memory')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: MemoryEntryInput,
  ): Promise<MemoryEntryResponse> {
    return this.memory.create(user.id, projectId, body);
  }

  /** La IA resume lo nuevo del chat y lo guarda como entrada SUMMARY. */
  @Post('projects/:projectId/memory/summary')
  summarize(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<MemoryEntryResponse> {
    return this.memory.summarize(user.id, projectId);
  }

  @Patch('memory/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MemoryEntryInput,
  ): Promise<MemoryEntryResponse> {
    return this.memory.update(user.id, id, body);
  }

  @Delete('memory/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.memory.remove(user.id, id);
  }
}
