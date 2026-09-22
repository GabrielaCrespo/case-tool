import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from './diagrams.service.js';
import { isPersistent, validateDiagram } from './diagram-validator.js';
import { PRIMARY_KEY } from './uml-catalog.js';

/**
 * CU02/CU07 — Qué cuenta como entidad.
 *
 * Esta comprobación existe por un fallo concreto: el generador daba por
 * persistente toda clase sin estereotipo, y el validador sólo las marcadas
 * «entity». Como una clase nace sin estereotipo —y las que crean CU04 y CU05
 * tampoco lo llevan—, dibujar Cliente y Pedido y pulsar «Generar backend»
 * devolvía «el diagrama no tiene ninguna clase que se pueda convertir en
 * entidad» delante de un lienzo lleno. Las dos reglas tienen que decir lo
 * mismo, así que la de Java se lee aquí del propio archivo del generador.
 */

const TIMES = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

function attribute(name: string, dataType: string | null) {
  return {
    id: `attribute-${name}`,
    class_id: '',
    name,
    data_type: dataType,
    visibility: 'private',
    is_nullable: true,
    is_unique: false,
    default_value: null,
    order_index: 0,
    ...TIMES,
  };
}

function umlClass(
  name: string,
  attributes: ReturnType<typeof attribute>[],
  stereotype: string | null = null,
) {
  return {
    id: `class-${name}`,
    diagram_id: 'diagram-1',
    name,
    stereotype,
    is_abstract: false,
    visibility: 'public',
    pos_x: 0,
    pos_y: 0,
    width: null,
    height: null,
    methods: [],
    attributes: attributes.map((item) => ({ ...item, class_id: `class-${name}` })),
    ...TIMES,
  };
}

function diagram(classes: ReturnType<typeof umlClass>[]): FullDiagramResponse {
  return {
    id: 'diagram-1',
    project_id: 'project-1',
    name: 'Modelo de datos',
    description: null,
    created_by: 'user-1',
    classes,
    relationships: [],
    ...TIMES,
  };
}

/**
 * Lo que el diseñador acaba de dibujar: dos cajas, sin tocar nada más. Sin
 * ningún atributo «id»: la clave primaria de las dos la pone la herramienta.
 */
const RECIEN_DIBUJADO = diagram([
  umlClass('Cliente', [attribute('nombre', 'String')]),
  umlClass('Pedido', [attribute('fecha', 'LocalDate')]),
]);

describe('CU02 — una clase sin estereotipo es una entidad', () => {
  it('un diagrama dibujado sin tocar estereotipos se puede generar', () => {
    const report = validateDiagram(RECIEN_DIBUJADO);

    expect(report.errors).toBe(0);
    expect(report.ready_for_generation).toBe(true);
  });

  it('interface, enumeration y service no cuentan como entidad', () => {
    expect(isPersistent({ stereotype: null })).toBe(true);
    expect(isPersistent({ stereotype: '' })).toBe(true);
    expect(isPersistent({ stereotype: 'entity' })).toBe(true);
    expect(isPersistent({ stereotype: 'interface' })).toBe(false);
    expect(isPersistent({ stereotype: 'enumeration' })).toBe(false);
    expect(isPersistent({ stereotype: 'service' })).toBe(false);
  });

  it('un diagrama que sólo trae interfaces no tiene nada que generar', () => {
    const report = validateDiagram(
      diagram([umlClass('Repositorio', [], 'interface')]),
    );

    expect(report.valid).toBe(true);
    expect(report.ready_for_generation).toBe(false);
  });
});

describe('CU02 — lo que falta antes de generar', () => {
  it('un atributo sin tipo impide generar, en vez de elegir el tipo por su autor', () => {
    const report = validateDiagram(
      diagram([umlClass('Cliente', [attribute('nombre', null)])]),
    );

    const issue = report.issues.find((candidate) => candidate.code === 'ATTRIBUTE_TYPE_REQUIRED');
    expect(issue?.severity).toBe('error');
    expect(report.ready_for_generation).toBe(false);
  });

  it('una entidad sin clave primaria dibujada no tiene nada que avisar', () => {
    const report = validateDiagram(diagram([umlClass('Cliente', [attribute('nombre', 'String')])]));

    // La clave primaria «id» la pone la herramienta en toda entidad, así que
    // no hay nada que falte ni nada que el generador tenga que inventarse.
    expect(report.issues).toHaveLength(0);
    expect(report.ready_for_generation).toBe(true);
  });

  it('un atributo llamado id, de un diagrama antiguo, se avisa y no impide generar', () => {
    const report = validateDiagram(diagram([umlClass('Cliente', [attribute('id', 'Long')])]));

    const issue = report.issues.find(
      (candidate) => candidate.code === 'ATTRIBUTE_IS_PRIMARY_KEY_NAME',
    );
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('«id»');
    expect(report.errors).toBe(0);
    expect(report.ready_for_generation).toBe(true);
  });
});

describe('CU07 — el generador Java dice lo mismo', () => {
  it('UmlClass.isPersistent() acepta los mismos estereotipos que el validador', () => {
    const java = readFileSync(
      '../generator/src/main/java/com/casese/generator/model/UmlClass.java',
      'utf8',
    );

    // Si alguien cambia la regla en Java sin cambiarla aquí, esta comprobación
    // salta: es exactamente el desajuste que hacía fallar CU07.
    expect(java).toContain(
      'return stereotype == null || stereotype.isBlank() || hasStereotype("entity");',
    );
  });

  it('la clave primaria del generador se llama igual que la reservada aquí', () => {
    const java = readFileSync(
      '../generator/src/main/java/com/casese/generator/plan/EntityPlan.java',
      'utf8',
    );

    // Si en Java pasara a llamarse de otra manera, el editor seguiría
    // reservando «id» y dejaría crear un atributo que choca con la columna.
    expect(java).toContain(`public static final String ID_NAME = "${PRIMARY_KEY.name}";`);
  });
});
