import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import type { DiagramChange } from './collaboration-events.js';

/**
 * CU03 — Canal interno entre los servicios de CU02 y el gateway.
 *
 * Los servicios avisan por aquí de cada cambio que han guardado, y el gateway
 * lo difunde a la sala. Se hace con este intermediario, y no inyectando el
 * gateway en los servicios, porque el gateway ya depende de ellos para
 * comprobar permisos: la dependencia directa sería circular.
 */
@Injectable()
export class DiagramEventsService {
  private readonly changes = new Subject<DiagramChange>();

  /** Lo observa el gateway. */
  get changes$(): Observable<DiagramChange> {
    return this.changes.asObservable();
  }

  emit(change: DiagramChange): void {
    this.changes.next(change);
  }
}
