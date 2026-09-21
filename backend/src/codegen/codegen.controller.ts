import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { CodegenJobResponse } from './codegen.service.js';
import { CodegenService } from './codegen.service.js';

/**
 * CU07 — Generar Backend y CU08 — Descargar Backend.
 *
 * Los dos cuelgan del diagrama, que es de donde sale el backend. Generar
 * devuelve el trabajo en marcha y no el resultado, porque compilar un proyecto
 * Spring Boot lleva su tiempo: el cliente pregunta después por el estado hasta
 * que el trabajo termina, y sólo entonces tiene sentido descargar.
 */
@Controller()
@UseGuards(AuthGuard)
export class CodegenController {
  constructor(private readonly codegenService: CodegenService) {}

  /** CU07 — Genera el backend a partir del modelo UML guardado. */
  @Post('diagrams/:id/backend')
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CodegenJobResponse> {
    return this.codegenService.generate(user.id, id);
  }

  /** Estado de la última generación: es lo que el cliente consulta mientras espera. */
  @Get('diagrams/:id/backend')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CodegenJobResponse | null> {
    return this.codegenService.findLatest(user.id, id);
  }

  /** CU08 — El proyecto generado, comprimido, con su cabecera de descarga. */
  @Get('diagrams/:id/backend/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { fileName, path } = await this.codegenService.download(user.id, id);

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // El nombre viaja también en una cabecera propia: fetch no puede leer
    // Content-Disposition si el servidor no la expone. Igual que en CU06.
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-File-Name');
    response.setHeader('X-File-Name', fileName);

    return new StreamableFile(createReadStream(path));
  }
}
