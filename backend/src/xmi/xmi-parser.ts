import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fromBounds, toVisibility } from './xmi-format.js';

/**
 * CU06 — De un archivo XMI a algo que el editor pueda crear.
 *
 * Lo que sale de aquí no es un modelo nuevo: es una lectura del archivo, con
 * los nombres y las referencias ya resueltos, que XmiService convierte en
 * clases y relaciones llamando a los mismos servicios que usa el lienzo.
 *
 * El analizador es deliberadamente tolerante con la forma y estricto con el
 * contenido. Tolerante porque cada herramienta escribe XMI a su manera, así
 * que en lugar de seguir rutas fijas se recorre el árbol entero buscando
 * elementos por lo que son. Estricto porque una relación que apunte a una
 * clase que no está en el archivo no se importa: dejaría una línea hacia
 * ninguna parte.
 *
 * Se leen las dos generaciones del formato, que se parecen mucho menos de lo
 * que su nombre sugiere:
 *
 *   XMI 2.1 (UML 2.x)          XMI 1.1 (UML 1.3) — lo que exporta EA por defecto
 *   ─────────────────          ────────────────────────────────────────────────
 *   xmi:id                     xmi.id  (punto, no dos puntos)
 *   packagedElement            UML:Class, UML:Association, UML:Generalization
 *     xmi:type="uml:Class"       (el tipo lo dice la etiqueta)
 *   ownedAttribute             UML:Classifier.feature > UML:Attribute
 *   <type xmi:idref="…"/>      UML:StructuralFeature.type > UML:Classifier
 *   ownedEnd / memberEnd       UML:Association.connection > UML:AssociationEnd
 *   lowerValue/upperValue      multiplicity="0..*" en el propio extremo
 *   generalization (anidada)   UML:Generalization suelta, con subtype/supertype
 *   xmi:Extension > geometry   UML:Diagram > UML:DiagramElement > geometry
 *
 * Hay además una diferencia de significado que no se ve en la estructura: en
 * UML 1.x el extremo marcado como agregación es el del **todo**, y en UML 2.x
 * es el de la **parte**. Leerlo mal invierte la relación, así que cada camino
 * lo trata a su manera.
 *
 * Lo que no se entiende no rompe la importación: se cuenta aparte y se le
 * dice al usuario cuántos elementos se omitieron.
 */

export interface ParsedAttribute {
  /** El identificador del archivo; con él se completa el tipo desde la extensión de EA. */
  id: string | null;
  name: string;
  /** null = el archivo no dice de qué tipo es. No se rellena. */
  type: string | null;
  visibility: string;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue: string | null;
}

export interface ParsedParameter {
  name: string;
  type: string | null;
}

export interface ParsedMethod {
  name: string;
  /** null = el archivo no declara retorno; el servicio usará «void». */
  returnType: string | null;
  visibility: string;
  parameters: ParsedParameter[];
}

export interface ParsedClass {
  /** El identificador que traía el archivo; sirve para las relaciones. */
  id: string;
  name: string;
  isAbstract: boolean;
  visibility: string;
  attributes: ParsedAttribute[];
  methods: ParsedMethod[];
  /** Posición leída del diagrama, si el archivo la traía. */
  position: { x: number; y: number } | null;
}

export interface ParsedRelationship {
  /** El identificador del archivo, para cruzarlo con el bloque de extensión. */
  id: string | null;
  type: 'ASSOCIATION' | 'AGGREGATION' | 'COMPOSITION' | 'INHERITANCE' | 'REALIZATION' | 'DEPENDENCY';
  source: string;
  target: string;
  sourceMultiplicity: string | null;
  targetMultiplicity: string | null;
  name: string | null;
  sourceRole: string | null;
  targetRole: string | null;
  /**
   * Clase intermedia de un muchos a muchos, si la asociación tenía una.
   * Se resuelve al final, cuando ya se han leído todas las clases.
   */
  associationClass?: string | null;
}

export interface ParsedXmi {
  /** Nombre del paquete o del modelo, para proponerlo como nombre del diagrama. */
  name: string | null;
  classes: ParsedClass[];
  relationships: ParsedRelationship[];
  /** Elementos UML reconocidos pero que esta herramienta no sabe representar. */
  skipped: string[];
}

/** Error de lectura del archivo, con un motivo que se le puede enseñar. */
export class XmiParseError extends Error {}

type Node = Record<string, unknown>;

/** Atributos XML que fast-xml-parser deja con este prefijo. */
const ATTR = '@_';

/**
 * Se quitan los prefijos de espacio de nombres al leer: así `uml:Class`,
 * `UML:Class` y `Class` son lo mismo, y `xmi:type` y `xsi:type` también. Es lo
 * que permite leer archivos de distintas herramientas con un solo camino.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
  // Una tilde puede venir escrita como «&#237;» —así la escribe esta misma
  // herramienta al exportar, para no depender de la codificación del archivo—.
  // Sin esto, «Categoría» llegaría como «Categor&#237;a».
  htmlEntities: true,
  // Un elemento que aparece una sola vez llega como objeto y no como lista;
  // `asList` se encarga de que el recorrido no tenga que distinguirlo.
  isArray: () => false,
});

export function parseXmi(xml: string): ParsedXmi {
  const wellFormed = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (wellFormed !== true) {
    throw new XmiParseError(
      `El archivo no es XML válido: ${wellFormed.err.msg} (línea ${wellFormed.err.line}).`,
    );
  }

  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch (error) {
    throw new XmiParseError(
      `No se pudo leer el archivo: ${error instanceof Error ? error.message : 'XML ilegible'}.`,
    );
  }

  // Sin raíz XMI ni modelo UML no es un archivo de intercambio UML, por muy
  // válido que sea el XML.
  if (document.XMI === undefined && document.Model === undefined) {
    throw new XmiParseError(
      'El archivo no parece un XMI de UML: no se encontró el elemento raíz «xmi:XMI» ni «uml:Model».',
    );
  }

  const collector = new Collector();
  collector.walk(document, null);

  if (collector.classes.size === 0) {
    throw new XmiParseError('El archivo no contiene ninguna clase UML que importar.');
  }

  return collector.result();
}

/**
 * Recorre el árbol entero anotando lo que reconoce.
 *
 * Se recorre todo en lugar de seguir la ruta «XMI → Model → packagedElement»
 * porque esa ruta cambia de una herramienta a otra: unas meten las clases en
 * paquetes anidados, otras las dejan al nivel del modelo, y EA además repite
 * información dentro de su bloque de extensión.
 */
class Collector {
  readonly classes = new Map<string, ParsedClass>();
  /** Identificador → nombre, para resolver los tipos de los atributos. */
  private readonly typeNames = new Map<string, string>();
  private readonly relationships: ParsedRelationship[] = [];
  private readonly generalizations: { child: string; parent: string; id: string }[] = [];
  private readonly geometry = new Map<string, { x: number; y: number }>();
  /** Identificador de atributo → tipo, leído del bloque de extensión de EA. */
  private readonly extensionTypes = new Map<string, string>();
  /** Identificador de relación → multiplicidades escritas tal cual. */
  private readonly connectorEnds = new Map<
    string,
    { sourceClass: string | null; source: string | null; target: string | null }
  >();
  private readonly skipped = new Set<string>();
  private packageName: string | null = null;
  private modelName: string | null = null;

  walk(node: unknown, tag: string | null): void {
    if (Array.isArray(node)) {
      for (const child of node) this.walk(child, tag);
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    const element = node as Node;
    const kind = typeOf(element, tag);

    switch (kind) {
      case 'Class':
      case 'Interface':
      case 'Enumeration':
        this.readClass(element, kind);
        break;
      case 'PrimitiveType':
      case 'DataType':
        this.readTypeName(element);
        break;
      case 'Association':
        this.readAssociation(element);
        break;
      case 'Generalization':
        this.readGeneralization(element);
        break;
      case 'Realization':
      case 'Abstraction':
        this.readDirected(element, 'REALIZATION');
        break;
      case 'Dependency':
      case 'Usage':
        this.readDirected(element, 'DEPENDENCY');
        break;
      case 'Package':
        // El paquete es lo que se corresponde con un diagrama nuestro, así que
        // su nombre es el mejor candidato para el diagrama importado.
        if (this.packageName === null) this.packageName = text(element[`${ATTR}name`]);
        break;
      case 'Model':
        if (this.modelName === null) this.modelName = text(element[`${ATTR}name`]);
        break;
      case 'StateMachine':
      case 'Activity':
      case 'UseCase':
      case 'Component':
      case 'Actor':
        // Se reconoce que están y que no se importan; el usuario lo verá en el
        // resumen en lugar de preguntarse por qué faltan.
        this.skipped.add(kind);
        break;
      default:
        break;
    }

    // La geometría va en `element` dentro de la extensión de EA (XMI 2.1) y
    // en `DiagramElement` dentro de UML:Diagram (XMI 1.1).
    if (
      (tag === 'element' || tag === 'DiagramElement') &&
      element[`${ATTR}geometry`] !== undefined
    ) {
      this.readGeometry(element);
    }
    if (tag === 'attribute') {
      this.readExtensionType(element);
    }
    if (tag === 'connector') {
      this.readConnector(element);
    }

    for (const [key, value] of Object.entries(element)) {
      if (key.startsWith(ATTR)) continue;
      this.walk(value, key);
    }
  }

  private readClass(element: Node, kind: string): void {
    const id = idOf(element);
    const name = text(element[`${ATTR}name`]);
    if (id === null || name === null) return;

    // EA repite las clases dentro de su bloque de extensión; la primera
    // lectura, la del modelo, es la buena.
    if (this.classes.has(id)) return;

    // Clase interna de Enterprise Architect: está en todos sus modelos y no
    // representa nada del usuario.
    if (name === 'EARootClass') return;

    this.typeNames.set(id, name);

    // Los miembros cuelgan de la clase en XMI 2.x y de `Classifier.feature`
    // en XMI 1.1; `members` mira en los dos sitios.
    const attributes: ParsedAttribute[] = [];
    for (const raw of members(element, 'ownedAttribute', 'Attribute')) {
      const attribute = this.readAttribute(raw);
      if (attribute !== null) attributes.push(attribute);
    }

    const methods: ParsedMethod[] = [];
    for (const raw of members(element, 'ownedOperation', 'Operation')) {
      const method = this.readMethod(raw);
      if (method !== null) methods.push(method);
    }

    // En XMI 2.x la generalización va dentro de la clase hija. En XMI 1.1 es
    // un elemento suelto y lo recoge readGeneralization.
    for (const raw of asList(element.generalization)) {
      const parent = generalOf(raw);
      if (parent !== null) {
        this.generalizations.push({ child: id, parent, id: idOf(raw) ?? `${id}_gen` });
      }
    }

    this.classes.set(id, {
      id,
      name,
      // Una interfaz no es abstracta por serlo, pero en nuestro modelo se
      // representa con el estereotipo; el servicio lo traduce.
      isAbstract: element[`${ATTR}isAbstract`] === 'true' || kind === 'Interface',
      visibility: toVisibility(text(element[`${ATTR}visibility`]) ?? undefined, 'public'),
      attributes,
      methods,
      position: null,
    });
  }

  /**
   * Una operación con sus parámetros.
   *
   * El tipo de retorno no es un campo: se escribe como un parámetro más,
   * marcado con `direction` (UML 2) o `kind` (UML 1.x) igual a «return».
   */
  private readMethod(raw: unknown): ParsedMethod | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const element = raw as Node;
    const name = text(element[`${ATTR}name`]);
    if (name === null) return null;

    const parameters: ParsedParameter[] = [];
    let returnType: string | null = null;

    for (const entry of members(element, 'ownedParameter', 'Parameter')) {
      if (typeof entry !== 'object' || entry === null) continue;

      const parameter = entry as Node;
      const direction = (
        text(parameter[`${ATTR}direction`]) ??
        text(parameter[`${ATTR}kind`]) ??
        'in'
      ).toLowerCase();

      if (direction === 'return') {
        returnType = this.typeReference(parameter);
        continue;
      }

      const parameterName = text(parameter[`${ATTR}name`]);
      if (parameterName !== null) {
        parameters.push({ name: parameterName, type: this.typeReference(parameter) });
      }
    }

    return {
      name,
      returnType,
      visibility: toVisibility(text(element[`${ATTR}visibility`]) ?? undefined, 'public'),
      parameters,
    };
  }

  /**
   * Generalización suelta de XMI 1.1: `subtype` es la clase hija y `supertype`
   * la madre, que es justo la orientación con la que guardamos la herencia.
   */
  private readGeneralization(element: Node): void {
    const child =
      text(element[`${ATTR}subtype`]) ?? text(element[`${ATTR}child`]) ?? refOf(element.specific);
    const parent =
      text(element[`${ATTR}supertype`]) ?? text(element[`${ATTR}parent`]) ?? generalOf(element);

    if (child === null || parent === null || child === parent) return;

    this.generalizations.push({ child, parent, id: idOf(element) ?? `${child}_${parent}` });
  }

  private readAttribute(raw: unknown): ParsedAttribute | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const element = raw as Node;
    const name = text(element[`${ATTR}name`]);
    if (name === null) return null;

    // Los extremos de una asociación también son propiedades y aparecen como
    // ownedAttribute en algunas herramientas: no son atributos de la clase.
    if (element[`${ATTR}association`] !== undefined) return null;

    const bounds = boundsOf(element);

    return {
      id: idOf(element),
      name,
      type: this.typeReference(element),
      visibility: toVisibility(text(element[`${ATTR}visibility`]) ?? undefined, 'private'),
      // Sin límite inferior declarado se asume opcional, que es como nace un
      // atributo en la base de datos.
      isNullable: bounds.lower === undefined ? true : bounds.lower === '0',
      isUnique: element[`${ATTR}isUnique`] === 'true',
      defaultValue: valueOf(element.defaultValue),
    };
  }

  /**
   * El tipo de un atributo puede venir de cuatro maneras según la herramienta:
   * como elemento `<type xmi:idref="…">`, como atributo `type="…"`, como
   * `href` a una biblioteca de tipos, o dentro del bloque de EA. Si no viene
   * de ninguna, el atributo se queda sin tipo y así se guarda.
   */
  private typeReference(element: Node): string | null {
    // XMI 1.1 mete el tipo en un envoltorio: el `UML:Classifier` de dentro es
    // el que lleva la referencia.
    const wrapper = element['StructuralFeature.type'] ?? element['Parameter.type'];
    if (typeof wrapper === 'object' && wrapper !== null) {
      const reference = refOf((wrapper as Node).Classifier ?? (wrapper as Node).DataType);
      if (reference !== null) return `#${reference}`;
    }

    // Y también lo repite entre sus etiquetas, que a veces es lo único legible.
    const tagged = this.taggedValues(element).get('type');
    if (tagged !== undefined) return tagged;

    const child = element.type;

    if (typeof child === 'object' && child !== null) {
      const node = child as Node;
      const reference = text(node[`${ATTR}idref`]) ?? text(node[`${ATTR}id`]);
      if (reference !== null) {
        // Puede referirse a un tipo declarado o a otra clase del archivo; en
        // los dos casos el nombre se resuelve al final.
        return `#${reference}`;
      }

      const href = text(node[`${ATTR}href`]);
      if (href !== null) {
        // «http://…/UML/20131001/PrimitiveTypes.xmi#String» → «String».
        return href.split('#').pop() ?? null;
      }
    }

    const declared = text(child) ?? text(element[`${ATTR}type`]);

    // Al quitar los prefijos de espacio de nombres, el `xmi:type` que dice de
    // qué metaclase UML es el elemento —«uml:Property»— cae en la misma clave
    // que un tipo de dato declarado como atributo. Los dos puntos son lo que
    // los distingue: ningún tipo de dato se llama «uml:algo».
    return declared === null || declared.includes(':') ? null : declared;
  }

  private readTypeName(element: Node): void {
    const id = idOf(element);
    const name = text(element[`${ATTR}name`]);

    if (id !== null && name !== null) this.typeNames.set(id, name);
  }

  /** Un hijo del elemento, buscando también por su nombre sin prefijo. */
  private child(element: Node, key: string): Node | null {
    const value = element[key];

    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Node)
      : null;
  }

  /**
   * Las etiquetas de EA, como un diccionario.
   *
   * Enterprise Architect guarda en `ModelElement.taggedValue` casi todo lo que
   * UML no tiene dónde poner: el tipo de un atributo, si admite nulos, cuál de
   * los dos extremos de una asociación es el origen. A veces es el único sitio
   * donde está el dato.
   */
  private taggedValues(element: Node): Map<string, string> {
    const values = new Map<string, string>();
    const container = this.child(element, 'ModelElement.taggedValue');
    if (container === null) return values;

    for (const entry of asList(container.TaggedValue)) {
      if (typeof entry !== 'object' || entry === null) continue;

      const node = entry as Node;
      const tag = text(node[`${ATTR}tag`]);
      const value = text(node[`${ATTR}value`]);

      if (tag !== null && value !== null) values.set(tag, value);
    }

    return values;
  }

  /**
   * Pone los extremos en orden origen-destino según la etiqueta `ea_end`.
   * Devuelve null cuando el archivo no lo dice y hay que fiarse del orden.
   */
  private orderedEnds(ends: Node[]): [Node, Node] | null {
    const source = ends.find((end) => this.taggedValues(end).get('ea_end') === 'source');
    const target = ends.find((end) => this.taggedValues(end).get('ea_end') === 'target');

    return source !== undefined && target !== undefined && source !== target
      ? [source, target]
      : null;
  }

  /**
   * Una asociación y sus dos extremos.
   *
   * El primero es el origen y el segundo el destino. Lo delicado es el rombo:
   * en UML 2.x lo lleva el extremo de la **parte** y en UML 1.x el del
   * **todo**, de modo que la misma marca significa lo contrario en cada
   * versión. Como en nuestro modelo el origen es siempre el todo, hay que
   * saber qué se está leyendo para no importar la relación al revés.
   */
  private readAssociation(element: Node): void {
    // UML 1.x: los extremos van dentro de `Association.connection`.
    const connection = asList(
      (this.child(element, 'Association.connection') ?? {}).AssociationEnd,
    ).filter((end): end is Node => typeof end === 'object' && end !== null);

    const uml1 = connection.length >= 2;
    const ends = uml1
      ? connection
      : [
          ...asList(element.ownedEnd),
          ...asList(element.memberEnd).filter((end) => endType(end as Node) !== null),
        ].filter((end): end is Node => typeof end === 'object' && end !== null);

    if (ends.length < 2) {
      this.skipped.add('Association');
      return;
    }

    // UML 1.x nombra los extremos en sus etiquetas; es más fiable que el
    // orden en que aparecen.
    const byRole = uml1 ? this.orderedEnds(ends) : null;
    let [first, second] = byRole ?? ends;

    let aggregation = kindOf(second) ?? kindOf(first);
    const markedEnd = kindOf(first) !== null ? first : kindOf(second) !== null ? second : null;

    if (markedEnd !== null) {
      // El todo es el extremo marcado en UML 1.x y el contrario en UML 2.x.
      const whole = uml1 ? markedEnd : markedEnd === first ? second : first;

      if (whole === second) {
        [first, second] = [second, first];
      }
      aggregation = kindOf(markedEnd);
    }

    const source = endType(first);
    const target = endType(second);
    if (source === null || target === null) {
      this.skipped.add('Association');
      return;
    }

    this.relationships.push({
      id: idOf(element),
      type: aggregation ?? 'ASSOCIATION',
      source,
      target,
      sourceMultiplicity: multiplicityOf(first),
      targetMultiplicity: multiplicityOf(second),
      name: text(element[`${ATTR}name`]),
      sourceRole: text(first[`${ATTR}name`]),
      targetRole: text(second[`${ATTR}name`]),
      // Enterprise Architect cuelga aquí la clase intermedia de un muchos a
      // muchos; sin esto, esa clase se importa suelta y la relación que le da
      // sentido se pierde.
      associationClass: this.taggedValues(element).get('associationclass') ?? null,
    });
  }

  /**
   * Dependencia y realización.
   *
   * En UML 1.3 las dos se escriben con el mismo elemento, `UML:Dependency`, y
   * lo que las distingue es la etiqueta `ea_type` de Enterprise Architect
   * —«Realisation», con la grafía británica que usa EA—. Sin mirarla, una
   * realización se importa como una dependencia corriente y la flecha
   * discontinua pierde el triángulo que la hacía una realización.
   */
  private readDirected(element: Node, type: 'REALIZATION' | 'DEPENDENCY'): void {
    const source =
      text(element[`${ATTR}client`]) ?? refOf(element.client) ?? refOf(element.supplier);
    const target = text(element[`${ATTR}supplier`]) ?? refOf(element.supplier);

    const declared = this.taggedValues(element).get('ea_type')?.toLowerCase();
    const resolved =
      declared === 'realisation' || declared === 'realization'
        ? 'REALIZATION'
        : declared === 'dependency' || declared === 'usage'
          ? 'DEPENDENCY'
          : type;

    if (source === null || target === null || source === target) {
      this.skipped.add(resolved === 'REALIZATION' ? 'Realization' : 'Dependency');
      return;
    }

    this.relationships.push({
      id: idOf(element),
      type: resolved,
      source,
      target,
      sourceMultiplicity: null,
      targetMultiplicity: null,
      name: text(element[`${ATTR}name`]),
      sourceRole: null,
      targetRole: null,
    });
  }

  /**
   * El tipo de un atributo según el bloque de extensión de EA.
   *
   * Enterprise Architect no siempre declara los tipos de dato como elementos
   * del modelo: los escribe aquí, en
   * `<attribute xmi:idref="…"><properties type="int"/></attribute>`. Es la
   * única forma de recuperar el tipo de un atributo de un archivo suyo, así
   * que se anota para completar después lo que quedó sin resolver.
   */
  /**
   * Convierte «#EATYPE_DOUBLE» en el nombre del tipo al que apunta.
   *
   * Mientras se lee el archivo, un tipo sólo se puede anotar como referencia:
   * lo que apunta puede declararse páginas más abajo. Aquí, con el archivo
   * entero leído, se cambia por su nombre —o por null si no estaba—.
   */
  private resolveReference(type: string | null): string | null {
    if (type === null || !type.startsWith('#')) return type;

    const reference = type.slice(1);

    return this.typeNames.get(reference) ?? namedTypeId(reference);
  }

  private readExtensionType(element: Node): void {
    const id = text(element[`${ATTR}idref`]) ?? idOf(element);
    if (id === null) return;

    const properties = element.properties;
    if (typeof properties !== 'object' || properties === null) return;

    const type = text((properties as Node)[`${ATTR}type`]);
    if (type !== null) this.extensionTypes.set(id, type);
  }

  /**
   * Las multiplicidades tal como estaban escritas, del bloque de conectores.
   *
   * En el modelo UML una multiplicidad son dos números, así que «*» y «0..*»
   * se guardan igual y al leerlos no se sabe cuál puso el usuario. Enterprise
   * Architect anota aquí el texto literal de cada extremo; cuando está, se
   * prefiere al par de números, y así lo que se escribió es lo que vuelve.
   */
  private readConnector(element: Node): void {
    const id = text(element[`${ATTR}idref`]) ?? idOf(element);
    if (id === null) return;

    const multiplicity = (end: unknown): string | null => {
      if (typeof end !== 'object' || end === null) return null;

      const type = (end as Node).type;
      if (typeof type !== 'object' || type === null) return null;

      return text((type as Node)[`${ATTR}multiplicity`]);
    };

    this.connectorEnds.set(id, {
      sourceClass: refOf(element.source),
      source: multiplicity(element.source),
      target: multiplicity(element.target),
    });
  }

  /** «Left=100;Top=200;Right=324;Bottom=320;» de la extensión de EA. */
  private readGeometry(element: Node): void {
    const subject = text(element[`${ATTR}subject`]) ?? text(element[`${ATTR}idref`]);
    const geometry = text(element[`${ATTR}geometry`]);
    if (subject === null || geometry === null) return;

    const left = /Left=(-?\d+)/.exec(geometry);
    const top = /Top=(-?\d+)/.exec(geometry);
    if (left === null || top === null) return;

    this.geometry.set(subject, { x: Number(left[1]), y: Number(top[1]) });
  }

  result(): ParsedXmi {
    for (const [id, position] of this.geometry) {
      const umlClass = this.classes.get(id);
      if (umlClass !== undefined) umlClass.position = position;
    }

    // Los tipos que se anotaron como referencia se resuelven ahora, cuando ya
    // se han leído todas las declaraciones del archivo y toda la extensión.
    // Afecta por igual a los atributos y a las firmas de los métodos: en un
    // archivo, un tipo puede declararse después de usarse.
    for (const umlClass of this.classes.values()) {
      for (const attribute of umlClass.attributes) {
        attribute.type = this.resolveReference(attribute.type);

        if (attribute.type === null && attribute.id !== null) {
          attribute.type = this.extensionTypes.get(attribute.id) ?? null;
        }
      }

      for (const method of umlClass.methods) {
        method.returnType = this.resolveReference(method.returnType);

        for (const parameter of method.parameters) {
          parameter.type = this.resolveReference(parameter.type);
        }
      }
    }

    const relationships: ParsedRelationship[] = [
      ...this.relationships,
      ...this.generalizations.map((generalization) => ({
        id: generalization.id,
        type: 'INHERITANCE' as const,
        source: generalization.child,
        target: generalization.parent,
        sourceMultiplicity: null,
        targetMultiplicity: null,
        name: null,
        sourceRole: null,
        targetRole: null,
      })),
    ];

    // El texto literal de las multiplicidades, cuando el archivo lo traía,
    // manda sobre el par de números: es lo que el usuario escribió.
    for (const relationship of relationships) {
      const connector = relationship.id === null ? undefined : this.connectorEnds.get(relationship.id);
      if (connector === undefined) continue;

      // El conector dice qué clase es el origen; si no coincide con cómo se
      // leyeron los extremos, las multiplicidades van al revés.
      const reversed =
        connector.sourceClass !== null && connector.sourceClass === relationship.target;

      const source = reversed ? connector.target : connector.source;
      const target = reversed ? connector.source : connector.target;

      if (source !== null) relationship.sourceMultiplicity = source;
      if (target !== null) relationship.targetMultiplicity = target;
    }

    /*
     * Muchos a muchos con clase intermedia.
     *
     * Enterprise Architect lo dibuja como una sola línea entre las dos clases
     * con una tercera colgando. Esta herramienta lo representa como lo que
     * acabará siendo en la base de datos: la clase intermedia unida a cada
     * lado con una asociación 1 : 0..*, que es justo lo que crea su
     * herramienta «clase de asociación». Sin esta traducción, la clase
     * intermedia se importa suelta —parece una clase que nadie pidió— y el
     * muchos a muchos desaparece.
     */
    const expanded = relationships.flatMap((relationship) => {
      const intermediate = relationship.associationClass;
      if (!intermediate || !this.classes.has(intermediate)) return [relationship];

      const link = (end: string): ParsedRelationship => ({
        id: null,
        type: 'ASSOCIATION',
        source: end,
        target: intermediate,
        sourceMultiplicity: '1',
        targetMultiplicity: '0..*',
        name: null,
        sourceRole: null,
        targetRole: null,
      });

      return [link(relationship.source), link(relationship.target)];
    });

    // Una relación hacia una clase que el archivo no trae dejaría una línea
    // suelta; se descarta y se cuenta.
    const valid = expanded.filter((relationship) => {
      const complete =
        this.classes.has(relationship.source) && this.classes.has(relationship.target);
      if (!complete) this.skipped.add('Relación con extremos fuera del archivo');

      return complete;
    });

    // «EA_Model» es el nombre con el que Enterprise Architect llama al modelo
    // raíz de cualquier exportación: no es el nombre de nada del usuario.
    const model = this.modelName === 'EA_Model' ? null : this.modelName;

    return {
      name: this.packageName ?? model,
      classes: [...this.classes.values()],
      relationships: valid,
      skipped: [...this.skipped],
    };
  }
}

// ------------------------------------------------------------------ lectores

/** Qué es este elemento: por su `xmi:type`, o por el nombre de la etiqueta. */
function typeOf(element: Node, tag: string | null): string {
  const declared = text(element[`${ATTR}type`]);

  if (declared !== null && declared.includes(':')) {
    return declared.split(':').pop() ?? '';
  }
  // XMI 1.1 no declara el tipo: la etiqueta ya dice qué es («UML:Class»).
  return tag ?? '';
}

/** `xmi:id` en XMI 2.x, `xmi.id` en XMI 1.1. */
function idOf(element: unknown): string | null {
  if (typeof element !== 'object' || element === null) return null;

  const node = element as Node;
  return text(node[`${ATTR}id`]) ?? text(node[`${ATTR}xmi.id`]);
}

/** El identificador al que apunta una referencia. */
function refOf(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (typeof value !== 'object' || value === null) return null;

  const node = value as Node;
  return text(node[`${ATTR}idref`]) ?? text(node[`${ATTR}xmi.idref`]) ?? text(node[`${ATTR}id`]);
}

/** La clase a la que está pegado un extremo de asociación. */
function endType(end: Node): string | null {
  return refOf(end.type) ?? text(end[`${ATTR}type`]);
}

/** «shared» → AGGREGATION, «composite» → COMPOSITION. */
function kindOf(end: unknown): 'AGGREGATION' | 'COMPOSITION' | null {
  if (typeof end !== 'object' || end === null) return null;

  const aggregation = text((end as Node)[`${ATTR}aggregation`])?.toLowerCase();

  if (aggregation === 'shared' || aggregation === 'aggregate') return 'AGGREGATION';
  if (aggregation === 'composite') return 'COMPOSITION';

  return null;
}

/**
 * La multiplicidad de un extremo, escrita como sea.
 *
 * UML 1.x la pone entera en un atributo —`multiplicity="0..*"`—, UML 2 la
 * parte en dos números y algunas herramientas la anidan en un
 * `MultiplicityRange`. Se devuelve el texto tal cual venga; quien lo guarda
 * comprueba después que sea una multiplicidad que este modelo admita.
 */
function multiplicityOf(end: Node): string | null {
  const direct = text(end[`${ATTR}multiplicity`]);
  if (direct !== null) return direct;

  const wrapper = end['AssociationEnd.multiplicity'];
  if (typeof wrapper === 'object' && wrapper !== null) {
    const multiplicity = (wrapper as Node).Multiplicity;
    const ranges =
      typeof multiplicity === 'object' && multiplicity !== null
        ? (multiplicity as Node)['Multiplicity.range']
        : null;
    const range =
      typeof ranges === 'object' && ranges !== null ? (ranges as Node).MultiplicityRange : null;

    if (typeof range === 'object' && range !== null) {
      const node = range as Node;
      return fromBounds({
        lower: text(node[`${ATTR}lower`]) ?? undefined,
        upper: text(node[`${ATTR}upper`]) ?? undefined,
      });
    }
  }

  return fromBounds(boundsOf(end));
}

function boundsOf(element: Node): { lower?: string; upper?: string } {
  const lower = valueOf(element.lowerValue);
  const upper = valueOf(element.upperValue);

  return {
    ...(lower === null ? {} : { lower }),
    ...(upper === null ? {} : { upper }),
  };
}

/** El `value` de un LiteralInteger, LiteralString o similar. */
function valueOf(node: unknown): string | null {
  if (typeof node === 'string') return text(node);
  if (typeof node !== 'object' || node === null) return null;

  const element = node as Node;
  return text(element[`${ATTR}value`]) ?? text(element['#text']);
}

/** La clase madre de una generalización, esté donde esté escrita. */
function generalOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const element = raw as Node;
  return text(element[`${ATTR}general`]) ?? refOf(element.general);
}

/**
 * Tipos que Enterprise Architect referencia sin declararlos.
 *
 * EA escribe `<type xmi:idref="EAJava_int"/>` apuntando a tipos de su
 * biblioteca de lenguajes, que no vienen en el archivo. El nombre del tipo
 * está dentro del propio identificador, después del prefijo del lenguaje, y
 * es lo único con lo que se puede recuperar.
 */
function namedTypeId(reference: string): string | null {
  const match = /^EA(?:Java|Csharp|CSharp|C|Cpp|VB|PHP|Python|Delphi|none)_(.+)$/i.exec(
    reference.trim(),
  );

  return match === null ? null : match[1];
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Los miembros de una clase, estén donde estén.
 *
 * En XMI 2.x cuelgan de la propia clase (`ownedAttribute`); en XMI 1.1 van
 * dentro de contenedores como `Classifier.feature`. Se mira en los dos sitios
 * para no tener dos caminos de lectura que mantener en paralelo.
 */
const FEATURE_CONTAINERS = [
  'Classifier.feature',
  'Namespace.ownedElement',
  'BehavioralFeature.parameter',
];

function members(element: Node, ...keys: string[]): unknown[] {
  const found: unknown[] = [];

  for (const key of keys) {
    found.push(...asList(element[key]));

    for (const container of FEATURE_CONTAINERS) {
      const nested = element[container];
      if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
        found.push(...asList((nested as Node)[key]));
      }
    }
  }

  return found;
}

/** Un hijo que puede venir suelto o repetido, siempre como lista. */
function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];

  return Array.isArray(value) ? value : [value];
}
