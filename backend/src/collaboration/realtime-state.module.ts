import { Global, Module } from '@nestjs/common';
import { DiagramEventsService } from './diagram-events.service.js';
import { LockRegistryService } from './lock-registry.service.js';

/**
 * CU03 — Estado en memoria de la colaboración: el canal de cambios y el
 * registro de bloqueos.
 *
 * Va en su propio módulo, sin dependencias, porque lo necesitan dos lados que
 * ya dependen entre sí: los servicios de CU02 (que avisan de cada cambio y
 * consultan los bloqueos antes de escribir) y el gateway de CU03 (que difunde y
 * concede). Así ninguno tiene que importar al otro.
 */
@Global()
@Module({
  providers: [DiagramEventsService, LockRegistryService],
  exports: [DiagramEventsService, LockRegistryService],
})
export class RealtimeStateModule {}
