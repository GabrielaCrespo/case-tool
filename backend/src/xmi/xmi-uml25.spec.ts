import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { validateDiagram } from '../diagrams/diagram-validator.js';
import { generateXmi } from './xmi-generator.js';
import { parseXmi } from './xmi-parser.js';

/**
 * Notación UML 2.5 de atributos y operaciones en el intercambio con
 * Enterprise Architect (CU06).
 *
 * Lo que se comprueba es doble: que lo nuevo —estático, derivado, sólo
 * lectura, multiplicidad de un atributo, operación abstracta— viaja en el
 * archivo y vuelve igual, y que un diagrama que no usa nada de eso se exporta
 * exactamente como antes, para no cambiarle a EA lo que ya sabía leer.
 */

const NOW = '2026-01-01T00:00:00.000Z';
const CLASS_ID = '11111111-1111-4111-8111-111111111111';

function attribute(
  id: string,
  name: string,
  overrides: Partial<FullDiagramResponse['classes'][number]['attributes'][number]> = {},
): FullDiagramResponse['classes'][number]['attributes'][number] {
  return {
    id,
    class_id: CLASS_ID,
    name,
    data_type: 'String',
    visibility: 'private',
    is_nullable: true,
    is_unique: false,
    default_value: null,
    is_static: false,
    is_derived: false,
    is_read_only: false,
    multiplicity: null,
    order_index: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function method(
  id: string,
  name: string,
  overrides: Partial<FullDiagramResponse['classes'][number]['methods'][number]> = {},
): FullDiagramResponse['classes'][number]['methods'][number] {
  return {
    id,
    class_id: CLASS_ID,
    name,
    return_type: 'void',
    visibility: 'public',
    is_static: false,
    is_abstract: false,
    order_index: 0,
    created_at: NOW,
    parameters: [],
    ...overrides,
  };
}

function diagramWith(
  attributes: FullDiagramResponse['classes'][number]['attributes'],
  methods: FullDiagramResponse['classes'][number]['methods'],
  isAbstract = true,
): FullDiagramResponse {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    project_id: '33333333-3333-4333-8333-333333333333',
    name: 'Notacion',
    description: null,
    created_by: '44444444-4444-4444-8444-444444444444',
    created_at: NOW,
    updated_at: NOW,
    classes: [
      {
        id: CLASS_ID,
        diagram_id: '22222222-2222-4222-8222-222222222222',
        name: 'Cliente',
        stereotype: null,
        is_abstract: isAbstract,
        visibility: 'public',
        pos_x: 10,
        pos_y: 20,
        width: null,
        height: null,
        created_at: NOW,
        updated_at: NOW,
        attributes,
        methods,
      },
    ],
    relationships: [],
  };
}

describe('UML 2.5 — atributos y operaciones en el XMI', () => {
  const diagram = diagramWith(
    [
      attribute('aaaaaaaa-0000-4000-8000-000000000001', 'contador', {
        data_type: 'Integer',
        is_static: true,
      }),
      attribute('aaaaaaaa-0000-4000-8000-000000000002', 'edad', {
        data_type: 'Integer',
        is_derived: true,
      }),
      attribute('aaaaaaaa-0000-4000-8000-000000000003', 'codigo', { is_read_only: true }),
      attribute('aaaaaaaa-0000-4000-8000-000000000004', 'telefonos', { multiplicity: '0..*' }),
      attribute('aaaaaaaa-0000-4000-8000-000000000005', 'nombre'),
    ],
    [
      method('bbbbbbbb-0000-4000-8000-000000000001', 'crear', { is_static: true }),
      method('bbbbbbbb-0000-4000-8000-000000000002', 'calcular', { is_abstract: true }),
      method('bbbbbbbb-0000-4000-8000-000000000003', 'guardar'),
    ],
  );

  const xmi = generateXmi(diagram);
  const parsed = parseXmi(xmi);
  const cliente = parsed.classes.find((umlClass) => umlClass.name === 'Cliente')!;
  const byName = (name: string) => cliente.attributes.find((a) => a.name === name)!;
  const methodNamed = (name: string) => cliente.methods.find((m) => m.name === name)!;

  it('escribe la notación como la entiende UML 1.3 / Enterprise Architect', () => {
    expect(xmi).toContain('<UML:Attribute name="contador" changeable="none" visibility="private" ownerScope="classifier"');
    expect(xmi).toContain('<UML:Attribute name="codigo" changeable="frozen"');
    expect(xmi).toContain('<UML:TaggedValue tag="derived" value="1"/>');
    expect(xmi).toContain('<UML:TaggedValue tag="upperBound" value="*"/>');
    expect(xmi).toContain('<UML:Operation name="crear" visibility="public" ownerScope="classifier"');
    expect(xmi).toContain('concurrency="sequential" isAbstract="true">');
  });

  it('vuelve igual al importarlo', () => {
    expect(byName('contador').isStatic).toBe(true);
    expect(byName('edad').isDerived).toBe(true);
    expect(byName('codigo').isReadOnly).toBe(true);
    expect(byName('telefonos').multiplicity).toBe('0..*');
    expect(methodNamed('crear').isStatic).toBe(true);
    expect(methodNamed('calcular').isAbstract).toBe(true);
  });

  it('un miembro sin notación sigue saliendo y volviendo como antes', () => {
    const nombre = byName('nombre');
    expect([nombre.isStatic, nombre.isDerived, nombre.isReadOnly, nombre.multiplicity]).toEqual([
      false,
      false,
      false,
      null,
    ]);
    expect(xmi).toContain(
      '<UML:Attribute name="nombre" changeable="none" visibility="private" ownerScope="instance" targetScope="instance">',
    );
    expect(xmi).toContain(
      '<UML:Operation name="guardar" visibility="public" ownerScope="instance" isQuery="false" concurrency="sequential">',
    );
    expect([methodNamed('guardar').isStatic, methodNamed('guardar').isAbstract]).toEqual([
      false,
      false,
    ]);
  });
});

describe('UML 2.5 — el archivo real de Enterprise Architect no cambia de lectura', () => {
  const parsed = parseXmi(readFileSync('test/fixtures/ea-ejemplo.xml', 'latin1'));

  it('sus atributos no se vuelven estáticos, derivados ni colecciones', () => {
    for (const umlClass of parsed.classes) {
      for (const attribute of umlClass.attributes) {
        expect(attribute.isStatic).toBe(false);
        expect(attribute.isDerived).toBe(false);
        expect(attribute.isReadOnly).toBe(false);
        expect(attribute.multiplicity).toBeNull();
      }
    }
  });
});

describe('UML 2.5 — XMI 2.x de otras herramientas', () => {
  const xmi = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="M" xmi:id="m1">
    <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Pedido" isAbstract="true">
      <ownedAttribute xmi:type="uml:Property" xmi:id="a1" name="lineas" isStatic="false" isDerived="false" isReadOnly="true">
        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="l1" value="1"/>
        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="u1" value="*"/>
      </ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="a2" name="total" isDerived="true">
        <lowerValue xmi:type="uml:LiteralInteger" xmi:id="l2" value="0"/>
        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="u2" value="1"/>
      </ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="a3" name="raro">
        <upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="u3" value="muchos"/>
      </ownedAttribute>
      <ownedOperation xmi:id="o1" name="contar" isStatic="true"/>
      <ownedOperation xmi:id="o2" name="validar" isAbstract="true"/>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;

  const pedido = parseXmi(xmi).classes[0];

  it('lee isStatic, isDerived, isReadOnly, isAbstract y la multiplicidad de una colección', () => {
    const lineas = pedido.attributes.find((a) => a.name === 'lineas')!;
    const total = pedido.attributes.find((a) => a.name === 'total')!;
    expect(lineas.isReadOnly).toBe(true);
    expect(lineas.multiplicity).toBe('1..*');
    expect(total.isDerived).toBe(true);
    // [0..1] sigue significando «admite nulos», no una multiplicidad dibujada.
    expect(total.multiplicity).toBeNull();
    expect(total.isNullable).toBe(true);
    expect(pedido.methods.find((m) => m.name === 'contar')!.isStatic).toBe(true);
    expect(pedido.methods.find((m) => m.name === 'validar')!.isAbstract).toBe(true);
  });

  it('una multiplicidad que no se entiende se descarta en vez de romper la importación', () => {
    expect(pedido.attributes.find((a) => a.name === 'raro')!.multiplicity).toBeNull();
  });
});

describe('UML 2.5 — reglas de buena formación', () => {
  it('avisa de una operación abstracta en una clase concreta y de estática + abstracta', () => {
    const codes = validateDiagram(
      diagramWith(
        [],
        [
          method('bbbbbbbb-0000-4000-8000-000000000009', 'calcular', {
            is_abstract: true,
            is_static: true,
          }),
        ],
        false,
      ),
    ).issues.map((issue) => issue.code);

    expect(codes).toContain('ABSTRACT_METHOD_IN_CONCRETE_CLASS');
    expect(codes).toContain('STATIC_ABSTRACT_METHOD');
  });

  it('son avisos: no impiden generar el backend', () => {
    const result = validateDiagram(
      diagramWith(
        [attribute('aaaaaaaa-0000-4000-8000-000000000010', 'telefonos', { multiplicity: '0..*' })],
        [method('bbbbbbbb-0000-4000-8000-000000000010', 'calcular', { is_abstract: true })],
        false,
      ),
    );

    expect(result.errors).toBe(0);
    expect(result.valid).toBe(true);
  });
});

describe('Estereotipos en el XMI', () => {
  it('una «enumeration» exportada vuelve como enumeración, con sus literales', () => {
    const diagram = diagramWith(
      [
        attribute('aaaaaaaa-0000-4000-8000-000000000020', 'ACTIVO', { data_type: null }),
        attribute('aaaaaaaa-0000-4000-8000-000000000021', 'INACTIVO', { data_type: null }),
      ],
      [],
      false,
    );
    diagram.classes[0].stereotype = 'enumeration';

    const parsed = parseXmi(generateXmi(diagram)).classes[0];
    expect(parsed.stereotype).toBe('enumeration');
    expect(parsed.attributes.map((a) => a.name)).toEqual(['ACTIVO', 'INACTIVO']);
  });

  it('lee uml:Enumeration y uml:Interface de XMI 2.x, con los ownedLiteral', () => {
    const parsed = parseXmi(`<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
  <uml:Model xmi:type="uml:Model" name="M" xmi:id="m1">
    <packagedElement xmi:type="uml:Enumeration" xmi:id="e1" name="Estado">
      <ownedLiteral xmi:type="uml:EnumerationLiteral" xmi:id="l1" name="ACTIVO"/>
      <ownedLiteral xmi:type="uml:EnumerationLiteral" xmi:id="l2" name="INACTIVO"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Interface" xmi:id="i1" name="Pagable"/>
  </uml:Model>
</xmi:XMI>`);
    const estado = parsed.classes.find((c) => c.name === 'Estado')!;
    expect(estado.stereotype).toBe('enumeration');
    expect(estado.attributes.map((a) => a.name)).toEqual(['ACTIVO', 'INACTIVO']);
    expect(parsed.classes.find((c) => c.name === 'Pagable')!.stereotype).toBe('interface');
  });

  it('un estereotipo que la herramienta no conoce se ignora en vez de romper la importación', () => {
    const diagram = diagramWith([], [], false);
    diagram.classes[0].stereotype = 'boundary';
    expect(parseXmi(generateXmi(diagram)).classes[0].stereotype).toBeNull();
  });
});
