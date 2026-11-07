import { Global, Module } from '@nestjs/common';
import { ChatEventsService } from './chat-events.service.js';
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
 *
 * CU13 añade el canal del chat del equipo, por la misma razón: lo usan el
 * asistente (que avisa) y el gateway (que difunde a la sala del proyecto).
 */
@Global()
@Module({
  providers: [DiagramEventsService, LockRegistryService, ChatEventsService],
  exports: [DiagramEventsService, LockRegistryService, ChatEventsService],
})
export class RealtimeStateModule {}
