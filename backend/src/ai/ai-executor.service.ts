import { Injectable } from '@nestjs/common';
import { ClassesService } from '../diagrams/classes.service.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import type { RelationshipType } from '../diagrams/relationships.service.js';
import { RelationshipsService } from '../diagrams/relationships.service.js';
import { OFFERED_DATA_TYPES, identifierProblem } from '../diagrams/uml-catalog.js';
import { isMultiplicity } from '../diagrams/validation.js';
import { besidePosition, freePosition } from './layout.js';
import type { Placed } from './layout.js';
import { RELATIONSHIP_LABELS, fold, normalizeDataType } from './uml-actions.js';
import type { AiRelationshipType, RawAction, RawAttribute } from './uml-actions.js';

/**
 * CU04/CU05 — Validación y ejecución de las acciones del asistente.
 *
 * Aquí está la frontera de verdad: lo que llega es una lista de acciones con
 * forma correcta, y lo que sale son cambios en el mismo modelo UML de CU02.
 * El trabajo se hace en dos pasadas y el orden importa.
 *
 *  1. `plan` comprueba **todas** las acciones contra una copia en memoria del
 *     diagrama, sin escribir nada. Si una sola no se puede ejecutar, no se
 *     ejecuta ninguna: dejar el diagrama a medio cambiar —la clase creada pero
 *     no su relación— es peor que no haber hecho nada, porque el usuario no
 *     pidió ese estado intermedio y tendría que deshacerlo a mano.
 *  2. `apply` ejecuta el plan llamando a ClassesService y RelationshipsService,
 *     los mismos servicios que usa el editor. Por eso el asistente hereda
 *     gratis todo lo de CU02 y CU03: las validaciones de cada campo, los
 *     UNIQUE, el borrado en cascada, los bloqueos de edición y el aviso por
 *     WebSocket a los demás editores de la sala.
 *
 * No hay un segundo modelo UML para la IA. Hay uno, el de PostgreSQL.
 */

/**
 * Atributo ya validado: si trae tipo, es uno del catálogo. `null` significa
 * que el atributo existe pero no se sabe de qué tipo es, y eso se guarda tal
 * cual: rellenarlo con un tipo supuesto sería inventarse el modelo.
 */
export interface PlannedAttribute {
  name: string;
  type: string | null;
}

/** Cambios que admite una relación existente. */
interface RelationshipChanges {
  relationship_type?: RelationshipType;
  source_multiplicity?: string | null;
  target_multiplicity?: string | null;
  name?: string | null;
}

/**
 * Paso listo para ejecutarse. Todo lo dudoso ya se resolvió: los nombres
 * existen, los tipos son del catálogo y las posiciones están calculadas.
 */
export type PlannedStep =
  | {
      kind: 'CREATE_CLASS';
      name: string;
      attributes: PlannedAttribute[];
      position: Placed;
      description: string;
    }
  | { kind: 'UPDATE_CLASS'; name: string; newName: string; description: string }
  | { kind: 'DELETE_CLASS'; name: string; description: string }
  | {
      kind: 'ADD_ATTRIBUTE';
      className: string;
      attributes: PlannedAttribute[];
      description: string;
    }
  | {
      kind: 'UPDATE_ATTRIBUTE';
      className: string;
      attributeName: string;
      newName: string | null;
      newType: string | null;
      description: string;
    }
  | { kind: 'DELETE_ATTRIBUTE'; className: string; attributeName: string; description: string }
  | {
      kind: 'CREATE_RELATIONSHIP';
      relationshipType: RelationshipType;
      /** Ya en la orientación con la que se guarda en uml_relationships. */
      sourceClass: string;
      targetClass: string;
      sourceMultiplicity: string | null;
      targetMultiplicity: string | null;
      name: string | null;
      description: string;
    }
  | {
      kind: 'UPDATE_RELATIONSHIP';
      relationshipId: string;
      changes: RelationshipChanges;
      description: string;
    }
  | { kind: 'DELETE_RELATIONSHIP'; relationshipId: string; description: string }
  | { kind: 'MOVE_CLASS'; name: string; position: Placed; description: string };

export interface ExecutionPlan {
  steps: PlannedStep[];
  /** Por qué no se puede ejecutar. Si trae algo, no se ejecuta nada. */
  rejections: string[];
  /** Decisiones que tomó el sistema y conviene contarle al usuario. */
  warnings: string[];
}

/** Qué hacer con un atributo cuyo tipo no se puede resolver. */
export type UnknownTypePolicy =
  /**
   * CU04: la instrucción se rechaza y el usuario la reformula. Cuando no dice
   * ningún tipo, el asistente usa String, que es lo que hace desde siempre.
   */
  | 'reject'
  /**
   * CU05: se guarda sin tipo y se avisa. De una foto no se puede volver a
   * preguntar, y suponer un tipo que no está dibujado sería inventarse el
   * modelo; es preferible un hueco honesto que el usuario rellena en el panel.
   */
  | 'keep-null';

/** Tipo con el que se guarda un atributo cuyo tipo no se pudo determinar. */
const FALLBACK_DATA_TYPE = 'String';

// --------------------------------------------------------------- borrador

interface DraftClass {
  name: string;
  /** Atributos de la clase: nombre normalizado → nombre real. */
  attributes: Map<string, string>;
  posX: number;
  posY: number;
}

interface DraftRelationship {
  /** null si la crea esta misma instrucción y todavía no existe en la base. */
  id: string | null;
  type: RelationshipType;
  source: string;
  target: string;
}

/**
 * Copia en memoria del diagrama, que se va modificando mientras se planifica.
 *
 * Sin ella, «crea la clase Pedido y relaciónala con Cliente» fallaría en la
 * segunda acción: Pedido todavía no existe en PostgreSQL cuando se valida.
 * Con ella, cada acción se comprueba contra el diagrama tal como quedará
 * después de las anteriores, que es lo que el usuario tiene en la cabeza.
 */
class DiagramDraft {
  private readonly classes = new Map<string, DraftClass>();
  private relationships: DraftRelationship[] = [];

  constructor(diagram: FullDiagramResponse) {
    for (const umlClass of diagram.classes) {
      this.classes.set(fold(umlClass.name), {
        name: umlClass.name,
        attributes: new Map(
          umlClass.attributes.map((attribute) => [fold(attribute.name), attribute.name]),
        ),
        posX: umlClass.pos_x,
        posY: umlClass.pos_y,
      });
    }

    const nameById = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name]));
    for (const relationship of diagram.relationships) {
      const source = nameById.get(relationship.source_class_id);
      const target = nameById.get(relationship.target_class_id);
      if (source === undefined || target === undefined) continue;

      this.relationships.push({
        id: relationship.id,
        type: relationship.relationship_type as RelationshipType,
        source: fold(source),
        target: fold(target),
      });
    }
  }

  /** La clase con ese nombre, sin distinguir mayúsculas ni tildes. */
  find(name: string): DraftClass | null {
    return this.classes.get(fold(name)) ?? null;
  }

  positions(): Placed[] {
    return [...this.classes.values()].map((umlClass) => ({
      posX: umlClass.posX,
      posY: umlClass.posY,
    }));
  }

  addClass(name: string, attributes: PlannedAttribute[], position: Placed): void {
    this.classes.set(fold(name), {
      name,
      attributes: new Map(attributes.map((attribute) => [fold(attribute.name), attribute.name])),
      posX: position.posX,
      posY: position.posY,
    });
  }

  renameClass(from: string, to: string): void {
    const umlClass = this.classes.get(fold(from));
    if (!umlClass) return;

    this.classes.delete(fold(from));
    this.classes.set(fold(to), { ...umlClass, name: to });

    // Las relaciones se indexan por nombre: si no se renombran aquí, la
    // siguiente acción de la misma instrucción no las encontraría.
    for (const relationship of this.relationships) {
      if (relationship.source === fold(from)) relationship.source = fold(to);
      if (relationship.target === fold(from)) relationship.target = fold(to);
    }
  }

  removeClass(name: string): void {
    const key = fold(name);
    this.classes.delete(key);
    // Igual que ON DELETE CASCADE en uml_relationships.
    this.relationships = this.relationships.filter(
      (relationship) => relationship.source !== key && relationship.target !== key,
    );
  }

  moveClass(name: string, position: Placed): void {
    const umlClass = this.classes.get(fold(name));
    if (!umlClass) return;

    umlClass.posX = position.posX;
    umlClass.posY = position.posY;
  }

  addAttribute(className: string, attribute: string): void {
    this.classes.get(fold(className))?.attributes.set(fold(attribute), attribute);
  }

  renameAttribute(className: string, from: string, to: string): void {
    const umlClass = this.classes.get(fold(className));
    if (!umlClass) return;

    umlClass.attributes.delete(fold(from));
    umlClass.attributes.set(fold(to), to);
  }

  removeAttribute(className: string, attribute: string): void {
    this.classes.get(fold(className))?.attributes.delete(fold(attribute));
  }

  /**
   * Relaciones entre dos clases, miren hacia donde miren.
   *
   * El usuario dice «la relación entre Cliente y Pedido» sin saber cuál se
   * guardó como origen, así que se busca en los dos sentidos y se devuelve
   * también si estaba al revés: para modificar multiplicidades hay que saberlo,
   * porque «Cliente 1» es el extremo origen o el destino según cómo se guardó.
   */
  between(a: string, b: string): { relationship: DraftRelationship; reversed: boolean }[] {
    const first = fold(a);
    const second = fold(b);
    const found: { relationship: DraftRelationship; reversed: boolean }[] = [];

    for (const relationship of this.relationships) {
      if (relationship.source === first && relationship.target === second) {
        found.push({ relationship, reversed: false });
      } else if (relationship.source === second && relationship.target === first) {
        found.push({ relationship, reversed: true });
      }
    }

    return found;
  }

  addRelationship(type: RelationshipType, source: string, target: string): void {
    this.relationships.push({ id: null, type, source: fold(source), target: fold(target) });
  }

  removeRelationship(id: string): void {
    this.relationships = this.relationships.filter((relationship) => relationship.id !== id);
  }
}

// ------------------------------------------------------------------ servicio

@Injectable()
export class AiExecutorService {
  constructor(
    private readonly classesService: ClassesService,
    private readonly relationshipsService: RelationshipsService,
  ) {}

  /**
   * Comprueba las acciones contra el diagrama sin escribir nada.
   * Devuelve el plan, los motivos de rechazo y los avisos.
   */
  plan(
    diagram: FullDiagramResponse,
    actions: RawAction[],
    unknownType: UnknownTypePolicy,
  ): ExecutionPlan {
    const draft = new DiagramDraft(diagram);
    const steps: PlannedStep[] = [];
    const rejections: string[] = [];
    const warnings: string[] = [];

    for (const action of actions) {
      this.planOne(action, draft, steps, rejections, warnings, unknownType);
    }

    return { steps, rejections, warnings };
  }

  /** Ejecuta un plan ya validado. Devuelve lo que se hizo, en castellano. */
  async apply(
    userId: string,
    diagram: FullDiagramResponse,
    steps: PlannedStep[],
  ): Promise<string[]> {
    // Los identificadores se resuelven sobre la marcha: una clase creada por
    // el primer paso todavía no tiene id cuando se planifica el segundo.
    const classIds = new Map<string, string>();
    const attributeIds = new Map<string, string>();

    for (const umlClass of diagram.classes) {
      classIds.set(fold(umlClass.name), umlClass.id);
      for (const attribute of umlClass.attributes) {
        attributeIds.set(`${umlClass.id}|${fold(attribute.name)}`, attribute.id);
      }
    }

    const classIdOf = (name: string): string | null => classIds.get(fold(name)) ?? null;
    const done: string[] = [];

    for (const step of steps) {
      switch (step.kind) {
        case 'CREATE_CLASS': {
          // Sin estereotipo, exactamente igual que una clase colocada a mano en
          // el lienzo: el asistente no decide por el usuario si esto es una
          // entidad, un servicio o una interfaz. Eso se elige en el panel.
          const created = await this.classesService.createClass(userId, diagram.id, {
            name: step.name,
            pos_x: step.position.posX,
            pos_y: step.position.posY,
          });
          classIds.set(fold(step.name), created.id);

          for (const attribute of step.attributes) {
            const savedAttribute = await this.classesService.createAttribute(userId, created.id, {
              name: attribute.name,
              data_type: attribute.type,
            });
            attributeIds.set(`${created.id}|${fold(attribute.name)}`, savedAttribute.id);
          }
          break;
        }

        case 'UPDATE_CLASS': {
          const classId = classIdOf(step.name);
          if (classId === null) break;

          await this.classesService.updateClass(userId, classId, { name: step.newName });
          classIds.delete(fold(step.name));
          classIds.set(fold(step.newName), classId);
          break;
        }

        case 'DELETE_CLASS': {
          const classId = classIdOf(step.name);
          if (classId === null) break;

          await this.classesService.removeClass(userId, classId);
          classIds.delete(fold(step.name));
          break;
        }

        case 'ADD_ATTRIBUTE': {
          const classId = classIdOf(step.className);
          if (classId === null) break;

          for (const attribute of step.attributes) {
            const saved = await this.classesService.createAttribute(userId, classId, {
              name: attribute.name,
              data_type: attribute.type,
            });
            attributeIds.set(`${classId}|${fold(attribute.name)}`, saved.id);
          }
          break;
        }

        case 'UPDATE_ATTRIBUTE': {
          const classId = classIdOf(step.className);
          if (classId === null) break;

          const key = `${classId}|${fold(step.attributeName)}`;
          const attributeId = attributeIds.get(key);
          if (attributeId === undefined) break;

          await this.classesService.updateAttribute(userId, attributeId, {
            ...(step.newName === null ? {} : { name: step.newName }),
            ...(step.newType === null ? {} : { data_type: step.newType }),
          });

          if (step.newName !== null) {
            attributeIds.delete(key);
            attributeIds.set(`${classId}|${fold(step.newName)}`, attributeId);
          }
          break;
        }

        case 'DELETE_ATTRIBUTE': {
          const classId = classIdOf(step.className);
          if (classId === null) break;

          const key = `${classId}|${fold(step.attributeName)}`;
          const attributeId = attributeIds.get(key);
          if (attributeId === undefined) break;

          await this.classesService.removeAttribute(userId, attributeId);
          attributeIds.delete(key);
          break;
        }

        case 'CREATE_RELATIONSHIP': {
          const sourceClassId = classIdOf(step.sourceClass);
          const targetClassId = classIdOf(step.targetClass);
          if (sourceClassId === null || targetClassId === null) break;

          await this.relationshipsService.create(userId, diagram.id, {
            source_class_id: sourceClassId,
            target_class_id: targetClassId,
            relationship_type: step.relationshipType,
            source_multiplicity: step.sourceMultiplicity,
            target_multiplicity: step.targetMultiplicity,
            name: step.name,
          });
          break;
        }

        case 'UPDATE_RELATIONSHIP': {
          await this.relationshipsService.update(userId, step.relationshipId, step.changes);
          break;
        }

        case 'DELETE_RELATIONSHIP': {
          await this.relationshipsService.remove(userId, step.relationshipId);
          break;
        }

        case 'MOVE_CLASS': {
          const classId = classIdOf(step.name);
          if (classId === null) break;

          await this.classesService.updateClass(userId, classId, {
            pos_x: step.position.posX,
            pos_y: step.position.posY,
          });
          break;
        }
      }

      done.push(step.description);
    }

    return done;
  }

  // ------------------------------------------------------------ validación

  private planOne(
    action: RawAction,
    draft: DiagramDraft,
    steps: PlannedStep[],
    rejections: string[],
    warnings: string[],
    unknownType: UnknownTypePolicy,
  ): void {
    const reject = (message: string) => rejections.push(message);

    switch (action.action) {
      case 'CREATE_CLASS': {
        const problem = identifierProblem(action.className);
        if (problem !== null) {
          reject(`«${action.className}» no es un nombre de clase válido: ${problem}.`);
          return;
        }
        if (draft.find(action.className) !== null) {
          reject(`Ya existe una clase llamada «${action.className}» en el diagrama.`);
          return;
        }

        const attributes = this.planAttributes(
          action.className,
          action.attributes,
          new Set(),
          rejections,
          warnings,
          unknownType,
        );
        if (attributes === null) return;

        const position =
          action.position === null
            ? freePosition(draft.positions())
            : { posX: Math.round(action.position.x), posY: Math.round(action.position.y) };

        draft.addClass(action.className, attributes, position);
        steps.push({
          kind: 'CREATE_CLASS',
          name: action.className,
          attributes,
          position,
          description:
            attributes.length === 0
              ? `Crear la clase ${action.className}.`
              : `Crear la clase ${action.className} con ${this.list(
                  attributes.map((attribute) => this.describeAttribute(attribute)),
                )}.`,
        });
        return;
      }

      case 'UPDATE_CLASS': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        const problem = identifierProblem(action.newName);
        if (problem !== null) {
          reject(`«${action.newName}» no es un nombre de clase válido: ${problem}.`);
          return;
        }

        const existing = draft.find(action.newName);
        if (existing !== null && fold(existing.name) !== fold(umlClass.name)) {
          reject(`Ya existe una clase llamada «${action.newName}» en el diagrama.`);
          return;
        }

        draft.renameClass(umlClass.name, action.newName);
        steps.push({
          kind: 'UPDATE_CLASS',
          name: umlClass.name,
          newName: action.newName,
          description: `Renombrar la clase ${umlClass.name} a ${action.newName}.`,
        });
        return;
      }

      case 'DELETE_CLASS': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        draft.removeClass(umlClass.name);
        steps.push({
          kind: 'DELETE_CLASS',
          name: umlClass.name,
          description: `Eliminar la clase ${umlClass.name} con sus atributos y sus relaciones.`,
        });
        return;
      }

      case 'ADD_ATTRIBUTE': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        const attributes = this.planAttributes(
          umlClass.name,
          action.attributes,
          new Set(umlClass.attributes.keys()),
          rejections,
          warnings,
          unknownType,
        );
        if (attributes === null) return;

        for (const attribute of attributes) {
          draft.addAttribute(umlClass.name, attribute.name);
        }
        steps.push({
          kind: 'ADD_ATTRIBUTE',
          className: umlClass.name,
          attributes,
          description: `Añadir a ${umlClass.name} ${this.list(
            attributes.map((attribute) => this.describeAttribute(attribute)),
          )}.`,
        });
        return;
      }

      case 'UPDATE_ATTRIBUTE': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        const current = umlClass.attributes.get(fold(action.attributeName));
        if (current === undefined) {
          reject(`La clase ${umlClass.name} no tiene ningún atributo «${action.attributeName}».`);
          return;
        }

        let newName: string | null = null;
        if (action.newName !== null) {
          const problem = identifierProblem(action.newName);
          if (problem !== null) {
            reject(`«${action.newName}» no es un nombre de atributo válido: ${problem}.`);
            return;
          }
          if (
            umlClass.attributes.has(fold(action.newName)) &&
            fold(action.newName) !== fold(current)
          ) {
            reject(`La clase ${umlClass.name} ya tiene un atributo «${action.newName}».`);
            return;
          }
          newName = action.newName;
        }

        let newType: string | null = null;
        if (action.newType !== null) {
          const resolved = normalizeDataType(action.newType);
          if (resolved === null) {
            reject(this.unknownTypeMessage(action.newType));
            return;
          }
          newType = resolved;
        }

        if (newName !== null) draft.renameAttribute(umlClass.name, current, newName);

        const changes = [
          newName === null ? null : `pasa a llamarse ${newName}`,
          newType === null ? null : `pasa a ser de tipo ${newType}`,
        ].filter((change): change is string => change !== null);

        steps.push({
          kind: 'UPDATE_ATTRIBUTE',
          className: umlClass.name,
          attributeName: current,
          newName,
          newType,
          description: `El atributo ${current} de ${umlClass.name} ${this.list(changes)}.`,
        });
        return;
      }

      case 'DELETE_ATTRIBUTE': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        const current = umlClass.attributes.get(fold(action.attributeName));
        if (current === undefined) {
          reject(`La clase ${umlClass.name} no tiene ningún atributo «${action.attributeName}».`);
          return;
        }

        draft.removeAttribute(umlClass.name, current);
        steps.push({
          kind: 'DELETE_ATTRIBUTE',
          className: umlClass.name,
          attributeName: current,
          description: `Eliminar el atributo ${current} de ${umlClass.name}.`,
        });
        return;
      }

      case 'CREATE_RELATIONSHIP': {
        this.planRelationships(action, draft, steps, rejections, warnings, unknownType);
        return;
      }

      case 'UPDATE_RELATIONSHIP': {
        const source = draft.find(action.sourceClass);
        const target = draft.find(action.targetClass);
        if (source === null) {
          reject(this.missingClass(action.sourceClass));
          return;
        }
        if (target === null) {
          reject(this.missingClass(action.targetClass));
          return;
        }

        const found = draft.between(source.name, target.name);
        if (found.length === 0) {
          reject(`No hay ninguna relación entre ${source.name} y ${target.name}.`);
          return;
        }
        if (found.length > 1) {
          reject(
            `Hay ${found.length} relaciones entre ${source.name} y ${target.name}: indique cuál hay que modificar.`,
          );
          return;
        }

        const { relationship, reversed } = found[0];
        if (relationship.id === null) {
          reject(
            `La relación entre ${source.name} y ${target.name} se acaba de crear en esta misma instrucción; modifíquela en otra.`,
          );
          return;
        }

        const changes: RelationshipChanges = {};
        const described: string[] = [];

        // El usuario habla de «el extremo de Cliente». Si la relación se
        // guardó al revés, ese extremo es el destino de la fila, no el origen.
        const ends: [string | null | undefined, string][] = reversed
          ? [
              [action.sourceMultiplicity, 'target'],
              [action.targetMultiplicity, 'source'],
            ]
          : [
              [action.sourceMultiplicity, 'source'],
              [action.targetMultiplicity, 'target'],
            ];

        for (const [value, end] of ends) {
          if (value === undefined) continue;
          if (value !== null && !isMultiplicity(value)) {
            reject(this.badMultiplicity(value));
            return;
          }
          if (end === 'source') {
            changes.source_multiplicity = value;
          } else {
            changes.target_multiplicity = value;
          }
        }

        if (action.sourceMultiplicity !== undefined) {
          described.push(`${source.name} queda en ${action.sourceMultiplicity ?? 'sin indicar'}`);
        }
        if (action.targetMultiplicity !== undefined) {
          described.push(`${target.name} queda en ${action.targetMultiplicity ?? 'sin indicar'}`);
        }

        if (action.relationshipType !== undefined && action.relationshipType !== relationship.type) {
          changes.relationship_type = action.relationshipType;
          described.push(`pasa a ser una ${RELATIONSHIP_LABELS[action.relationshipType]}`);
        }
        if (action.name !== undefined) {
          changes.name = action.name;
          described.push(
            action.name === null ? 'se le quita el nombre' : `se llama «${action.name}»`,
          );
        }

        if (Object.keys(changes).length === 0) {
          reject(`La relación entre ${source.name} y ${target.name} ya estaba así.`);
          return;
        }

        steps.push({
          kind: 'UPDATE_RELATIONSHIP',
          relationshipId: relationship.id,
          changes,
          description: `En la relación ${source.name}–${target.name}, ${this.list(described)}.`,
        });
        return;
      }

      case 'DELETE_RELATIONSHIP': {
        const source = draft.find(action.sourceClass);
        const target = draft.find(action.targetClass);
        if (source === null) {
          reject(this.missingClass(action.sourceClass));
          return;
        }
        if (target === null) {
          reject(this.missingClass(action.targetClass));
          return;
        }

        const found = draft.between(source.name, target.name);
        if (found.length === 0) {
          reject(`No hay ninguna relación entre ${source.name} y ${target.name}.`);
          return;
        }
        if (found.length > 1) {
          reject(
            `Hay ${found.length} relaciones entre ${source.name} y ${target.name}: indique cuál hay que eliminar.`,
          );
          return;
        }

        const { relationship } = found[0];
        if (relationship.id === null) {
          reject(
            `La relación entre ${source.name} y ${target.name} se acaba de crear en esta misma instrucción.`,
          );
          return;
        }

        draft.removeRelationship(relationship.id);
        steps.push({
          kind: 'DELETE_RELATIONSHIP',
          relationshipId: relationship.id,
          description: `Eliminar la ${RELATIONSHIP_LABELS[relationship.type as AiRelationshipType] ?? 'relación'} entre ${source.name} y ${target.name}.`,
        });
        return;
      }

      case 'MOVE_CLASS': {
        const umlClass = draft.find(action.className);
        if (umlClass === null) {
          reject(this.missingClass(action.className));
          return;
        }

        let position: Placed;
        let where: string;

        if (action.position !== null) {
          position = { posX: Math.round(action.position.x), posY: Math.round(action.position.y) };
          where = `a x=${position.posX}, y=${position.posY}`;
        } else if (action.reference !== null) {
          const reference = draft.find(action.reference.className);
          if (reference === null) {
            reject(this.missingClass(action.reference.className));
            return;
          }
          position = besidePosition(
            { posX: reference.posX, posY: reference.posY },
            action.reference.direction,
          );
          where = `${this.directionLabel(action.reference.direction)} de ${reference.name}`;
        } else {
          reject(`No se entendió a dónde mover la clase ${umlClass.name}.`);
          return;
        }

        draft.moveClass(umlClass.name, position);
        steps.push({
          kind: 'MOVE_CLASS',
          name: umlClass.name,
          position,
          description: `Mover la clase ${umlClass.name} ${where}.`,
        });
        return;
      }
    }
  }

  /**
   * Una acción CREATE_RELATIONSHIP puede producir varias relaciones: «Cliente y
   * Administrador heredan de Usuario» son dos filas con el mismo padre.
   */
  private planRelationships(
    action: Extract<RawAction, { action: 'CREATE_RELATIONSHIP' }>,
    draft: DiagramDraft,
    steps: PlannedStep[],
    rejections: string[],
    warnings: string[],
    unknownType: UnknownTypePolicy,
  ): void {
    const declared = draft.find(action.sourceClass);
    if (declared === null) {
      // Leyendo una foto, una línea hacia una caja cuyo nombre no se pudo
      // importar se deja sin dibujar; dictando, se rechaza la instrucción.
      if (unknownType === 'keep-null') {
        warnings.push(this.missingClass(action.sourceClass));
        return;
      }
      rejections.push(this.missingClass(action.sourceClass));
      return;
    }

    const isInheritance = action.relationshipType === 'INHERITANCE';

    /*
     * Multiplicidades ilegibles.
     *
     * La decisión es la misma que con los tipos de dato y por el mismo motivo.
     * Al dictar (CU04) se puede volver a preguntar, así que una multiplicidad
     * que no existe rechaza la instrucción. Al leer una foto (CU05) no hay a
     * quién preguntar, y Enterprise Architect llega a dibujar cosas como
     * «*..0» en los extremos de una clase de asociación: tirar la importación
     * entera —ocho clases y sus atributos— por un número mal leído en una
     * esquina sería desproporcionado. Ese extremo se queda sin multiplicidad y
     * se avisa.
     */
    let sourceMultiplicity = action.sourceMultiplicity;
    let targetMultiplicity = action.targetMultiplicity;

    // La herencia no tiene extremos «muchos»; guardarlos sería ruido que CU07
    // tendría que ignorar.
    if (!isInheritance) {
      const ends: [string | null, 'source' | 'target'][] = [
        [sourceMultiplicity, 'source'],
        [targetMultiplicity, 'target'],
      ];

      for (const [multiplicity, end] of ends) {
        if (multiplicity === null || isMultiplicity(multiplicity)) continue;

        if (unknownType === 'reject') {
          rejections.push(this.badMultiplicity(multiplicity));
          return;
        }

        warnings.push(
          `La multiplicidad «${multiplicity}» entre ${action.sourceClass} y ${action.targetClasses.join(
            ', ',
          )} no es válida: ese extremo quedó sin indicar.`,
        );
        if (end === 'source') {
          sourceMultiplicity = null;
        } else {
          targetMultiplicity = null;
        }
      }
    }

    for (const targetName of action.targetClasses) {
      const other = draft.find(targetName);
      if (other === null) {
        if (unknownType === 'keep-null') {
          warnings.push(this.missingClass(targetName));
          continue;
        }
        rejections.push(this.missingClass(targetName));
        return;
      }

      if (fold(other.name) === fold(declared.name)) {
        const reason = isInheritance
          ? `La clase ${declared.name} no puede heredar de sí misma.`
          : `No se puede relacionar la clase ${declared.name} consigo misma desde el asistente.`;

        // Al leer una foto se salta esa línea y se sigue; al dictar se
        // rechaza, que es lo que permite al usuario reformular la instrucción.
        if (unknownType === 'keep-null') {
          warnings.push(reason);
          continue;
        }
        rejections.push(reason);
        return;
      }

      /*
       * Orientación de la herencia.
       *
       * En las acciones del asistente, «sourceClass» de una INHERITANCE es la
       * clase padre y «targetClasses» las hijas —así lo define CU04, y así se
       * dice en el prompt—. En uml_relationships es al revés: la fila va de la
       * hija (source) a la madre (target), que es hacia donde apunta el
       * triángulo en el lienzo. Aquí es donde se da la vuelta, una sola vez y
       * en un sitio.
       */
      const sourceClass = isInheritance ? other.name : declared.name;
      const targetClass = isInheritance ? declared.name : other.name;

      const duplicate = draft
        .between(sourceClass, targetClass)
        .some((found) => found.relationship.type === action.relationshipType);
      if (duplicate) {
        const reason = `Ya existe una ${RELATIONSHIP_LABELS[action.relationshipType]} entre ${declared.name} y ${other.name}.`;

        // Importar una foto sobre un diagrama que ya tenía parte de lo
        // dibujado es un caso normal —y previsto: a las clases repetidas se
        // les añaden sólo los atributos nuevos—, así que una relación que ya
        // estaba no puede tumbar la importación entera.
        if (unknownType === 'keep-null') {
          warnings.push(reason);
          continue;
        }
        rejections.push(reason);
        return;
      }

      draft.addRelationship(action.relationshipType, sourceClass, targetClass);
      steps.push({
        kind: 'CREATE_RELATIONSHIP',
        relationshipType: action.relationshipType,
        sourceClass,
        targetClass,
        sourceMultiplicity: isInheritance ? null : sourceMultiplicity,
        targetMultiplicity: isInheritance ? null : targetMultiplicity,
        name: action.name,
        description: isInheritance
          ? `Hacer que ${other.name} herede de ${declared.name}.`
          : `Crear una ${RELATIONSHIP_LABELS[action.relationshipType]} entre ${declared.name} (${
              sourceMultiplicity ?? 'sin multiplicidad'
            }) y ${other.name} (${targetMultiplicity ?? 'sin multiplicidad'}).`,
      });
    }
  }

  /**
   * Valida una lista de atributos. Devuelve null —y deja el motivo en
   * `rejections`— en cuanto uno no sirve: basta con uno para no ejecutar nada.
   */
  private planAttributes(
    className: string,
    attributes: RawAttribute[],
    taken: Set<string>,
    rejections: string[],
    warnings: string[],
    unknownType: UnknownTypePolicy,
  ): PlannedAttribute[] | null {
    const planned: PlannedAttribute[] = [];
    const seen = new Set(taken);

    for (const attribute of attributes) {
      const problem = identifierProblem(attribute.name);
      if (problem !== null) {
        rejections.push(`«${attribute.name}» no es un nombre de atributo válido: ${problem}.`);
        return null;
      }

      if (seen.has(fold(attribute.name))) {
        rejections.push(`La clase ${className} ya tiene un atributo «${attribute.name}».`);
        return null;
      }
      seen.add(fold(attribute.name));

      const type = normalizeDataType(attribute.type);
      if (type === null) {
        /*
         * No se pudo resolver el tipo, y qué hacer depende de quién pregunta.
         *
         * Al dictar o teclear (CU04) se puede volver a preguntar, así que un
         * tipo que no existe se rechaza y, cuando la instrucción no dice
         * ninguno, se usa String —que es lo que el asistente hace desde
         * siempre—. Al leer una foto (CU05) no hay a quién preguntar: se
         * guarda el atributo sin tipo, porque un hueco es la verdad y un tipo
         * supuesto sería una invención que después nadie distinguiría de lo
         * que de verdad estaba dibujado.
         */
        if (unknownType === 'keep-null') {
          planned.push({ name: attribute.name, type: null });
          if (attribute.type !== null) {
            warnings.push(
              `El tipo «${attribute.type}» del atributo ${attribute.name} de ${className} no está en el catálogo: se guardó sin tipo.`,
            );
          }
          continue;
        }

        if (attribute.type === null) {
          planned.push({ name: attribute.name, type: FALLBACK_DATA_TYPE });
          warnings.push(
            `El atributo ${attribute.name} de ${className} se guardó como ${FALLBACK_DATA_TYPE}: no se indicó su tipo.`,
          );
          continue;
        }

        rejections.push(this.unknownTypeMessage(attribute.type));
        return null;
      }

      planned.push({ name: attribute.name, type });
    }

    return planned;
  }

  // -------------------------------------------------------------- mensajes

  private missingClass(name: string): string {
    return `No existe ninguna clase llamada «${name}» en el diagrama.`;
  }

  /** «id: Integer», o «nombre (sin tipo)» cuando no se pudo determinar. */
  private describeAttribute(attribute: PlannedAttribute): string {
    return attribute.type === null
      ? `${attribute.name} (sin tipo)`
      : `${attribute.name}: ${attribute.type}`;
  }

  private unknownTypeMessage(type: string): string {
    return `El tipo «${type}» no está en el catálogo. Use uno de: ${OFFERED_DATA_TYPES.join(', ')}.`;
  }

  private badMultiplicity(value: string): string {
    return `«${value}» no es una multiplicidad válida. Ejemplos: 1, 0..1, 0..*, 1..*, *.`;
  }

  private directionLabel(direction: 'above' | 'below' | 'left' | 'right'): string {
    const labels = {
      above: 'encima',
      below: 'debajo',
      left: 'a la izquierda',
      right: 'a la derecha',
    };

    return labels[direction];
  }

  /** «a, b y c»: se usa en las frases que se le enseñan al usuario. */
  private list(items: string[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];

    return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
  }
}
