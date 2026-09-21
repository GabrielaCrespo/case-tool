import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { XmiController } from './xmi.controller.js';
import { XmiService } from './xmi.service.js';

/**
 * CU06 — Gestionar el intercambio de diagramas mediante XMI.
 *
 * Como el resto de módulos que tocan el diagrama, no trae modelo propio: toma
 * de DiagramsModule los servicios con los que el editor crea clases y
 * relaciones, de modo que un diagrama importado es indistinguible de uno
 * dibujado a mano.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  controllers: [XmiController],
  providers: [XmiService],
})
export class XmiModule {}
