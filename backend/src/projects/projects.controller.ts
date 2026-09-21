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
  ProjectInput,
  ProjectMemberResponse,
  ProjectResponse,
} from './projects.service.js';
import { ProjectsService } from './projects.service.js';

/**
 * CU01 — Gestionar Proyecto de Diseño.
 * Cada endpoint es una operación técnica de este único caso de uso.
 *
 * Todas las rutas exigen un usuario autenticado: el propietario sale siempre
 * del token, nunca del cuerpo de la petición.
 */
@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ProjectInput,
  ): Promise<ProjectResponse> {
    return this.projectsService.create(user.id, body);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ProjectResponse[]> {
    return this.projectsService.findAll(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponse> {
    return this.projectsService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ProjectInput,
  ): Promise<ProjectResponse> {
    return this.projectsService.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.projectsService.remove(user.id, id);
  }

  // ------------------------------------------------------------------ CU03
  // Invitar a otras personas es lo que hace posible la colaboración: sin
  // miembros, un diagrama sólo lo puede abrir su propietario.

  @Get(':id/members')
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectMemberResponse[]> {
    return this.projectsService.listMembers(user.id, id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { email?: unknown },
  ): Promise<ProjectMemberResponse> {
    return this.projectsService.addMember(user.id, id, body);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
  ): Promise<void> {
    return this.projectsService.removeMember(user.id, id, memberUserId);
  }
}
