import { randomUUID } from 'node:crypto';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
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
 * Estructura que se genera:
 *
 *   XMI
 *     XMI.header
 *     XMI.content
 *       UML:Model
 *         UML:Namespace.ownedElement
 *           UML:Package                      ← el diagrama
 *             UML:Class                      ← cada clase
 *               UML:Classifier.feature
 *                 UML:Attribute              ← cada atributo
 *                 UML:Operation              ← cada método
 *             UML:Association                ← asociaciones, con sus extremos
 *             UML:Generalization             ← herencias
 *           UML:DataType                     ← los tipos que se usan
 *       UML:Diagram                          ← posiciones de las cajas
 */

/** Relaciones que en UML son una asociación con dos extremos. */
const ASSOCIATIONS = new Set(['ASSOCIATION', 'AGGREGATION', 'COMPOSITION']);

/**
 * El adorno de agregación en UML 1.3.
 *
 * Aquí está la trampa del formato: en UML 1.x el extremo marcado es el del
 * **todo**, mientras que en UML 2.x es el de la **parte**. Como en nuestro
 * modelo el origen es siempre el todo, el adorno va en el extremo de origen.
 */
const AGGREGATION_KIND: Record<string, string> = {
  AGGREGATION: 'aggregate',
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
 * Identificador del tipo «sin determinar».
 *
 * Enterprise Architect declara un DataType sin nombre y apunta a él desde los
 * atributos que no tienen tipo. Reproducirlo es lo que permite que un atributo
 * sin tipo siga sin tipo al volver: si se omitiera el tipo, EA le pondría uno
 * por su cuenta al abrir el archivo.
 */
const UNTYPED_ID = 'eaxmiid0';

export function generateXmi(diagram: FullDiagramResponse): string {
  const packageId = toXmiId(diagram.id, 'EAPK');
  const modelId = `MX_${toXmiId(randomUUID())}`;
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  /*
   * Los tipos de dato se declaran una vez y quien los usa los referencia.
   * Hay que recorrer también las firmas de los métodos, no sólo los
   * atributos: un tipo referenciado sin declarar deja la referencia colgando,
   * y al volver a importar el archivo ese parámetro llega sin tipo.
   */
  const usedTypes = [
    ...new Set(
      diagram.classes.flatMap((umlClass) => [
        ...umlClass.attributes.map((attribute) => attribute.data_type),
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

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<XMI xmi.version="1.1" xmlns:UML="omg.org/UML1.3" timestamp="${timestamp}">`);
  lines.push('	<XMI.header>');
  lines.push('		<XMI.documentation>');
  lines.push('			<XMI.exporter>CASE-Tool</XMI.exporter>');
  lines.push('			<XMI.exporterVersion>1.0</XMI.exporterVersion>');
  lines.push('		</XMI.documentation>');
  lines.push('	</XMI.header>');
  lines.push('	<XMI.content>');
  lines.push(`		<UML:Model name="EA Model" xmi.id="${modelId}">`);
  lines.push('			<UML:Namespace.ownedElement>');
  lines.push(
    `				<UML:Package name="${escapeXml(diagram.name)}" xmi.id="${packageId}" isRoot="false" isLeaf="false" isAbstract="false" visibility="public">`,
  );
  lines.push('					<UML:Namespace.ownedElement>');

  for (const umlClass of diagram.classes) {
    lines.push(...classElement(umlClass, packageId, typeIds));
  }

  for (const relationship of diagram.relationships) {
    if (ASSOCIATIONS.has(relationship.relationship_type)) {
      lines.push(...associationElement(relationship));
    } else {
      lines.push(...directedElement(relationship));
    }
  }

  lines.push('					</UML:Namespace.ownedElement>');
  lines.push('				</UML:Package>');

  // El tipo «sin determinar» va primero, como en los archivos de EA.
  lines.push(
    `				<UML:DataType xmi.id="${UNTYPED_ID}" visibility="private" isRoot="false" isLeaf="false" isAbstract="false"/>`,
  );
  for (const [name, id] of typeIds) {
    lines.push(
      `				<UML:DataType xmi.id="${id}" name="${escapeXml(name)}" visibility="private" isRoot="false" isLeaf="false" isAbstract="false"/>`,
    );
  }

  lines.push('			</UML:Namespace.ownedElement>');
  lines.push('		</UML:Model>');
  lines.push(...diagramElement(diagram, packageId));
  lines.push('	</XMI.content>');
  lines.push('	<XMI.difference/>');
  lines.push('	<XMI.extensions xmi.extender="CASE-Tool"/>');
  lines.push('</XMI>');

  return `${lines.join('\n')}\n`;
}

/** Una etiqueta de las que EA cuelga de cada elemento. */
function tag(name: string, value: string): string {
  return `						<UML:TaggedValue tag="${name}" value="${escapeXml(value)}"/>`;
}

function classElement(
  umlClass: FullDiagramResponse['classes'][number],
  packageId: string,
  typeIds: Map<string, string>,
): string[] {
  const id = toXmiId(umlClass.id);
  const lines: string[] = [];

  lines.push(
    `						<UML:Class name="${escapeXml(umlClass.name)}" xmi.id="${id}" visibility="${umlClass.visibility}" namespace="${packageId}" isRoot="false" isLeaf="false" isAbstract="${umlClass.is_abstract}" isActive="false">`,
  );

  lines.push('							<UML:ModelElement.taggedValue>');
  lines.push(tag('ea_stype', 'Class'));
  lines.push(tag('isSpecification', 'false'));
  if (umlClass.stereotype !== null) lines.push(tag('stereotype', umlClass.stereotype));
  lines.push(tag('package', packageId));
  lines.push('							</UML:ModelElement.taggedValue>');

  if (umlClass.attributes.length > 0 || umlClass.methods.length > 0) {
    lines.push('							<UML:Classifier.feature>');

    for (const attribute of umlClass.attributes) {
      const typeId = attribute.data_type === null ? UNTYPED_ID : typeIds.get(attribute.data_type)!;

      lines.push(
        `								<UML:Attribute name="${escapeXml(attribute.name)}" changeable="none" visibility="${attribute.visibility}" ownerScope="instance" targetScope="instance">`,
      );
      lines.push('									<UML:Attribute.initialValue>');
      lines.push(
        attribute.default_value === null
          ? '										<UML:Expression/>'
          : `										<UML:Expression body="${escapeXml(attribute.default_value)}"/>`,
      );
      lines.push('									</UML:Attribute.initialValue>');
      lines.push('									<UML:StructuralFeature.type>');
      lines.push(`										<UML:Classifier xmi.idref="${typeId}"/>`);
      lines.push('									</UML:StructuralFeature.type>');
      lines.push('									<UML:ModelElement.taggedValue>');
      // El tipo se repite en las etiquetas porque es donde EA lo lee.
      if (attribute.data_type !== null) lines.push(tag('type', attribute.data_type));
      lines.push(tag('position', String(attribute.order_index)));
      lines.push(tag('lowerBound', attribute.is_nullable ? '0' : '1'));
      lines.push(tag('upperBound', '1'));
      lines.push('									</UML:ModelElement.taggedValue>');
      lines.push('								</UML:Attribute>');
    }

    for (const method of umlClass.methods) {
      lines.push(
        `								<UML:Operation name="${escapeXml(method.name)}" visibility="${method.visibility}" ownerScope="instance" isQuery="false" concurrency="sequential">`,
      );
      lines.push('									<UML:BehavioralFeature.parameter>');

      for (const parameter of method.parameters) {
        lines.push(
          `										<UML:Parameter name="${escapeXml(parameter.name)}" kind="in">`,
        );
        lines.push('											<UML:Parameter.type>');
        lines.push(
          `												<UML:Classifier xmi.idref="${typeIds.get(parameter.data_type) ?? UNTYPED_ID}"/>`,
        );
        lines.push('											</UML:Parameter.type>');
        lines.push('										</UML:Parameter>');
      }

      // El retorno es un parámetro más, marcado como tal: así lo hace UML 1.x.
      if (method.return_type !== 'void') {
        lines.push('										<UML:Parameter name="return" kind="return">');
        lines.push('											<UML:Parameter.type>');
        lines.push(
          `												<UML:Classifier xmi.idref="${typeIds.get(method.return_type) ?? UNTYPED_ID}"/>`,
        );
        lines.push('											</UML:Parameter.type>');
        lines.push('										</UML:Parameter>');
      }

      lines.push('									</UML:BehavioralFeature.parameter>');
      lines.push('								</UML:Operation>');
    }

    lines.push('							</UML:Classifier.feature>');
  }

  lines.push('						</UML:Class>');

  return lines;
}

function associationElement(
  relationship: FullDiagramResponse['relationships'][number],
): string[] {
  const id = toXmiId(relationship.id);
  const name = relationship.name === null ? '' : ` name="${escapeXml(relationship.name)}"`;
  const aggregation = AGGREGATION_KIND[relationship.relationship_type] ?? 'none';

  const lines: string[] = [];
  lines.push(
    `						<UML:Association${name} xmi.id="${id}" visibility="public" isRoot="false" isLeaf="false" isAbstract="false">`,
  );
  lines.push('							<UML:ModelElement.taggedValue>');
  lines.push(tag('ea_type', EA_TYPE[relationship.relationship_type] ?? 'Association'));
  lines.push(tag('direction', 'Unspecified'));
  // «lb» y «rb» son las multiplicidades tal como se escribieron: EA las lee de
  // aquí, y así «*» no vuelve convertido en «0..*».
  if (relationship.source_multiplicity !== null) {
    lines.push(tag('lb', relationship.source_multiplicity));
  }
  if (relationship.target_multiplicity !== null) {
    lines.push(tag('rb', relationship.target_multiplicity));
  }
  if (relationship.relationship_type === 'COMPOSITION') lines.push(tag('subtype', 'Strong'));
  lines.push('							</UML:ModelElement.taggedValue>');

  lines.push('							<UML:Association.connection>');
  lines.push(
    ...associationEnd({
      classId: relationship.source_class_id,
      role: relationship.source_role,
      multiplicity: relationship.source_multiplicity,
      navigable: relationship.is_navigable_source,
      // El adorno va en el extremo del todo, que en nuestro modelo es el origen.
      aggregation,
      end: 'source',
    }),
  );
  lines.push(
    ...associationEnd({
      classId: relationship.target_class_id,
      role: relationship.target_role,
      multiplicity: relationship.target_multiplicity,
      navigable: relationship.is_navigable_target,
      aggregation: 'none',
      end: 'target',
    }),
  );
  lines.push('							</UML:Association.connection>');
  lines.push('						</UML:Association>');

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
    `								<UML:AssociationEnd${name} visibility="public"${multiplicity} aggregation="${end.aggregation}" isOrdered="false" targetScope="instance" changeable="none" isNavigable="${end.navigable}" type="${toXmiId(end.classId)}">`,
    '									<UML:ModelElement.taggedValue>',
    `										<UML:TaggedValue tag="ea_end" value="${end.end}"/>`,
    '									</UML:ModelElement.taggedValue>',
    '								</UML:AssociationEnd>',
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
function directedElement(
  relationship: FullDiagramResponse['relationships'][number],
): string[] {
  const id = toXmiId(relationship.id);
  const source = toXmiId(relationship.source_class_id);
  const target = toXmiId(relationship.target_class_id);
  const eaType = EA_TYPE[relationship.relationship_type] ?? 'Generalization';

  if (relationship.relationship_type === 'INHERITANCE') {
    return [
      `						<UML:Generalization subtype="${source}" supertype="${target}" xmi.id="${id}" visibility="public">`,
      '							<UML:ModelElement.taggedValue>',
      tag('ea_type', eaType),
      tag('direction', 'Source -> Destination'),
      '							</UML:ModelElement.taggedValue>',
      '						</UML:Generalization>',
    ];
  }

  return [
    `						<UML:Dependency client="${source}" supplier="${target}" xmi.id="${id}" visibility="public">`,
    '							<UML:ModelElement.taggedValue>',
    tag('ea_type', eaType),
    tag('direction', 'Source -> Destination'),
    '							</UML:ModelElement.taggedValue>',
    '						</UML:Dependency>',
  ];
}

/**
 * El diagrama con la posición de cada caja.
 *
 * UML no dice nada de dónde está dibujado nada: la posición es cosa del
 * diagrama, no del modelo. Escribirla es lo que hace que al abrir el archivo
 * en EA —o al volver a importarlo aquí— las clases aparezcan donde estaban y
 * no amontonadas en una rejilla.
 */
function diagramElement(diagram: FullDiagramResponse, packageId: string): string[] {
  const lines: string[] = [];

  lines.push(
    `		<UML:Diagram name="${escapeXml(diagram.name)}" xmi.id="${toXmiId(diagram.id, 'EADG')}" diagramType="ClassDiagram" owner="${packageId}" toolName="CASE-Tool">`,
  );
  lines.push('			<UML:ModelElement.taggedValue>');
  lines.push(`				<UML:TaggedValue tag="package" value="${packageId}"/>`);
  lines.push('				<UML:TaggedValue tag="type" value="Logical"/>');
  lines.push('			</UML:ModelElement.taggedValue>');
  lines.push('			<UML:Diagram.element>');

  for (const [index, umlClass] of diagram.classes.entries()) {
    const left = Math.round(umlClass.pos_x);
    const top = Math.round(umlClass.pos_y);
    const right = left + Math.round(umlClass.width ?? DEFAULT_WIDTH);
    const bottom = top + Math.round(umlClass.height ?? DEFAULT_HEIGHT);

    lines.push(
      `				<UML:DiagramElement geometry="Left=${left};Top=${top};Right=${right};Bottom=${bottom};" subject="${toXmiId(umlClass.id)}" seqno="${index + 1}"/>`,
    );
  }

  for (const relationship of diagram.relationships) {
    lines.push(
      `				<UML:DiagramElement geometry="SX=0;SY=0;EX=0;EY=0;" subject="${toXmiId(relationship.id)}"/>`,
    );
  }

  lines.push('			</UML:Diagram.element>');
  lines.push('		</UML:Diagram>');

  return lines;
}
