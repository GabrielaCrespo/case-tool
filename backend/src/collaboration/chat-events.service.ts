import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type { ChatEvent } from './collaboration-events.js';

/**
 * CU13 — Canal interno entre el chat del equipo y el gateway.
 *
 * El servicio del asistente avisa por aquí de cada mensaje que guarda y de
 * cuándo la IA empieza y termina de responder, y el gateway lo difunde a la
 * sala del proyecto. Es el mismo arreglo que DiagramEventsService, y por la
 * misma razón: el gateway ya depende de otros servicios, y que éstos
 * dependieran de él sería circular.
 */
@Injectable()
export class ChatEventsService {
  private readonly events = new Subject<ChatEvent>();

  /** Lo observa el gateway. */
  get events$(): Observable<ChatEvent> {
    return this.events.asObservable();
  }

  emit(event: ChatEvent): void {
    this.events.next(event);
  }
}
