import { describe, expect, it } from 'vitest';
import { addressAsker, buildChatContext, chatInstructions, firstNameOf } from './assistant-context.js';

describe('addressAsker', () => {
  it('no toca una respuesta que ya nombra a quien preguntó', () => {
    expect(addressAsker('Beto, a Pedido le falta total.', 'Beto Prueba')).toBe('Beto, a Pedido le falta total.');
    expect(addressAsker('Claro, Beto: falta total.', 'Beto Prueba')).toBe('Claro, Beto: falta total.');
  });

  it('antepone el nombre de pila cuando el modelo lo olvida', () => {
    expect(addressAsker('A Pedido le falta total.', 'Beto Prueba')).toBe('Beto: A Pedido le falta total.');
  });

  it('reconoce el nombre aunque cambien mayúsculas o tildes', () => {
    expect(addressAsker('ramon, sí.', 'Ramón Pérez')).toBe('ramon, sí.');
  });

  it('no confunde el nombre con parte de otra palabra', () => {
    // «Ana» dentro de «Analiza» no cuenta como nombrarla.
    expect(addressAsker('Analiza la clase Pedido.', 'Ana Prueba')).toBe('Ana: Analiza la clase Pedido.');
  });

  it('sin autor conocido deja la respuesta igual', () => {
    expect(addressAsker('Hola.', null)).toBe('Hola.');
  });

  it('toma el nombre de pila', () => {
    expect(firstNameOf('  Gabriela Belén Crespo ')).toBe('Gabriela');
  });
});

describe('contexto por integrante', () => {
  it('las instrucciones piden dirigirse a quien pregunta', () => {
    expect(chatInstructions('Tienda')).toContain('nombre de pila');
  });

  it('la conversación reciente dice a quién respondió la IA', () => {
    const context = buildChatContext({
      project: { name: 'Tienda', description: null },
      mode: 'ANSWER',
      memory: [],
      currentDiagram: null,
      validation: null,
      otherDiagrams: [],
      recentMessages: [
        { author: 'Beto Prueba', diagramName: null, content: '¿Qué le falta a Pedido?' },
        { author: null, diagramName: null, content: 'Beto, le falta total.', inReplyTo: 'Beto Prueba' },
      ],
      question: { author: 'Ana Prueba', diagramName: null, content: '¿Estás de acuerdo?' },
      contextBudget: 10_000,
    });
    const text = context.messages.map((message) => message.content).join('\n');
    expect(text).toContain('[IA, a Beto Prueba] Beto, le falta total.');
    expect(text).toContain('Ana Prueba pregunta:');
  });
});
