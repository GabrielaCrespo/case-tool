import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { CollaborationGateway } from './collaboration.gateway.js';

/**
 * CU03 — Colaborar en el Diseño del Diagrama.
 *
 * Reutiliza AuthModule para validar el token del handshake y DiagramsModule
 * para comprobar que quien entra a la sala puede abrir ese diagrama. El estado
 * en memoria llega por RealtimeStateModule, que es global.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  providers: [CollaborationGateway],
})
export class CollaborationModule {}
