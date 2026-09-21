/**
 * CU04/CU05 — Dónde colocar las clases que nacen sin coordenadas.
 *
 * El usuario no dice «x=400 y=250» al dictar «crea una clase Cliente», y una
 * foto casi nunca permite leer posiciones fiables. Como pos_x y pos_y son
 * columnas NOT NULL, alguien tiene que decidirlas, y ese alguien es el
 * sistema: la IA no propone coordenadas que no estén en la instrucción.
 *
 * El criterio es el mismo en los dos casos: rejilla de izquierda a derecha, sin
 * pisar lo que ya hay en el lienzo.
 */

/** Tamaño con el que el editor dibuja una clase recién creada. */
const CLASS_WIDTH = 224;
const CLASS_HEIGHT = 120;

/** Separación entre clases contiguas de la rejilla. */
const GAP_X = 80;
const GAP_Y = 80;

const STEP_X = CLASS_WIDTH + GAP_X;
const STEP_Y = CLASS_HEIGHT + GAP_Y;

/** Clases por fila antes de bajar a la siguiente. */
const COLUMNS = 4;

const ORIGIN_X = 80;
const ORIGIN_Y = 80;

export interface Placed {
  posX: number;
  posY: number;
}

/**
 * Dos clases se estorban si sus cajas se solapan. Se compara con el tamaño por
 * defecto y no con el real: una clase redimensionada a mano podría ser mayor,
 * pero para decidir un hueco libre basta con esta aproximación.
 */
function overlaps(a: Placed, b: Placed): boolean {
  return (
    Math.abs(a.posX - b.posX) < CLASS_WIDTH + GAP_X / 2 &&
    Math.abs(a.posY - b.posY) < CLASS_HEIGHT + GAP_Y / 2
  );
}

/**
 * Primer hueco de la rejilla que no pisa ninguna de las clases dadas.
 *
 * Se recorre la rejilla en lugar de colocar «debajo de la última»: así una
 * clase creada por el asistente cae en el sitio vacío que el usuario ve, y no
 * apilada en una esquina sobre la que ya hay algo.
 */
export function freePosition(existing: readonly Placed[]): Placed {
  for (let index = 0; index < 400; index += 1) {
    const candidate: Placed = {
      posX: ORIGIN_X + (index % COLUMNS) * STEP_X,
      posY: ORIGIN_Y + Math.floor(index / COLUMNS) * STEP_Y,
    };

    if (!existing.some((placed) => overlaps(placed, candidate))) {
      return candidate;
    }
  }

  // Con 400 clases en el diagrama, debajo de todo es tan buen sitio como otro.
  const lowest = existing.reduce((max, placed) => Math.max(max, placed.posY), ORIGIN_Y);
  return { posX: ORIGIN_X, posY: lowest + STEP_Y };
}

/** Posición relativa a otra clase: «mueve Pedido a la derecha de Cliente». */
export function besidePosition(
  reference: Placed,
  direction: 'above' | 'below' | 'left' | 'right',
): Placed {
  switch (direction) {
    case 'above':
      return { posX: reference.posX, posY: reference.posY - STEP_Y };
    case 'below':
      return { posX: reference.posX, posY: reference.posY + STEP_Y };
    case 'left':
      return { posX: reference.posX - STEP_X, posY: reference.posY };
    case 'right':
      return { posX: reference.posX + STEP_X, posY: reference.posY };
  }
}

/**
 * Alto que ocupará una clase en el lienzo según lo que lleva dentro.
 *
 * El editor dibuja las clases con alto automático, de modo que una clase de
 * once atributos mide el doble que una de tres. Calcularlo importa porque es
 * lo que decide cuánto hay que separarlas: repartirlas como si todas midieran
 * lo mismo es lo que hacía que las cajas altas se pisaran entre ellas.
 */
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 19;

export function estimatedHeight(attributeCount: number): number {
  return Math.max(CLASS_HEIGHT, HEADER_HEIGHT + attributeCount * ROW_HEIGHT);
}

/** Una clase leída de la imagen, con lo que hace falta para colocarla. */
export interface ImageBox {
  /** Posición relativa (0..1) que la IA vio, o null si no supo situarla. */
  position: { x: number; y: number } | null;
  attributeCount: number;
}

/**
 * CU05 — Coloca en el lienzo las clases leídas de una imagen conservando la
 * disposición del dibujo.
 *
 * Se colocan todas a la vez, y no una por una, porque el problema es de
 * conjunto: la IA devuelve posiciones redondeadas —varias clases caen en la
 * misma x— y lo que decide si dos cajas se pisan no es dónde estaban en la
 * foto, sino cuánto miden aquí. Colocando cada una por su cuenta no hay forma
 * de saberlo, y el resultado era un diagrama con la disposición correcta pero
 * con clases encima de otras.
 *
 * El procedimiento son dos pasos:
 *
 *  1. Escalar las fracciones a un lienzo cuyo alto se calcula con la caja más
 *     alta, no con una altura fija, para que las filas quepan de verdad.
 *  2. Separar lo que aun así se solape, bajando la caja de más abajo. Se baja
 *     y no se mueve de lado a propósito: desplazar en horizontal rompería las
 *     columnas del dibujo original, que es lo que se está intentando conservar.
 *
 * `existing` son las clases que ya estaban en el diagrama: lo importado se
 * coloca debajo, para no caer encima de lo que el usuario ya tenía.
 */
export function fromImageLayout(boxes: readonly ImageBox[], existing: readonly Placed[] = []): Placed[] {
  const columns = Math.max(2, Math.ceil(Math.sqrt(boxes.length)));
  const rows = Math.max(1, Math.ceil(boxes.length / columns));
  const tallest = Math.max(...boxes.map((box) => estimatedHeight(box.attributeCount)), CLASS_HEIGHT);

  const width = columns * STEP_X;
  const height = rows * (tallest + GAP_Y);

  // Lo importado empieza por debajo de lo que ya hubiera en el lienzo.
  const originY =
    existing.length === 0
      ? ORIGIN_Y
      : existing.reduce((lowest, placed) => Math.max(lowest, placed.posY), ORIGIN_Y) + STEP_Y;

  const placed: (Placed & { height: number })[] = [];

  for (const box of boxes) {
    const size = estimatedHeight(box.attributeCount);

    if (box.position === null) {
      // Sin posición en la imagen, al primer hueco libre de la rejilla.
      const free = freePosition([...existing, ...placed]);
      placed.push({ ...free, height: size });
      continue;
    }

    // Se recorta a 0..1: una coordenada fuera de rango sólo puede ser un error
    // de lectura, y no debe mandar la clase fuera del lienzo.
    const x = Math.min(Math.max(box.position.x, 0), 1);
    const y = Math.min(Math.max(box.position.y, 0), 1);

    placed.push({
      posX: Math.round(ORIGIN_X + x * width),
      posY: Math.round(originY + y * height),
      height: size,
    });
  }

  return separate(placed);
}

/**
 * Baja las cajas que se pisan hasta que ninguna se solape con otra.
 *
 * Se recorre de arriba abajo y cada caja se compara sólo con las que ya
 * quedaron colocadas: así la de más arriba se queda donde estaba y es siempre
 * la de abajo la que cede, que es el orden en que se lee un diagrama.
 */
function separate(boxes: (Placed & { height: number })[]): Placed[] {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => a.box.posY - b.box.posY || a.box.posX - b.box.posX);

  const settled: (Placed & { height: number })[] = [];

  for (const { box } of order) {
    let moved = { ...box };

    // Cada vuelta baja la caja justo lo necesario para librar a la que la
    // estorba; el tope evita dar vueltas si dos cajas se empujan entre sí.
    for (let attempt = 0; attempt < boxes.length * 2; attempt += 1) {
      const collision = settled.find((other) => collide(other, moved));
      if (collision === undefined) break;

      moved = { ...moved, posY: collision.posY + collision.height + GAP_Y };
    }

    settled.push(moved);
  }

  // Se devuelven en el orden en que llegaron, que es el de las clases.
  const result: Placed[] = new Array(boxes.length);
  for (const [position, { index }] of order.entries()) {
    result[index] = { posX: settled[position].posX, posY: settled[position].posY };
  }

  return result;
}

/** Dos cajas se pisan si sus rectángulos se cortan, contando la separación. */
function collide(a: Placed & { height: number }, b: Placed & { height: number }): boolean {
  const horizontal = Math.abs(a.posX - b.posX) < CLASS_WIDTH + GAP_X / 2;
  const vertical = a.posY < b.posY + b.height + GAP_Y / 2 && b.posY < a.posY + a.height + GAP_Y / 2;

  return horizontal && vertical;
}
