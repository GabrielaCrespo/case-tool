import type { PlannedStep } from '../ai/ai-executor.service.js';
import type { RawAction } from '../ai/uml-actions.js';
import { fold, parseActions } from '../ai/uml-actions.js';
import type { LockState } from '../collaboration/collaboration-events.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';

/**
 * CU15 — Delegar Ejecución de Tareas a la IA: las propuestas de cambio.
 *
 * La IA del chat habla el mismo idioma de acciones que el asistente de CU04
 * (uml-actions.ts) y sus propuestas pasan por el mismo ejecutor: se validan
 * con `plan` contra el diagrama y se aplican con `apply`, a través de los
 * mismos servicios que usa el lienzo. Aquí están las piezas puras de ese
 * camino, para poder probarlas sin base ni modelo.
 */

/** Lo que se guarda en chat_messages.proposed_actions. */
export interface StoredProposal {
  /** Las acciones tal como se leyeron: se vuelven a validar al aplicarlas. */
  actions: RawAction[];
  /** Qué hará cada paso, en castellano, para la tarjeta del chat. */
  summary: string[];
}

/**
 * Las acciones que trae la respuesta del modelo. Sin lista, o con una vacía,
 * no hay propuesta; lo que no se pueda leer se devuelve como problema, igual
 * que en CU04, en lugar de ejecutar a medias.
 */
export function actionsFrom(value: unknown): { actions: RawAction[]; problems: string[] } {
  const list =
    value !== null && typeof value === 'object' ? (value as { actions?: unknown }).actions : undefined;

  if (!Array.isArray(list) || list.length === 0) {
    return { actions: [], problems: [] };
  }

  const parsed = parseActions({ actions: list });
  return {
    actions: parsed.actions,
    problems: parsed.error === null ? parsed.problems : [parsed.error, ...parsed.problems],
  };
}

/** Lee lo guardado en proposed_actions, o null si no tiene la forma esperada. */
export function readStoredProposal(value: unknown): StoredProposal | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const { actions, summary } = value as { actions?: unknown; summary?: unknown };

  if (!Array.isArray(actions) || !Array.isArray(summary)) {
    return null;
  }
  return {
    actions: actions as RawAction[],
    summary: summary.filter((line): line is string => typeof line === 'string'),
  };
}

/**
 * Qué elementos que toca el plan tiene tomados otra persona (CU03).
 *
 * Se mira antes de aplicar y no se deja que lo descubra `apply` a mitad de
 * camino: los pasos se ejecutan de uno en uno, y chocar con un bloqueo en el
 * tercero dejaría aplicados los dos primeros. Sólo cuentan los mismos
 * elementos que comprueban los servicios de CU02 al escribir: la clase que se
 * modifica, borra o mueve, y la relación que se modifica o se borra (también
 * las que se lleva por delante el borrado de una clase).
 */
export function lockConflicts(
  steps: PlannedStep[],
  diagram: FullDiagramResponse,
  locks: LockState[],
  actorId: string,
): string[] {
  const classIdByName = new Map(diagram.classes.map((umlClass) => [fold(umlClass.name), umlClass.id]));
  const classNameById = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name]));
  const touchedClasses = new Set<string>();
  const touchedRelationships = new Set<string>();

  const touchClass = (name: string) => {
    const id = classIdByName.get(fold(name));
    if (id !== undefined) touchedClasses.add(id);
  };

  for (const step of steps) {
    switch (step.kind) {
      case 'UPDATE_CLASS':
      case 'MOVE_CLASS':
        touchClass(step.name);
        break;
      case 'DELETE_CLASS': {
        touchClass(step.name);
        const id = classIdByName.get(fold(step.name));
        for (const relationship of diagram.relationships) {
          if (relationship.source_class_id === id || relationship.target_class_id === id) {
            touchedRelationships.add(relationship.id);
          }
        }
        break;
      }
      case 'ADD_ATTRIBUTE':
      case 'UPDATE_ATTRIBUTE':
      case 'DELETE_ATTRIBUTE':
        touchClass(step.className);
        break;
      case 'UPDATE_RELATIONSHIP':
      case 'DELETE_RELATIONSHIP':
        touchedRelationships.add(step.relationshipId);
        break;
      default:
        break;
    }
  }

  const conflicts = new Set<string>();
  for (const lock of locks) {
    if (lock.holder.user_id === actorId) continue;

    if (lock.element_type === 'class' && touchedClasses.has(lock.element_id)) {
      conflicts.add(`${lock.holder.full_name} está editando ${classNameById.get(lock.element_id) ?? 'una clase'}`);
    }
    if (lock.element_type === 'relationship' && touchedRelationships.has(lock.element_id)) {
      const relationship = diagram.relationships.find((candidate) => candidate.id === lock.element_id);
      const ends = relationship
        ? `${classNameById.get(relationship.source_class_id) ?? '?'}—${classNameById.get(relationship.target_class_id) ?? '?'}`
        : '';
      conflicts.add(`${lock.holder.full_name} está editando la relación ${ends}`.trim());
    }
  }

  return [...conflicts];
}
