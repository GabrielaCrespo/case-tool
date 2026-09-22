import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { decodeXmi } from './xmi-format.js';
import { generateXmi } from './xmi-generator.js';
import { parseXmi } from './xmi-parser.js';
import type { ParsedXmi } from './xmi-parser.js';
import { XmiService } from './xmi.service.js';

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

/**
 * CU06 — Lo que Enterprise Architect necesita del archivo.
 *
 * Estas comprobaciones no son sobre UML sino sobre EA: son las piezas que él
 * espera encontrar y que, al faltar, hacían que abriera el archivo con las
 * cajas amontonadas y las líneas dibujadas como le parecía. Se comparan contra
 * el archivo de EA de verdad, que es el que dice cómo tienen que ser.
 */
/**
 * CU06 — Las letras acentuadas.
 *
 * Un diagrama de este proyecto está escrito en castellano, así que la mitad de
 * los nombres llevan tilde o eñe. Es lo primero que se rompe al intercambiar
 * archivos con una herramienta que no usa la misma codificación.
 */
describe('CU06 — el nombre con tilde sobrevive al viaje', () => {
  /** El mismo XMI mínimo, escrito como lo escribiría cada herramienta. */
  const fileWith = (encoding: 'windows-1252' | 'utf-8'): Buffer => {
    const xml = `<?xml version="1.0" encoding="${encoding}"?>
<XMI xmi.version="1.1" xmlns:UML="omg.org/UML1.3">
	<XMI.content>
		<UML:Model name="EA Model" xmi.id="MX_1">
			<UML:Namespace.ownedElement>
				<UML:Package name="Catálogo" xmi.id="EAPK_1" visibility="public">
					<UML:Namespace.ownedElement>
						<UML:Class name="Categoría" xmi.id="EAID_1" visibility="public"/>
					</UML:Namespace.ownedElement>
				</UML:Package>
			</UML:Namespace.ownedElement>
		</UML:Model>
	</XMI.content>
</XMI>`;

    return Buffer.from(xml, encoding === 'utf-8' ? 'utf8' : 'latin1');
  };

  it('lee un archivo de EA, que viene en windows-1252', () => {
    const parsed = parseXmi(decodeXmi(fileWith('windows-1252')));

    expect(parsed.name).toBe('Catálogo');
    expect(parsed.classes[0].name).toBe('Categoría');
  });

  it('lee también el de una herramienta que escriba en UTF-8', () => {
    const parsed = parseXmi(decodeXmi(fileWith('utf-8')));

    expect(parsed.classes[0].name).toBe('Categoría');
  });

  it('exporta la tilde como referencia numérica, que vale en las dos', () => {
    const diagram = toDiagram(parseXmi(decodeXmi(fileWith('windows-1252'))));
    const xmi = generateXmi(diagram);

    expect(xmi).toContain('name="Categor&#237;a"');
    // Todo el archivo es ASCII —cada carácter ocupa un byte—, así que ninguna
    // herramienta puede leerlo torcido por la codificación.
    expect(Buffer.byteLength(xmi, 'utf8')).toBe(xmi.length);
    expect(parseXmi(xmi).classes[0].name).toBe('Categoría');
  });
});

describe('CU06 — el archivo tiene la forma que espera Enterprise Architect', () => {
  const diagram = toDiagram(parseXmi(EA_FILE));
  const xmi = generateXmi(diagram);

  it('declara la clase raíz de EA y su bloque de extensión', () => {
    expect(xmi).toContain('<?xml version="1.0" encoding="windows-1252"?>');
    expect(xmi).toContain('name="EARootClass"');
    expect(xmi).toContain('<XMI.extensions xmi.extender="Enterprise Architect 2.5">');
  });

  it('numera los elementos y dice entre qué números va cada línea', () => {
    expect(xmi).toContain('<UML:TaggedValue tag="ea_eleType" value="element"/>');
    expect(xmi).toContain('<UML:TaggedValue tag="ea_localid"');
    expect(xmi).toContain('<UML:TaggedValue tag="ea_sourceID"');
    expect(xmi).toContain('<UML:TaggedValue tag="ea_targetID"');
  });

  it('ata cada línea del dibujo a las dos cajas por su DUID', () => {
    const boxes = [...xmi.matchAll(/style="DUID=([0-9A-F]{8});"/g)].map((match) => match[1]);
    const links = [...xmi.matchAll(/EOID=([0-9A-F]{8});SOID=([0-9A-F]{8});/g)];
    const connectors = [...xmi.matchAll(/<UML:(Association|Generalization|Dependency) /g)];

    expect(boxes).toHaveLength(diagram.classes.length);
    // Una por cada línea escrita: las dos asociaciones de la entidad
    // intermedia son una sola línea, así que no se cuentan las relaciones.
    expect(links).toHaveLength(connectors.length);
    // Ninguna línea puede apuntar a una caja que no está dibujada: es lo que
    // dejaba a EA sin saber dónde empieza y dónde acaba cada relación.
    for (const [, target, source] of links) {
      expect(boxes).toContain(target);
      expect(boxes).toContain(source);
    }
  });

  it('escribe la clave primaria de cada entidad, que no está en el modelo', () => {
    // El «id» lo pone la herramienta, así que no viaja en uml_attributes; pero
    // quien abra el archivo en EA está mirando el diseño de unas tablas, y una
    // tabla sin su clave primaria no describe lo que CU07 va a generar.
    const keys = [...xmi.matchAll(/<UML:Attribute name="id" /g)];
    expect(keys).toHaveLength(diagram.classes.length);

    // Su tipo tiene que estar declarado, o EA le pondría uno por su cuenta.
    expect(xmi).toContain('<UML:DataType xmi.id="eaxmiid1" name="Integer"');
    expect(xmi).toMatch(/<UML:DataType xmi\.id="eaxmiid\d+" name="Long"/);
  });

  it('escribe un solo id aunque la clase guardada ya tuviera el suyo', () => {
    // Un modelo importado de EA antes de esta regla trae su propia columna
    // «id»; escribir además la implícita daría dos columnas iguales en la misma
    // tabla, que es lo que EA abre como un atributo repetido.
    const conIdPropio = {
      ...diagram,
      classes: diagram.classes.map((umlClass, index) =>
        index === 0
          ? {
              ...umlClass,
              attributes: [
                { ...umlClass.attributes[0], id: randomUUID(), name: 'ID', data_type: 'Integer' },
                ...umlClass.attributes,
              ],
            }
          : umlClass,
      ),
    };

    const written = generateXmi(conIdPropio);

    expect([...written.matchAll(/<UML:Attribute name="id" /gi)]).toHaveLength(
      diagram.classes.length,
    );
  });

  it('marca la agregación con la palabra de EA y en el extremo del todo', () => {
    // EA escribe «shared», no el «aggregate» de UML 1.3, y pone el rombo en el
    // destino; con lo otro dibujaba una asociación corriente.
    expect(xmi).toContain('aggregation="shared"');
    expect(xmi).toContain('aggregation="composite"');
    expect(xmi).not.toContain('aggregation="aggregate"');
  });

  it('escribe la entidad intermedia como la clase de asociación de EA', () => {
    // Class6 llegó del archivo de EA como clase de asociación de Class2—Class4
    // y se guardó como dos asociaciones hacia ella; al exportar vuelve a ser
    // una sola línea con la caja colgando.
    const intermediate = diagram.classes.find((umlClass) => umlClass.name === 'Class6')!;

    expect(xmi).toContain(`<UML:TaggedValue tag="associationclass" value="EAID_`);
    expect(xmi).toContain('<UML:TaggedValue tag="conID"');
    expect(
      diagram.relationships.filter(
        (relationship) => relationship.target_class_id === intermediate.id,
      ),
    ).toHaveLength(2);
    // Las dos asociaciones hacia ella no se escriben además de la línea.
    expect([...xmi.matchAll(/<UML:Association /g)]).toHaveLength(
      diagram.relationships.filter((relationship) =>
        ['ASSOCIATION', 'AGGREGATION', 'COMPOSITION'].includes(relationship.relationship_type),
      ).length - 1,
    );
  });

  it('al volver a leerlo, el id no se importa como atributo: la entidad ya lo tiene', () => {
    // El otro lado de la regla anterior. Un modelo de EA cuyas tablas traen su
    // columna «id» —o uno que esta herramienta acaba de exportar— se importa
    // con esa columna descartada y un solo aviso para todo el archivo, en vez
    // de dejar un atributo que después el generador tendría que omitir.
    const service = new XmiService(null as never, null as never, null as never);
    const parsed = parseXmi(xmi);
    const warnings: string[] = [];

    const classes = service['resolveNames'](parsed, warnings);

    expect(classes).toHaveLength(diagram.classes.length);
    for (const umlClass of classes) {
      expect(umlClass.attributes.map((attribute) => attribute.name)).not.toContain('id');
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('«id»');
  });

  it('no escribe coordenadas negativas, que EA no sabe dibujar', () => {
    // El lienzo deja arrastrar una clase por encima del origen; EA recorta esas
    // coordenadas a cero y las cajas de ese borde acaban unas sobre otras.
    const moved = {
      ...diagram,
      classes: diagram.classes.map((umlClass, index) =>
        index === 0 ? { ...umlClass, pos_x: -300, pos_y: -80 } : umlClass,
      ),
    };

    const geometries = [...generateXmi(moved).matchAll(/Left=(-?\d+);Top=(-?\d+)/g)];
    expect(geometries.length).toBeGreaterThan(0);
    for (const [, left, top] of geometries) {
      expect(Number(left)).toBeGreaterThanOrEqual(0);
      expect(Number(top)).toBeGreaterThanOrEqual(0);
    }

    // Y el desplazamiento es el mismo para todas: el dibujo no se deforma.
    const again = parseXmi(generateXmi(moved));
    const distance = (parsed: { classes: { name: string; position: { x: number } | null }[] }) => {
      const first = parsed.classes.find((umlClass) => umlClass.name === 'Class2')!.position!;
      const second = parsed.classes.find((umlClass) => umlClass.name === 'Class4')!.position!;
      return second.x - first.x;
    };
    expect(distance(again)).toBe(
      moved.classes.find((umlClass) => umlClass.name === 'Class4')!.pos_x -
        moved.classes.find((umlClass) => umlClass.name === 'Class2')!.pos_x,
    );
  });
});
