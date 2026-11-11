import type { FullDiagramResponse } from './diagrams.service.js';
import {
  PRIMARY_KEY,
  STEREOTYPES,
  VISIBILITIES,
  identifierProblem,
  isDataType,
  isDefaultValueCompatible,
  isPrimaryKeyName,
  isReturnType,
} from './uml-catalog.js';

/**
 * CU02 — Validación del diagrama completo.
 *
 * Es una función pura sobre el modelo ya guardado: las validaciones de cada
 * endpoint impiden guardar una pieza mal formada, pero hay reglas que sólo se
 * pueden comprobar mirando el diagrama entero —que una herencia no forme un
 * ciclo, que una relación no apunte a una clase que ya no está—. Es también la
 * puerta de entrada de CU07: si aquí no hay errores, el modelo se puede
 * traducir a Spring Boot.
 */

export type IssueSeverity = 'error' | 'warning';

export type IssueElementType =
  | 'DIAGRAM'
  | 'CLASS'
  | 'ATTRIBUTE'
  | 'METHOD'
  | 'PARAMETER'
  | 'RELATIONSHIP';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Identificador estable del tipo de problema, para poder agruparlos. */
  code: string;
  /** Mensaje ya redactado, diciendo qué elemento tiene el problema. */
  message: string;
  element_type: IssueElementType;
  element_id: string | null;
  /** Clase a la que llevar al usuario cuando pulse el aviso. */
  class_id: string | null;
  /** Relación a la que llevar al usuario, cuando el problema es de una. */
  relationship_id: string | null;
}

export interface DiagramValidationResponse {
  diagram_id: string;
  /** No hay errores; puede haber avisos. */
  valid: boolean;
  errors: number;
  warnings: number;
  /** Válido y además con algo que generar: al menos una entidad. */
  ready_for_generation: boolean;
  issues: ValidationIssue[];
}

const MULTIPLICITY_PATTERN = /^(\*|\d+|\d+\.\.(\d+|\*))$/;

/** Multiplicidades que significan «muchos»: '*', '0..*', '1..*', '2..*'... */
export function isMany(multiplicity: string | null): boolean {
  return multiplicity !== null && (multiplicity === '*' || multiplicity.endsWith('..*'));
}

/**
 * La clase se convertirá en una tabla.
 *
 * Una clase del lienzo nace sin estereotipo, y eso ya significa «entidad»: en
 * un diagrama de datos lo que se dibuja son las cosas que hay que guardar. Es
 * literalmente la misma regla que aplica el generador en
 * `UmlClass.isPersistent()`, y tiene que seguir siéndolo: mientras aquí se
 * contaban sólo las marcadas «entity», el validador daba por vacío un modelo
 * que el generador sí sabía traducir, y CU07 se negaba a arrancar con un
 * «el diagrama no tiene ninguna clase que se pueda convertir en entidad»
 * delante de un lienzo lleno de clases. Los estereotipos que quedan
 * —interface, enumeration, service— son las tres excepciones: generan sólo su
 * equivalente Java, sin tabla.
 */
export function isPersistent(umlClass: { stereotype: string | null }): boolean {
  return (
    umlClass.stereotype === null ||
    umlClass.stereotype.length === 0 ||
    umlClass.stereotype === 'entity'
  );
}

/** Los extremos de una asociación son muchos a muchos. */
export function isManyToMany(relationship: {
  relationship_type: string;
  source_multiplicity: string | null;
  target_multiplicity: string | null;
}): boolean {
  return (
    relationship.relationship_type === 'ASSOCIATION' &&
    isMany(relationship.source_multiplicity) &&
    isMany(relationship.target_multiplicity)
  );
}

export function validateDiagram(diagram: FullDiagramResponse): DiagramValidationResponse {
  const issues: ValidationIssue[] = [];

  const add = (issue: Omit<ValidationIssue, 'relationship_id' | 'class_id'> &
    Partial<Pick<ValidationIssue, 'relationship_id' | 'class_id'>>) => {
    issues.push({ class_id: null, relationship_id: null, ...issue });
  };

  const classNames = new Set(diagram.classes.map((umlClass) => umlClass.name));
  const classById = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass]));

  /** Un tipo vale si está en el catálogo o es una clase de este diagrama. */
  const isKnownType = (type: string) => isReturnType(type) || classNames.has(type);

  if (diagram.classes.length === 0) {
    add({
      severity: 'warning',
      code: 'DIAGRAM_EMPTY',
      message: 'El diagrama no tiene ninguna clase.',
      element_type: 'DIAGRAM',
      element_id: diagram.id,
    });
  }

  // ------------------------------------------------------------- clases
  const seenNames = new Map<string, string>();

  for (const umlClass of diagram.classes) {
    const persistent = isPersistent(umlClass);
    const where = `${persistent ? 'Entidad' : 'Clase'} ${umlClass.name}`;

    const problem = identifierProblem(umlClass.name);
    if (problem !== null) {
      add({
        severity: 'error',
        code: 'CLASS_NAME_INVALID',
        message: `${where}: el nombre no es válido para generar una clase Java (${problem}).`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    }

    // uml_classes tiene UNIQUE (diagram_id, name), pero se comprueba igual:
    // el modelo puede llegar aquí desde XMI o desde una foto (CU05/CU06).
    const duplicate = seenNames.get(umlClass.name);
    if (duplicate !== undefined) {
      add({
        severity: 'error',
        code: 'CLASS_NAME_DUPLICATED',
        message: `${where}: hay dos clases con el mismo nombre en el diagrama.`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    } else {
      seenNames.set(umlClass.name, umlClass.id);
    }

    if (
      umlClass.stereotype !== null &&
      !STEREOTYPES.includes(umlClass.stereotype as (typeof STEREOTYPES)[number])
    ) {
      add({
        severity: 'error',
        code: 'CLASS_STEREOTYPE_INVALID',
        message: `${where}: el estereotipo «${umlClass.stereotype}» no está permitido. Use uno de: ${STEREOTYPES.join(', ')}.`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    }

    if (!VISIBILITIES.includes(umlClass.visibility as (typeof VISIBILITIES)[number])) {
      add({
        severity: 'error',
        code: 'CLASS_VISIBILITY_INVALID',
        message: `${where}: la visibilidad «${umlClass.visibility}» no está permitida.`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    }

    // ---------------------------------------------------------- atributos
    const seenAttributes = new Set<string>();

    for (const attribute of umlClass.attributes) {
      const at = `${where}, atributo ${attribute.name}`;

      const attributeProblem = identifierProblem(attribute.name);
      if (attributeProblem !== null) {
        add({
          severity: 'error',
          code: 'ATTRIBUTE_NAME_INVALID',
          message: `${at}: el nombre no es válido (${attributeProblem}).`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      if (seenAttributes.has(attribute.name)) {
        add({
          severity: 'error',
          code: 'ATTRIBUTE_DUPLICATED',
          message: `${at}: la clase tiene dos atributos con ese nombre.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }
      seenAttributes.add(attribute.name);

      // Un atributo sin tipo no es un atributo mal formado: es uno a medio
      // describir, y así llegan los de una foto de pizarra que sólo lista
      // nombres (CU05) o los que se dictan sin decir de qué tipo son (CU04).
      // Durante el diseño se admite; lo que no se admite es generar con él,
      // porque esa columna hay que declararla de algún tipo y elegirlo por
      // nuestra cuenta sería decidir en silencio algo que nadie decidió.
      if (attribute.data_type === null || attribute.data_type.length === 0) {
        add({
          severity: persistent ? 'error' : 'warning',
          code: persistent ? 'ATTRIBUTE_TYPE_REQUIRED' : 'ATTRIBUTE_TYPE_MISSING',
          message: persistent
            ? `${at}: falta el tipo de dato. Sin él no se puede saber de qué tipo declarar su columna.`
            : `${at}: todavía no tiene tipo de dato.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      } else if (!isDataType(attribute.data_type)) {
        add({
          severity: 'error',
          code: 'ATTRIBUTE_TYPE_INVALID',
          message: `${at}: el tipo «${attribute.data_type}» no pertenece al catálogo de tipos.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      if (
        attribute.data_type !== null &&
        attribute.default_value !== null &&
        !isDefaultValueCompatible(attribute.data_type, attribute.default_value)
      ) {
        add({
          severity: 'error',
          code: 'ATTRIBUTE_DEFAULT_INCOMPATIBLE',
          message: `${at}: el valor por defecto «${attribute.default_value}» no es compatible con el tipo ${attribute.data_type}.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      /*
       * Un atributo llamado «id» sólo puede venir de un diagrama guardado
       * antes de que la clave primaria pasara a ponerla la herramienta: el
       * editor ya no deja crearlo y las importaciones lo descartan. Se avisa
       * porque el generador lo omite —la columna «id» de la tabla es la clave
       * primaria, no este atributo— y eso tiene que verse antes de generar.
       */
      if (isPrimaryKeyName(attribute.name)) {
        add({
          severity: 'warning',
          code: 'ATTRIBUTE_IS_PRIMARY_KEY_NAME',
          message: `${at}: se omitirá al generar. La clave primaria «${PRIMARY_KEY.name}» la pone la herramienta en todas las entidades; puede borrar este atributo.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      /*
       * Notación UML 2.5. Son avisos y no errores: el diagrama es correcto en
       * UML, pero el generador de CU07 traduce cada atributo de una entidad a
       * una columna, y una colección no cabe en una columna.
       */
      if (persistent && attribute.multiplicity !== null && isMany(attribute.multiplicity)) {
        add({
          severity: 'warning',
          code: 'ATTRIBUTE_COLLECTION_IN_ENTITY',
          message: `${at}: tiene multiplicidad [${attribute.multiplicity}]; al generar el backend se guardará como una sola columna. Para una lista de valores conviene una clase aparte unida por una asociación.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      if (attribute.is_derived && attribute.default_value !== null) {
        add({
          severity: 'warning',
          code: 'DERIVED_ATTRIBUTE_WITH_DEFAULT',
          message: `${at}: es derivado (se calcula a partir de otros), así que no debería tener valor inicial.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }

      if (!VISIBILITIES.includes(attribute.visibility as (typeof VISIBILITIES)[number])) {
        add({
          severity: 'error',
          code: 'ATTRIBUTE_VISIBILITY_INVALID',
          message: `${at}: la visibilidad «${attribute.visibility}» no está permitida.`,
          element_type: 'ATTRIBUTE',
          element_id: attribute.id,
          class_id: umlClass.id,
        });
      }
    }

    // Ya no se avisa de que falte la clave primaria: toda entidad tiene la
    // suya, «id», y la pone la herramienta. Una tabla sin ninguna otra columna
    // sí se dice, porque casi siempre es una entidad a medio describir.
    if (persistent && umlClass.attributes.length === 0) {
      add({
        severity: 'warning',
        code: 'ENTITY_WITHOUT_ATTRIBUTES',
        message: `${where}: no tiene ningún atributo; su tabla se generará sólo con la clave primaria «${PRIMARY_KEY.name}».`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    }

    if (umlClass.stereotype === 'interface' && umlClass.attributes.length > 0) {
      add({
        severity: 'warning',
        code: 'INTERFACE_WITH_ATTRIBUTES',
        message: `${where}: una interfaz no debería declarar atributos.`,
        element_type: 'CLASS',
        element_id: umlClass.id,
        class_id: umlClass.id,
      });
    }

    // ------------------------------------------------------------ métodos
    for (const method of umlClass.methods) {
      const at = `${where}, método ${method.name}`;

      /*
       * UML 2.5: una operación abstracta no tiene implementación, así que sólo
       * puede estar en una clase abstracta o en una interfaz; y una operación
       * estática pertenece a la clase, no se redefine, así que no puede ser
       * abstracta a la vez.
       */
      if (method.is_abstract && !umlClass.is_abstract && umlClass.stereotype !== 'interface') {
        add({
          severity: 'warning',
          code: 'ABSTRACT_METHOD_IN_CONCRETE_CLASS',
          message: `${at}: es abstracto, pero la clase no lo es. En UML una clase con operaciones abstractas debe marcarse como abstracta.`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      }

      if (method.is_abstract && method.is_static) {
        add({
          severity: 'warning',
          code: 'STATIC_ABSTRACT_METHOD',
          message: `${at}: no puede ser estático y abstracto a la vez.`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      }

      const methodProblem = identifierProblem(method.name);
      if (methodProblem !== null) {
        add({
          severity: 'error',
          code: 'METHOD_NAME_INVALID',
          message: `${at}: el nombre no es válido (${methodProblem}).`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      }

      if (method.return_type.length === 0) {
        add({
          severity: 'error',
          code: 'METHOD_RETURN_REQUIRED',
          message: `${at}: debe indicar tipo de retorno.`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      } else if (!isKnownType(method.return_type)) {
        add({
          severity: 'error',
          code: 'METHOD_RETURN_INVALID',
          message: `${at}: el tipo de retorno «${method.return_type}» no es un tipo del catálogo ni una clase del diagrama.`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      }

      if (!VISIBILITIES.includes(method.visibility as (typeof VISIBILITIES)[number])) {
        add({
          severity: 'error',
          code: 'METHOD_VISIBILITY_INVALID',
          message: `${at}: la visibilidad «${method.visibility}» no está permitida.`,
          element_type: 'METHOD',
          element_id: method.id,
          class_id: umlClass.id,
        });
      }

      const seenParameters = new Set<string>();
      for (const parameter of method.parameters) {
        const on = `${at}, parámetro ${parameter.name || '(sin nombre)'}`;

        if (parameter.name.length === 0) {
          add({
            severity: 'error',
            code: 'PARAMETER_NAME_REQUIRED',
            message: `${at}: hay un parámetro sin nombre.`,
            element_type: 'PARAMETER',
            element_id: parameter.id,
            class_id: umlClass.id,
          });
        } else {
          const parameterProblem = identifierProblem(parameter.name);
          if (parameterProblem !== null) {
            add({
              severity: 'error',
              code: 'PARAMETER_NAME_INVALID',
              message: `${on}: el nombre no es válido (${parameterProblem}).`,
              element_type: 'PARAMETER',
              element_id: parameter.id,
              class_id: umlClass.id,
            });
          }
          if (seenParameters.has(parameter.name)) {
            add({
              severity: 'error',
              code: 'PARAMETER_DUPLICATED',
              message: `${at}: tiene dos parámetros llamados «${parameter.name}».`,
              element_type: 'PARAMETER',
              element_id: parameter.id,
              class_id: umlClass.id,
            });
          }
          seenParameters.add(parameter.name);
        }

        if (parameter.data_type.length === 0) {
          add({
            severity: 'error',
            code: 'PARAMETER_TYPE_REQUIRED',
            message: `${on}: debe indicar un tipo.`,
            element_type: 'PARAMETER',
            element_id: parameter.id,
            class_id: umlClass.id,
          });
        } else if (parameter.data_type === 'void' || !isKnownType(parameter.data_type)) {
          add({
            severity: 'error',
            code: 'PARAMETER_TYPE_INVALID',
            message: `${on}: el tipo «${parameter.data_type}» no es un tipo del catálogo ni una clase del diagrama.`,
            element_type: 'PARAMETER',
            element_id: parameter.id,
            class_id: umlClass.id,
          });
        }
      }
    }
  }

  // -------------------------------------------------------- relaciones
  for (const relationship of diagram.relationships) {
    const source = classById.get(relationship.source_class_id);
    const target = classById.get(relationship.target_class_id);
    const where = `Relación ${source?.name ?? '?'}-${target?.name ?? '?'}`;

    // Una referencia huérfana no debería existir: las claves foráneas son
    // ON DELETE CASCADE. Se comprueba porque un modelo importado sí podría
    // traerla, y porque es exactamente lo que CU07 no puede generar.
    if (!source) {
      add({
        severity: 'error',
        code: 'RELATIONSHIP_SOURCE_MISSING',
        message: `${where}: la clase de origen no existe en el diagrama.`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }
    if (!target) {
      add({
        severity: 'error',
        code: 'RELATIONSHIP_TARGET_MISSING',
        message: `${where}: la clase de destino no existe en el diagrama.`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }

    for (const [end, multiplicity] of [
      ['origen', relationship.source_multiplicity],
      ['destino', relationship.target_multiplicity],
    ] as const) {
      if (multiplicity !== null && !MULTIPLICITY_PATTERN.test(multiplicity)) {
        add({
          severity: 'error',
          code: 'RELATIONSHIP_MULTIPLICITY_INVALID',
          message: `${where}: multiplicidad de ${end} inválida («${multiplicity}»). Ejemplos: 1, 0..1, 0..*, 1..*.`,
          element_type: 'RELATIONSHIP',
          element_id: relationship.id,
          relationship_id: relationship.id,
        });
      }
    }

    const structural =
      relationship.relationship_type === 'INHERITANCE' ||
      relationship.relationship_type === 'REALIZATION';

    if (structural && relationship.source_class_id === relationship.target_class_id) {
      add({
        severity: 'error',
        code: 'INHERITANCE_SELF',
        message: `${where}: una clase no puede heredar de sí misma.`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }

    if (
      relationship.relationship_type === 'REALIZATION' &&
      target &&
      target.stereotype !== 'interface'
    ) {
      add({
        severity: 'warning',
        code: 'REALIZATION_TARGET_NOT_INTERFACE',
        message: `${where}: una implementación debería apuntar a una clase con estereotipo «interface».`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }

    if (
      relationship.relationship_type === 'ASSOCIATION' &&
      relationship.source_multiplicity === null &&
      relationship.target_multiplicity === null
    ) {
      add({
        severity: 'warning',
        code: 'ASSOCIATION_WITHOUT_MULTIPLICITY',
        message: `${where}: no tiene multiplicidades; sin ellas no se sabe qué cardinalidad generar.`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }

    // Muchos a muchos: el modelo lo admite, pero necesita una clase
    // intermedia antes de poder convertirse en tablas.
    if (isManyToMany(relationship)) {
      add({
        severity: 'warning',
        code: 'MANY_TO_MANY_WITHOUT_ASSOCIATION_CLASS',
        message: `${where}: es una relación muchos a muchos y no se puede convertir en tablas tal cual. Bórrela y una las dos entidades con la herramienta «Entidad intermedia».`,
        element_type: 'RELATIONSHIP',
        element_id: relationship.id,
        relationship_id: relationship.id,
      });
    }
  }

  for (const cycle of inheritanceCycles(diagram)) {
    add({
      severity: 'error',
      code: 'INHERITANCE_CYCLE',
      message: `Herencia circular: ${cycle.join(' → ')}.`,
      element_type: 'DIAGRAM',
      element_id: diagram.id,
    });
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const entities = diagram.classes.filter(isPersistent);

  return {
    diagram_id: diagram.id,
    valid: errors === 0,
    errors,
    warnings,
    ready_for_generation: errors === 0 && entities.length > 0,
    issues,
  };
}

/**
 * Ciclos en la jerarquía de herencia: «A hereda de B, B hereda de A» no se
 * puede escribir en Java. Devuelve los nombres de cada ciclo encontrado.
 */
function inheritanceCycles(diagram: FullDiagramResponse): string[][] {
  const nameOf = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name]));
  const parents = new Map<string, string[]>();

  for (const relationship of diagram.relationships) {
    if (
      relationship.relationship_type !== 'INHERITANCE' &&
      relationship.relationship_type !== 'REALIZATION'
    ) {
      continue;
    }
    const from = relationship.source_class_id;
    parents.set(from, [...(parents.get(from) ?? []), relationship.target_class_id]);
  }

  const cycles: string[][] = [];
  const done = new Set<string>();

  /** Recorre hacia arriba llevando el camino, para poder mostrarlo. */
  function walk(classId: string, path: string[]): void {
    const seenAt = path.indexOf(classId);
    if (seenAt >= 0) {
      const cycle = [...path.slice(seenAt), classId].map((id) => nameOf.get(id) ?? '?');
      // Un mismo ciclo se alcanza desde cada uno de sus miembros.
      const key = [...cycle].sort().join('|');
      if (!done.has(key)) {
        done.add(key);
        cycles.push(cycle);
      }
      return;
    }

    for (const parent of parents.get(classId) ?? []) {
      walk(parent, [...path, classId]);
    }
  }

  for (const umlClass of diagram.classes) {
    walk(umlClass.id, []);
  }

  return cycles;
}
