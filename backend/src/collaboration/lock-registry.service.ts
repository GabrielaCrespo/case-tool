import { ConflictException, Injectable } from '@nestjs/common';
import type { LockableType, LockHolder, LockState } from './collaboration-events.js';

interface StoredLock extends LockState {
  diagram_id: string;
}

/**
 * CU03 — Exclusión mutua sobre los elementos del diagrama.
 *
 * Mientras alguien tiene seleccionada una clase o una relación, la toma; el
 * resto la ve bloqueada y la API rechaza sus escrituras sobre ella. Los
 * bloqueos viven en memoria a propósito: describen quién está editando *ahora*
 * y no deben sobrevivir a un reinicio del servidor ni ensuciar PostgreSQL.
 *
 * Los identificadores son UUID, así que basta con una clave por elemento; el
 * diagrama se guarda para poder listar los bloqueos de una sala.
 */
@Injectable()
export class LockRegistryService {
  private readonly locks = new Map<string, StoredLock>();

  private key(elementType: LockableType, elementId: string): string {
    return `${elementType}:${elementId}`;
  }

  /**
   * Toma el elemento. Si ya lo tiene el mismo usuario (por ejemplo en otra
   * pestaña) se le renueva; si lo tiene otro, no se concede.
   */
  acquire(
    diagramId: string,
    elementType: LockableType,
    elementId: string,
    holder: LockHolder,
  ): { granted: boolean; lock: StoredLock } {
    const key = this.key(elementType, elementId);
    const current = this.locks.get(key);

    if (current && current.holder.user_id !== holder.user_id) {
      return { granted: false, lock: current };
    }

    const lock: StoredLock = {
      diagram_id: diagramId,
      element_type: elementType,
      element_id: elementId,
      holder,
    };
    this.locks.set(key, lock);

    return { granted: true, lock };
  }

  /** Suelta el elemento si lo tenía este socket. */
  release(elementType: LockableType, elementId: string, socketId: string): StoredLock | null {
    const key = this.key(elementType, elementId);
    const current = this.locks.get(key);

    if (!current || current.holder.socket_id !== socketId) {
      return null;
    }
    this.locks.delete(key);

    return current;
  }

  /** Al desconectarse un usuario se sueltan todos sus elementos. */
  releaseAllFor(socketId: string): StoredLock[] {
    const released: StoredLock[] = [];

    for (const [key, lock] of this.locks) {
      if (lock.holder.socket_id === socketId) {
        this.locks.delete(key);
        released.push(lock);
      }
    }

    return released;
  }

  listByDiagram(diagramId: string): LockState[] {
    return [...this.locks.values()].filter((lock) => lock.diagram_id === diagramId);
  }

  /**
   * Comprueba que el usuario puede escribir sobre el elemento. Lo usan los
   * servicios de CU02 antes de guardar, de modo que la exclusión mutua es real
   * y no sólo un aviso en la interfaz.
   */
  assertCanEdit(elementType: LockableType, elementId: string, userId: string): void {
    const current = this.locks.get(this.key(elementType, elementId));

    if (current && current.holder.user_id !== userId) {
      throw new ConflictException(
        `${current.holder.full_name} está editando este elemento en este momento.`,
      );
    }
  }
}
