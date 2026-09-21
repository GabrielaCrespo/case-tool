import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimatedHeight, fromImageLayout } from './layout.js';
import { parseImageModel } from './uml-actions.js';

/**
 * CU05 — Que un diagrama leído de una imagen quepa en el lienzo.
 *
 * El archivo de `test/fixtures` es lo que Qwen3-VL respondió de verdad al
 * mirar la fotografía de un diagrama de clases de un gimnasio: ocho clases,
 * una de ellas la clase intermedia de un muchos a muchos, con cajas de tres a
 * once atributos. Se usa esa lectura y no una inventada porque el problema
 * que resuelve layout.ts nace justo de cómo responde el modelo: redondea las
 * posiciones —tres clases distintas caen en x = 0,45— y eso es lo que hacía
 * que las cajas acabaran unas encima de otras.
 */
const READING = parseImageModel(
  JSON.parse(readFileSync('test/fixtures/lectura-imagen-gimnasio.json', 'utf8')),
);

const BOXES = READING.classes.map((umlClass) => ({
  position: umlClass.position,
  attributeCount: umlClass.attributes.length,
}));

/** Ancho con el que el editor dibuja una clase. */
const CLASS_WIDTH = 224;

describe('CU05 — colocar en el lienzo lo leído de una imagen', () => {
  it('la lectura de la imagen trae las ocho clases', () => {
    expect(READING.classes.map((umlClass) => umlClass.name)).toEqual([
      'EVALUACION_FISICA',
      'INSTRUCTOR',
      'CLIENTE',
      'RUTINA',
      'GRUPO_MUSCULAR',
      'EJERCICIO',
      'DETALLE_RUTINA',
      'EJERCICIO_GRUPO_MUSCULAR',
    ]);
  });

  it('no deja ninguna clase encima de otra', () => {
    const placed = fromImageLayout(BOXES);

    for (const [i, a] of placed.entries()) {
      for (const [j, b] of placed.entries()) {
        if (i >= j) continue;

        const overlapX = Math.abs(a.posX - b.posX) < CLASS_WIDTH;
        const overlapY =
          a.posY < b.posY + estimatedHeight(BOXES[j].attributeCount) &&
          b.posY < a.posY + estimatedHeight(BOXES[i].attributeCount);

        expect(
          overlapX && overlapY,
          `${READING.classes[i].name} se solapa con ${READING.classes[j].name}`,
        ).toBe(false);
      }
    }
  });

  it('conserva la disposición del dibujo', () => {
    const placed = fromImageLayout(BOXES);
    const at = (name: string) =>
      placed[READING.classes.findIndex((umlClass) => umlClass.name === name)];

    // En la imagen, INSTRUCTOR está a la derecha de EVALUACION_FISICA y las
    // dos arriba; CLIENTE queda debajo y GRUPO_MUSCULAR abajo a la izquierda.
    expect(at('INSTRUCTOR').posX).toBeGreaterThan(at('EVALUACION_FISICA').posX);
    expect(at('CLIENTE').posY).toBeGreaterThan(at('EVALUACION_FISICA').posY);
    expect(at('GRUPO_MUSCULAR').posX).toBeLessThan(at('EJERCICIO').posX);
    expect(at('DETALLE_RUTINA').posY).toBeGreaterThan(at('INSTRUCTOR').posY);
  });

  it('separa más las clases con muchos atributos', () => {
    // CLIENTE tiene once atributos y GRUPO_MUSCULAR tres: la primera ocupa
    // bastante más alto, y de ahí sale el sitio que hay que dejarle debajo.
    expect(estimatedHeight(11)).toBeGreaterThan(estimatedHeight(3));
    expect(estimatedHeight(0)).toBe(120);
  });

  it('coloca lo importado debajo de lo que ya había en el lienzo', () => {
    const existing = [{ posX: 80, posY: 600 }];
    const placed = fromImageLayout(BOXES, existing);

    for (const box of placed) {
      expect(box.posY).toBeGreaterThan(600);
    }
  });

  it('coloca en la rejilla las clases que el modelo no supo situar', () => {
    const placed = fromImageLayout([
      { position: null, attributeCount: 2 },
      { position: null, attributeCount: 2 },
    ]);

    expect(placed[0]).not.toEqual(placed[1]);
  });
});

describe('CU05 — lo que el modelo lee mal', () => {
  it('deja pasar la multiplicidad imposible que EA dibuja en una clase de asociación', () => {
    // El dibujo trae «*..0» junto a EJERCICIO. Se transcribe tal cual: quien
    // decide qué hacer con ella es el ejecutor, que la deja sin indicar y
    // avisa, en lugar de tumbar la importación de las ocho clases.
    const ends = READING.relationships.flatMap((relationship) => [
      relationship.sourceMultiplicity,
      relationship.targetMultiplicity,
    ]);

    expect(ends).toContain('*..0');
  });

  it('lee una sola relación por cada línea del dibujo', () => {
    expect(READING.relationships).toHaveLength(8);
  });
});
