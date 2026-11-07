import { describe, expect, it } from 'vitest';
import { AiExecutorService } from '../ai/ai-executor.service.js';
import type { LockState } from '../collaboration/collaboration-events.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { actionsFrom, lockConflicts, readStoredProposal } from './proposal.js';

/**
 * CU15 — Lo que la IA del chat propone, cómo se guarda y qué la frena.
 *
 * `plan` no escribe nada, así que el ejecutor se usa sin sus servicios, como
 * en ai-executor.spec.ts: lo que se prueba es la misma validación que CU04.
 */
const executor = new AiExecutorService(null as never, null as never);
const now = new Date().toISOString();

const diagram: FullDiagramResponse = {
  id: 'd1',
  project_id: 'p1',
  name: 'Ventas',
  description: null,
  created_by: 'u1',
  created_at: now,
  updated_at: now,
  classes: ['CLIENTE', 'NOTAVENTA', 'PRODUCTO'].map((name, index) => ({
    id: `c${index}`,
    diagram_id: 'd1',
    name,
    stereotype: null,
    is_abstract: false,
    visibility: 'public',
    pos_x: index * 300,
    pos_y: 0,
    width: null,
    height: null,
    created_at: now,
    updated_at: now,
    attributes: [],
    methods: [],
  })),
  relationships: [
    {
      id: 'r1',
      diagram_id: 'd1',
      source_class_id: 'c0',
      target_class_id: 'c1',
      relationship_type: 'ASSOCIATION',
      source_multiplicity: '1',
      target_multiplicity: '0..*',
      name: null,
      source_role: null,
      target_role: null,
      is_navigable_source: true,
      is_navigable_target: true,
      created_at: now,
      updated_at: now,
    },
  ],
};

function lock(type: 'class' | 'relationship', id: string, user: string, name: string): LockState {
  return { element_type: type, element_id: id, holder: { user_id: user, full_name: name, socket_id: `s-${user}` } };
}

/** Lo que el modelo devolvería al pedirle la entidad intermedia. */
const reply = {
  reply: 'Agrego DETALLENOTA entre NOTAVENTA y PRODUCTO.',
  actions: [
    { action: 'CREATE_CLASS', className: 'DETALLENOTA', attributes: [{ name: 'cantidad', type: 'Integer' }] },
    {
      action: 'CREATE_RELATIONSHIP',
      relationshipType: 'ASSOCIATION',
      sourceClass: 'NOTAVENTA',
      targetClasses: ['DETALLENOTA'],
      sourceMultiplicity: '1',
      targetMultiplicity: '1..*',
    },
    { action: 'ADD_ATTRIBUTE', className: 'PRODUCTO', attributes: [{ name: 'precio', type: 'BigDecimal' }] },
  ],
};

describe('actionsFrom', () => {
  it('lee las acciones de la respuesta con el mismo parser que CU04', () => {
    const { actions, problems } = actionsFrom(reply);

    expect(problems).toEqual([]);
    expect(actions.map((action) => action.action)).toEqual(['CREATE_CLASS', 'CREATE_RELATIONSHIP', 'ADD_ATTRIBUTE']);
  });

  it.each([[{ reply: 'sólo texto' }], [{ reply: 'x', actions: [] }], ['texto'], [null]])(
    'sin acciones no hay propuesta: %j',
    (value) => {
      expect(actionsFrom(value)).toEqual({ actions: [], problems: [] });
    },
  );

  it('lo ilegible se dice, no se ejecuta a medias', () => {
    const { problems } = actionsFrom({ reply: 'x', actions: [{ action: 'BORRAR_TODO' }] });

    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('la propuesta se valida como en CU04', () => {
  it('una propuesta correcta da un paso por acción, con su descripción', () => {
    const plan = executor.plan(diagram, actionsFrom(reply).actions, 'reject');

    expect(plan.rejections).toEqual([]);
    expect(plan.steps.map((step) => step.kind)).toEqual(['CREATE_CLASS', 'CREATE_RELATIONSHIP', 'ADD_ATTRIBUTE']);
    expect(plan.steps.every((step) => step.description.length > 0)).toBe(true);
  });

  it('una propuesta vieja —la clase ya existe— se rechaza con el motivo', () => {
    const stale: FullDiagramResponse = {
      ...diagram,
      classes: [...diagram.classes, { ...diagram.classes[0], id: 'c9', name: 'DETALLENOTA' }],
    };

    expect(executor.plan(stale, actionsFrom(reply).actions, 'reject').rejections.length).toBeGreaterThan(0);
  });
});

describe('readStoredProposal', () => {
  it('devuelve lo guardado', () => {
    const stored = { actions: actionsFrom(reply).actions, summary: ['Crear DETALLENOTA'] };

    expect(readStoredProposal(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it.each([[null], [{ actions: [] }], [{ summary: [] }], ['x']])('rechaza lo que no tiene la forma: %j', (value) => {
    expect(readStoredProposal(value)).toBeNull();
  });
});

describe('lockConflicts', () => {
  const steps = executor.plan(diagram, actionsFrom(reply).actions, 'reject').steps;

  it('sin bloqueos, nada lo frena', () => {
    expect(lockConflicts(steps, diagram, [], 'u1')).toEqual([]);
  });

  it('la clase que se modifica, tomada por otra persona, lo frena y dice quién', () => {
    expect(lockConflicts(steps, diagram, [lock('class', 'c2', 'u2', 'Ana')], 'u1')).toEqual([
      'Ana está editando PRODUCTO',
    ]);
  });

  it('un bloqueo propio no frena', () => {
    expect(lockConflicts(steps, diagram, [lock('class', 'c2', 'u1', 'Luis')], 'u1')).toEqual([]);
  });

  it('una clase que sólo se relaciona, sin modificarse, no frena (como en CU02)', () => {
    expect(lockConflicts(steps, diagram, [lock('class', 'c1', 'u2', 'Ana')], 'u1')).toEqual([]);
  });

  it('borrar una clase choca con quien edita una relación suya', () => {
    const deletion = executor.plan(diagram, [{ action: 'DELETE_CLASS', className: 'CLIENTE' }], 'reject').steps;

    expect(lockConflicts(deletion, diagram, [lock('relationship', 'r1', 'u2', 'Ana')], 'u1')).toEqual([
      'Ana está editando la relación CLIENTE—NOTAVENTA',
    ]);
  });
});
