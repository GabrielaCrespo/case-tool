import { describe, expect, it } from 'vitest';
import { ProjectQueue } from './project-queue.js';

/** CU12 — Las preguntas de un proyecto se responden de una en una. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

const ignore = () => undefined;

describe('ProjectQueue', () => {
  it('no empieza la segunda pregunta de un proyecto hasta que termina la primera', async () => {
    const queue = new ProjectQueue(5);
    const first = deferred();
    const order: string[] = [];

    queue.enqueue('p1', async () => { order.push('empieza 1'); await first.promise; order.push('acaba 1'); }, ignore);
    queue.enqueue('p1', async () => { order.push('empieza 2'); }, ignore);

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['empieza 1']);
    expect(queue.pending('p1')).toBe(2);

    first.resolve();
    await new Promise((done) => setTimeout(done, 0));

    expect(order).toEqual(['empieza 1', 'acaba 1', 'empieza 2']);
    expect(queue.pending('p1')).toBe(0);
  });

  it('dos proyectos no se esperan entre sí', async () => {
    const queue = new ProjectQueue(5);
    const blocked = deferred();
    const started: string[] = [];

    queue.enqueue('p1', async () => { started.push('p1'); await blocked.promise; }, ignore);
    queue.enqueue('p2', async () => { started.push('p2'); }, ignore);
    await new Promise((done) => setTimeout(done, 0));

    expect(started).toEqual(['p1', 'p2']);
    blocked.resolve();
  });

  it('rechaza una pregunta más cuando la cola está llena', () => {
    const queue = new ProjectQueue(2);
    const never = deferred();

    expect(queue.enqueue('p1', () => never.promise, ignore)).toBe(true);
    expect(queue.enqueue('p1', () => never.promise, ignore)).toBe(true);
    expect(queue.hasRoom('p1')).toBe(false);
    expect(queue.enqueue('p1', () => never.promise, ignore)).toBe(false);
    expect(queue.pending('p1')).toBe(2);
  });

  it('un fallo no detiene las preguntas siguientes', async () => {
    const queue = new ProjectQueue(5);
    const errors: unknown[] = [];
    let second = false;

    queue.enqueue('p1', () => Promise.reject(new Error('cuota')), (error) => errors.push(error));
    queue.enqueue('p1', async () => { second = true; }, (error) => errors.push(error));
    await new Promise((done) => setTimeout(done, 0));

    expect(errors).toHaveLength(1);
    expect(second).toBe(true);
    expect(queue.pending('p1')).toBe(0);
  });
});
