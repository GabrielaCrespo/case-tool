import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { JsonValue, Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';
import { AiExecutorService } from './ai-executor.service.js';
import type { ExecutionPlan } from './ai-executor.service.js';
import { GroqService } from './groq.service.js';
import { fromImageLayout } from './layout.js';
import { diagramContext, imageSystemPrompt, interpretSystemPrompt } from './prompts.js';
import { RELATIONSHIP_LABELS, fold, parseActions, parseImageModel } from './uml-actions.js';
import type { Point, RawAction, RawImageModel } from './uml-actions.js';

/**
 * CU04 — Asistir el Diseño mediante IA.
 * CU05 — Generar Diagrama desde Imagen.
 *
 * Los dos casos de uso acaban en el mismo sitio a propósito: una instrucción
 * escrita y una foto de una pizarra son dos maneras de decir lo mismo, y las
 * dos se convierten en acciones sobre el modelo UML de CU02. De ahí que este
 * servicio los orqueste juntos y que ninguno tenga modelo propio.
 *
 * La cadena es siempre la misma y no se salta ningún eslabón:
 *
 *   entrada → IA → acción estructurada → normalización → validación → ejecución
 *
 * La IA sólo ocupa el segundo eslabón. Lo que responde no se ejecuta nunca
 * directamente: pasa por uml-actions.ts, que le da forma, y por
 * ai-executor.service.ts, que comprueba que sea posible antes de escribir.
 */

/** Imágenes que se aceptan, con las extensiones que les corresponden. */
const ACCEPTED_IMAGES: Record<string, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
};

/**
 * Tope de tamaño de la imagen que se acepta.
 *
 * La imagen viaja al modelo dentro de la petición, codificada en base64, que
 * engorda los bytes un tercio: con este tope la petición se queda en unos 11 MB
 * y la API admite 20. Una foto más grande tampoco se leería mejor —el modelo
 * cobra 2048 tokens por imagen, sea cual sea su resolución—.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Audios que se aceptan al dictar. Son los formatos que produce MediaRecorder
 * en los navegadores: Opus en WebM (Chrome y Edge), Opus en Ogg (Firefox) y
 * AAC en MP4 (Safari). WAV y MP3 están para poder probar con un archivo.
 */
const ACCEPTED_AUDIO: Record<string, string[]> = {
  'audio/webm': ['webm'],
  'audio/ogg': ['ogg', 'oga'],
  'audio/mp4': ['mp4', 'm4a'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
};

/**
 * Tope de la grabación. Una instrucción dictada dura segundos; con este
 * margen sobra, y evita que una pestaña olvidada grabando mande media hora
 * de audio a transcribir.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Longitud máxima de una instrucción de CU04. */
const MAX_COMMAND_LENGTH = 1000;

/**
 * De dónde salió la instrucción.
 *
 * Es lo único que cambia entre escribir y dictar, y sólo afecta a lo que se
 * anota en ai_command_logs, que tiene columnas distintas para el tipo de
 * entrada y para el texto transcrito. La interpretación es la misma.
 */
interface CommandOrigin {
  inputType: 'TEXT' | 'VOICE';
  /** Lo que entró: el texto tecleado, o una descripción de la grabación. */
  rawInput: string;
  transcribedText: string | null;
}

const TYPED: CommandOrigin = { inputType: 'TEXT', rawInput: '', transcribedText: null };

/** Fichero tal como lo entrega Multer. */
export interface UploadedFile {
  /** Nombre del campo del formulario en el que llegó. */
  fieldname: string;
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Cuerpo de POST /ai/interpret. Se admiten las dos grafías del identificador
 * —`diagramId` y `diagram_id`— porque el resto de la API responde en
 * snake_case y no merece la pena que el cliente tenga que recordar cuál toca.
 */
export interface AiCommandInput {
  projectId?: unknown;
  project_id?: unknown;
  diagramId?: unknown;
  diagram_id?: unknown;
  command?: unknown;
}

export type AiResultStatus =
  /** Se interpretó, se validó y se ejecutó. */
  | 'APPLIED'
  /** No se pudo interpretar o no era posible: el diagrama no se tocó. */
  | 'REJECTED'
  /** Se interpretó bien, pero algo falló al guardar. */
  | 'FAILED';

export interface AiResult {
  status: AiResultStatus;
  /** Lo que se hizo, en frases que se le pueden enseñar al usuario. */
  applied: string[];
  /** Por qué no se hizo. */
  rejections: string[];
  /** Decisiones que tomó el sistema por su cuenta. */
  warnings: string[];
  /**
   * El diagrama completo después de la operación. Viaja en la respuesta para
   * que el editor pinte el resultado sin una segunda petición.
   */
  diagram: FullDiagramResponse;
}

/**
 * CU05 añade cuánto se leyó de la imagen. No va la imagen ni ninguna
 * referencia a ella: se descartó en cuanto el modelo terminó de mirarla.
 */
export interface ImageImportResult extends AiResult {
  job_id: string;
  classes_created: number;
  relationships_created: number;
}

/**
 * CU04 por voz: el mismo resultado de siempre, más lo que se entendió al
 * dictar. La transcripción se devuelve aunque la instrucción se rechace,
 * porque es lo que permite al usuario ver si le entendió mal el micrófono o
 * si lo que pidió no era posible.
 */
export interface VoiceResult extends AiResult {
  transcription: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly executor: AiExecutorService,
    private readonly groq: GroqService,
  ) {}

  // ------------------------------------------------------------------ CU04

  /**
   * Interpreta una instrucción en lenguaje natural y la aplica al diagrama.
   *
   * Es el único camino de CU04: da igual que la instrucción se haya tecleado o
   * dictado, porque la voz entra por aquí ya convertida en texto. `origin`
   * sólo dice de dónde venía, y eso únicamente cambia lo que se anota en
   * ai_command_logs —que distingue TEXT de VOICE y guarda aparte el texto
   * transcrito—; la interpretación, la validación y la ejecución son las
   * mismas.
   *
   * Todo lo que ocurra queda anotado: la instrucción, lo que la IA entendió y
   * si se ejecutó o no. Sirve para poder explicar después por qué el diagrama
   * quedó como quedó.
   */
  async interpret(
    userId: string,
    input: AiCommandInput,
    origin: CommandOrigin = TYPED,
  ): Promise<AiResult> {
    const diagramId = this.requiredUuid(input?.diagramId ?? input?.diagram_id, 'diagramId');
    const command = this.requiredCommand(input?.command);

    // Al teclear, lo que entró es la propia instrucción; al dictar, quien
    // llama ya ha descrito la grabación y trae la transcripción aparte.
    const entry: CommandOrigin =
      origin.inputType === 'TEXT'
        ? { inputType: 'TEXT', rawInput: command, transcribedText: null }
        : origin;

    // findOneFull comprueba los permisos: quien no puede abrir el diagrama
    // tampoco puede dictarle instrucciones.
    const diagram = await this.diagramsService.findOneFull(userId, diagramId);

    // projectId es opcional, pero si llega tiene que ser el del diagrama: una
    // discrepancia sólo puede venir de un cliente confundido.
    const projectId = input?.projectId ?? input?.project_id;
    if (typeof projectId === 'string' && projectId.length > 0 && projectId !== diagram.project_id) {
      throw new BadRequestException('El diagrama indicado no pertenece a ese proyecto.');
    }

    const raw = await this.groq.askJson(
      interpretSystemPrompt(),
      `${diagramContext(diagram)}\n\nInstrucción del usuario:\n${command}`,
    );

    const parsed = parseActions(raw);

    // La IA declaró que no entendía, o su respuesta traía acciones a medias.
    // En los dos casos el diagrama se queda como estaba: ejecutar «lo que se
    // entendió» de una instrucción mal leída es justo lo que no debe pasar.
    if (parsed.error !== null || parsed.problems.length > 0) {
      const rejections = parsed.error !== null ? [parsed.error] : parsed.problems;
      await this.log(diagramId, userId, entry, null, raw, 'REJECTED', rejections.join(' '));

      return { status: 'REJECTED', applied: [], rejections, warnings: [], diagram };
    }

    const plan = this.executor.plan(diagram, parsed.actions, 'reject');

    if (plan.rejections.length > 0) {
      await this.log(
        diagramId,
        userId,
        entry,
        parsed.actions,
        raw,
        'REJECTED',
        plan.rejections.join(' '),
      );

      return {
        status: 'REJECTED',
        applied: [],
        rejections: plan.rejections,
        warnings: plan.warnings,
        diagram,
      };
    }

    return this.run(userId, diagram, plan, async (status, applied, error) => {
      await this.log(
        diagramId,
        userId,
        entry,
        parsed.actions,
        raw,
        status === 'APPLIED' ? 'SUCCESS' : 'FAILED',
        error,
      );
      return applied;
    });
  }

  /**
   * CU04 por voz: el micrófono dicta y el asistente hace lo mismo que si se
   * hubiera escrito.
   *
   * Aquí no hay nada de UML. Se comprueba que el audio sea audio, se pide la
   * transcripción a Whisper y el texto resultante entra en `interpret`, el
   * mismo método de siempre. No existe un intérprete de voz: existe un
   * micrófono que escribe por el usuario.
   */
  async interpretVoice(
    userId: string,
    diagramIdInput: unknown,
    file: UploadedFile | undefined,
  ): Promise<VoiceResult> {
    const diagramId = this.requiredUuid(diagramIdInput, 'diagram_id');
    this.assertValidAudio(file);

    const transcription = await this.groq.transcribe(file!.buffer, file!.mimetype);

    // El audio no se guarda: lo que tiene valor es lo que se dijo. En
    // ai_command_logs queda la descripción de la grabación y el texto.
    const result = await this.interpret(
      userId,
      { diagramId, command: transcription.text },
      {
        inputType: 'VOICE',
        rawInput: `Grabación de voz (${file!.mimetype}, ${Math.round(
          file!.size / 1024,
        )} KB, ${transcription.duration} s)`,
        transcribedText: transcription.text,
      },
    );

    return { ...result, transcription: transcription.text };
  }

  // ------------------------------------------------------------------ CU05

  /**
   * Convierte una imagen de un diagrama de clases en un diagrama editable.
   *
   * La imagen no se guarda en ninguna parte: llega, se le enseña al modelo y se
   * descarta al terminar la petición. No pasa por disco, ni por PostgreSQL, ni
   * por ningún servicio de terceros que la almacene. De la importación queda
   * constancia en photo_import_jobs —quién, cuándo, qué archivo y qué se leyó—,
   * pero de la imagen sólo su nombre, su tipo y su tamaño.
   *
   * El orden es validar, anotar, analizar, normalizar, validar y ejecutar. El
   * trabajo se anota antes de analizar para que quede registro de lo que se
   * intentó importar aunque el análisis falle después.
   */
  async imageToUml(
    userId: string,
    diagramIdInput: unknown,
    file: UploadedFile | undefined,
  ): Promise<ImageImportResult> {
    const diagramId = this.requiredUuid(diagramIdInput, 'diagram_id');
    this.assertValidImage(file);

    const diagram = await this.diagramsService.findOneFull(userId, diagramId);

    const job = await db.orm.public.PhotoImportJobs.create({
      diagramId,
      userId,
      originalFileName: file!.originalname as Varchar<255>,
      mimeType: file!.mimetype as Varchar<100>,
      fileSize: file!.size,
      status: 'PROCESSING',
      extractedModel: null,
      errorMessage: null,
      completedAt: null,
    });

    const fail = async (reason: string): Promise<ImageImportResult> => {
      await this.closeJob(job.id, 'FAILED', null, reason);

      return {
        status: 'REJECTED',
        applied: [],
        rejections: [reason],
        warnings: [],
        diagram,
        job_id: job.id,
        classes_created: 0,
        relationships_created: 0,
      };
    };

    /*
     * La imagen viaja dentro de la propia petición, codificada en base64.
     *
     * Es la forma de enseñársela al modelo sin dejarla en ningún sitio: no hay
     * URL que servir porque no hay nada guardado. Codificar engorda los bytes
     * un tercio, así que el tope de 8 MB de la subida deja la petición en unos
     * 11 MB, holgada frente a los 20 MB que admite la API. Tampoco hace falta
     * reducir la imagen: el modelo cobra 2048 tokens por imagen sea cual sea su
     * resolución, de modo que una captura grande no cuesta más ni tarda más.
     */
    const dataUri = `data:${file!.mimetype};base64,${file!.buffer.toString('base64')}`;

    let raw: unknown;
    try {
      raw = await this.groq.askJson(
        imageSystemPrompt(),
        'Transcribe este diagrama de clases.',
        dataUri,
      );
    } catch (error) {
      // Sin conexión, cuota agotada, respuesta ilegible: el trabajo queda
      // marcado como fallido antes de devolverle el error al usuario.
      await this.closeJob(
        job.id,
        'FAILED',
        null,
        error instanceof Error ? error.message : 'Fallo al analizar la imagen.',
      );
      throw error;
    }

    const model = parseImageModel(raw);

    if (model.classes.length === 0) {
      return fail(
        'No se reconoció ningún diagrama de clases en la imagen. Compruebe que se leen los nombres de las clases.',
      );
    }

    const { actions, warnings } = this.toActions(model, diagram);
    if (actions.length === 0) {
      return fail('Todo lo que se leyó en la imagen ya estaba en el diagrama.');
    }

    // 'keep-null' y no 'reject': de una foto se lee lo que se lee. Un atributo
    // sin tipo —o con uno que no está en el catálogo— se guarda sin tipo, y ni
    // impide importar el resto ni se rellena con un tipo que nadie dibujó.
    const plan = this.executor.plan(diagram, actions, 'keep-null');

    if (plan.rejections.length > 0) {
      return fail(plan.rejections.join(' '));
    }

    const created = {
      classes: plan.steps.filter((step) => step.kind === 'CREATE_CLASS').length,
      relationships: plan.steps.filter((step) => step.kind === 'CREATE_RELATIONSHIP').length,
    };

    const result = await this.run(userId, diagram, plan, async (status, applied, error) => {
      await this.closeJob(
        job.id,
        status === 'APPLIED' ? 'COMPLETED' : 'FAILED',
        // extracted_model guarda lo que se leyó en la imagen. Es lo único que
        // queda de ella: el modelo leído, no la imagen.
        JSON.parse(JSON.stringify(model)) as JsonValue,
        error,
      );
      return applied;
    });

    return {
      ...result,
      warnings: [...warnings, ...model.problems, ...result.warnings],
      job_id: job.id,
      classes_created: created.classes,
      relationships_created: created.relationships,
    };
  }

  // ---------------------------------------------------------------- comunes

  /**
   * Ejecuta un plan ya validado y devuelve el diagrama tal como quedó.
   *
   * Que un paso falle aquí no es un fallo de interpretación: el plan era
   * correcto contra el modelo que se leyó. Lo que puede pasar es que otro
   * usuario tomara la clase mientras tanto (CU03) o que la conexión con
   * PostgreSQL se cayera. En ese caso se cuenta qué llegó a aplicarse y se
   * devuelve el diagrama real, para que el lienzo no muestre algo que no es.
   */
  private async run(
    userId: string,
    diagram: FullDiagramResponse,
    plan: ExecutionPlan,
    record: (
      status: AiResultStatus,
      applied: string[],
      error: string | null,
    ) => Promise<string[]>,
  ): Promise<AiResult> {
    let applied: string[] = [];
    let status: AiResultStatus = 'APPLIED';
    let failure: string | null = null;

    try {
      applied = await this.executor.apply(userId, diagram, plan.steps);
    } catch (error) {
      status = 'FAILED';
      failure = error instanceof Error ? error.message : 'No se pudo guardar el cambio.';
      this.logger.error('Fallo al aplicar las acciones del asistente', error);
    }

    await record(status, applied, failure);

    return {
      status,
      applied,
      rejections: failure === null ? [] : [failure],
      warnings: plan.warnings,
      // Se relee de PostgreSQL y no se reconstruye a mano: lo que el editor
      // debe pintar es el modelo guardado, incluidas las cascadas que se
      // llevaron por delante relaciones al borrar una clase.
      diagram: await this.diagramsService.findOneFull(userId, diagram.id),
    };
  }

  /**
   * Convierte el modelo leído de la imagen en acciones de CU04.
   *
   * Es lo que hace que CU05 no tenga modelo propio: lo que sale de la foto
   * entra por la misma puerta que una instrucción escrita, y por tanto pasa
   * por la misma validación. Aquí sólo se quita lo que ya está en el diagrama:
   * el plan rechazaría la importación entera por una clase repetida, y lo
   * razonable al importar sobre un diagrama con contenido es completarlo.
   */
  private toActions(
    model: RawImageModel,
    diagram: FullDiagramResponse,
  ): { actions: RawAction[]; warnings: string[] } {
    const actions: RawAction[] = [];
    const warnings: string[] = [];

    const existing = new Map(
      diagram.classes.map((umlClass) => [
        fold(umlClass.name),
        new Set(umlClass.attributes.map((attribute) => fold(attribute.name))),
      ]),
    );
    const seen = new Set<string>();

    /*
     * Las clases nuevas se apartan en lugar de crearse sobre la marcha porque
     * su posición depende de las demás: la disposición del dibujo sólo se
     * puede repartir en el lienzo cuando se sabe cuántas clases hay y cuánto
     * mide cada una (layout.ts). Las que ya existían no se colocan: se quedan
     * donde el usuario las tenía.
     */
    const fresh: RawImageModel['classes'] = [];

    for (const umlClass of model.classes) {
      const key = fold(umlClass.name);

      if (seen.has(key)) {
        warnings.push(`La clase ${umlClass.name} aparecía dos veces en la imagen; se leyó una.`);
        continue;
      }
      seen.add(key);

      const known = existing.get(key);

      if (known !== undefined) {
        // La clase ya está en el diagrama: se le añaden sólo los atributos
        // nuevos, en lugar de rechazar la importación por duplicada.
        const attributes = umlClass.attributes.filter(
          (attribute) => !known.has(fold(attribute.name)),
        );
        warnings.push(
          attributes.length === 0
            ? `La clase ${umlClass.name} ya estaba en el diagrama y no se tocó.`
            : `La clase ${umlClass.name} ya estaba en el diagrama: sólo se le añadieron los atributos nuevos.`,
        );

        if (attributes.length > 0) {
          actions.push({ action: 'ADD_ATTRIBUTE', className: umlClass.name, attributes });
        }
        continue;
      }

      fresh.push(umlClass);
    }

    const positions = fromImageLayout(
      fresh.map((umlClass) => ({
        position: umlClass.position,
        attributeCount: umlClass.attributes.length,
      })),
      diagram.classes.map((umlClass) => ({ posX: umlClass.pos_x, posY: umlClass.pos_y })),
    );

    for (const [index, umlClass] of fresh.entries()) {
      actions.push({
        action: 'CREATE_CLASS',
        className: umlClass.name,
        attributes: umlClass.attributes,
        position: { x: positions[index].posX, y: positions[index].posY },
      });
    }

    actions.push(...this.relationshipActions(model, warnings));

    return { actions, warnings };
  }

  /**
   * Las relaciones de la imagen, una por cada par de clases.
   *
   * Un modelo de visión describe a veces la misma línea dos veces —primero
   * como asociación y después, al fijarse en el rombo, como composición—, y
   * crear las dos deja dos líneas paralelas entre las mismas clases que el
   * usuario tiene que borrar a mano. Se queda una sola: la más concreta, que
   * es la que aporta el adorno que el modelo vio en el segundo vistazo.
   *
   * Las entidades intermedias se resuelven antes que nada, porque cambian qué
   * líneas hay que crear: donde el dibujo tenía una línea entre dos clases con
   * una caja colgando, el diagrama tiene dos asociaciones hacia esa caja y
   * ninguna línea directa.
   */
  private relationshipActions(model: RawImageModel, warnings: string[]): RawAction[] {
    /** Cuánto afirma cada tipo: gana el que más dice del dibujo. */
    const precision: Record<string, number> = {
      ASSOCIATION: 0,
      AGGREGATION: 1,
      INHERITANCE: 2,
      COMPOSITION: 2,
    };

    const intermediates = this.associationClasses(model, warnings);

    const chosen = new Map<string, RawImageModel['relationships'][number]>();

    for (const relationship of model.relationships) {
      const pair = pairKey(relationship.sourceClass, relationship.targetClass);

      // La línea que sostenía a la entidad intermedia ya está contada: crearla
      // además dejaría el muchos a muchos que la intermedia venía a resolver.
      if (intermediates.has(pair)) continue;

      const previous = chosen.get(pair);

      if (previous === undefined) {
        chosen.set(pair, relationship);
        continue;
      }
      if (precision[relationship.relationshipType] > precision[previous.relationshipType]) {
        warnings.push(
          `La línea entre ${relationship.sourceClass} y ${relationship.targetClass} se leyó dos veces; se tomó la ${RELATIONSHIP_LABELS[relationship.relationshipType]}.`,
        );
        chosen.set(pair, relationship);
      }
    }

    const actions: RawAction[] = [];

    /*
     * Las dos asociaciones de cada entidad intermedia, con las mismas
     * multiplicidades que pone la herramienta «Entidad intermedia» del lienzo
     * (1 : 0..*): una fila de la tabla intermedia pertenece a una fila de cada
     * extremo, y cada extremo puede tener muchas. Las multiplicidades escritas
     * en el dibujo eran las de la línea directa, que ya no existe.
     */
    for (const { intermediate, ends } of intermediates.values()) {
      for (const end of ends) {
        actions.push({
          action: 'CREATE_RELATIONSHIP',
          relationshipType: 'ASSOCIATION',
          sourceClass: end,
          targetClasses: [intermediate],
          sourceMultiplicity: '1',
          targetMultiplicity: '0..*',
          name: null,
        });
      }
    }

    actions.push(
      ...[...chosen.values()].map((relationship): RawAction => {
        /*
         * Vuelta de la herencia. El modelo describe el dibujo —de la hija sale
         * la línea, el triángulo apunta a la madre—, mientras que una acción
         * CREATE_RELATIONSHIP pone el padre en «sourceClass» y las hijas en
         * «targetClasses». Se cambia aquí para que la acción signifique lo
         * mismo venga de una foto o de una instrucción escrita.
         */
        const inheritance = relationship.relationshipType === 'INHERITANCE';

        return {
          action: 'CREATE_RELATIONSHIP',
          relationshipType: relationship.relationshipType,
          sourceClass: inheritance ? relationship.targetClass : relationship.sourceClass,
          targetClasses: [inheritance ? relationship.sourceClass : relationship.targetClass],
          sourceMultiplicity: relationship.sourceMultiplicity,
          targetMultiplicity: relationship.targetMultiplicity,
          name: null,
        };
      }),
    );

    return actions;
  }

  /**
   * Las entidades intermedias del dibujo, indexadas por el par de clases que
   * unen.
   *
   * Una clase de asociación es una caja atada por una línea discontinua a la
   * línea que une otras dos clases, y es lo que resuelve un muchos a muchos:
   * DETALLE_VENTA entre NOTAVENTA y PRODUCTO. En el modelo guardado no existe
   * como tal —CU02 no tiene ese concepto—, sino como lo que acaba siendo una
   * tabla: la clase y las dos asociaciones que la unen a los extremos, igual
   * que las crea la herramienta «Entidad intermedia» del lienzo.
   *
   * Se reconocen por dos caminos. El primero es que el modelo lo diga, que es
   * lo que le pide el prompt. El segundo existe porque el primero falla: una
   * línea discontinua fina se pierde con facilidad al reducir la imagen, y
   * entonces la caja llega sin ninguna relación. Lo que la delata es dónde
   * está dibujada, y sólo se da por buena cuando no queda duda razonable.
   */
  private associationClasses(
    model: RawImageModel,
    warnings: string[],
  ): Map<string, { intermediate: string; ends: [string, string] }> {
    const found = new Map<string, { intermediate: string; ends: [string, string] }>();
    const known = new Map(model.classes.map((umlClass) => [fold(umlClass.name), umlClass.name]));

    const declare = (intermediate: string, source: string, target: string, how: string): void => {
      const pair = pairKey(source, target);
      if (found.has(pair)) return;

      found.set(pair, { intermediate, ends: [source, target] });
      warnings.push(
        `${intermediate} ${how}: se creó como entidad intermedia entre ${source} y ${target}, unida a las dos, en lugar de la línea directa.`,
      );
    };

    for (const relationship of model.relationships) {
      if (relationship.associationClass === null) continue;

      // El nombre tiene que ser el de una caja que se leyó: si el modelo se
      // inventó ahí un nombre, la línea se crea tal como está dibujada.
      const intermediate = known.get(fold(relationship.associationClass));
      if (intermediate === undefined) continue;

      const ends = [fold(relationship.sourceClass), fold(relationship.targetClass)];
      if (ends.includes(fold(intermediate))) continue;

      declare(
        intermediate,
        relationship.sourceClass,
        relationship.targetClass,
        'colgaba de la línea',
      );
    }

    // Segundo camino: las cajas que se quedaron sin ninguna línea.
    const connected = new Set<string>();
    for (const relationship of model.relationships) {
      connected.add(fold(relationship.sourceClass));
      connected.add(fold(relationship.targetClass));
      if (relationship.associationClass !== null) {
        connected.add(fold(relationship.associationClass));
      }
    }

    for (const umlClass of model.classes) {
      const box = umlClass.position;
      if (connected.has(fold(umlClass.name)) || box === null) continue;

      /*
       * Sólo se mira contra los muchos a muchos: son las líneas que no se
       * pueden convertir en tablas tal cual, y por eso las únicas de las que
       * cuelga una caja en un diagrama de datos. Y sólo se resuelve si encaja
       * en una: con dos candidatas no hay forma de saber de cuál era.
       */
      const candidates = model.relationships.filter(
        (relationship) =>
          relationship.relationshipType === 'ASSOCIATION' &&
          isMany(relationship.sourceMultiplicity) &&
          isMany(relationship.targetMultiplicity) &&
          !found.has(pairKey(relationship.sourceClass, relationship.targetClass)) &&
          hangsFrom(
            box,
            this.positionOf(model, relationship.sourceClass),
            this.positionOf(model, relationship.targetClass),
          ),
      );

      if (candidates.length !== 1) continue;

      declare(
        umlClass.name,
        candidates[0].sourceClass,
        candidates[0].targetClass,
        'se leyó sin ninguna línea, pero estaba dibujada sobre la que une a las otras dos',
      );
    }

    return found;
  }

  /** Dónde estaba dibujada una clase dentro de la imagen, si se distinguió. */
  private positionOf(model: RawImageModel, className: string): Point | null {
    return (
      model.classes.find((umlClass) => fold(umlClass.name) === fold(className))?.position ?? null
    );
  }

  // ------------------------------------------------------------ validación

  private requiredUuid(value: unknown, field: string): string {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new BadRequestException(`El campo ${field} debe ser un UUID válido.`);
    }

    return value;
  }

  private requiredCommand(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('El campo command es obligatorio y debe ser un texto.');
    }

    const command = value.trim();
    if (command.length === 0) {
      throw new BadRequestException('Escriba qué quiere hacer con el diagrama.');
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      throw new BadRequestException(
        `La instrucción no puede superar los ${MAX_COMMAND_LENGTH} caracteres.`,
      );
    }

    return command;
  }

  /**
   * Comprueba que lo que llegó es de verdad una imagen que el modelo pueda
   * mirar. Se miran las tres cosas —tipo declarado, extensión y tamaño—
   * porque cada una tapa un agujero de la anterior: el tipo lo pone el
   * navegador y puede mentir, y la extensión sola no dice nada del contenido.
   */
  private assertValidImage(file: UploadedFile | undefined): void {
    this.assertValidFile(file, {
      accepted: ACCEPTED_IMAGES,
      maxBytes: MAX_IMAGE_BYTES,
      field: 'image',
      missing: 'Adjunte una imagen del diagrama en el campo «image».',
      wrongType: (type) =>
        `El archivo no es una imagen admitida (${type}). Use PNG, JPG, JPEG o WEBP.`,
      tooBig: (mb, max) => `La imagen ocupa ${mb} MB y el máximo son ${max} MB.`,
    });
  }

  /** Lo mismo para la grabación de voz. */
  private assertValidAudio(file: UploadedFile | undefined): void {
    this.assertValidFile(file, {
      accepted: ACCEPTED_AUDIO,
      maxBytes: MAX_AUDIO_BYTES,
      field: 'audio',
      missing: 'Adjunte la grabación en el campo «audio».',
      wrongType: (type) =>
        `El archivo no es un audio admitido (${type}). Use WEBM, OGG, MP4, MP3 o WAV.`,
      tooBig: (mb, max) => `La grabación ocupa ${mb} MB y el máximo son ${max} MB.`,
    });
  }

  private assertValidFile(
    file: UploadedFile | undefined,
    rules: {
      accepted: Record<string, string[]>;
      maxBytes: number;
      field: string;
      missing: string;
      wrongType: (type: string) => string;
      tooBig: (megabytes: number, max: number) => string;
    },
  ): void {
    if (!file || file.size === 0) {
      throw new BadRequestException(rules.missing);
    }

    // El navegador añade el códec al tipo («audio/webm;codecs=opus»), y eso no
    // cambia de qué formato se trata.
    const mimeType = file.mimetype.split(';')[0].trim().toLowerCase();
    const extensions = rules.accepted[mimeType];
    if (extensions === undefined) {
      throw new BadRequestException(rules.wrongType(file.mimetype));
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!extensions.includes(extension)) {
      throw new BadRequestException(
        `La extensión «.${extension}» no corresponde a un archivo ${mimeType}.`,
      );
    }

    if (file.size > rules.maxBytes) {
      throw new BadRequestException(
        rules.tooBig(Math.round(file.size / 1024 / 1024), rules.maxBytes / 1024 / 1024),
      );
    }
  }

  // -------------------------------------------------------------- registro

  /**
   * Cierra el trabajo de importación.
   *
   * `extractedModel` es null cuando no se llegó a leer nada de la imagen: la
   * referencia a la imagen ya está en sus propias columnas desde que el
   * trabajo nació, así que un fallo no borra de dónde venía.
   */
  private async closeJob(
    jobId: string,
    status: 'COMPLETED' | 'FAILED',
    extractedModel: JsonValue | null,
    errorMessage: string | null,
  ): Promise<void> {
    try {
      await db.orm.public.PhotoImportJobs.where({ id: jobId }).update({
        status,
        extractedModel,
        errorMessage,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Que no se pueda cerrar el trabajo no invalida el diagrama que ya se
      // creó: se deja constancia en el log del servidor y se sigue.
      this.logger.error(`No se pudo cerrar el trabajo de importación ${jobId}`, error);
    }
  }

  /**
   * Deja constancia de la instrucción en ai_command_logs.
   *
   * Se guarda también lo que respondió la IA en crudo: cuando el asistente
   * rechaza algo que el usuario cree correcto, es lo único que permite saber
   * si falló la interpretación o la validación.
   */
  private async log(
    diagramId: string,
    userId: string,
    origin: CommandOrigin,
    actions: RawAction[] | null,
    raw: unknown,
    status: 'SUCCESS' | 'FAILED' | 'REJECTED',
    errorMessage: string | null,
  ): Promise<void> {
    const operations = [...new Set((actions ?? []).map((action) => action.action))];

    try {
      await db.orm.public.AiCommandLogs.create({
        diagramId,
        userId,
        inputType: origin.inputType,
        rawInput: origin.rawInput,
        transcribedText: origin.transcribedText,
        resolvedOperation:
          operations.length === 0
            ? null
            : ((operations.length === 1 ? operations[0] : 'MULTIPLE') as Varchar<50>),
        operationPayload: {
          actions: JSON.parse(JSON.stringify(actions ?? [])) as JsonValue,
          model: JSON.parse(JSON.stringify(raw ?? null)) as JsonValue,
        },
        status: status as Varchar<20>,
        errorMessage,
      });
    } catch (error) {
      this.logger.error('No se pudo registrar la instrucción en ai_command_logs', error);
    }
  }
}

// --------------------------------------------------------------- geometría

/**
 * Las dos clases de una línea, en una clave que no depende del orden: el modelo
 * puede nombrar los extremos al revés de un vistazo al siguiente y seguiría
 * siendo la misma línea del dibujo.
 */
function pairKey(source: string, target: string): string {
  return [fold(source), fold(target)].sort().join('|');
}

/** Multiplicidades que significan «muchos». */
function isMany(multiplicity: string | null): boolean {
  return multiplicity !== null && (multiplicity === '*' || multiplicity.endsWith('..*'));
}

/**
 * ¿La caja está colgada de la línea que une a las otras dos?
 *
 * Es la forma de una clase de asociación en el dibujo: se coloca frente a la
 * mitad de la línea y separada de ella, ni más allá de uno de los extremos ni
 * tan lejos como para ser otra cosa. Se le piden las dos condiciones: que su
 * proyección sobre la línea caiga entre los dos extremos —con algo de holgura,
 * porque estas coordenadas las estima el modelo a ojo— y que su distancia a la
 * línea no pase de lo que miden los extremos entre sí.
 */
function hangsFrom(box: Point, source: Point | null, target: Point | null): boolean {
  if (source === null || target === null) return false;

  const spanX = target.x - source.x;
  const spanY = target.y - source.y;
  const lengthSquared = spanX * spanX + spanY * spanY;
  if (lengthSquared === 0) return false;

  // Dónde cae la caja a lo largo de la línea: 0 en un extremo, 1 en el otro.
  const along = ((box.x - source.x) * spanX + (box.y - source.y) * spanY) / lengthSquared;
  if (along < -0.15 || along > 1.15) return false;

  const awayX = box.x - (source.x + along * spanX);
  const awayY = box.y - (source.y + along * spanY);

  return awayX * awayX + awayY * awayY <= lengthSquared;
}
