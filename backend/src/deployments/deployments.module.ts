import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { DeploymentsController } from './deployments.controller.js';
import { DeploymentsService } from './deployments.service.js';

/**
 * Publicar el backend generado.
 *
 * Va aparte de CodegenModule aunque continúe su trabajo, porque son dos cosas
 * distintas: generar escribe un proyecto y lo compila, y publicar lo pone a
 * correr en una máquina. Lo segundo sólo funciona donde hay un Docker a mano,
 * mientras que lo primero funciona en cualquier portátil.
 *
 * De DiagramsModule toma el mismo control de acceso que el resto: quien no
 * puede ver un diagrama tampoco puede publicarlo ni darlo de baja.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  controllers: [DeploymentsController],
  providers: [DeploymentsService],
})
export class DeploymentsModule {}
