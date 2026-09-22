import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { DeploymentResponse } from './deployments.service.js';
import { DeploymentsService } from './deployments.service.js';

/**
 * Publicar el backend generado de un diagrama.
 *
 * Cuelga del diagrama porque es de donde sale el backend, igual que generar y
 * descargar. Publicar devuelve el despliegue en marcha y no el resultado:
 * construir la imagen y arrancar el contenedor lleva minutos, así que el
 * cliente pregunta después por el estado hasta que termina.
 */
@Controller()
@UseGuards(AuthGuard)
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  /** Publica; reemplaza el despliegue anterior del mismo diagrama si lo había. */
  @Post('diagrams/:id/deployment')
  deploy(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentResponse> {
    return this.deploymentsService.deploy(user.id, id);
  }

  /** Estado actual: es lo que el cliente consulta mientras espera. */
  @Get('diagrams/:id/deployment')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentResponse | null> {
    return this.deploymentsService.find(user.id, id);
  }

  /** Las últimas líneas del contenedor, que es lo que explica un fallo. */
  @Get('diagrams/:id/deployment/logs')
  logs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ lines: string }> {
    return this.deploymentsService.logs(user.id, id);
  }

  /** Da de baja: para el contenedor y borra su base de datos. */
  @Delete('diagrams/:id/deployment')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeploymentResponse> {
    return this.deploymentsService.remove(user.id, id);
  }
}
