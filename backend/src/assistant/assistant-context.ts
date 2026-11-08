import { interpretSystemPrompt } from '../ai/prompts.js';
import type { DiagramValidationResponse } from '../diagrams/diagram-validator.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { PRIMARY_KEY } from '../diagrams/uml-catalog.js';
import type { AiMode } from '../projects/projects.service.js';
import type { ChatLlmMessage } from './chat-llm-client.js';

/**
 * CU12 — Lo que se le enseña al modelo del chat.
 *
 * Todo sale de aquí, y en un orden que no cambia: instrucciones, memoria del
 * proyecto, descripción, diagrama actual, una línea por cada otro diagrama,
 * conversación reciente y, al final, la pregunta. Un orden estable hace que
 * dos respuestas a la misma pregunta se parezcan, y que cuando una salga mal
 * se pueda saber qué vio el modelo.
 *
 * Es una función pura —recibe los datos ya leídos y devuelve los mensajes—
 * para poder probarla sin base ni modelo.
 *
 * Va en un solo mensaje de usuario detrás de las instrucciones, y no como una
 * conversación alternada: en el chat escriben varias personas, y no todos los
 * servidores compatibles aceptan dos mensajes seguidos del mismo papel.
 */

/** Cuántos mensajes anteriores del chat se le enseñan al modelo. */
export const RECENT_MESSAGES = 8;

/**
 * Un mensaje anterior muy largo —una respuesta extensa de la IA— se recorta:
 * para seguir la conversación basta con su comienzo.
 */
const RECENT_MESSAGE_MAX_CHARS = 1_500;

export type MemoryKind = 'DECISION' | 'REQUIREMENT' | 'SUMMARY';

export interface ContextMemoryEntry {
  kind: MemoryKind;
  title: string;
  content: string;
}

export interface ContextMessage {
  /** null es la IA. */
  author: string | null;
  diagramName: string | null;
  content: string;
  /** En un mensaje de la IA, a quién le respondía; null si no se sabe. */
  inReplyTo?: string | null;
}

/** El nombre de pila: con él se dirige la IA a cada integrante. */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * La respuesta, dirigida a quien preguntó.
 *
 * Las instrucciones ya le piden al modelo que empiece nombrando a quien le
 * escribe, pero un modelo no siempre obedece. En un chat de grupo una
 * respuesta sin destinatario no se sabe para quién es, así que si el nombre no
 * aparece se antepone aquí. Si ya lo nombra, la respuesta no se toca.
 */
export function addressAsker(reply: string, askerFullName: string | null): string {
  if (askerFullName === null || askerFullName.trim() === '') return reply;

  const firstName = firstNameOf(askerFullName);
  const pattern = new RegExp(`(^|[^\\p{L}])${fold(firstName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
  if (pattern.test(fold(reply))) return reply;

  return `${firstName}: ${reply}`;
}

export interface ChatContextInput {
  project: { name: string; description: string | null };
  /** CU15 — Si la IA sólo responde, propone cambios o los aplica. */
  mode: AiMode;
  /** En orden de creación. */
  memory: ContextMemoryEntry[];
  /** El diagrama desde el que se pregunta; null si se pregunta desde el proyecto. */
  currentDiagram: FullDiagramResponse | null;
  validation: DiagramValidationResponse | null;
  otherDiagrams: { name: string; classNames: string[] }[];
  /** Del más antiguo al más reciente; como mucho RECENT_MESSAGES. */
  recentMessages: ContextMessage[];
  question: { author: string; diagramName: string | null; content: string };
  /** Tokens aproximados que puede ocupar todo (ai_settings.context_budget). */
  contextBudget: number;
}

export interface ChatContext {
  messages: ChatLlmMessage[];
  estimatedTokens: number;
  /** Lo que no cupo en el presupuesto, para poder explicarlo. */
  omitted: {
    messages: number;
    otherDiagrams: number;
    memory: number;
    diagramTruncated: boolean;
  };
}

/**
 * Tokens aproximados de un texto. Cuatro caracteres por token es la regla
 * habitual; para repartir un presupuesto basta, y no obliga a cargar el
 * tokenizador de cada modelo.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Desde aquí, el prompt de CU04 describe las acciones sobre el diagrama. */
const CATALOGUE_MARKER = 'Acciones disponibles:';

/**
 * CU15 — Las acciones que la IA puede proponer, en el mismo idioma que el
 * asistente de CU04: se recortan de su prompt (prompts.ts) en lugar de
 * copiarlas, porque las lee el mismo parser y las ejecuta el mismo ejecutor, y
 * dos descripciones del mismo formato acabarían diciendo cosas distintas.
 * Incluye los tipos de dato, los de relación, la orientación de la herencia y
 * las multiplicidades.
 */
export function actionCatalogue(): string {
  const prompt = interpretSystemPrompt();
  const start = prompt.indexOf(CATALOGUE_MARKER);

  return start >= 0 ? prompt.slice(start) : '';
}

/**
 * CU15 — Qué puede hacer la IA con el diagrama, según el modo del proyecto.
 * Sin diagrama abierto no hay sobre qué actuar, sea cual sea el modo.
 */
function modeInstructions(mode: AiMode, hasDiagram: boolean): string[] {
  if (mode === 'ANSWER' || !hasDiagram) {
    return [
      mode === 'ANSWER'
        ? '"actions" va siempre vacío: en este proyecto sólo respondes. Si te piden cambiar el diagrama, ' +
          'explica qué cambios harías para que alguien del equipo los haga.'
        : '"actions" va siempre vacío: no hay un diagrama abierto sobre el que actuar.',
    ];
  }

  return [
    mode === 'PROPOSE'
      ? 'Cuando te pidan cambiar el diagrama actual, o cuando tu respuesta sea un cambio concreto en él, ' +
        'además de explicarlo en "reply" escribe esos cambios en "actions": el equipo verá una tarjeta para ' +
        'aplicarlos o descartarlos. Tú no los aplicas: en "reply" preséntalos como una propuesta ' +
        '(«Propongo…»), nunca como algo ya hecho. Si sólo te preguntan o piden un análisis, "actions" va vacío.'
      : 'Cuando te pidan expresamente que hagas un cambio en el diagrama actual, escribe sus acciones en ' +
        '"actions": se aplicarán al momento en nombre de quien te lo pidió, así que en "reply" cuenta qué ' +
        'cambiaste. Si sólo te preguntan o piden un análisis o una opinión, "actions" va vacío: no cambies ' +
        'nada que no te pidan.',
    'Las acciones sólo pueden tocar el diagrama actual, usan los nombres exactos de sus clases y atributos ' +
      `y nunca crean el atributo «${PRIMARY_KEY.name}». Se escriben así:`,
    '',
    actionCatalogue(),
  ];
}

/** Instrucciones del chat. */
export function chatInstructions(projectName: string, mode: AiMode = 'ANSWER', hasDiagram = false): string {
  return [
    `Eres el asistente de IA del equipo que diseña el proyecto «${projectName}» en una herramienta CASE ` +
      'colaborativa de modelado de datos con diagramas de clases UML. Eres un integrante más del equipo: ' +
      'varias personas te escriben en un chat compartido y todas leen tus respuestas.',
    '',
    'Cómo responder:',
    '- Responde en español, de forma concreta y breve, a la pregunta de quien te escribe.',
    '- Diriges cada respuesta a una persona concreta: la que firma la sección «Pregunta». Empieza ' +
      'nombrándola por su nombre de pila («Beto, …») y háblale a ella en singular, de tú; no respondas ' +
      'en plural ni al grupo en general. Si su pregunta menciona a otra persona del equipo o algo que ' +
      'dijo, nómbrala también. En «Conversación reciente» verás a quién le respondiste cada vez: úsalo ' +
      'para no mezclar lo que preguntó cada uno.',
    '- Básate en el contexto del proyecto que viene a continuación: memoria, descripción y diagramas. ' +
      'Nombra las clases, los atributos y las relaciones con su nombre exacto.',
    '- No des respuestas genéricas de manual: si la pregunta es general, aplícala a este diseño. ' +
      'Si al contexto le falta algo para responder, dilo y pregunta lo que necesites.',
    '- Respeta las decisiones técnicas y los requisitos de la memoria del proyecto; si algo que se ' +
      'propone los contradice, adviértelo.',
    `- Toda entidad tiene una clave primaria implícita «${PRIMARY_KEY.name}» de tipo ${PRIMARY_KEY.dataType} ` +
      'que pone la herramienta: no la declares ni la propongas como atributo.',
    '- Cada clase persistente se convertirá en una entidad JPA de un backend Spring Boot, con su tabla.',
    '- Escribe texto plano; puedes usar listas con guiones. Sin tablas ni encabezados.',
    '',
    'Formato de salida: un único objeto JSON, sin nada antes ni después:',
    '{"reply": "tu respuesta", "actions": []}',
    ...modeInstructions(mode, hasDiagram),
  ].join('\n');
}

/**
 * El diagrama con todo lo que importa para hablar de él: clases con sus
 * atributos (tipo, obligatoriedad, unicidad, valor por defecto) y métodos,
 * relaciones leídas en castellano con sus multiplicidades, y los problemas que
 * encuentra el validador de CU02. Más detallado que el de CU04 (diagramContext
 * en prompts.ts), que sólo necesita nombres para resolver una orden.
 */
export function describeDiagram(
  diagram: FullDiagramResponse,
  validation: DiagramValidationResponse | null,
): string {
  const lines: string[] = [];

  if (diagram.description) {
    lines.push(`Descripción: ${diagram.description}`);
  }

  if (diagram.classes.length === 0) {
    lines.push('Todavía no tiene ninguna clase.');
  } else {
    lines.push('Clases:');
    for (const umlClass of diagram.classes) {
      const traits = [
        umlClass.is_abstract ? 'abstracta' : null,
        umlClass.stereotype ? `«${umlClass.stereotype}»` : null,
      ].filter((trait) => trait !== null);
      lines.push(`- ${umlClass.name}${traits.length > 0 ? ` (${traits.join(', ')})` : ''}`);

      for (const attribute of umlClass.attributes) {
        const details = [
          attribute.data_type ?? 'sin tipo',
          attribute.is_nullable ? null : 'obligatorio',
          attribute.is_unique ? 'único' : null,
          attribute.default_value === null ? null : `por defecto ${attribute.default_value}`,
        ].filter((detail) => detail !== null);
        lines.push(`    · ${attribute.name}: ${details.join(', ')}`);
      }
      for (const method of umlClass.methods) {
        const parameters = method.parameters
          .map((parameter) => `${parameter.name}: ${parameter.data_type}`)
          .join(', ');
        lines.push(`    · ${method.name}(${parameters}): ${method.return_type}`);
      }
    }
  }

  const names = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name]));
  if (diagram.relationships.length === 0) {
    lines.push('Relaciones: ninguna.');
  } else {
    lines.push('Relaciones:');
    for (const relationship of diagram.relationships) {
      lines.push(`- ${describeRelationship(relationship, names)}`);
    }
  }

  if (validation && validation.issues.length > 0) {
    lines.push(
      `Validación: ${validation.errors} error(es) y ${validation.warnings} aviso(s).`,
      ...validation.issues.map(
        (issue) => `- ${issue.severity === 'error' ? 'Error' : 'Aviso'}: ${issue.message}`,
      ),
    );
  } else if (validation) {
    lines.push('Validación: sin errores ni avisos.');
  }

  return lines.join('\n');
}

/**
 * Una relación leída como la entiende la herramienta: en la herencia el origen
 * es la hija; en la agregación y la composición, el origen es el todo (el
 * rombo va de su lado). Las multiplicidades van con el extremo al que
 * pertenecen.
 */
function describeRelationship(
  relationship: FullDiagramResponse['relationships'][number],
  names: Map<string, string>,
): string {
  const source = names.get(relationship.source_class_id) ?? '?';
  const target = names.get(relationship.target_class_id) ?? '?';
  const ends = `${source} [${relationship.source_multiplicity ?? '-'}] — ${target} [${relationship.target_multiplicity ?? '-'}]`;
  const extras = [
    relationship.name ? `nombre «${relationship.name}»` : null,
    relationship.source_role ? `rol de ${source}: ${relationship.source_role}` : null,
    relationship.target_role ? `rol de ${target}: ${relationship.target_role}` : null,
  ].filter((extra) => extra !== null);
  const suffix = extras.length > 0 ? `; ${extras.join('; ')}` : '';

  switch (relationship.relationship_type) {
    case 'INHERITANCE':
      return `${source} hereda de ${target}${suffix}`;
    case 'REALIZATION':
      return `${source} implementa ${target}${suffix}`;
    case 'DEPENDENCY':
      return `${source} depende de ${target}${suffix}`;
    case 'COMPOSITION':
      return `composición: ${source} (todo) se compone de ${target} (parte): ${ends}${suffix}`;
    case 'AGGREGATION':
      return `agregación: ${source} (todo) agrupa ${target} (parte): ${ends}${suffix}`;
    default:
      return `asociación: ${ends}${suffix}`;
  }
}

/**
 * Arma los mensajes para el modelo dentro del presupuesto de contexto.
 *
 * Si no cabe todo, se quita en este orden, de lo que menos falta hace a lo que
 * más: los mensajes más antiguos de la conversación, los otros diagramas, los
 * resúmenes y después las demás entradas de memoria (las más antiguas antes)
 * y, por último, se recorta el diagrama actual. Las instrucciones y la
 * pregunta no se tocan nunca. Lo que se quita se dice en su sitio, para que
 * el modelo no crea que no existe.
 */
export function buildChatContext(input: ChatContextInput): ChatContext {
  const system = chatInstructions(input.project.name, input.mode, input.currentDiagram !== null);
  const state = {
    messages: input.recentMessages.slice(-RECENT_MESSAGES),
    otherDiagrams: [...input.otherDiagrams],
    memory: [...input.memory],
    diagram:
      input.currentDiagram === null ? null : describeDiagram(input.currentDiagram, input.validation),
    omitted: { messages: 0, otherDiagrams: 0, memory: 0, diagramTruncated: false },
  };

  const render = (): string => renderUserMessage(input, state);
  const fits = (): boolean => estimateTokens(system) + estimateTokens(render()) <= input.contextBudget;

  while (!fits() && state.messages.length > 0) {
    state.messages.shift();
    state.omitted.messages += 1;
  }
  while (!fits() && state.otherDiagrams.length > 0) {
    state.otherDiagrams.pop();
    state.omitted.otherDiagrams += 1;
  }
  while (!fits() && state.memory.length > 0) {
    const summary = state.memory.findIndex((entry) => entry.kind === 'SUMMARY');
    state.memory.splice(summary >= 0 ? summary : 0, 1);
    state.omitted.memory += 1;
  }
  if (!fits() && state.diagram !== null) {
    // Lo que sobra, en caracteres, se quita del final del diagrama.
    const excess = (estimateTokens(system) + estimateTokens(render()) - input.contextBudget) * 4;
    state.diagram = state.diagram.slice(0, Math.max(0, state.diagram.length - excess - 200));
    state.omitted.diagramTruncated = true;
  }

  const user = render();

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    estimatedTokens: estimateTokens(system) + estimateTokens(user),
    omitted: state.omitted,
  };
}

function renderUserMessage(
  input: ChatContextInput,
  state: {
    messages: ContextMessage[];
    otherDiagrams: { name: string; classNames: string[] }[];
    memory: ContextMemoryEntry[];
    diagram: string | null;
    omitted: ChatContext['omitted'];
  },
): string {
  const sections: string[] = [];

  sections.push(['## Memoria del proyecto', ...renderMemory(state.memory, state.omitted.memory)].join('\n'));

  sections.push(
    ['## Descripción del proyecto', input.project.description?.trim() || 'No tiene descripción.'].join('\n'),
  );

  if (input.currentDiagram === null || state.diagram === null) {
    sections.push('## Diagrama actual\nSe pregunta desde el proyecto, sin un diagrama abierto.');
  } else {
    sections.push(
      [
        `## Diagrama actual: «${input.currentDiagram.name}»`,
        state.diagram,
        state.omitted.diagramTruncated ? '(Diagrama recortado por el límite de contexto.)' : null,
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
  }

  const others = state.otherDiagrams.map(
    (diagram) =>
      `- «${diagram.name}»: ${diagram.classNames.length > 0 ? diagram.classNames.join(', ') : 'sin clases'}`,
  );
  sections.push(
    [
      '## Otros diagramas del proyecto',
      ...(others.length > 0 || state.omitted.otherDiagrams > 0 ? others : ['No hay otros diagramas.']),
      state.omitted.otherDiagrams > 0
        ? `(Se omitieron ${state.omitted.otherDiagrams} diagrama(s) por el límite de contexto.)`
        : null,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );

  const conversation = state.messages.map((message) => {
    const who =
      message.author === null
        ? message.inReplyTo
          ? `IA, a ${message.inReplyTo}`
          : 'IA'
        : `${message.author}${message.diagramName ? `, en «${message.diagramName}»` : ''}`;
    const text =
      message.content.length > RECENT_MESSAGE_MAX_CHARS
        ? `${message.content.slice(0, RECENT_MESSAGE_MAX_CHARS)}…`
        : message.content;
    return `[${who}] ${text}`;
  });
  sections.push(
    [
      '## Conversación reciente',
      state.omitted.messages > 0
        ? `(Se omitieron ${state.omitted.messages} mensaje(s) anteriores por el límite de contexto.)`
        : null,
      ...(conversation.length > 0 ? conversation : state.omitted.messages > 0 ? [] : ['Es la primera pregunta.']),
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );

  const from = input.question.diagramName ? ` (desde «${input.question.diagramName}»)` : '';
  sections.push(`## Pregunta\n${input.question.author}${from} pregunta:\n${input.question.content}`);

  return sections.join('\n\n');
}

function renderMemory(memory: ContextMemoryEntry[], omitted: number): string[] {
  const groups: [MemoryKind, string][] = [
    ['DECISION', 'Decisiones técnicas:'],
    ['REQUIREMENT', 'Requisitos:'],
    ['SUMMARY', 'Resúmenes de conversaciones anteriores:'],
  ];
  const lines: string[] = [];

  for (const [kind, heading] of groups) {
    const entries = memory.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    lines.push(heading, ...entries.map((entry) => `- ${entry.title}: ${entry.content}`));
  }

  if (lines.length === 0 && omitted === 0) {
    lines.push('Todavía no hay decisiones, requisitos ni resúmenes guardados.');
  }
  if (omitted > 0) {
    lines.push(`(Se omitieron ${omitted} entrada(s) de memoria por el límite de contexto.)`);
  }

  return lines;
}

/**
 * El texto de la respuesta del modelo. Se admite que llame al campo de otra
 * forma, o que devuelva sólo el texto, antes que perder una respuesta útil.
 */
export function readReply(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : null;
  }
  if (value === null || typeof value !== 'object') {
    return null;
  }

  for (const key of ['reply', 'respuesta', 'answer']) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}
