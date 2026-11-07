import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { readMemoryInput, readSummary, summaryMessages } from './project-memory.service.js';

/**
 * CU14 — Qué se acepta en la memoria del proyecto y cómo se pide un resumen.
 * Lo que toca la base y el modelo se comprueba contra el servidor en marcha.
 */
describe('readMemoryInput', () => {
  it('al crear exige tipo, título y contenido, y los recorta', () => {
    expect(
      readMemoryInput({ kind: 'DECISION', title: ' Moneda ', content: ' Bolivianos con BigDecimal. ' }, false),
    ).toEqual({ kind: 'DECISION', title: 'Moneda', content: 'Bolivianos con BigDecimal.' });
  });

  it.each([
    ['sin tipo', { title: 'x', content: 'y' }],
    ['un tipo desconocido', { kind: 'NOTE', title: 'x', content: 'y' }],
    ['sin título', { kind: 'REQUIREMENT', content: 'y' }],
    ['un título en blanco', { kind: 'REQUIREMENT', title: '  ', content: 'y' }],
    ['un título demasiado largo', { kind: 'REQUIREMENT', title: 'x'.repeat(201), content: 'y' }],
    ['un contenido demasiado largo', { kind: 'REQUIREMENT', title: 'x', content: 'y'.repeat(8001) }],
  ])('al crear rechaza %s', (_, input) => {
    expect(() => readMemoryInput(input, false)).toThrow(BadRequestException);
  });

  it('al modificar acepta sólo lo que llega', () => {
    expect(readMemoryInput({ content: 'Nuevo texto' }, true)).toEqual({ content: 'Nuevo texto' });
  });

  it('al modificar sin campos lo dice', () => {
    expect(() => readMemoryInput({}, true)).toThrow('Indique al menos un campo');
  });
});

describe('summaryMessages', () => {
  const transcript = [
    { author: 'Luis', diagramName: 'Ventas', content: '¿Falta el detalle de la venta?' },
    { author: null, diagramName: 'Ventas', content: 'Propongo DETALLENOTA. (cambios aplicados)' },
  ];

  it('pide un JSON con título y viñetas, sin inventar', () => {
    const [system] = summaryMessages('Tienda', transcript);

    expect(system.role).toBe('system');
    expect(system.content).toContain('«Tienda»');
    expect(system.content).toContain('{"title"');
    expect(system.content).toContain('no añadas recomendaciones ni nada que nadie dijo');
  });

  it('pasa la conversación con quién dijo qué y desde qué diagrama', () => {
    const [, user] = summaryMessages('Tienda', transcript);

    expect(user.content).toContain('[Luis, en «Ventas»] ¿Falta el detalle de la venta?');
    expect(user.content).toContain('[IA] Propongo DETALLENOTA. (cambios aplicados)');
  });
});

describe('readSummary', () => {
  it('lee el título y el resumen', () => {
    expect(readSummary({ title: ' Detalle de venta ', summary: ' - Se creó DETALLENOTA. ' }, 'Resumen')).toEqual({
      title: 'Detalle de venta',
      content: '- Se creó DETALLENOTA.',
    });
  });

  it('sin título usa el de respaldo', () => {
    expect(readSummary({ summary: '- Algo.' }, 'Resumen del 7/11')?.title).toBe('Resumen del 7/11');
  });

  it.each([[{ title: 'x' }], [{ summary: '  ' }], [null], ['texto']])('sin resumen devuelve null: %j', (value) => {
    expect(readSummary(value, 'Resumen')).toBeNull();
  });
});
