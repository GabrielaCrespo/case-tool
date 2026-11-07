/**
 * CU12 — Una pregunta a la vez por proyecto.
 *
 * El plan gratuito de Gemini admite pocas peticiones por minuto, y en un chat
 * compartido varias personas pueden preguntar a la vez. En lugar de lanzar
 * todas y que fallen por cuota, las de un mismo proyecto esperan su turno; las
 * de proyectos distintos no se esperan entre sí.
 *
 * Vive en memoria, como los bloqueos de CU03: si el backend se reinicia, las
 * preguntas que esperaban se quedan sin respuesta, pero siguen guardadas en el
 * chat y se pueden volver a hacer.
 */
export class ProjectQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly counts = new Map<string, number>();

  constructor(private readonly maxPending: number) {}

  /** Cuántas tareas del proyecto esperan o se están haciendo. */
  pending(projectId: string): number {
    return this.counts.get(projectId) ?? 0;
  }

  /** Si cabe una tarea más en la cola del proyecto. */
  hasRoom(projectId: string): boolean {
    return this.pending(projectId) < this.maxPending;
  }

  /**
   * Pone la tarea a la cola del proyecto. Devuelve false, sin encolarla, si
   * ya hay demasiadas esperando. Un fallo de una tarea no detiene las demás:
   * cada tarea es responsable de sus propios errores, y lo que se le escape
   * se entrega a `onError`.
   */
  enqueue(projectId: string, task: () => Promise<void>, onError: (error: unknown) => void): boolean {
    if (!this.hasRoom(projectId)) {
      return false;
    }

    this.counts.set(projectId, this.pending(projectId) + 1);

    const previous = this.tails.get(projectId) ?? Promise.resolve();
    const current = previous
      .then(task)
      .catch(onError)
      .finally(() => {
        const left = this.pending(projectId) - 1;
        if (left > 0) {
          this.counts.set(projectId, left);
        } else {
          this.counts.delete(projectId);
        }
        if (this.tails.get(projectId) === current) {
          this.tails.delete(projectId);
        }
      });

    this.tails.set(projectId, current);
    return true;
  }
}
