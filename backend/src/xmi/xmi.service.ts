import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { freePosition } from '../ai/layout.js';
import { ClassesService } from '../diagrams/classes.service.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { RelationshipsService } from '../diagrams/relationships.service.js';
import { DATA_TYPE_NAMES, identifierProblem } from '../diagrams/uml-catalog.js';
import { isMultiplicity } from '../diagrams/validation.js';
import { generateXmi } from './xmi-generator.js';
import { XmiParseError, parseXmi } from './xmi-parser.js';
import type { ParsedClass, ParsedXmi } from './xmi-parser.js';

/**
 * CU06 — Gestionar el intercambio de diagramas mediante XMI.
 *
 * Exportar es escribir el modelo guardado como XMI; importar es leer un XMI y
 * crear con él un diagrama nuevo. Las dos operaciones son deterministas: no
 * interviene ninguna IA, y el mismo archivo produce siempre el mismo
 * resultado. Es la diferencia con CU05, donde una imagen se interpreta.
 *
 * La importación crea siempre un diagrama nuevo dentro del proyecto. Nunca
 * sobrescribe uno existente, para que abrir un archivo por equivocación no
 * pueda borrar el trabajo de nadie.
 *
 * Todo lo que se crea pasa por ClassesService y RelationshipsService, los
 * mismos servicios que usa el lienzo: un XMI manipulado a mano no puede meter
 * en la base algo que el editor no habría dejado guardar.
 */

/** Tamaño máximo del archivo; un XMI de un diagrama grande no llega a esto. */
export const MAX_XMI_BYTES = 5 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = ['xmi', 'xml'];

/** Fichero tal como lo entrega Multer. */
export interface UploadedFile {
  fieldname: string;
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Lo que se le cuenta al usuario después de importar. */
export interface XmiImportSummary {
  classes: number;
  attributes: number;
  methods: number;
  relationships: number;
  /** Elementos UML reconocidos que esta herramienta no representa. */
  skipped: string[];
  /** Cosas que se ajustaron para poder guardarlas; se dicen, no se ocultan. */
  warnings: string[];
}

export interface XmiImportResult {
  diagram: FullDiagramResponse;
  summary: XmiImportSummary;
}

@Injectable()
export class XmiService {
  private readonly logger = new Logger(XmiService.name);

  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly classesService: ClassesService,
    private readonly relationshipsService: RelationshipsService,
  ) {}

  /**
   * El diagrama guardado, escrito como XMI 1.1 sobre UML 1.3.
   *
   * La extensión es `.xml` y no `.xmi` porque es la que usa Enterprise
   * Architect para este formato, y el archivo está pensado para abrirse allí.
   */
  async export(userId: string, diagramId: string): Promise<{ fileName: string; xmi: string }> {
    const diagram = await this.diagramsService.findOneFull(userId, diagramId);

    return { fileName: `${fileNameOf(diagram.name)}.xml`, xmi: generateXmi(diagram) };
  }

  /**
   * Crea un diagrama nuevo a partir de un archivo XMI.
   *
   * Se lee y se valida entero antes de escribir nada: si el archivo estuviera
   * roto a la mitad, quedaría si no un diagrama incompleto que el usuario no
   * pidió. Lo que se lee bien pero no cabe en este modelo se omite y se
   * cuenta; lo que no se puede leer detiene la importación.
   */
  async import(
    userId: string,
    projectId: string,
    file: UploadedFile | undefined,
    nameOverride?: unknown,
  ): Promise<XmiImportResult> {
    this.assertValidFile(file);

    let parsed: ParsedXmi;
    try {
      parsed = parseXmi(file!.buffer.toString('utf8'));
    } catch (error) {
      if (error instanceof XmiParseError) {
        throw new BadRequestException(error.message);
      }
      this.logger.error('Fallo inesperado al leer el XMI', error);
      throw new BadRequestException('No se pudo leer el archivo XMI.');
    }

    const warnings: string[] = [];
    const named = this.resolveNames(parsed, warnings);

    const name =
      this.text(nameOverride) ?? parsed.name ?? fileNameOf(file!.originalname).replace(/\.xmi$/i, '');
    const diagram = await this.diagramsService.create(userId, projectId, {
      name,
      description: `Importado desde ${file!.originalname}.`,
    });

    // Del identificador que traía el archivo al de la clase recién creada.
    const classIds = new Map<string, string>();
    const placed: { posX: number; posY: number }[] = [];
    let attributes = 0;
    let methods = 0;

    for (const umlClass of named) {
      // Sin posición en el archivo se coloca en la primera casilla libre, que
      // es lo mismo que hace el asistente al crear una clase.
      const position =
        umlClass.position === null
          ? freePosition(placed)
          : { posX: Math.round(umlClass.position.x), posY: Math.round(umlClass.position.y) };
      placed.push(position);

      const created = await this.classesService.createClass(userId, diagram.id, {
        name: umlClass.name,
        is_abstract: umlClass.isAbstract,
        visibility: umlClass.visibility,
        pos_x: position.posX,
        pos_y: position.posY,
      });
      classIds.set(umlClass.id, created.id);

      for (const attribute of umlClass.attributes) {
        const type = this.resolveType(attribute.type, umlClass.name, attribute.name, warnings);

        await this.classesService.createAttribute(userId, created.id, {
          name: attribute.name,
          // Sin tipo se manda null: el archivo no lo decía y no se inventa.
          data_type: type,
          visibility: attribute.visibility,
          is_nullable: attribute.isNullable,
          is_unique: attribute.isUnique,
          default_value: attribute.defaultValue,
        });
        attributes += 1;
      }

      methods += await this.createMethods(userId, created.id, umlClass, warnings);
    }

    let relationships = 0;
    const skipped = [...parsed.skipped];

    for (const relationship of parsed.relationships) {
      const source = classIds.get(relationship.source);
      const target = classIds.get(relationship.target);

      // Puede faltar si su clase se descartó por tener un nombre imposible.
      if (source === undefined || target === undefined) {
        skipped.push('Relación entre clases que no se importaron');
        continue;
      }

      /*
       * Una relación de una clase consigo misma sí se importa.
       *
       * Es un modelo corriente —un empleado que supervisa a otros empleados,
       * una categoría que cuelga de otra categoría— y descartarla hacía
       * desaparecer del diagrama una línea que el archivo traía dibujada. Lo
       * único que no puede ser reflexivo es la herencia: una clase no hereda de
       * sí misma, y CU07 no sabría qué escribir.
       */
      if (source === target && relationship.type === 'INHERITANCE') {
        warnings.push('Se omitió una herencia de una clase consigo misma.');
        continue;
      }

      const where = `${relationship.type} entre las clases del archivo`;

      await this.relationshipsService.create(userId, diagram.id, {
        source_class_id: source,
        target_class_id: target,
        relationship_type: relationship.type,
        source_multiplicity: this.resolveMultiplicity(
          relationship.sourceMultiplicity,
          where,
          warnings,
        ),
        target_multiplicity: this.resolveMultiplicity(
          relationship.targetMultiplicity,
          where,
          warnings,
        ),
        name: relationship.name,
        source_role: relationship.sourceRole,
        target_role: relationship.targetRole,
      });
      relationships += 1;
    }

    return {
      diagram: await this.diagramsService.findOneFull(userId, diagram.id),
      summary: {
        classes: classIds.size,
        attributes,
        methods,
        relationships,
        skipped: [...new Set(skipped)],
        warnings,
      },
    };
  }

  /**
   * Crea los métodos de una clase.
   *
   * Un método con un retorno o un parámetro de tipo irreconocible no tumba la
   * importación: se ajusta lo que se puede —el retorno pasa a «void»— y el
   * parámetro que no se puede representar se omite diciéndolo, porque en este
   * modelo un parámetro sin tipo no existe.
   */
  private async createMethods(
    userId: string,
    classId: string,
    umlClass: ParsedClass,
    warnings: string[],
  ): Promise<number> {
    let created = 0;

    for (const method of umlClass.methods) {
      const returnType =
        this.resolveType(method.returnType, umlClass.name, method.name, []) ?? 'void';

      const saved = await this.classesService.createMethod(userId, classId, {
        name: method.name,
        return_type: returnType,
        visibility: method.visibility,
      });
      created += 1;

      for (const parameter of method.parameters) {
        const type = this.resolveType(parameter.type, umlClass.name, parameter.name, []);

        if (type === null) {
          warnings.push(
            `El parámetro «${parameter.name}» de ${umlClass.name}.${method.name} se omitió: no se pudo determinar su tipo.`,
          );
          continue;
        }

        await this.classesService.createParameter(userId, saved.id, {
          name: parameter.name,
          data_type: type,
        });
      }
    }

    return created;
  }

  /**
   * La multiplicidad que traía el archivo, si este modelo la admite.
   *
   * Enterprise Architect escribe a veces multiplicidades que no significan
   * nada, como «*..0» en los extremos de una clase de asociación. Guardarlas
   * no es posible y detener la importación por ellas sería desproporcionado:
   * se deja el extremo sin multiplicidad y se avisa.
   */
  private resolveMultiplicity(
    multiplicity: string | null,
    where: string,
    warnings: string[],
  ): string | null {
    if (multiplicity === null) return null;

    const text = multiplicity.trim();
    if (text.length === 0) return null;
    if (isMultiplicity(text)) return text;

    warnings.push(`La multiplicidad «${text}» de la ${where} no es válida y se dejó sin indicar.`);
    return null;
  }

  // ------------------------------------------------------------ validación

  /**
   * Los nombres de clase de otra herramienta no tienen por qué servir como
   * identificadores Java, que es lo que este modelo exige para poder generar
   * el backend después (CU07). Se corrigen los que se pueden —quitando
   * espacios y signos— y se descartan los que no, diciéndolo.
   */
  private resolveNames(parsed: ParsedXmi, warnings: string[]): ParsedClass[] {
    const usable: ParsedClass[] = [];
    const taken = new Set<string>();

    for (const umlClass of parsed.classes) {
      const name = this.toIdentifier(umlClass.name);

      if (name === null) {
        warnings.push(`La clase «${umlClass.name}» se omitió: su nombre no es utilizable.`);
        continue;
      }
      if (name !== umlClass.name) {
        warnings.push(`La clase «${umlClass.name}» se importó como «${name}».`);
      }
      if (taken.has(name.toLowerCase())) {
        warnings.push(`Había dos clases llamadas «${name}»; se importó la primera.`);
        continue;
      }
      taken.add(name.toLowerCase());

      const attributes = umlClass.attributes.flatMap((attribute) => {
        const attributeName = this.toIdentifier(attribute.name);
        if (attributeName === null) {
          warnings.push(
            `El atributo «${attribute.name}» de ${name} se omitió: su nombre no es utilizable.`,
          );
          return [];
        }
        return [{ ...attribute, name: attributeName }];
      });

      usable.push({ ...umlClass, name, attributes });
    }

    if (usable.length === 0) {
      throw new BadRequestException(
        'Ninguna de las clases del archivo tiene un nombre que esta herramienta pueda usar.',
      );
    }

    return usable;
  }

  /** «Orden de Compra» → «OrdenDeCompra»; null si no queda nada aprovechable. */
  private toIdentifier(name: string): string | null {
    const cleaned = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_ ]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
      .join('');

    if (cleaned.length === 0) return null;
    // Un nombre que empiece por dígito no sirve como identificador.
    const candidate = /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;

    return identifierProblem(candidate) === null ? candidate : null;
  }

  /**
   * El tipo que traía el archivo, traducido al catálogo.
   *
   * Los nombres varían entre herramientas —«int», «varchar», «Date»—, y lo que
   * no se reconoce se guarda sin tipo en lugar de aproximarlo: un tipo
   * inventado no se distingue después de uno que sí estaba en el archivo.
   */
  private resolveType(
    type: string | null,
    className: string,
    attributeName: string,
    warnings: string[],
  ): string | null {
    if (type === null) return null;

    const exact = DATA_TYPE_NAMES.find(
      (name) => name.toLowerCase() === type.trim().toLowerCase(),
    );
    if (exact !== undefined) return exact;

    const equivalent = EQUIVALENT_TYPES[type.trim().toLowerCase()];
    if (equivalent !== undefined) return equivalent;

    warnings.push(
      `El tipo «${type}» de ${className}.${attributeName} no está en el catálogo: el atributo quedó sin tipo.`,
    );
    return null;
  }

  private assertValidFile(file: UploadedFile | undefined): void {
    if (!file || file.size === 0) {
      throw new BadRequestException('Adjunte el archivo XMI en el campo «file».');
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      throw new BadRequestException(
        `El archivo debe tener extensión .xmi o .xml; llegó «.${extension}».`,
      );
    }

    if (file.size > MAX_XMI_BYTES) {
      throw new BadRequestException(
        `El archivo ocupa ${Math.round(file.size / 1024 / 1024)} MB y el máximo son ${
          MAX_XMI_BYTES / 1024 / 1024
        } MB.`,
      );
    }
  }

  private text(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
}

/**
 * Tipos de otras herramientas que significan lo mismo que uno del catálogo.
 * Sólo equivalencias claras: lo dudoso se queda sin tipo.
 */
const EQUIVALENT_TYPES: Record<string, string> = {
  int: 'Integer',
  integer: 'Integer',
  int32: 'Integer',
  smallint: 'Integer',
  short: 'Integer',
  long: 'Long',
  int64: 'Long',
  bigint: 'Long',
  string: 'String',
  varchar: 'String',
  nvarchar: 'String',
  char: 'String',
  text: 'String',
  double: 'Double',
  float: 'Float',
  real: 'Float',
  decimal: 'BigDecimal',
  numeric: 'BigDecimal',
  bigdecimal: 'BigDecimal',
  money: 'BigDecimal',
  bool: 'Boolean',
  boolean: 'Boolean',
  bit: 'Boolean',
  date: 'LocalDate',
  localdate: 'LocalDate',
  datetime: 'LocalDateTime',
  timestamp: 'LocalDateTime',
  localdatetime: 'LocalDateTime',
  uuid: 'UUID',
  guid: 'UUID',
};

/** «Sistema de Ventas» → «sistema-de-ventas», para nombrar el archivo. */
function fileNameOf(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length === 0 ? 'diagrama' : slug;
}
