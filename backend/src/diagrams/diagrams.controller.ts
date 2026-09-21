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
import type { ExchangeDocument } from './diagram-exchange.service.js';
import { DiagramExchangeService } from './diagram-exchange.service.js';
import type { DiagramValidationResponse } from './diagram-validator.js';
import type {
  DiagramInput,
  DiagramResponse,
  FullDiagramResponse,
} from './diagrams.service.js';
import { DiagramsService } from './diagrams.service.js';

/**
 * CU02 — Diseñar Diagrama de Clases UML: el diagrama en sí.
 * Las rutas cuelgan del proyecto al crear y listar, y del diagrama para el
 * resto, por eso el controller no declara un prefijo común.
 */
@Controller()
@UseGuards(AuthGuard)
export class DiagramsController {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly exchangeService: DiagramExchangeService,
  ) {}

  @Post('projects/:projectId/diagrams')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: DiagramInput,
  ): Promise<DiagramResponse> {
    return this.diagramsService.create(user.id, projectId, body);
  }

  @Get('projects/:projectId/diagrams')
  findAllByProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<DiagramResponse[]> {
    return this.diagramsService.findAllByProject(user.id, projectId);
  }

  /** Diagrama completo: clases con atributos y métodos, más las relaciones. */
  @Get('diagrams/:id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FullDiagramResponse> {
    return this.diagramsService.findOneFull(user.id, id);
  }

  /**
   * El diagrama en el formato de intercambio, para guardarlo como archivo.
   * Se lee del modelo guardado; no interviene ninguna IA.
   */
  @Get('diagrams/:id/export')
  export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExchangeDocument> {
    return this.exchangeService.export(user.id, id);
  }

  /**
   * Crea un diagrama nuevo a partir de un archivo exportado antes.
   * Nunca sobrescribe uno existente: cuelga del proyecto, como cualquier alta.
   */
  @Post('projects/:projectId/diagrams/import')
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: { document?: unknown; name?: unknown },
  ): Promise<FullDiagramResponse> {
    // Se admite el documento envuelto en «document» o suelto en el cuerpo:
    // lo segundo es lo que sale de leer el archivo tal cual.
    return this.exchangeService.import(
      user.id,
      projectId,
      body?.document ?? body,
      body?.name,
    );
  }

  /** Validación del modelo completo: lo que CU07 exigirá antes de generar. */
  @Get('diagrams/:id/validation')
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DiagramValidationResponse> {
    return this.diagramsService.validate(user.id, id);
  }

  @Patch('diagrams/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DiagramInput,
  ): Promise<DiagramResponse> {
    return this.diagramsService.update(user.id, id, body);
  }

  @Delete('diagrams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.diagramsService.remove(user.id, id);
  }
}
