import { describe, expect, it } from 'vitest';
import { validateDiagram } from '../diagrams/diagram-validator.js';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import type { ChatContextInput } from './assistant-context.js';
import {
  actionCatalogue,
  buildChatContext,
  describeDiagram,
  estimateTokens,
  readReply,
  RECENT_MESSAGES,
} from './assistant-context.js';

/**
 * CU12 — Lo que el modelo del chat ve, y en qué orden.
 *
 * Es lo que hace que la IA responda sobre este proyecto y no en general: si
 * aquí falta la memoria o el diagrama, la respuesta será de manual.
 */
const now = new Date().toISOString();

function umlClass(id: string, name: string, attributes: [string, string | null, boolean?][] = []) {
  return {
    id,
    diagram_id: 'd1',
    name,
    stereotype: null,
    is_abstract: false,
    visibility: 'public',
    pos_x: 0,
    pos_y: 0,
    width: null,
    height: null,
    created_at: now,
    updated_at: now,
    attributes: attributes.map(([attribute, dataType, required], index) => ({
      id: `${id}-a${index}`,
      class_id: id,
      name: attribute,
      data_type: dataType,
      visibility: 'private',
      is_nullable: !required,
      is_unique: false,
      default_value: null,
      is_static: false,
      is_derived: false,
      is_read_only: false,
      multiplicity: null,
      order_index: index,
      created_at: now,
      updated_at: now,
    })),
    methods: [],
  };
}

function relationship(
  id: string,
  type: string,
  source: string,
  target: string,
  sourceMultiplicity: string | null,
  targetMultiplicity: string | null,
) {
  return {
    id,
    diagram_id: 'd1',
    source_class_id: source,
    target_class_id: target,
    relationship_type: type,
    source_multiplicity: sourceMultiplicity,
    target_multiplicity: targetMultiplicity,
    name: null,
    source_role: null,
    target_role: null,
    is_navigable_source: true,
    is_navigable_target: true,
    created_at: now,
    updated_at: now,
  };
}

const ventas: FullDiagramResponse = {
  id: 'd1',
  project_id: 'p1',
  name: 'Ventas',
  description: null,
  created_by: 'u1',
  created_at: now,
  updated_at: now,
  classes: [
    umlClass('c1', 'CLIENTE', [['nombre', 'String', true], ['telefono', null]]),
    umlClass('c2', 'NOTAVENTA', [['fecha', 'LocalDate', true], ['monto', 'BigDecimal']]),
    umlClass('c3', 'PERSONA'),
  ],
  relationships: [
    relationship('r1', 'ASSOCIATION', 'c1', 'c2', '1', '0..*'),
    relationship('r2', 'INHERITANCE', 'c1', 'c3', null, null),
  ],
};

function input(overrides: Partial<ChatContextInput> = {}): ChatContextInput {
  return {
    project: { name: 'Tienda', description: 'Ventas al por menor de una tienda de barrio.' },
    mode: 'ANSWER',
    memory: [
      { kind: 'DECISION', title: 'Moneda', content: 'Los montos se guardan en bolivianos con BigDecimal.' },
      { kind: 'REQUIREMENT', title: 'Crédito', content: 'Un cliente puede comprar a crédito.' },
    ],
    currentDiagram: ventas,
    validation: validateDiagram(ventas),
    otherDiagrams: [{ name: 'Inventario', classNames: ['PRODUCTO', 'ALMACEN'] }],
    recentMessages: [
      { author: 'Ana', diagramName: 'Ventas', content: '¿Falta el detalle de la venta?' },
      { author: null, diagramName: 'Ventas', content: 'Sí, falta DETALLEVENTA.' },
    ],
    question: { author: 'Luis', diagramName: 'Ventas', content: '¿Cómo registro los pagos a crédito?' },
    contextBudget: 24_000,
    ...overrides,
  };
}

describe('buildChatContext', () => {
  it('pone las instrucciones aparte y el contexto en el orden acordado', () => {
    const { messages } = buildChatContext(input());

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('«Tienda»');
    expect(messages[0].content).toContain('{"reply"');

    const user = messages[1].content;
    const order = [
      '## Memoria del proyecto',
      '## Descripción del proyecto',
      '## Diagrama actual: «Ventas»',
      '## Otros diagramas del proyecto',
      '## Conversación reciente',
      '## Pregunta',
    ].map((heading) => user.indexOf(heading));

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lleva el contenido real del proyecto, no sólo los títulos', () => {
    const user = buildChatContext(input()).messages[1].content;

    expect(user).toContain('Moneda: Los montos se guardan en bolivianos con BigDecimal.');
    expect(user).toContain('Requisitos:\n- Crédito: Un cliente puede comprar a crédito.');
    expect(user).toContain('Ventas al por menor de una tienda de barrio.');
    expect(user).toContain('- «Inventario»: PRODUCTO, ALMACEN');
    expect(user).toContain('[Ana, en «Ventas»] ¿Falta el detalle de la venta?');
    expect(user).toContain('[IA] Sí, falta DETALLEVENTA.');
    expect(user).toContain('Luis (desde «Ventas») pregunta:\n¿Cómo registro los pagos a crédito?');
  });

  it('recuerda que la clave primaria la pone la herramienta', () => {
    expect(buildChatContext(input()).messages[0].content).toContain('clave primaria implícita «id» de tipo Long');
  });

  it('dice que no hay memoria ni otros diagramas en vez de dejar el hueco', () => {
    const user = buildChatContext(
      input({ memory: [], otherDiagrams: [], recentMessages: [], project: { name: 'Tienda', description: null } }),
    ).messages[1].content;

    expect(user).toContain('Todavía no hay decisiones, requisitos ni resúmenes guardados.');
    expect(user).toContain('No tiene descripción.');
    expect(user).toContain('No hay otros diagramas.');
    expect(user).toContain('Es la primera pregunta.');
  });

  it(`no enseña más de ${RECENT_MESSAGES} mensajes anteriores`, () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      author: 'Ana',
      diagramName: null,
      content: `mensaje ${index}`,
    }));
    const user = buildChatContext(input({ recentMessages: many })).messages[1].content;

    expect(user).not.toContain('mensaje 3');
    expect(user).toContain('mensaje 4');
    expect(user).toContain('mensaje 11');
  });

  it('sin presupuesto, quita primero los mensajes antiguos y después los otros diagramas', () => {
    const recentMessages = Array.from({ length: 8 }, (_, index) => ({
      author: 'Ana',
      diagramName: null,
      content: `${'palabra '.repeat(150)}${index}`,
    }));
    const full = buildChatContext(input({ recentMessages }));
    const tight = buildChatContext(input({ recentMessages, contextBudget: full.estimatedTokens - 400 }));

    expect(tight.estimatedTokens).toBeLessThanOrEqual(full.estimatedTokens - 400);
    expect(tight.omitted.messages).toBeGreaterThan(0);
    expect(tight.omitted.otherDiagrams).toBe(0);
    expect(tight.omitted.memory).toBe(0);
    expect(tight.messages[1].content).toContain('mensaje(s) anteriores por el límite de contexto');
    // Se van los más antiguos: el último sigue.
    expect(tight.messages[1].content).toContain(`${'palabra '.repeat(150)}7`);
  });

  it('con muy poco presupuesto conserva las instrucciones y la pregunta', () => {
    // Apenas más de lo que ocupan las instrucciones: no cabe nada más.
    const instructions = estimateTokens(buildChatContext(input()).messages[0].content);
    const tiny = buildChatContext(input({ contextBudget: instructions + 60 }));

    expect(tiny.messages[0].content).toContain('Formato de salida');
    expect(tiny.messages[1].content).toContain('¿Cómo registro los pagos a crédito?');
    expect(tiny.omitted).toEqual({ messages: 2, otherDiagrams: 1, memory: 2, diagramTruncated: true });
    expect(tiny.messages[1].content).toContain('(Diagrama recortado por el límite de contexto.)');
  });

  it('sin diagrama abierto lo dice', () => {
    const user = buildChatContext(input({ currentDiagram: null, validation: null })).messages[1].content;

    expect(user).toContain('Se pregunta desde el proyecto, sin un diagrama abierto.');
  });
});

describe('instrucciones según el modo del proyecto (CU15)', () => {
  const system = (overrides: Partial<ChatContextInput>) => buildChatContext(input(overrides)).messages[0].content;

  it('el catálogo de acciones sale del prompt de CU04, con la herencia y las multiplicidades', () => {
    const catalogue = actionCatalogue();

    expect(catalogue.startsWith('Acciones disponibles:')).toBe(true);
    expect(catalogue).toContain('"action":"CREATE_CLASS"');
    expect(catalogue).toContain('"action":"CREATE_RELATIONSHIP"');
    expect(catalogue).toContain('en INHERITANCE el padre va en "sourceClass"');
    expect(catalogue).toContain('Multiplicidades:');
  });

  it('ANSWER: nunca acciones, y sin catálogo que lo tiente', () => {
    const text = system({ mode: 'ANSWER' });

    expect(text).toContain('"actions" va siempre vacío: en este proyecto sólo respondes');
    expect(text).not.toContain('"action":"CREATE_CLASS"');
  });

  it('PROPOSE: acciones cuando se pide un cambio, para una tarjeta que el equipo aplica', () => {
    const text = system({ mode: 'PROPOSE' });

    expect(text).toContain('el equipo verá una tarjeta para aplicarlos o descartarlos');
    expect(text).toContain('nunca como algo ya hecho');
    expect(text).toContain('"action":"CREATE_CLASS"');
    expect(text).toContain('nunca crean el atributo «id»');
  });

  it('EXECUTE: sólo si se lo piden expresamente, y se aplica en nombre de quien pidió', () => {
    const text = system({ mode: 'EXECUTE' });

    expect(text).toContain('se aplicarán al momento en nombre de quien te lo pidió');
    expect(text).toContain('no cambies nada que no te pidan');
    expect(text).toContain('"action":"CREATE_CLASS"');
  });

  it('sin diagrama abierto no hay acciones, sea cual sea el modo', () => {
    const text = system({ mode: 'EXECUTE', currentDiagram: null, validation: null });

    expect(text).toContain('no hay un diagrama abierto sobre el que actuar');
    expect(text).not.toContain('"action":"CREATE_CLASS"');
  });
});

describe('describeDiagram', () => {
  it('lee las relaciones como las guarda la herramienta', () => {
    const text = describeDiagram(ventas, null);

    expect(text).toContain('asociación: CLIENTE [1] — NOTAVENTA [0..*]');
    expect(text).toContain('CLIENTE hereda de PERSONA');
  });

  it('describe los atributos con su tipo y si son obligatorios', () => {
    const text = describeDiagram(ventas, null);

    expect(text).toContain('· nombre: String, obligatorio');
    expect(text).toContain('· telefono: sin tipo');
  });

  it('incluye lo que encuentra el validador', () => {
    const empty: FullDiagramResponse = { ...ventas, classes: [], relationships: [] };
    const text = describeDiagram(empty, validateDiagram(empty));

    expect(text).toContain('Todavía no tiene ninguna clase.');
    expect(text).toMatch(/Validación: \d+ error\(es\)/);
  });
});

describe('readReply', () => {
  it.each([
    [{ reply: '  Falta DETALLEVENTA. ', actions: [] }, 'Falta DETALLEVENTA.'],
    [{ respuesta: 'En castellano también' }, 'En castellano también'],
    ['Sólo el texto', 'Sólo el texto'],
  ])('lee %j', (value, expected) => {
    expect(readReply(value)).toBe(expected);
  });

  it.each([[{ reply: '' }], [{ actions: [] }], [null], [42]])('no inventa una respuesta de %j', (value) => {
    expect(readReply(value)).toBeNull();
  });
});
