import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { JsonValue, Varchar } from '@prisma/orm-postgres/target/codec-types';
import { AiExecutorService } from '../ai/ai-executor.service.js';
import { ChatEventsService } from '../collaboration/chat-events.service.js';
import { LockRegistryService } from '../collaboration/lock-registry.service.js';
import { validateDiagram } from '../diagrams/diagram-validator.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';
import type { AiMode } from '../projects/projects.service.js';
import { connectionOf } from './ai-settings.service.js';
import { AiSettingsService } from './ai-settings.service.js';
import type { ChatContext, ContextMessage } from './assistant-context.js';
import { addressAsker, buildChatContext, readReply, RECENT_MESSAGES } from './assistant-context.js';
import { ChatLlmClient } from './chat-llm-client.js';
import { ProjectQueue } from './project-queue.js';
import type { StoredProposal } from './proposal.js';
import { actionsFrom, lockConflicts, readStoredProposal } from './proposal.js';

/**
 * CU12 — Consultar al Asistente de IA.
 *
 * Cada integrante pregunta por su cuenta, pero la pregunta y la respuesta
 * quedan en el chat del proyecto, que es de todos (CU13). La pregunta se
 * guarda y se devuelve en el acto; la respuesta llega después, cuando le toca
 * el turno en la cola del proyecto y el modelo contesta, y se guarda como un
 * mensaje más cuyo autor es la IA (author_id NULL).
 *
 * El modelo no contesta de memoria: en cada pregunta se le enseña el proyecto
 * entero —memoria, descripción, el diagrama desde el que se pregunta con su
 * validación, los demás diagramas y la conversación reciente— armado por
 * assistant-context.ts.
 *
 * CU13 — Cada mensaje guardado, y cuándo la IA empieza y termina de responder,
 * se avisa por ChatEventsService para que el gateway lo difunda a la sala del
 * proyecto: todo el equipo ve la pregunta y la respuesta en cuanto existen.
 *
 * CU15 — Según el modo del proyecto (projects.ai_mode), la respuesta puede
 * traer cambios para el diagrama. Nunca se aplican sin pasar por el mismo
 * ejecutor que CU04 (plan → apply): en PROPOSE quedan como propuesta que
 * cualquiera del equipo aplica o descarta, y al aplicarla se vuelve a validar
 * contra el diagrama de ese momento; en EXECUTE se aplican al responder, en
 * nombre de quien preguntó. Si alguien tiene tomado un elemento que el cambio
 * toca, no se aplica nada y se dice quién.
 */

/** Una pregunta más larga no es una pregunta: es un documento. */
const QUESTION_MAX_LENGTH = 4_000;

/** chat_messages.model es VARCHAR(150). */
const MODEL_MAX_LENGTH = 150;

/** Preguntas que pueden esperar a la vez en un mismo proyecto. */
const MAX_PENDING_PER_PROJECT = 5;

/** Cuántos mensajes devuelve el historial si no se pide otra cosa, y el máximo. */
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatActionStatus = 'NONE' | 'PROPOSED' | 'APPLIED' | 'REJECTED' | 'FAILED';

/** Un mensaje del chat tal como lo devuelve la API. */
export interface ChatMessageResponse {
  id: string;
  project_id: string;
  diagram_id: string | null;
  diagram_name: string | null;
  /** null es la IA. */
  author: { id: string; full_name: string } | null;
  /** En la respuesta de la IA, la pregunta a la que contesta. */
  reply_to: string | null;
  content: string;
  /** CU15 — Los cambios que propone la IA y qué hará cada uno. */
  proposed_actions: StoredProposal | null;
  action_status: ChatActionStatus;
  /** Qué se hizo al aplicarlos, o por qué no se pudo. */
  action_result: string | null;
  /** Quién los aplicó o los descartó. */
  resolved_by: { id: string; full_name: string } | null;
  resolved_at: string | null;
  model: string | null;
  /** La IA no pudo responder; content lo explica. */
  error_message: string | null;
  created_at: string;
}

export interface ChatQuestionInput {
  content?: unknown;
  diagram_id?: unknown;
}

export interface ChatHistoryQuery {
  limit?: unknown;
  before?: unknown;
}

interface MessageRow {
  id: string;
  projectId: string;
  diagramId: string | null;
  authorId: string | null;
  replyToId: string | null;
  content: string;
  proposedActions: unknown;
  actionStatus: ChatActionStatus;
  actionResult: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  model: string | null;
  errorMessage: string | null;
  createdAt: string;
  author: { id: string; fullName: string } | null;
  resolver: { id: string; fullName: string } | null;
  diagram: { name: string } | null;
}

/** CU15 — Qué pasó con los cambios de una respuesta de la IA. */
interface ActionOutcome {
  status: ChatActionStatus;
  proposal: StoredProposal | null;
  result: string | null;
  resolvedBy: string | null;
}

const NO_ACTIONS: ActionOutcome = { status: 'NONE', proposal: null, result: null, resolvedBy: null };

/** La propuesta como valor JSON para la columna JSONB. */
function toJson(proposal: StoredProposal): JsonValue {
  return JSON.parse(JSON.stringify(proposal)) as JsonValue;
}

/** Cómo se cuenta al modelo lo que pasó con una propuesta anterior. */
const STATUS_NOTES: Record<ChatActionStatus, string> = {
  NONE: '',
  PROPOSED: ' (cambios propuestos, pendientes de aplicar)',
  APPLIED: ' (cambios aplicados)',
  REJECTED: ' (cambios descartados por el equipo)',
  FAILED: ' (cambios que no se pudieron aplicar)',
};

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly queue = new ProjectQueue(MAX_PENDING_PER_PROJECT);
  /** CU15 — Propuestas que se están aplicando, para no aplicar dos veces. */
  private readonly applying = new Set<string>();

  constructor(
    private readonly settings: AiSettingsService,
    private readonly llm: ChatLlmClient,
    private readonly diagrams: DiagramsService,
    private readonly chatEvents: ChatEventsService,
    private readonly executor: AiExecutorService,
    private readonly locks: LockRegistryService,
  ) {}

  /** CU13 — El chat del proyecto, del mensaje más antiguo al más reciente. */
  async list(userId: string, projectId: string, query: ChatHistoryQuery): Promise<ChatMessageResponse[]> {
    await this.assertProjectAccess(userId, projectId);

    const limit = this.readLimit(query?.limit);
    const before = this.readBefore(query?.before);

    let messages = this.messages().where({ projectId });
    if (before !== null) {
      messages = messages.where((message) => message.createdAt.lt(before));
    }
    const rows = await messages
      .orderBy((message) => message.createdAt.desc())
      .limit(limit)
      .all();

    return (rows as MessageRow[]).reverse().map((row) => this.toResponse(row));
  }

  /**
   * CU12 — Hacer una pregunta. Devuelve la pregunta ya guardada; la respuesta
   * de la IA llega después como otro mensaje del chat.
   */
  async ask(userId: string, projectId: string, input: ChatQuestionInput): Promise<ChatMessageResponse> {
    const content = this.readQuestion(input?.content);
    await this.assertProjectAccess(userId, projectId);
    const diagramId = await this.readDiagram(userId, projectId, input?.diagram_id);

    // Si nadie le va a contestar, la pregunta no se guarda: quedaría en el
    // chat esperando una respuesta que no va a llegar.
    const status = await this.settings.status();
    if (!status.available) {
      throw new ServiceUnavailableException(status.reason ?? 'El asistente de IA no está disponible.');
    }
    if (!this.queue.hasRoom(projectId)) {
      throw new HttpException(
        `La IA tiene ${this.queue.pending(projectId)} preguntas de este proyecto por responder. Espere a que conteste alguna.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const question = await db.orm.public.ChatMessages.create({
      projectId,
      diagramId,
      authorId: userId,
      content,
    });

    // Se avisa antes de encolar: la pregunta tiene que llegar a la sala antes
    // que el «pensando» y que la respuesta.
    const response = await this.findResponse(question.id);
    this.chatEvents.emit({ kind: 'chat:message', project_id: projectId, payload: response });

    this.queue.enqueue(
      projectId,
      () => this.answer(question.id),
      (error) => this.logger.error(`No se pudo responder a la pregunta ${question.id}`, error),
    );

    return response;
  }

  /**
   * Responde a una pregunta ya guardada. Si algo falla, también se contesta:
   * con un mensaje de la IA que dice por qué, para que quien preguntó —y el
   * resto del equipo— no se quede esperando.
   */
  private async answer(questionId: string): Promise<void> {
    const question = (await this.messages().first({ id: questionId })) as MessageRow | null;
    if (!question) {
      return;
    }

    this.publishStatus(question, 'thinking');
    try {
      await this.reply(question);
    } finally {
      this.publishStatus(question, 'idle');
    }
  }

  private async reply(question: MessageRow): Promise<void> {
    try {
      const settings = await this.settings.current();
      const status = await this.settings.status();
      if (!status.available) {
        throw new ServiceUnavailableException(status.reason ?? 'El asistente de IA no está disponible.');
      }

      const { context, current, mode } = await this.buildContext(question, settings.contextBudget);
      const completion = await this.llm.completeJson(connectionOf(settings), context.messages);
      const reply = readReply(completion.value);

      if (reply === null) {
        throw new HttpException(
          'El modelo contestó sin texto. Inténtelo de nuevo o reformule la pregunta.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // CU15 — Lo que haya propuesto la IA no se toma de su palabra: si el
      // modo no lo admite o no hay diagrama, se ignora; si no, se valida.
      const outcome =
        mode !== 'ANSWER' && current !== null && question.authorId !== null
          ? await this.handleActions(completion.value, current, mode, question.authorId)
          : NO_ACTIONS;

      const saved = await db.orm.public.ChatMessages.create({
        projectId: question.projectId,
        diagramId: question.diagramId,
        authorId: null,
        replyToId: question.id,
        // En el chat del grupo cada respuesta tiene un destinatario.
        content: addressAsker(reply, question.author?.fullName ?? null),
        model: completion.model.slice(0, MODEL_MAX_LENGTH) as Varchar<typeof MODEL_MAX_LENGTH>,
        proposedActions: outcome.proposal === null ? null : toJson(outcome.proposal),
        actionStatus: outcome.status,
        actionResult: outcome.result,
        resolvedBy: outcome.resolvedBy,
        resolvedAt: outcome.resolvedBy === null ? null : new Date().toISOString(),
      });
      await this.publishMessage(saved.id);
    } catch (error) {
      const reason =
        error instanceof HttpException ? error.message : 'Se produjo un error interno al preparar la respuesta.';
      if (!(error instanceof HttpException)) {
        this.logger.error(`Error al responder a la pregunta ${question.id}`, error);
      }

      const saved = await db.orm.public.ChatMessages.create({
        projectId: question.projectId,
        diagramId: question.diagramId,
        authorId: null,
        replyToId: question.id,
        content: addressAsker(`No pude responder: ${reason}`, question.author?.fullName ?? null),
        errorMessage: reason,
      });
      await this.publishMessage(saved.id);
    }
  }

  /**
   * CU15 — Convierte lo que propuso la IA en una propuesta validada o, en modo
   * EXECUTE, en cambios ya aplicados.
   *
   * Una propuesta que no pasa la validación se guarda como fallida y con el
   * motivo, en lugar de ocultarse: el equipo ve que la IA quiso cambiar algo y
   * por qué no se puede. En EXECUTE, si alguien tiene tomado un elemento que el
   * cambio toca, no se aplica nada y queda como propuesta para cuando termine.
   */
  private async handleActions(
    value: unknown,
    current: FullDiagramResponse,
    mode: AiMode,
    askerId: string,
  ): Promise<ActionOutcome> {
    const { actions, problems } = actionsFrom(value);

    if (actions.length === 0 && problems.length === 0) {
      return NO_ACTIONS;
    }
    if (problems.length > 0) {
      return {
        status: 'FAILED',
        proposal: actions.length > 0 ? { actions, summary: [] } : null,
        result: `La IA propuso cambios que no se pudieron leer: ${problems.join(' ')}`,
        resolvedBy: null,
      };
    }

    const plan = this.executor.plan(current, actions, 'reject');
    if (plan.rejections.length > 0) {
      return {
        status: 'FAILED',
        proposal: { actions, summary: [] },
        result: `La propuesta no es válida para el diagrama: ${plan.rejections.join(' ')}`,
        resolvedBy: null,
      };
    }

    const proposal: StoredProposal = { actions, summary: plan.steps.map((step) => step.description) };
    const notes = plan.warnings.length > 0 ? plan.warnings.join(' ') : null;

    if (mode === 'PROPOSE') {
      return { status: 'PROPOSED', proposal, result: notes, resolvedBy: null };
    }

    const conflicts = lockConflicts(plan.steps, current, this.locks.listByDiagram(current.id), askerId);
    if (conflicts.length > 0) {
      return {
        status: 'PROPOSED',
        proposal,
        result: `No se aplicó al momento porque ${conflicts.join(' y ')}. Aplíquela cuando termine.`,
        resolvedBy: null,
      };
    }

    try {
      const applied = await this.executor.apply(askerId, current, plan.steps);
      return { status: 'APPLIED', proposal, result: applied.join('\n'), resolvedBy: askerId };
    } catch (error) {
      this.logger.error('No se pudieron aplicar los cambios de la IA', error);
      return {
        status: 'FAILED',
        proposal,
        result: `No se pudo aplicar: ${error instanceof Error ? error.message : 'error al guardar el cambio.'}`,
        resolvedBy: null,
      };
    }
  }

  /**
   * CU15 — Aplicar una propuesta de la IA. Puede hacerlo cualquiera del equipo,
   * y se aplica en su nombre: los cambios llegan al lienzo de todos como si los
   * hubiera hecho a mano.
   *
   * Se vuelve a validar contra el diagrama de este momento, no contra el que vio
   * la IA: entretanto alguien pudo crear la clase que proponía o borrar la que
   * modificaba. Si ya no encaja, queda como fallida con el motivo. Si alguien
   * tiene tomado un elemento que toca, no se aplica nada, se dice quién y la
   * propuesta sigue pendiente.
   */
  async apply(userId: string, messageId: string): Promise<ChatMessageResponse> {
    const message = await this.findProposal(userId, messageId);
    const project = await db.orm.public.Projects.select('aiMode').first({ id: message.projectId });

    if (project?.aiMode === 'ANSWER') {
      throw new ForbiddenException(
        'En este proyecto la IA sólo responde: su propietario desactivó los cambios propuestos.',
      );
    }
    if (message.diagramId === null) {
      throw new BadRequestException('El diagrama de esta propuesta ya no existe.');
    }
    const stored = readStoredProposal(message.proposedActions);
    if (stored === null) {
      throw new BadRequestException('La propuesta no tiene cambios que aplicar.');
    }
    if (this.applying.has(message.id)) {
      throw new ConflictException('Alguien del equipo ya está aplicando esta propuesta.');
    }

    this.applying.add(message.id);
    try {
      const current = await this.diagrams.findOneFull(userId, message.diagramId);
      const plan = this.executor.plan(current, stored.actions, 'reject');

      if (plan.rejections.length > 0) {
        return await this.resolve(message.id, userId, 'FAILED', `Ya no se puede aplicar: ${plan.rejections.join(' ')}`);
      }

      const conflicts = lockConflicts(plan.steps, current, this.locks.listByDiagram(current.id), userId);
      if (conflicts.length > 0) {
        throw new ConflictException(`No se aplicó: ${conflicts.join(' y ')}. Inténtelo cuando termine.`);
      }

      let outcome: { status: ChatActionStatus; result: string };
      try {
        const applied = await this.executor.apply(userId, current, plan.steps);
        outcome = { status: 'APPLIED', result: applied.join('\n') };
      } catch (error) {
        if (error instanceof ConflictException) {
          // Alguien tomó un elemento justo entre la comprobación y el cambio.
          throw error;
        }
        this.logger.error(`No se pudo aplicar la propuesta ${message.id}`, error);
        outcome = {
          status: 'FAILED',
          result: `No se pudo aplicar: ${error instanceof Error ? error.message : 'error al guardar el cambio.'}`,
        };
      }
      return await this.resolve(message.id, userId, outcome.status, outcome.result);
    } finally {
      this.applying.delete(message.id);
    }
  }

  /** CU15 — Descartar una propuesta: queda en el chat, marcada y sin aplicar. */
  async reject(userId: string, messageId: string): Promise<ChatMessageResponse> {
    const message = await this.findProposal(userId, messageId);
    if (this.applying.has(message.id)) {
      throw new ConflictException('Alguien del equipo está aplicando esta propuesta en este momento.');
    }
    return this.resolve(message.id, userId, 'REJECTED', null);
  }

  /** Una propuesta de la IA, todavía pendiente, de un proyecto del usuario. */
  private async findProposal(userId: string, messageId: string): Promise<MessageRow> {
    const message = (await this.messages().first({ id: messageId })) as MessageRow | null;

    if (!message) {
      throw new NotFoundException('El mensaje indicado no existe.');
    }
    await this.assertProjectAccess(userId, message.projectId);

    if (message.authorId !== null || message.actionStatus === 'NONE') {
      throw new BadRequestException('Ese mensaje no trae cambios propuestos por la IA.');
    }
    if (message.actionStatus !== 'PROPOSED') {
      throw new ConflictException(
        message.actionStatus === 'APPLIED'
          ? 'Esta propuesta ya se aplicó.'
          : message.actionStatus === 'REJECTED'
            ? 'Esta propuesta ya se descartó.'
            : 'Esta propuesta no se pudo aplicar y ya no está pendiente.',
      );
    }
    return message;
  }

  /**
   * Cierra una propuesta y avisa a la sala. La condición sobre el estado hace
   * que, si dos personas la resuelven a la vez, sólo cuente la primera.
   */
  private async resolve(
    messageId: string,
    userId: string,
    status: ChatActionStatus,
    result: string | null,
  ): Promise<ChatMessageResponse> {
    const updated = await db.orm.public.ChatMessages.where({ id: messageId, actionStatus: 'PROPOSED' }).update({
      actionStatus: status,
      actionResult: result,
      resolvedBy: userId,
      resolvedAt: new Date().toISOString(),
    });

    if (!updated) {
      throw new ConflictException('Otra persona del equipo resolvió esta propuesta primero.');
    }

    const response = await this.findResponse(messageId);
    this.chatEvents.emit({ kind: 'chat:updated', project_id: response.project_id, payload: response });
    return response;
  }

  /** CU13 — Un mensaje ya guardado, a la sala del proyecto. */
  private async publishMessage(messageId: string): Promise<void> {
    const message = await this.findResponse(messageId);
    this.chatEvents.emit({ kind: 'chat:message', project_id: message.project_id, payload: message });
  }

  /** CU13 — Que el equipo sepa a qué pregunta está respondiendo la IA. */
  private publishStatus(question: MessageRow, state: 'thinking' | 'idle'): void {
    this.chatEvents.emit({
      kind: 'ai:status',
      project_id: question.projectId,
      payload: { project_id: question.projectId, question_id: question.id, state },
    });
  }

  /**
   * Reúne lo que el modelo tiene que ver, en el orden de assistant-context.ts,
   * y devuelve también el diagrama y el modo: son lo que decide qué se hace
   * con los cambios que proponga.
   */
  private async buildContext(
    question: MessageRow,
    contextBudget: number,
  ): Promise<{ context: ChatContext; current: FullDiagramResponse | null; mode: AiMode }> {
    const project = await db.orm.public.Projects.first({ id: question.projectId });
    if (!project) {
      throw new NotFoundException('El proyecto ya no existe.');
    }

    const memory = await db.orm.public.ProjectMemoryEntries.where({ projectId: project.id })
      .orderBy((entry) => entry.createdAt.asc())
      .all();

    const diagrams = await db.orm.public.Diagrams.where({ projectId: project.id })
      .include('umlClasses', (umlClass) => umlClass.orderBy((c) => c.createdAt.asc()))
      .orderBy((diagram) => diagram.createdAt.asc())
      .all();

    // Se lee como quien pregunta: si entretanto perdió el acceso o el diagrama
    // se borró, se responde sin él en lugar de no responder.
    let current: FullDiagramResponse | null = null;
    if (question.diagramId !== null && question.authorId !== null) {
      current = await this.diagrams
        .findOneFull(question.authorId, question.diagramId)
        .catch(() => null);
    }

    // Los mensajes de la IA que sólo dicen que no pudo responder no aportan
    // nada a la conversación; se traen de más para que queden RECENT_MESSAGES.
    const earlier = (await this.messages()
      .where({ projectId: project.id })
      .where((message) => message.createdAt.lt(question.createdAt))
      .orderBy((message) => message.createdAt.desc())
      .limit(RECENT_MESSAGES * 2)
      .all()) as MessageRow[];
    // A quién le respondió la IA en cada mensaje, para que no mezcle los hilos
    // de cada integrante. La pregunta suele estar en la misma ventana; si no,
    // queda sin destinatario, igual que antes.
    const askers = new Map(earlier.map((message) => [message.id, message.author?.fullName ?? null]));
    const recent: ContextMessage[] = earlier
      .filter((message) => message.errorMessage === null)
      .slice(0, RECENT_MESSAGES)
      .reverse()
      .map((message) => ({
        author: message.author?.fullName ?? null,
        inReplyTo:
          message.author === null && message.replyToId !== null
            ? (askers.get(message.replyToId) ?? null)
            : null,
        diagramName: message.diagram?.name ?? null,
        // Que el modelo sepa qué pasó con lo que propuso antes.
        content: `${message.content}${STATUS_NOTES[message.actionStatus]}`,
      }));

    const context = buildChatContext({
      project: { name: project.name, description: project.description },
      mode: project.aiMode,
      memory: memory.map((entry) => ({ kind: entry.kind, title: entry.title, content: entry.content })),
      currentDiagram: current,
      validation: current === null ? null : validateDiagram(current),
      otherDiagrams: diagrams
        .filter((diagram) => diagram.id !== current?.id)
        .map((diagram) => ({
          name: diagram.name,
          classNames: diagram.umlClasses.map((umlClass) => umlClass.name),
        })),
      recentMessages: recent,
      question: {
        author: question.author?.fullName ?? 'Alguien del equipo',
        diagramName: current?.name ?? question.diagram?.name ?? null,
        content: question.content,
      },
      contextBudget,
    });

    return { context, current, mode: project.aiMode };
  }

  /** Los mensajes con su autor, quien resolvió la propuesta y su diagrama. */
  private messages() {
    return db.orm.public.ChatMessages.include('author').include('resolver').include('diagram');
  }

  private async findResponse(messageId: string): Promise<ChatMessageResponse> {
    const row = (await this.messages().first({ id: messageId })) as MessageRow | null;
    if (!row) {
      throw new NotFoundException('El mensaje ya no existe.');
    }
    return this.toResponse(row);
  }

  /** El chat es del proyecto: entra su propietario y quien haya invitado. */
  private async assertProjectAccess(userId: string, projectId: string): Promise<void> {
    const project = await db.orm.public.Projects.select('id', 'ownerId').first({ id: projectId });
    if (!project) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }
    await this.diagrams.assertProjectAccess(userId, project);
  }

  private readQuestion(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('Escriba la pregunta para la IA (campo content).');
    }
    const content = value.trim();
    if (content.length > QUESTION_MAX_LENGTH) {
      throw new BadRequestException(
        `La pregunta no puede superar los ${QUESTION_MAX_LENGTH} caracteres.`,
      );
    }
    return content;
  }

  /** El diagrama desde el que se pregunta, que tiene que ser de este proyecto. */
  private async readDiagram(userId: string, projectId: string, value: unknown): Promise<string | null> {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new BadRequestException('diagram_id debe ser el identificador de un diagrama.');
    }

    const diagram = await this.diagrams.assertDiagramAccess(userId, value);
    if (diagram.projectId !== projectId) {
      throw new BadRequestException('Ese diagrama no pertenece a este proyecto.');
    }
    return diagram.id;
  }

  private readLimit(value: unknown): number {
    if (value === undefined) {
      return DEFAULT_PAGE;
    }
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new BadRequestException(`limit debe ser un número entero entre 1 y ${MAX_PAGE}.`);
    }
    return limit;
  }

  /** Para pedir mensajes más antiguos que los que ya se tienen. */
  private readBefore(value: unknown): string | null {
    if (value === undefined) {
      return null;
    }
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new BadRequestException('before debe ser una fecha ISO 8601.');
    }
    return new Date(value).toISOString();
  }

  private toResponse(row: MessageRow): ChatMessageResponse {
    return {
      id: row.id,
      project_id: row.projectId,
      diagram_id: row.diagramId,
      diagram_name: row.diagram?.name ?? null,
      author: row.author === null ? null : { id: row.author.id, full_name: row.author.fullName },
      reply_to: row.replyToId,
      content: row.content,
      proposed_actions: readStoredProposal(row.proposedActions),
      action_status: row.actionStatus,
      action_result: row.actionResult,
      resolved_by: row.resolver === null ? null : { id: row.resolver.id, full_name: row.resolver.fullName },
      resolved_at: row.resolvedAt === null ? null : new Date(row.resolvedAt).toISOString(),
      model: row.model,
      error_message: row.errorMessage,
      created_at: new Date(row.createdAt).toISOString(),
    };
  }
}
