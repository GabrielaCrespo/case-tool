import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UploadedFile, XmiImportResult } from './xmi.service.js';
import { MAX_XMI_BYTES, XmiService } from './xmi.service.js';

/**
 * CU06 — Gestionar el intercambio de diagramas mediante XMI.
 *
 * Exportar devuelve el archivo tal cual, con su cabecera de descarga, para que
 * el navegador lo guarde sin que el cliente tenga que construirlo. Importar
 * recibe el archivo y crea un diagrama nuevo dentro del proyecto.
 */
@Controller()
@UseGuards(AuthGuard)
export class XmiController {
  constructor(private readonly xmiService: XmiService) {}

  /** El diagrama como archivo .xmi, listo para abrir en otra herramienta. */
  @Get('diagrams/:id/xmi')
  @Header('Content-Type', 'application/vnd.xmi+xml; charset=utf-8')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { fileName, xmi } = await this.xmiService.export(user.id, id);

    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    // El nombre del archivo viaja también aquí: fetch no puede leer
    // Content-Disposition si el servidor no la expone.
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-File-Name');
    response.setHeader('X-File-Name', fileName);

    return xmi;
  }

  /**
   * Crea un diagrama nuevo con el contenido de un archivo XMI.
   * Cuelga del proyecto, como cualquier alta: nunca pisa un diagrama abierto.
   */
  @Post('projects/:projectId/diagrams/import-xmi')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: MAX_XMI_BYTES, files: 1 } }))
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @Body() body: { name?: unknown },
  ): Promise<XmiImportResult> {
    // Se elige el campo aquí en vez de pedírselo a Multer: así un campo con
    // otro nombre es «falta el archivo» y no un error sin controlar.
    const file = files?.find((candidate) => candidate.fieldname === 'file') ?? files?.[0];

    return this.xmiService.import(user.id, projectId, file, body?.name);
  }
}
