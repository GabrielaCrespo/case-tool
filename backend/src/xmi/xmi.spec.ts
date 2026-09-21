import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { generateXmi } from './xmi-generator.js';
import { parseXmi } from './xmi-parser.js';
import type { ParsedXmi } from './xmi-parser.js';

/**
 * CU06 — Que un modelo sobreviva al viaje de ida y vuelta.
 *
 * El archivo de `test/fixtures` no es inventado: lo exportó Enterprise
 * Architect de verdad, con las seis relaciones que se pueden dibujar entre
 * clases, y es la única forma de comprobar contra el formato tal como lo
 * escribe la herramienta con la que hay que intercambiar modelos. Un XMI
 * escrito a mano para la prueba sólo demostraría que el analizador sabe leer
 * lo que el generador escribe.
 *
 * Está escrito en windows-1252, que es lo que declara su cabecera.
 */
const EA_FILE = readFileSync('test/fixtures/ea-ejemplo.xml', 'latin1');

/** Cómo se lee cada relación, para poder compararlas de un vistazo. */
function relations(parsed: ParsedXmi): string[] {
  const names = new Map(parsed.classes.map((umlClass) => [umlClass.id, umlClass.name]));

  return parsed.relationships
    .map(
      (relationship) =>
        `${relationship.type} ${names.get(relationship.source)}(${relationship.sourceMultiplicity}) -> ${names.get(
          relationship.target,
        )}(${relationship.targetMultiplicity})`,
    )
    .sort();
}

/**
 * Convierte una lectura del archivo en el diagrama que devolvería la API, que
 * es lo que recibe el generador. Equivale a importar el archivo y volver a
 * pedirlo, sin pasar por PostgreSQL.
 */
function toDiagram(parsed: ParsedXmi): FullDiagramResponse {
  const now = new Date().toISOString();
  const ids = new Map(parsed.classes.map((umlClass) => [umlClass.id, randomUUID()]));

  return {
    id: randomUUID(),
    project_id: randomUUID(),
    name: parsed.name ?? 'Diagrama',
    description: null,
    created_by: randomUUID(),
    created_at: now,
    updated_at: now,
    classes: parsed.classes.map((umlClass, index) => ({
      id: ids.get(umlClass.id)!,
      diagram_id: '',
      name: umlClass.name,
      stereotype: null,
      is_abstract: umlClass.isAbstract,
      visibility: umlClass.visibility,
      pos_x: umlClass.position?.x ?? index * 100,
      pos_y: umlClass.position?.y ?? 0,
      width: null,
      height: null,
      created_at: now,
      updated_at: now,
      attributes: umlClass.attributes.map((attribute, order) => ({
        id: randomUUID(),
        class_id: '',
        name: attribute.name,
        // El catálogo no tiene «int»; el servicio lo traduce al importar.
        data_type: attribute.type === 'int' ? 'Integer' : attribute.type,
        visibility: attribute.visibility,
        is_primary_key: false,
        is_nullable: attribute.isNullable,
        is_unique: attribute.isUnique,
        default_value: attribute.defaultValue,
        order_index: order,
        created_at: now,
        updated_at: now,
      })),
      methods: umlClass.methods.map((method, order) => ({
        id: randomUUID(),
        class_id: '',
        name: method.name,
        return_type: method.returnType ?? 'void',
        visibility: method.visibility,
        order_index: order,
        created_at: now,
        parameters: method.parameters.map((parameter, position) => ({
          id: randomUUID(),
          method_id: '',
          name: parameter.name,
          data_type: parameter.type ?? 'String',
          order_index: position,
          created_at: now,
        })),
      })),
    })),
    relationships: parsed.relationships.map((relationship) => ({
      id: randomUUID(),
      diagram_id: '',
      source_class_id: ids.get(relationship.source)!,
      target_class_id: ids.get(relationship.target)!,
      relationship_type: relationship.type,
      source_multiplicity: relationship.sourceMultiplicity,
      target_multiplicity: relationship.targetMultiplicity,
      name: relationship.name,
      source_role: relationship.sourceRole,
      target_role: relationship.targetRole,
      is_navigable_source: true,
      is_navigable_target: true,
      created_at: now,
      updated_at: now,
    })),
  };
}

describe('CU06 — leer un archivo de Enterprise Architect', () => {
  const parsed = parseXmi(EA_FILE);

  it('lee las clases con sus atributos y sus métodos', () => {
    expect(parsed.classes.map((umlClass) => umlClass.name).sort()).toEqual([
      'Class1',
      'Class2',
      'Class3',
      'Class4',
      'Class5',
      'Class6',
    ]);

    const class1 = parsed.classes.find((umlClass) => umlClass.name === 'Class1')!;
    expect(class1.attributes.map((attribute) => `${attribute.name}:${attribute.type}`)).toEqual([
      'a1:int',
      'a2:int',
      'aa3:int',
    ]);

    // EARootClass es una clase interna de EA y no representa nada del usuario.
    expect(parsed.classes.some((umlClass) => umlClass.name === 'EARootClass')).toBe(false);
  });

  it('conserva la posición de cada caja', () => {
    const class1 = parsed.classes.find((umlClass) => umlClass.name === 'Class1')!;

    expect(class1.position).toEqual({ x: 58, y: 89 });
  });

  it('distingue la realización de la dependencia por la etiqueta de EA', () => {
    // El archivo la escribe como UML:Dependency con ea_type="Realisation":
    // sin mirar esa etiqueta se importaría como una dependencia corriente.
    expect(relations(parsed)).toContain('REALIZATION Class3(null) -> Class5(null)');
  });

  it('lee una asociación de una clase consigo misma', () => {
    expect(relations(parsed)).toContain('ASSOCIATION Class1(null) -> Class1(null)');
  });

  it('convierte la clase de asociación en la clase intermedia y sus dos enlaces', () => {
    // EA dibuja Class2—Class4 con Class6 colgando; aquí eso son dos
    // asociaciones 1 : 0..* hacia Class6, que es lo que acabará en la base.
    expect(relations(parsed)).toContain('ASSOCIATION Class2(1) -> Class6(0..*)');
    expect(relations(parsed)).toContain('ASSOCIATION Class4(1) -> Class6(0..*)');
  });
});

describe('CU06 — exportar y volver a leer', () => {
  it('devuelve el mismo modelo', () => {
    const original = parseXmi(EA_FILE);
    const again = parseXmi(generateXmi(toDiagram(original)));

    expect(again.classes.map((umlClass) => umlClass.name).sort()).toEqual(
      original.classes.map((umlClass) => umlClass.name).sort(),
    );
    // Aquí es donde se veía el fallo: la dependencia y la realización se
    // escribían como UML:Generalization y volvían convertidas en herencia.
    expect(relations(again)).toEqual(relations(original));
  });

  it('conserva las posiciones', () => {
    const original = parseXmi(EA_FILE);
    const again = parseXmi(generateXmi(toDiagram(original)));

    const positionsOf = (parsed: ParsedXmi) =>
      Object.fromEntries(
        parsed.classes.map((umlClass) => [umlClass.name, umlClass.position]),
      );

    expect(positionsOf(again)).toEqual(positionsOf(original));
  });

  it('escribe la herencia como Generalization y la dependencia como Dependency', () => {
    const xmi = generateXmi(toDiagram(parseXmi(EA_FILE)));

    expect(xmi).toContain('<UML:Generalization');
    expect(xmi).toContain('<UML:Dependency');
    expect(xmi).toContain('value="Realisation"');
  });
});
