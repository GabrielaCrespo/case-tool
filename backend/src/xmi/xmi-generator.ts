import { randomUUID } from 'node:crypto';
import { isPersistent } from '../diagrams/diagram-validator.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { PRIMARY_KEY, isPrimaryKeyName } from '../diagrams/uml-catalog.js';
import { escapeXml, toXmiId } from './xmi-format.js';

/**
 * CU06 — Del diagrama guardado a un archivo XMI que Enterprise Architect abra.
 *
 * Se escribe XMI 1.1 sobre UML 1.3, y no la versión 2.1 que es más moderna,
 * por una razón práctica: es lo que exporta e importa Enterprise Architect por
 * defecto, y el objetivo de este caso de uso es intercambiar modelos con él.
 * Por eso también la extensión del archivo es `.xml`, como la suya.
 *
 * El XML se escribe a mano, con plantillas, en vez de armarlo con una
 * librería. No es por ahorrarse una dependencia: XMI es un formato posicional
 * y quisquilloso —el orden de los extremos decide cuál es cuál, y EA espera
 * sus etiquetas donde las pone él—, y verlo escrito tal como saldrá es lo que
 * permite compararlo con un archivo real de EA.
 *
 * La referencia es test/fixtures/ea-ejemplo.xml, exportado por Enterprise
 * Architect de verdad. Un XMI que sólo cumpla el estándar no basta: EA lee del
 * archivo mucho más de lo que UML define, y lo que no encuentra lo inventa.
 * De ahí tres cosas que no son adorno y que al faltar se notaban:
 *
 *  - `ea_localid` y `ea_eleType`. Numeran los elementos dentro del archivo, y
 *    los conectores dicen a qué números unen (`ea_sourceID`, `ea_targetID`).
 *  - El `style` de cada caja del diagrama, con su `DUID`, y el de cada línea,
 *    con `SOID` y `EOID` apuntando a esos DUID. Es lo que ata la línea a las
 *    dos cajas dibujadas; sin ello EA dibuja las relaciones como puede.
 *  - El adorno de agregación escrito como lo escribe EA: `shared` o
 *    `composite` en el extremo del TODO, que en sus archivos es el destino.
 *
 * Estructura que se genera:
 *
 *   XMI
 *     XMI.header
 *     XMI.content
 *       UML:Model
 *         UML:Namespace.ownedElement
 *           UML:Class EARootClass            ← la raíz que EA espera
 *           UML:Package                      ← el diagrama
 *             UML:Class                      ← cada clase
 *               UML:Classifier.feature
 *                 UML:Attribute              ← cada atributo
 *                 UML:Operation              ← cada método
 *             UML:Association                ← asociaciones, con sus extremos
 *             UML:Generalization             ← herencias
 *             UML:Dependency                 ← realizaciones y dependencias
 *           UML:DataType                     ← los tipos que se usan
 *       UML:Diagram                          ← posiciones de las cajas
 */

type UmlClass = FullDiagramResponse['classes'][number];
type Relationship = FullDiagramResponse['relationships'][number];

/** Relaciones que en UML son una asociación con dos extremos. */
const ASSOCIATIONS = new Set(['ASSOCIATION', 'AGGREGATION', 'COMPOSITION']);

/**
 * El adorno de agregación, con la palabra que usa Enterprise Architect.
 *
 * Aquí están las dos trampas del formato. La primera, el vocabulario: UML 1.3
 * dice «aggregate» y EA escribe «shared»; con «aggregate» EA no reconoce el
 * rombo y dibuja una asociación corriente. La segunda, la orientación: el
 * extremo marcado es el del TODO, y en los archivos de EA el todo es siempre
 * el destino de la línea. Como en nuestro modelo el todo es el origen, la
 * relación se escribe con los extremos cambiados (`wholeIsTarget`).
 */
const AGGREGATION_KIND: Record<string, string> = {
  AGGREGATION: 'shared',
  COMPOSITION: 'composite',
};

/** Cómo llama Enterprise Architect a cada tipo de relación. */
const EA_TYPE: Record<string, string> = {
  ASSOCIATION: 'Association',
  AGGREGATION: 'Aggregation',
  COMPOSITION: 'Aggregation',
  INHERITANCE: 'Generalization',
  REALIZATION: 'Realisation',
  DEPENDENCY: 'Dependency',
};

/** Tamaño con el que el editor dibuja una clase que nadie redimensionó. */
const DEFAULT_WIDTH = 224;
const DEFAULT_HEIGHT = 120;

/**
 * Margen con el que empieza el dibujo en EA.
 *
 * El lienzo de esta herramienta admite coordenadas negativas —se puede
 * arrastrar una clase por encima y a la izquierda del origen— y el de EA no.
 * Al exportar se desplaza todo para que la caja más arriba y más a la
 * izquierda quede aquí, conservando las distancias: si no, EA recorta las
 * negativas a cero y las cajas de ese borde salen unas encima de otras.
 */
const DIAGRAM_MARGIN = 20;

/**
 * Identificador del tipo «sin determinar».
 *
 * Enterprise Architect declara un DataType sin nombre y apunta a él desde los
 * atributos que no tienen tipo. Reproducirlo es lo que permite que un atributo
 * sin tipo siga sin tipo al volver: si se omitiera el tipo, EA le pondría uno
 * por su cuenta al abrir el archivo.
 */
const UNTYPED_ID = 'eaxmiid0';

/** Estilo con el que EA dibuja una caja recién creada. */
const CLASS_STYLE =
  'BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;';

/** Estilo de un extremo de línea; EA lo escribe en los dos. */
const END_STYLE = 'Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=Unspecified;';

/**
 * Una relación tal como se va a escribir.
 *
 * No siempre coincide con la que está guardada: una entidad intermedia son dos
 * asociaciones en el modelo y una sola línea en el archivo.
 */
interface Connector {
  id: string;
  type: string;
  sourceClassId: string;
  targetClassId: string;
  sourceMultiplicity: string | null;
  targetMultiplicity: string | null;
  name: string | null;
  sourceRole: string | null;
  targetRole: string | null;
  navigableSource: boolean;
  navigableTarget: boolean;
  /** La clase que cuelga de esta línea, si es un muchos a muchos resuelto. */
  associationClassId: string | null;
}

export function generateXmi(diagram: FullDiagramResponse): string {
  const packageId = toXmiId(diagram.id, 'EAPK');
  const modelId = `MX_${toXmiId(randomUUID())}`;
  const created = eaDate(diagram.created_at);
  const modified = eaDate(diagram.updated_at);
  const timestamp = eaDate(new Date().toISOString());

  const { connectors, intermediates } = toConnectors(diagram);

  /*
   * Los números locales de EA. Cada elemento y cada conector del archivo lleva
   * el suyo, y los conectores se refieren a las clases por ese número y no por
   * su identificador. Aquí se reparten por orden de aparición.
   */
  const classNumbers = new Map(diagram.classes.map((umlClass, index) => [umlClass.id, index + 1]));
  const connectorNumbers = new Map(
    connectors.map((connector, index) => [connector.id, index + 1]),
  );

  /*
   * Los tipos de dato se declaran una vez y quien los usa los referencia.
   * Hay que recorrer también las firmas de los métodos, no sólo los
   * atributos: un tipo referenciado sin declarar deja la referencia colgando,
   * y al volver a importar el archivo ese parámetro llega sin tipo.
   */
  const usedTypes = [
    ...new Set(
      diagram.classes.flatMap((umlClass) => [
        // columnsOf, no attributes: la clave primaria implícita también se
        // escribe, y su tipo tiene que estar declarado.
        ...columnsOf(umlClass).map((attribute) => attribute.data_type),
        ...umlClass.methods.flatMap((method) => [
          method.return_type === 'void' ? null : method.return_type,
          ...method.parameters.map((parameter) => parameter.data_type),
        ]),
      ]),
    ),
  ]
    .filter((type): type is string => type !== null)
    .sort();

  const typeIds = new Map(usedTypes.map((type, index) => [type, `eaxmiid${index + 1}`]));

  const context: Context = {
    packageId,
    packageName: diagram.name,
    created,
    modified,
    typeIds,
    classNumbers,
    connectorNumbers,
    classNames: new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name])),
    intermediates,
  };

  const lines: string[] = [];
  // La codificación es la que declaran los archivos de EA; lo que no es ASCII
  // viaja como referencia numérica (escapeXml), así que no depende de ella.
  lines.push('<?xml version="1.0" encoding="windows-1252"?>');
  lines.push(`<XMI xmi.version="1.1" xmlns:UML="omg.org/UML1.3" timestamp="${timestamp}">`);
  lines.push(line(1, '<XMI.header>'));
  lines.push(line(2, '<XMI.documentation>'));
  // El nombre del formato, no el de esta herramienta: lo que va aquí es el
  // dialecto en el que está escrito el archivo, que es el de EA 2.5.
  lines.push(line(3, '<XMI.exporter>Enterprise Architect</XMI.exporter>'));
  lines.push(line(3, '<XMI.exporterVersion>2.5</XMI.exporterVersion>'));
  lines.push(line(2, '</XMI.documentation>'));
  lines.push(line(1, '</XMI.header>'));
  lines.push(line(1, '<XMI.content>'));
  lines.push(line(2, `<UML:Model name="EA Model" xmi.id="${modelId}">`));
  lines.push(line(3, '<UML:Namespace.ownedElement>'));
  // EA cuelga todo de esta clase raíz y la espera al abrir el archivo.
  lines.push(
    line(
      4,
      '<UML:Class name="EARootClass" xmi.id="EAID_11111111_5487_4080_A7F4_41526CB0AA00" isRoot="true" isLeaf="false" isAbstract="false"/>',
    ),
  );
  lines.push(
    line(
      4,
      `<UML:Package name="${escapeXml(diagram.name)}" xmi.id="${packageId}" isRoot="false" isLeaf="false" isAbstract="false" visibility="public">`,
    ),
  );
  lines.push(...packageTags(context));
  lines.push(line(5, '<UML:Namespace.ownedElement>'));

  for (const umlClass of diagram.classes) {
    lines.push(...classElement(umlClass, context));
  }

  for (const connector of connectors) {
    lines.push(
      ...(ASSOCIATIONS.has(connector.type)
        ? associationElement(connector, context)
        : directedElement(connector, context)),
    );
  }

  lines.push(line(5, '</UML:Namespace.ownedElement>'));
  lines.push(line(4, '</UML:Package>'));

  // El tipo «sin determinar» va primero, como en los archivos de EA.
  lines.push(
    line(
      4,
      `<UML:DataType xmi.id="${UNTYPED_ID}" visibility="private" isRoot="false" isLeaf="false" isAbstract="false"/>`,
    ),
  );
  for (const [name, id] of typeIds) {
    lines.push(
      line(
        4,
        `<UML:DataType xmi.id="${id}" name="${escapeXml(name)}" visibility="private" isRoot="false" isLeaf="false" isAbstract="false"/>`,
      ),
    );
  }

  lines.push(line(3, '</UML:Namespace.ownedElement>'));
  lines.push(line(2, '</UML:Model>'));
  lines.push(...diagramElement(diagram, connectors, context));
  lines.push(line(1, '</XMI.content>'));
  lines.push(line(1, '<XMI.difference/>'));
  lines.push(line(1, '<XMI.extensions xmi.extender="Enterprise Architect 2.5">'));
  lines.push(line(2, '<EAModel.paramSub/>'));
  lines.push(line(1, '</XMI.extensions>'));
  lines.push('</XMI>');

  return `${lines.join('\n')}\n`;
}

/** Lo que hace falta en todas partes mientras se escribe el archivo. */
interface Context {
  packageId: string;
  packageName: string;
  created: string;
  modified: string;
  typeIds: Map<string, string>;
  /** Número local de EA de cada clase. */
  classNumbers: Map<string, number>;
  /** Número local de EA de cada línea. */
  connectorNumbers: Map<string, number>;
  classNames: Map<string, string>;
  /** Clase intermedia → la línea de la que cuelga. */
  intermediates: Map<string, string>;
}

// ------------------------------------------------------------- las relaciones

/**
 * Las líneas que hay que escribir, y qué clases son entidades intermedias.
 *
 * Una entidad intermedia está guardada como lo que acabará siendo en la base
 * de datos —una tabla más, unida a cada lado con una asociación 1 : 0..*—,
 * pero Enterprise Architect la dibuja de otra manera: una sola línea entre las
 * dos clases con la caja colgando de ella por un trazo discontinuo. Exportar
 * las dos asociaciones tal cual deja en EA tres cajas y dos líneas normales, y
 * el muchos a muchos que la intermedia venía a resolver desaparece del dibujo.
 *
 * Así que se reconoce el patrón y se escribe como lo escribe EA. El patrón es
 * el que produce la herramienta «Entidad intermedia» del lienzo y el que crea
 * la lectura de una imagen (CU05): la clase no participa en ninguna otra
 * relación, y las dos que llegan a ella vienen de clases distintas con
 * multiplicidad 1 en el origen y 0..* en ella. Se admiten también las dos sin
 * multiplicidad —así quedan cuando se dibujan a mano—, y entonces el archivo
 * las devuelve con la que les corresponde: una fila de la tabla intermedia
 * pertenece a una fila de cada lado.
 *
 * Con cualquier otra combinación no se toca nada. Una entidad a la que llegan
 * dos relaciones con otras multiplicidades no es una tabla intermedia, y
 * dibujarla como tal en EA diría del modelo algo que el modelo no dice.
 */
function toConnectors(diagram: FullDiagramResponse): {
  connectors: Connector[];
  intermediates: Map<string, string>;
} {
  const touching = new Map<string, Relationship[]>();
  for (const relationship of diagram.relationships) {
    for (const classId of [relationship.source_class_id, relationship.target_class_id]) {
      touching.set(classId, [...(touching.get(classId) ?? []), relationship]);
    }
  }

  /** Clase intermedia → identificador de la línea que la sostiene. */
  const intermediates = new Map<string, string>();
  /** Las dos asociaciones que sustituye cada línea. */
  const replaced = new Set<string>();
  const collapsed: Connector[] = [];

  for (const umlClass of diagram.classes) {
    const links = touching.get(umlClass.id) ?? [];

    const isIntermediate =
      links.length === 2 &&
      links.every(
        (link) =>
          link.relationship_type === 'ASSOCIATION' &&
          link.target_class_id === umlClass.id &&
          ((link.source_multiplicity === '1' && link.target_multiplicity === '0..*') ||
            (link.source_multiplicity === null && link.target_multiplicity === null)),
      ) &&
      links[0].source_class_id !== links[1].source_class_id;

    if (!isIntermediate) continue;

    // La línea hereda el identificador de la primera de las dos asociaciones:
    // así el archivo no estrena identificadores en cada exportación.
    const [first, second] = links;
    intermediates.set(umlClass.id, first.id);
    replaced.add(first.id);
    replaced.add(second.id);

    collapsed.push({
      id: first.id,
      type: 'ASSOCIATION',
      sourceClassId: first.source_class_id,
      targetClassId: second.source_class_id,
      // Las multiplicidades del muchos a muchos las vuelve a poner quien lea
      // el archivo: las guardadas son las de las dos líneas que se sustituyen.
      sourceMultiplicity: null,
      targetMultiplicity: null,
      name: null,
      sourceRole: null,
      targetRole: null,
      navigableSource: true,
      navigableTarget: true,
      associationClassId: umlClass.id,
    });
  }

  const rest = diagram.relationships
    .filter((relationship) => !replaced.has(relationship.id))
    .map(
      (relationship): Connector => ({
        id: relationship.id,
        type: relationship.relationship_type,
        sourceClassId: relationship.source_class_id,
        targetClassId: relationship.target_class_id,
        sourceMultiplicity: relationship.source_multiplicity,
        targetMultiplicity: relationship.target_multiplicity,
        name: relationship.name,
        sourceRole: relationship.source_role,
        targetRole: relationship.target_role,
        navigableSource: relationship.is_navigable_source,
        navigableTarget: relationship.is_navigable_target,
        associationClassId: null,
      }),
    );

  return { connectors: [...collapsed, ...rest], intermediates };
}

// ----------------------------------------------------------------- elementos

function packageTags(context: Context): string[] {
  return [
    line(5, '<UML:ModelElement.taggedValue>'),
    ...[
      ['created', context.created],
      ['modified', context.modified],
      ['iscontrolled', 'FALSE'],
      ['version', '1.0'],
      ['isprotected', 'FALSE'],
      ['usedtd', 'FALSE'],
      ['logxml', 'FALSE'],
      ['packageFlags', 'isModel=1;VICON=3;CRC=0;'],
      ['phase', '1.0'],
      ['status', 'Proposed'],
      ['author', 'CASE-Tool'],
      ['complexity', '1'],
      ['ea_stype', 'Public'],
      ['tpos', '0'],
      ['gentype', 'Java'],
    ].map(([name, value]) => tag(6, name, value)),
    line(5, '</UML:ModelElement.taggedValue>'),
  ];
}

/**
 * Las columnas que se escriben de una clase: su clave primaria y después sus
 * atributos.
 *
 * El «id» no está en el modelo —lo pone la herramienta en toda entidad—, pero
 * sí tiene que estar en el archivo: quien abra el XMI en Enterprise Architect
 * está mirando el diseño de unas tablas, y una tabla sin su clave primaria no
 * describe lo que CU07 va a generar. Al volver a importar se descarta, porque
 * la entidad ya nace con ella.
 *
 * De «id» se escribe uno y sólo uno. Un diagrama guardado antes de que la
 * clave primaria la pusiera la herramienta puede tener todavía un atributo con
 * ese nombre —lo tienen los que se importaron de Enterprise Architect—, y
 * escribirlo además del implícito daría dos columnas iguales en la misma
 * tabla: EA las abre como un atributo repetido y el generador lo omite de
 * todas formas.
 *
 * Una clase marcada «interface», «enumeration» o «service» no genera tabla, así
 * que no lleva clave primaria y sus atributos se escriben tal como están.
 */
function columnsOf(umlClass: UmlClass): UmlClass['attributes'] {
  if (!isPersistent(umlClass)) {
    return umlClass.attributes;
  }

  const own = umlClass.attributes.filter((attribute) => !isPrimaryKeyName(attribute.name));

  const key: UmlClass['attributes'][number] = {
    // El GUID se deriva del de la clase para que dos exportaciones del mismo
    // diagrama den el mismo archivo.
    id: `${umlClass.id.slice(0, 24)}000000000001`,
    class_id: umlClass.id,
    name: PRIMARY_KEY.name,
    data_type: PRIMARY_KEY.dataType,
    visibility: 'private',
    is_nullable: false,
    is_unique: true,
    default_value: null,
    order_index: 0,
    created_at: umlClass.created_at,
    updated_at: umlClass.updated_at,
  };

  return [key, ...own];
}

function classElement(umlClass: UmlClass, context: Context): string[] {
  const id = toXmiId(umlClass.id);
  const lines: string[] = [];

  lines.push(
    line(
      6,
      `<UML:Class name="${escapeXml(umlClass.name)}" xmi.id="${id}" visibility="${umlClass.visibility}" namespace="${context.packageId}" isRoot="false" isLeaf="false" isAbstract="${umlClass.is_abstract}" isActive="false">`,
    ),
  );

  lines.push(line(7, '<UML:ModelElement.taggedValue>'));
  lines.push(tag(8, 'isSpecification', 'false'));
  lines.push(tag(8, 'ea_stype', 'Class'));
  lines.push(tag(8, 'ea_ntype', '0'));
  lines.push(tag(8, 'version', '1.0'));
  if (umlClass.stereotype !== null) lines.push(tag(8, 'stereotype', umlClass.stereotype));
  lines.push(tag(8, 'package', context.packageId));
  lines.push(tag(8, 'date_created', context.created));
  lines.push(tag(8, 'date_modified', context.modified));
  lines.push(tag(8, 'gentype', 'Java'));
  lines.push(tag(8, 'tagged', '0'));
  lines.push(tag(8, 'package_name', context.packageName));
  lines.push(tag(8, 'phase', '1.0'));
  lines.push(tag(8, 'author', 'CASE-Tool'));
  lines.push(tag(8, 'complexity', '1'));
  lines.push(tag(8, 'status', 'Proposed'));
  lines.push(tag(8, 'tpos', '0'));
  lines.push(tag(8, 'ea_localid', String(context.classNumbers.get(umlClass.id) ?? 0)));
  lines.push(tag(8, 'ea_eleType', 'element'));
  // La clase que cuelga de una línea apunta a ella: es la otra mitad de la
  // etiqueta «associationclass» que lleva la propia línea.
  const hangsFrom = context.intermediates.get(umlClass.id);
  if (hangsFrom !== undefined) lines.push(tag(8, 'conID', toXmiId(hangsFrom)));
  lines.push(tag(8, 'style', CLASS_STYLE));
  lines.push(line(7, '</UML:ModelElement.taggedValue>'));

  const attributes = columnsOf(umlClass);

  if (attributes.length > 0 || umlClass.methods.length > 0) {
    lines.push(line(7, '<UML:Classifier.feature>'));

    for (const [index, attribute] of attributes.entries()) {
      const typeId =
        attribute.data_type === null ? UNTYPED_ID : context.typeIds.get(attribute.data_type)!;

      lines.push(
        line(
          8,
          `<UML:Attribute name="${escapeXml(attribute.name)}" changeable="none" visibility="${attribute.visibility}" ownerScope="instance" targetScope="instance">`,
        ),
      );
      lines.push(line(9, '<UML:Attribute.initialValue>'));
      lines.push(
        line(
          10,
          attribute.default_value === null
            ? '<UML:Expression/>'
            : `<UML:Expression body="${escapeXml(attribute.default_value)}"/>`,
        ),
      );
      lines.push(line(9, '</UML:Attribute.initialValue>'));
      lines.push(line(9, '<UML:StructuralFeature.type>'));
      lines.push(line(10, `<UML:Classifier xmi.idref="${typeId}"/>`));
      lines.push(line(9, '</UML:StructuralFeature.type>'));
      lines.push(line(9, '<UML:ModelElement.taggedValue>'));
      // El tipo se repite en las etiquetas porque es donde EA lo lee.
      if (attribute.data_type !== null) lines.push(tag(10, 'type', attribute.data_type));
      lines.push(tag(10, 'containment', 'Not Specified'));
      lines.push(tag(10, 'ordered', '0'));
      lines.push(tag(10, 'static', '0'));
      lines.push(tag(10, 'collection', 'false'));
      lines.push(tag(10, 'position', String(attribute.order_index)));
      /*
       * Los límites son siempre 1 y 1, como en los archivos de EA, y no se
       * usan para decir si la columna admite nulos. EA entiende cualquier otro
       * par como una multiplicidad del atributo y la escribe al lado del campo
       * en todas las tablas —«precio: BigDecimal [0..1]»—, que es ruido que
       * nadie pidió. Además no se perdía nada: nuestro lector nunca miró estas
       * etiquetas, así que el «admite nulos» no viajaba en el archivo de todos
       * modos.
       */
      lines.push(tag(10, 'lowerBound', '1'));
      lines.push(tag(10, 'upperBound', '1'));
      lines.push(tag(10, 'duplicates', '0'));
      lines.push(tag(10, 'ea_guid', eaGuid(attribute.id)));
      lines.push(tag(10, 'ea_localid', String(index + 1)));
      lines.push(tag(10, 'styleex', 'volatile=0;'));
      lines.push(line(9, '</UML:ModelElement.taggedValue>'));
      lines.push(line(8, '</UML:Attribute>'));
    }

    for (const [index, method] of umlClass.methods.entries()) {
      lines.push(
        line(
          8,
          `<UML:Operation name="${escapeXml(method.name)}" visibility="${method.visibility}" ownerScope="instance" isQuery="false" concurrency="sequential">`,
        ),
      );
      lines.push(line(9, '<UML:ModelElement.taggedValue>'));
      lines.push(tag(10, 'type', method.return_type));
      lines.push(tag(10, 'const', 'false'));
      lines.push(tag(10, 'synchronised', '0'));
      lines.push(tag(10, 'concurrency', 'Sequential'));
      lines.push(tag(10, 'position', String(method.order_index)));
      lines.push(tag(10, 'pure', '0'));
      lines.push(tag(10, 'ea_guid', eaGuid(method.id)));
      lines.push(tag(10, 'ea_localid', String(index + 1)));
      lines.push(line(9, '</UML:ModelElement.taggedValue>'));
      lines.push(line(9, '<UML:BehavioralFeature.parameter>'));

      for (const parameter of method.parameters) {
        lines.push(
          line(
            10,
            `<UML:Parameter name="${escapeXml(parameter.name)}" kind="in" visibility="public">`,
          ),
        );
        lines.push(line(11, '<UML:Parameter.type>'));
        lines.push(
          line(
            12,
            `<UML:Classifier xmi.idref="${context.typeIds.get(parameter.data_type) ?? UNTYPED_ID}"/>`,
          ),
        );
        lines.push(line(11, '</UML:Parameter.type>'));
        lines.push(line(11, '<UML:ModelElement.taggedValue>'));
        lines.push(tag(12, 'type', parameter.data_type));
        lines.push(line(11, '</UML:ModelElement.taggedValue>'));
        lines.push(line(10, '</UML:Parameter>'));
      }

      // El retorno es un parámetro más, marcado como tal: así lo hace UML 1.x.
      lines.push(line(10, '<UML:Parameter kind="return" visibility="public">'));
      lines.push(line(11, '<UML:Parameter.type>'));
      lines.push(
        line(
          12,
          `<UML:Classifier xmi.idref="${context.typeIds.get(method.return_type) ?? UNTYPED_ID}"/>`,
        ),
      );
      lines.push(line(11, '</UML:Parameter.type>'));
      lines.push(line(11, '<UML:ModelElement.taggedValue>'));
      lines.push(tag(12, 'pos', '0'));
      lines.push(tag(12, 'type', method.return_type));
      lines.push(tag(12, 'const', '0'));
      lines.push(line(11, '</UML:ModelElement.taggedValue>'));
      lines.push(line(11, '<UML:Parameter.defaultValue>'));
      lines.push(line(12, '<UML:Expression/>'));
      lines.push(line(11, '</UML:Parameter.defaultValue>'));
      lines.push(line(10, '</UML:Parameter>'));

      lines.push(line(9, '</UML:BehavioralFeature.parameter>'));
      lines.push(line(8, '</UML:Operation>'));
    }

    lines.push(line(7, '</UML:Classifier.feature>'));
  }

  lines.push(line(6, '</UML:Class>'));

  return lines;
}

// --------------------------------------------------------------- conectores

/**
 * Las etiquetas con las que EA describe cualquier línea.
 *
 * `ea_sourceID` y `ea_targetID` son los números locales de las dos clases, no
 * sus identificadores: es como EA vuelve a atar la línea a sus extremos.
 */
function connectorTags(
  connector: Connector,
  context: Context,
  ends: { source: string; target: string },
): string[] {
  return [
    tag(8, 'style', '3'),
    tag(8, 'ea_type', EA_TYPE[connector.type] ?? 'Association'),
    tag(8, 'direction', connector.type === 'ASSOCIATION' ? 'Unspecified' : 'Source -> Destination'),
    tag(8, 'linemode', '3'),
    tag(8, 'linecolor', '-1'),
    tag(8, 'linewidth', '0'),
    tag(8, 'seqno', '0'),
    tag(8, 'headStyle', '0'),
    tag(8, 'lineStyle', '0'),
    tag(8, 'ea_localid', String(context.connectorNumbers.get(connector.id) ?? 0)),
    tag(8, 'ea_sourceName', context.classNames.get(ends.source) ?? ''),
    tag(8, 'ea_targetName', context.classNames.get(ends.target) ?? ''),
    tag(8, 'ea_sourceType', 'Class'),
    tag(8, 'ea_targetType', 'Class'),
    tag(8, 'ea_sourceID', String(context.classNumbers.get(ends.source) ?? 0)),
    tag(8, 'ea_targetID', String(context.classNumbers.get(ends.target) ?? 0)),
    tag(8, 'virtualInheritance', '0'),
  ];
}

function associationElement(connector: Connector, context: Context): string[] {
  const id = toXmiId(connector.id);
  const name = connector.name === null ? '' : ` name="${escapeXml(connector.name)}"`;
  const kind = AGGREGATION_KIND[connector.type];

  /*
   * El rombo va en el extremo del todo, y en los archivos de EA el todo es el
   * destino. En el modelo el todo es el origen, así que una agregación o una
   * composición se escriben con los dos extremos cambiados de sitio: los
   * papeles, las multiplicidades y los nombres van con ellos.
   */
  const wholeIsTarget = kind !== undefined;
  const source = wholeIsTarget ? connector.targetClassId : connector.sourceClassId;
  const target = wholeIsTarget ? connector.sourceClassId : connector.targetClassId;
  const sourceEnd = {
    classId: source,
    role: wholeIsTarget ? connector.targetRole : connector.sourceRole,
    multiplicity: wholeIsTarget ? connector.targetMultiplicity : connector.sourceMultiplicity,
    navigable: wholeIsTarget ? connector.navigableTarget : connector.navigableSource,
    aggregation: 'none',
    end: 'source' as const,
  };
  const targetEnd = {
    classId: target,
    role: wholeIsTarget ? connector.sourceRole : connector.targetRole,
    multiplicity: wholeIsTarget ? connector.sourceMultiplicity : connector.targetMultiplicity,
    navigable: wholeIsTarget ? connector.navigableSource : connector.navigableTarget,
    aggregation: kind ?? 'none',
    end: 'target' as const,
  };

  const lines: string[] = [];
  lines.push(
    line(
      6,
      `<UML:Association${name} xmi.id="${id}" visibility="public" isRoot="false" isLeaf="false" isAbstract="false">`,
    ),
  );
  lines.push(line(7, '<UML:ModelElement.taggedValue>'));
  lines.push(...connectorTags(connector, context, { source, target }));
  // «lb» y «rb» son las multiplicidades tal como se escribieron: EA las lee de
  // aquí, y así «*» no vuelve convertido en «0..*».
  if (sourceEnd.multiplicity !== null) lines.push(tag(8, 'lb', sourceEnd.multiplicity));
  if (targetEnd.multiplicity !== null) lines.push(tag(8, 'rb', targetEnd.multiplicity));
  if (connector.type === 'COMPOSITION') lines.push(tag(8, 'subtype', 'Strong'));
  if (connector.associationClassId !== null) {
    lines.push(tag(8, 'subtype', 'Class'));
    lines.push(
      tag(8, 'privatedata1', String(context.classNumbers.get(connector.associationClassId) ?? 0)),
    );
    lines.push(tag(8, 'associationclass', toXmiId(connector.associationClassId)));
  }
  lines.push(line(7, '</UML:ModelElement.taggedValue>'));

  lines.push(line(7, '<UML:Association.connection>'));
  lines.push(...associationEnd(sourceEnd));
  lines.push(...associationEnd(targetEnd));
  lines.push(line(7, '</UML:Association.connection>'));
  lines.push(line(6, '</UML:Association>'));

  return lines;
}

function associationEnd(end: {
  classId: string;
  role: string | null;
  multiplicity: string | null;
  navigable: boolean;
  aggregation: string;
  end: 'source' | 'target';
}): string[] {
  const name = end.role === null ? '' : ` name="${escapeXml(end.role)}"`;
  const multiplicity =
    end.multiplicity === null ? '' : ` multiplicity="${escapeXml(end.multiplicity)}"`;

  return [
    line(
      8,
      `<UML:AssociationEnd${name} visibility="public"${multiplicity} aggregation="${end.aggregation}" isOrdered="false" targetScope="instance" changeable="none" isNavigable="${end.navigable}" type="${toXmiId(end.classId)}">`,
    ),
    line(9, '<UML:ModelElement.taggedValue>'),
    tag(10, 'containment', 'Unspecified'),
    tag(10, end.end === 'source' ? 'sourcestyle' : 'deststyle', END_STYLE),
    tag(10, 'ea_end', end.end),
    line(9, '</UML:ModelElement.taggedValue>'),
    line(8, '</UML:AssociationEnd>'),
  ];
}

/**
 * Herencia, realización y dependencia.
 *
 * Las tres van de una clase a otra sin extremos ni multiplicidades, pero UML
 * 1.3 no las escribe con el mismo elemento, y confundirlas no es un detalle de
 * forma: un archivo que declara `UML:Generalization` dice «hereda», y
 * Enterprise Architect lo dibuja con el triángulo de la herencia aunque la
 * etiqueta `ea_type` diga otra cosa. Una dependencia exportada así volvía
 * convertida en herencia.
 *
 * Por eso hay dos caminos:
 *
 *  - La herencia es `UML:Generalization`, un elemento suelto que apunta a las
 *    dos clases: `subtype` es la hija y `supertype` la madre, que es
 *    exactamente la orientación con la que la guardamos.
 *  - La realización y la dependencia son `UML:Dependency`, con `client` —quien
 *    depende— y `supplier` —de quién depende—. Las dos comparten elemento y se
 *    distinguen por `ea_type`, que es también como las escribe EA.
 */
function directedElement(connector: Connector, context: Context): string[] {
  const id = toXmiId(connector.id);
  const source = toXmiId(connector.sourceClassId);
  const target = toXmiId(connector.targetClassId);
  const ends = { source: connector.sourceClassId, target: connector.targetClassId };

  const element =
    connector.type === 'INHERITANCE'
      ? {
          open: `<UML:Generalization subtype="${source}" supertype="${target}" xmi.id="${id}" visibility="public">`,
          close: '</UML:Generalization>',
        }
      : {
          open: `<UML:Dependency client="${source}" supplier="${target}" xmi.id="${id}" visibility="public">`,
          close: '</UML:Dependency>',
        };

  return [
    line(6, element.open),
    line(7, '<UML:ModelElement.taggedValue>'),
    ...connectorTags(connector, context, ends),
    line(7, '</UML:ModelElement.taggedValue>'),
    line(6, element.close),
  ];
}

// ----------------------------------------------------------------- diagrama

/**
 * El diagrama con la posición de cada caja.
 *
 * UML no dice nada de dónde está dibujado nada: la posición es cosa del
 * diagrama, no del modelo. Escribirla es lo que hace que al abrir el archivo
 * en EA —o al volver a importarlo aquí— las clases aparezcan donde estaban y
 * no amontonadas en una rejilla.
 *
 * Cada caja lleva un `DUID`, que es como el diagrama la nombra, y cada línea
 * dice entre qué dos DUID va (`SOID` y `EOID`). Sin eso EA tiene las clases
 * colocadas pero no sabe a qué cajas atar las líneas.
 */
function diagramElement(
  diagram: FullDiagramResponse,
  connectors: Connector[],
  context: Context,
): string[] {
  const lines: string[] = [];

  lines.push(
    line(
      2,
      `<UML:Diagram name="${escapeXml(diagram.name)}" xmi.id="${toXmiId(diagram.id, 'EAID')}" diagramType="ClassDiagram" owner="${context.packageId}" toolName="Enterprise Architect 2.5">`,
    ),
  );
  lines.push(line(3, '<UML:ModelElement.taggedValue>'));
  lines.push(tag(4, 'version', '1.0'));
  lines.push(tag(4, 'author', 'CASE-Tool'));
  lines.push(tag(4, 'created_date', context.created));
  lines.push(tag(4, 'modified_date', context.modified));
  lines.push(tag(4, 'package', context.packageId));
  lines.push(tag(4, 'type', 'Logical'));
  lines.push(tag(4, 'ea_localid', '1'));
  lines.push(
    tag(
      4,
      'EAStyle',
      'ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=0;PPgs.cy=0;DocSize.cx=827;DocSize.cy=1169;ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;VisibleAttributeDetail=0;ShowOpRetType=1;ShowIcons=1;CollabNums=0;HideProps=0;ShowReqs=0;ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;HideElemStereo=0;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;ExplicitNavigability=0;ShowShape=1;AllDockable=0;',
    ),
  );
  lines.push(line(3, '</UML:ModelElement.taggedValue>'));
  lines.push(line(3, '<UML:Diagram.element>'));

  /*
   * Las coordenadas del lienzo pueden ser negativas y las de EA no: si alguna
   * lo es se desplaza el dibujo entero hasta el margen, sin cambiar las
   * distancias entre las cajas. Un diagrama que ya cabe no se toca.
   */
  const shift = (values: number[]): number => {
    const smallest = Math.min(...values);

    return smallest < 0 ? smallest - DIAGRAM_MARGIN : 0;
  };
  const shiftX = shift(diagram.classes.map((umlClass) => umlClass.pos_x));
  const shiftY = shift(diagram.classes.map((umlClass) => umlClass.pos_y));

  for (const [index, umlClass] of diagram.classes.entries()) {
    const left = Math.round(umlClass.pos_x - shiftX);
    const top = Math.round(umlClass.pos_y - shiftY);
    const right = left + Math.round(umlClass.width ?? DEFAULT_WIDTH);
    const bottom = top + Math.round(umlClass.height ?? DEFAULT_HEIGHT);

    lines.push(
      line(
        4,
        `<UML:DiagramElement geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${toXmiId(umlClass.id)}" seqno="${index + 1}" style="DUID=${duid(umlClass.id)};"/>`,
      ),
    );
  }

  for (const connector of connectors) {
    // En una agregación o una composición la línea se escribió con los
    // extremos cambiados; el dibujo tiene que decir lo mismo.
    const swapped = AGGREGATION_KIND[connector.type] !== undefined;
    const from = swapped ? connector.targetClassId : connector.sourceClassId;
    const to = swapped ? connector.sourceClassId : connector.targetClassId;

    lines.push(
      line(
        4,
        `<UML:DiagramElement geometry="SX=0;SY=0;EX=0;EY=0;EDGE=2;$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;Path=;" subject="${toXmiId(connector.id)}" style="Mode=3;EOID=${duid(to)};SOID=${duid(from)};Color=-1;LWidth=0;Hidden=0;"/>`,
      ),
    );
  }

  lines.push(line(3, '</UML:Diagram.element>'));
  lines.push(line(2, '</UML:Diagram>'));

  return lines;
}

// ------------------------------------------------------------------ formato

/** Una línea con la sangría de tabuladores que le toca. */
function line(depth: number, text: string): string {
  return `${'\t'.repeat(depth)}${text}`;
}

/** Una etiqueta de las que EA cuelga de cada elemento. */
function tag(depth: number, name: string, value: string): string {
  return line(depth, `<UML:TaggedValue tag="${name}" value="${escapeXml(value)}"/>`);
}

/** «2026-09-21 15:40:00», que es como EA escribe las fechas. */
function eaDate(isoDate: string): string {
  const date = new Date(isoDate);
  const value = Number.isNaN(date.getTime()) ? new Date() : date;

  return value.toISOString().replace('T', ' ').slice(0, 19);
}

/** Un UUID con la forma que EA da a los suyos: «{2130EF14-C88B-...}». */
function eaGuid(uuid: string): string {
  return `{${uuid.toUpperCase()}}`;
}

/**
 * El nombre con el que el diagrama se refiere a una caja.
 *
 * EA usa ocho dígitos hexadecimales, distintos de los del elemento: el mismo
 * elemento puede estar dibujado en varios diagramas. Como aquí cada clase se
 * dibuja una sola vez, se toman los del identificador de la clase, que ya es
 * único y no cambia entre dos exportaciones.
 */
function duid(classId: string): string {
  return classId.replace(/-/g, '').slice(0, 8).toUpperCase();
}
