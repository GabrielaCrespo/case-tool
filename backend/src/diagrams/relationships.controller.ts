import {
  Body,
  Controller,
  Delete,
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
import type { RelationshipResponse } from './diagrams.service.js';
import type {
  AssociationClassInput,
  AssociationClassResponse,
  RelationshipInput,
} from './relationships.service.js';
import { RelationshipsService } from './relationships.service.js';

/** CU02 — Relaciones entre clases y sus multiplicidades. */
@Controller()
@UseGuards(AuthGuard)
export class RelationshipsController {
  constructor(private readonly relationshipsService: RelationshipsService) {}

  @Post('diagrams/:diagramId/relationships')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Body() body: RelationshipInput,
  ): Promise<RelationshipResponse> {
    return this.relationshipsService.create(user.id, diagramId, body);
  }

  @Patch('relationships/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RelationshipInput,
  ): Promise<RelationshipResponse> {
    return this.relationshipsService.update(user.id, id, body);
  }

  /** Une dos clases con una clase intermedia y sus dos asociaciones 1:0..*. */
  @Post('diagrams/:diagramId/association-classes')
  createAssociationClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Body() body: AssociationClassInput,
  ): Promise<AssociationClassResponse> {
    return this.relationshipsService.createAssociationClass(user.id, diagramId, body);
  }

  @Delete('relationships/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.relationshipsService.remove(user.id, id);
  }
}
