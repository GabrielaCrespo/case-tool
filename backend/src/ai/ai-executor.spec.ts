import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { AiExecutorService } from './ai-executor.service.js';
import type { RawAction } from './uml-actions.js';

/**
 * CU04/CU05 — Qué se rechaza y qué se deja pasar.
 *
 * `plan` comprueba las acciones contra una copia en memoria del diagrama y no
 * escribe nada, así que para probarlo no hace falta ni PostgreSQL ni los dos
 * servicios que sólo usa `apply`.
 *
 * Lo que se comprueba aquí es la diferencia entre los dos casos de uso, que es
 * la misma decisión tomada dos veces: dictando (CU04) se puede volver a
 * preguntar, así que lo dudoso rechaza la instrucción; leyendo una foto (CU05)
 * no hay a quién preguntar, así que lo dudoso se deja sin indicar y se avisa.
 */
const executor = new AiExecutorService(null as never, null as never);

function diagramWith(...names: string[]): FullDiagramResponse {
  const now = new Date().toISOString();

  return {
    id: 'd',
    project_id: 'p',
    name: 'Diagrama',
    description: null,
    created_by: 'u',
    created_at: now,
    updated_at: now,
    classes: names.map((name, index) => ({
      id: `c${index}`,
      diagram_id: 'd',
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
    relationships: [],
  };
}

/** La relación que la IA leyó en la imagen del gimnasio, con su «*..0». */
const imposible: RawAction = {
  action: 'CREATE_RELATIONSHIP',
  relationshipType: 'ASSOCIATION',
  sourceClass: 'EJERCICIO',
  targetClasses: ['EJERCICIO_GRUPO_MUSCULAR'],
  sourceMultiplicity: '*..0',
  targetMultiplicity: '1',
  name: null,
};

describe('CU05 — una lectura dudosa no tumba la importación', () => {
  const diagram = diagramWith('EJERCICIO', 'EJERCICIO_GRUPO_MUSCULAR');

  it('guarda la relación dejando sin indicar el extremo imposible', () => {
    const plan = executor.plan(diagram, [imposible], 'keep-null');

    expect(plan.rejections).toEqual([]);
    expect(plan.steps).toHaveLength(1);

    const step = plan.steps[0];
    expect(step.kind).toBe('CREATE_RELATIONSHIP');
    if (step.kind !== 'CREATE_RELATIONSHIP') return;

    expect(step.sourceMultiplicity).toBeNull();
    // El extremo que sí era legible se conserva.
    expect(step.targetMultiplicity).toBe('1');
    expect(plan.warnings.join(' ')).toContain('*..0');
  });

  it('salta una línea hacia una clase que no se importó, sin perder las demás', () => {
    const plan = executor.plan(
      diagram,
      [
        { ...imposible, targetClasses: ['CLASE_QUE_NO_EXISTE'] },
        {
          action: 'CREATE_RELATIONSHIP',
          relationshipType: 'ASSOCIATION',
          sourceClass: 'EJERCICIO',
          targetClasses: ['EJERCICIO_GRUPO_MUSCULAR'],
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
          name: null,
        },
      ],
      'keep-null',
    );

    expect(plan.rejections).toEqual([]);
    expect(plan.steps).toHaveLength(1);
  });
});

describe('CU04 — una instrucción dudosa se rechaza', () => {
  const diagram = diagramWith('EJERCICIO', 'EJERCICIO_GRUPO_MUSCULAR');

  it('no crea nada cuando la multiplicidad no es válida', () => {
    const plan = executor.plan(diagram, [imposible], 'reject');

    expect(plan.steps).toEqual([]);
    expect(plan.rejections.join(' ')).toContain('*..0');
  });
});

describe('CU04/CU05 — la clave primaria no se añade como atributo', () => {
  /**
   * Es el caso corriente: se dicta «crea Cliente con id, nombre y correo», o la
   * foto trae dibujada la columna «id». La clave primaria la pone la
   * herramienta en toda entidad, así que ese atributo se descarta con un aviso
   * en lugar de rechazar la instrucción entera.
   */
  const conId: RawAction = {
    action: 'CREATE_CLASS',
    className: 'Cliente',
    attributes: [
      { name: 'id', type: 'Long' },
      { name: 'nombre', type: 'String' },
    ],
    position: null,
  };

  it('crea la clase con los demás atributos y lo dice', () => {
    const plan = executor.plan(diagramWith(), [conId], 'reject');

    expect(plan.rejections).toEqual([]);
    expect(plan.steps).toHaveLength(1);

    const step = plan.steps[0];
    expect(step.kind).toBe('CREATE_CLASS');
    if (step.kind !== 'CREATE_CLASS') return;

    expect(step.attributes.map((attribute) => attribute.name)).toEqual(['nombre']);
    expect(plan.warnings.join(' ')).toContain('«id»');
  });

  it('renombrar un atributo a «id» sí se rechaza', () => {
    const diagram = diagramWith('Cliente');
    diagram.classes[0].attributes = [
      {
        id: 'a0',
        class_id: 'c0',
        name: 'codigo',
        data_type: 'String',
        visibility: 'private',
        is_nullable: true,
        is_unique: false,
        default_value: null,
        order_index: 0,
        created_at: diagram.created_at,
        updated_at: diagram.updated_at,
      },
    ];

    const plan = executor.plan(
      diagram,
      [
        {
          action: 'UPDATE_ATTRIBUTE',
          className: 'Cliente',
          attributeName: 'codigo',
          newName: 'id',
          newType: null,
        },
      ],
      'reject',
    );

    expect(plan.steps).toEqual([]);
    expect(plan.rejections.join(' ')).toContain('«id»');
  });
});
