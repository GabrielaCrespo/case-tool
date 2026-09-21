import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { JsonValue, Varchar } from '@prisma/orm-postgres/target/codec-types';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';
import { AiExecutorService } from './ai-executor.service.js';
import type { ExecutionPlan } from './ai-executor.service.js';
import { CloudinaryService } from './cloudinary.service.js';
import { fromImageLayout } from './layout.js';
import { OllamaService } from './ollama.service.js';
import { diagramContext, imageSystemPrompt, interpretSystemPrompt } from './prompts.js';
import { SpeechToTextService } from './speech-to-text.service.js';
import { RELATIONSHIP_LABELS, fold, parseActions, parseImageModel } from './uml-actions.js';
import type { RawAction, RawImageModel } from './uml-actions.js';

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
 * Tope de tamaño. No es una limitación técnica de Cloudinary sino del modelo:
 * una imagen más grande no se lee mejor y multiplica el tiempo de análisis.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Ancho máximo con el que se le enseña la imagen al modelo.
 *
 * Medido con Qwen3-VL sobre el mismo diagrama: 1920 px tarda 177 s y 1280 px
 * tarda 83 s, leyendo exactamente las mismas clases, atributos y relaciones.
 * Por debajo de 1280 no se gana tiempo y se empieza a arriesgar el texto de
 * las cajas, así que ahí está el punto.
 */
const ANALYSIS_MAX_WIDTH = 1280;

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

/** CU05 añade de dónde salió el diagrama. */
export interface ImageImportResult extends AiResult {
  job_id: string;
  image_url: string;
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
    private readonly ollama: OllamaService,
    private readonly cloudinary: CloudinaryService,
    private readonly speech: SpeechToTextService,
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

    const raw = await this.ollama.askJson(
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
   * transcripción a Faster-Whisper y el texto resultante entra en `interpret`,
   * el mismo método de siempre. No existe un intérprete de voz: existe un
   * micrófono que escribe por el usuario.
   */
  async interpretVoice(
    userId: string,
    diagramIdInput: unknown,
    file: UploadedFile | undefined,
  ): Promise<VoiceResult> {
    const diagramId = this.requiredUuid(diagramIdInput, 'diagram_id');
    this.assertValidAudio(file);

    const transcription = await this.speech.transcribe(file!.buffer, file!.mimetype);

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
   * El orden —validar, subir, analizar, normalizar, validar, ejecutar— es el
   * del enunciado y tiene su motivo: la imagen se guarda antes de analizarla
   * para que quede constancia de qué se le pidió leer al modelo, aunque
   * después el análisis falle.
   */
  async imageToUml(
    userId: string,
    diagramIdInput: unknown,
    file: UploadedFile | undefined,
  ): Promise<ImageImportResult> {
    const diagramId = this.requiredUuid(diagramIdInput, 'diagram_id');
    this.assertValidImage(file);

    const diagram = await this.diagramsService.findOneFull(userId, diagramId);
    const image = await this.cloudinary.upload(file!);

    // El trabajo se anota antes de analizar: si Ollama falla o la imagen no
    // era un diagrama, queda registrado qué se intentó importar y por qué no
    // salió. La imagen vive en Cloudinary; en PostgreSQL sólo su referencia.
    const job = await db.orm.public.PhotoImportJobs.create({
      diagramId,
      userId,
      imageUrl: image.imageUrl as Varchar<500>,
      cloudinaryPublicId: image.cloudinaryPublicId as Varchar<255>,
      originalFileName: image.originalFileName as Varchar<255>,
      mimeType: image.mimeType as Varchar<100>,
      fileSize: image.fileSize,
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
        image_url: image.imageUrl,
        classes_created: 0,
        relationships_created: 0,
      };
    };

    // Se analiza una versión reducida: lo que tarda el modelo depende del
    // tamaño de la imagen, y una foto de móvil sin reducir se pasa de
    // cualquier espera razonable. Si no se puede obtener, se usa la original.
    const scaled = await this.cloudinary.readScaled(image, ANALYSIS_MAX_WIDTH);

    let raw: unknown;
    try {
      raw = await this.ollama.askJson(imageSystemPrompt(), 'Transcribe este diagrama de clases.', [
        (scaled ?? file!.buffer).toString('base64'),
      ]);
    } catch (error) {
      // Ollama apagado, modelo ausente, respuesta ilegible: el trabajo queda
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
        // extracted_model guarda lo que se leyó en la imagen, y sólo eso: la
        // referencia a la imagen tiene sus propias columnas.
        JSON.parse(JSON.stringify(model)) as JsonValue,
        error,
      );
      return applied;
    });

    return {
      ...result,
      warnings: [...warnings, ...model.problems, ...result.warnings],
      job_id: job.id,
      image_url: image.imageUrl,
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
   */
  private relationshipActions(model: RawImageModel, warnings: string[]): RawAction[] {
    /** Cuánto afirma cada tipo: gana el que más dice del dibujo. */
    const precision: Record<string, number> = {
      ASSOCIATION: 0,
      AGGREGATION: 1,
      INHERITANCE: 2,
      COMPOSITION: 2,
    };

    const chosen = new Map<string, RawImageModel['relationships'][number]>();

    for (const relationship of model.relationships) {
      const pair = [fold(relationship.sourceClass), fold(relationship.targetClass)].sort().join('|');
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

    return [...chosen.values()].map((relationship) => {
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
    });
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
