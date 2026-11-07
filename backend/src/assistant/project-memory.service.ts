import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { db } from '../prisma/db.js';
import { AiSettingsService, connectionOf } from './ai-settings.service.js';
import type { MemoryKind } from './assistant-context.js';
import type { ChatLlmMessage } from './chat-llm-client.js';
import { ChatLlmClient } from './chat-llm-client.js';

/**
 * CU14 — Gestionar Memoria del Proyecto (Propietario).
 *
 * Lo que la IA del chat recuerda de un proyecto y tiene en cuenta en cada
 * respuesta (assistant-context.ts): su descripción, las decisiones técnicas y
 * los requisitos que el equipo fue fijando, los resúmenes de conversaciones
 * anteriores y sus diagramas.
 *
 * La descripción es la del proyecto (projects.description, se cambia como
 * siempre desde CU01) y los diagramas se leen de sus tablas: aquí sólo se
 * guarda lo que no tiene otro sitio, en project_memory_entries. La lee
 * cualquiera del equipo; la cambia sólo el propietario.
 *
 * Los resúmenes los escribe la IA cuando el propietario lo pide con un botón,
 * nunca solos, y quedan como una entrada más que se puede corregir o borrar.
 */

export const MEMORY_KINDS: readonly MemoryKind[] = ['DECISION', 'REQUIREMENT', 'SUMMARY'];

/** project_memory_entries.title es VARCHAR(200). */
const TITLE_MAX_LENGTH = 200;

/**
 * Cada entrada viaja entera al modelo en cada pregunta: una entrada más larga
 * que esto se come el presupuesto de contexto del resto del proyecto.
 */
const CONTENT_MAX_LENGTH = 8_000;

/** Cuántos mensajes del chat entran, como mucho, en un resumen. */
const SUMMARY_MAX_MESSAGES = 80;

/** Un mensaje muy largo se recorta al resumir: basta con su comienzo. */
const SUMMARY_MESSAGE_MAX_CHARS = 1_500;

export interface MemoryEntryInput {
  kind?: unknown;
  title?: unknown;
  content?: unknown;
}

export interface MemoryEntryResponse {
  id: string;
  project_id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  created_by: { id: string; full_name: string };
  created_at: string;
  updated_at: string;
}

/** Todo lo que la IA sabe del proyecto, para la pantalla de CU14. */
export interface ProjectMemoryResponse {
  project_id: string;
  description: string | null;
  /** Sólo el propietario cambia la memoria. */
  can_edit: boolean;
  entries: MemoryEntryResponse[];
  /** Los diagramas no se guardan aquí: se leen del modelo en cada pregunta. */
  diagrams: { id: string; name: string; classes: number; relationships: number }[];
}

/** Un mensaje del chat, tal como entra en el resumen. */
export interface TranscriptLine {
  /** null es la IA. */
  author: string | null;
  diagramName: string | null;
  content: string;
}

/**
 * Valida los campos de una entrada. Al crear son obligatorios los tres; al
 * modificar, sólo los que lleguen.
 */
export function readMemoryInput(
  input: MemoryEntryInput | null | undefined,
  partial: boolean,
): { kind?: MemoryKind; title?: string; content?: string } {
  const data = input ?? {};
  const result: { kind?: MemoryKind; title?: string; content?: string } = {};

  if (data.kind !== undefined || !partial) {
    if (typeof data.kind !== 'string' || !MEMORY_KINDS.includes(data.kind as MemoryKind)) {
      throw new BadRequestException(`kind debe ser uno de: ${MEMORY_KINDS.join(', ')}.`);
    }
    result.kind = data.kind as MemoryKind;
  }
  if (data.title !== undefined || !partial) {
    result.title = readText(data.title, 'title', 'El título', TITLE_MAX_LENGTH);
  }
  if (data.content !== undefined || !partial) {
    result.content = readText(data.content, 'content', 'El contenido', CONTENT_MAX_LENGTH);
  }

  if (partial && Object.keys(result).length === 0) {
    throw new BadRequestException('Indique al menos un campo a modificar: kind, title o content.');
  }
  return result;
}

function readText(value: unknown, field: string, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${label} es obligatorio (campo ${field}).`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new BadRequestException(`${label} no puede superar los ${max} caracteres.`);
  }
  return text;
}

/** Lo que se le pide al modelo para resumir la conversación. */
export function summaryMessages(projectName: string, transcript: TranscriptLine[]): ChatLlmMessage[] {
  const lines = transcript.map((line) => {
    const who =
      line.author === null ? 'IA' : `${line.author}${line.diagramName ? `, en «${line.diagramName}»` : ''}`;
    const text =
      line.content.length > SUMMARY_MESSAGE_MAX_CHARS
        ? `${line.content.slice(0, SUMMARY_MESSAGE_MAX_CHARS)}…`
        : line.content;
    return `[${who}] ${text}`;
  });

  return [
    {
      role: 'system',
      content: [
        `Resumes la conversación del equipo que diseña el proyecto «${projectName}», un modelo de datos ` +
          'con diagramas de clases UML. El resumen se guarda en la memoria del proyecto y la IA lo leerá ' +
          'en las próximas conversaciones, así que tiene que servir para retomar el trabajo sin releerlo todo.',
        '',
        'Reglas:',
        '- Escribe en español, en viñetas breves que empiecen por "- ".',
        '- Recoge las decisiones de diseño, los cambios aplicados al diagrama, lo que se propuso y se ' +
          'descartó, y las dudas que quedaron abiertas. Nombra clases y atributos con su nombre exacto.',
        '- Sólo lo que está en la conversación: no añadas recomendaciones ni nada que nadie dijo.',
        '- Omite saludos y mensajes sin contenido.',
        '',
        'Responde únicamente con un objeto JSON:',
        '{"title": "título breve, de menos de 80 caracteres", "summary": "- viñeta\\n- viñeta"}',
      ].join('\n'),
    },
    { role: 'user', content: `Conversación:\n${lines.join('\n')}` },
  ];
}

/** El resumen que devolvió el modelo, o null si no trae texto. */
export function readSummary(value: unknown, fallbackTitle: string): { title: string; content: string } | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const { title, summary } = value as { title?: unknown; summary?: unknown };

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return null;
  }
  const cleanTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : fallbackTitle;

  return {
    title: cleanTitle.slice(0, TITLE_MAX_LENGTH),
    content: summary.trim().slice(0, CONTENT_MAX_LENGTH),
  };
}

interface EntryRow {
  id: string;
  projectId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; fullName: string };
}

@Injectable()
export class ProjectMemoryService {
  constructor(
    private readonly diagrams: DiagramsService,
    private readonly settings: AiSettingsService,
    private readonly llm: ChatLlmClient,
  ) {}

  /** GET /projects/:projectId/memory — para cualquiera del equipo. */
  async get(userId: string, projectId: string): Promise<ProjectMemoryResponse> {
    const project = await this.findProject(userId, projectId);

    const entries = (await this.entries()
      .where({ projectId })
      .orderBy((entry) => entry.createdAt.asc())
      .all()) as EntryRow[];

    const diagrams = await db.orm.public.Diagrams.where({ projectId })
      .include('umlClasses')
      .include('umlRelationships')
      .orderBy((diagram) => diagram.createdAt.asc())
      .all();

    return {
      project_id: project.id,
      description: project.description,
      can_edit: project.ownerId === userId,
      entries: entries.map((entry) => this.toResponse(entry)),
      diagrams: diagrams.map((diagram) => ({
        id: diagram.id,
        name: diagram.name,
        classes: diagram.umlClasses.length,
        relationships: diagram.umlRelationships.length,
      })),
    };
  }

  /** POST /projects/:projectId/memory */
  async create(userId: string, projectId: string, input: MemoryEntryInput): Promise<MemoryEntryResponse> {
    await this.findOwnedProject(userId, projectId);
    const data = readMemoryInput(input, false);

    const created = await db.orm.public.ProjectMemoryEntries.create({
      projectId,
      kind: data.kind!,
      title: data.title! as Varchar<typeof TITLE_MAX_LENGTH>,
      content: data.content!,
      createdBy: userId,
    });

    return this.findResponse(created.id);
  }

  /** PATCH /memory/:id */
  async update(userId: string, entryId: string, input: MemoryEntryInput): Promise<MemoryEntryResponse> {
    const entry = await this.findEntry(entryId);
    await this.findOwnedProject(userId, entry.projectId);
    const data = readMemoryInput(input, true);

    await db.orm.public.ProjectMemoryEntries.where({ id: entryId }).update({
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.title !== undefined ? { title: data.title as Varchar<typeof TITLE_MAX_LENGTH> } : {}),
      ...(data.content !== undefined ? { content: data.content } : {}),
      // Como en backend_deployments y ai_settings: la fecha la pone el
      // servicio, no un disparador.
      updatedAt: new Date().toISOString(),
    });

    return this.findResponse(entryId);
  }

  /** DELETE /memory/:id */
  async remove(userId: string, entryId: string): Promise<void> {
    const entry = await this.findEntry(entryId);
    await this.findOwnedProject(userId, entry.projectId);

    await db.orm.public.ProjectMemoryEntries.where({ id: entryId }).delete();
  }

  /**
   * POST /projects/:projectId/memory/summary — la IA resume lo que se habló en
   * el chat desde el último resumen y lo guarda como una entrada más.
   */
  async summarize(userId: string, projectId: string): Promise<MemoryEntryResponse> {
    const project = await this.findOwnedProject(userId, projectId);

    const status = await this.settings.status();
    if (!status.available) {
      throw new ServiceUnavailableException(status.reason ?? 'El asistente de IA no está disponible.');
    }

    // Sólo lo nuevo: lo anterior ya está en el último resumen.
    const last = await db.orm.public.ProjectMemoryEntries.where({ projectId, kind: 'SUMMARY' })
      .orderBy((entry) => entry.createdAt.desc())
      .first();

    let query = db.orm.public.ChatMessages.include('author').include('diagram').where({ projectId });
    if (last) {
      query = query.where((message) => message.createdAt.gt(last.createdAt));
    }
    const recent = (await query
      .orderBy((message) => message.createdAt.desc())
      .limit(SUMMARY_MAX_MESSAGES)
      .all()) as {
      content: string;
      errorMessage: string | null;
      author: { fullName: string } | null;
      diagram: { name: string } | null;
    }[];

    // Los avisos de que la IA no pudo responder no son conversación.
    const transcript: TranscriptLine[] = recent
      .filter((message) => message.errorMessage === null)
      .reverse()
      .map((message) => ({
        author: message.author?.fullName ?? null,
        diagramName: message.diagram?.name ?? null,
        content: message.content,
      }));

    if (transcript.length < 2) {
      throw new BadRequestException(
        last
          ? 'No hay conversación nueva que resumir desde el último resumen.'
          : 'Todavía no hay conversación que resumir en el chat del proyecto.',
      );
    }

    const settings = await this.settings.current();
    const completion = await this.llm.completeJson(
      connectionOf(settings),
      summaryMessages(project.name, transcript),
    );
    const summary = readSummary(
      completion.value,
      `Resumen de la conversación del ${new Date().toLocaleDateString('es')}`,
    );

    if (summary === null) {
      throw new HttpException(
        'El modelo no devolvió un resumen. Inténtelo de nuevo.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const created = await db.orm.public.ProjectMemoryEntries.create({
      projectId,
      kind: 'SUMMARY',
      title: summary.title as Varchar<typeof TITLE_MAX_LENGTH>,
      content: summary.content,
      createdBy: userId,
    });

    return this.findResponse(created.id);
  }

  /** Las entradas con su autor, para poder nombrarlo. */
  private entries() {
    return db.orm.public.ProjectMemoryEntries.include('user');
  }

  private async findEntry(entryId: string): Promise<EntryRow> {
    const entry = (await this.entries().first({ id: entryId })) as EntryRow | null;
    if (!entry) {
      throw new NotFoundException('La entrada de memoria indicada no existe.');
    }
    return entry;
  }

  private async findResponse(entryId: string): Promise<MemoryEntryResponse> {
    return this.toResponse(await this.findEntry(entryId));
  }

  /** La memoria la lee cualquiera del equipo. */
  private async findProject(userId: string, projectId: string) {
    const project = await db.orm.public.Projects.first({ id: projectId });
    if (!project) {
      throw new NotFoundException('El proyecto indicado no existe.');
    }
    await this.diagrams.assertProjectAccess(userId, project);
    return project;
  }

  /** Y la cambia sólo su propietario, como el resto del proyecto (CU01). */
  private async findOwnedProject(userId: string, projectId: string) {
    const project = await this.findProject(userId, projectId);
    if (project.ownerId !== userId) {
      throw new ForbiddenException('Sólo el propietario del proyecto puede cambiar su memoria.');
    }
    return project;
  }

  private toResponse(entry: EntryRow): MemoryEntryResponse {
    return {
      id: entry.id,
      project_id: entry.projectId,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      created_by: { id: entry.user.id, full_name: entry.user.fullName },
      created_at: new Date(entry.createdAt).toISOString(),
      updated_at: new Date(entry.updatedAt).toISOString(),
    };
  }
}
