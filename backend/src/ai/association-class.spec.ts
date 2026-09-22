import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { AiExecutorService } from './ai-executor.service.js';
import { AiService } from './ai.service.js';
import type { RawAction, RawImageModel } from './uml-actions.js';

/**
 * CU05 — La entidad intermedia de una imagen.
 *
 * El caso es el de la nota de venta: NOTAVENTA y PRODUCTO unidas por una línea
 * de muchos a muchos, y DETALLE_VENTA colgando de ella por una línea
 * discontinua. Es el dibujo más común en un diagrama de datos y el que hay que
 * leer bien, porque un muchos a muchos sin resolver no se puede convertir en
 * tablas: sin la caja intermedia, CU07 no tendría dónde guardar el precio y la
 * cantidad de cada línea de la venta.
 *
 * `toActions` no toca la base ni la IA —convierte lo leído en acciones—, así
 * que se prueba con los servicios sin construir.
 */
const service = new AiService(null as never, null as never, null as never);

const EMPTY_DIAGRAM: FullDiagramResponse = {
  id: 'd',
  project_id: 'p',
  name: 'Diagrama de clase',
  description: null,
  created_by: 'u',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  classes: [],
  relationships: [],
};

/** Las cajas de la imagen, con la posición que tienen dibujadas. */
const CLASSES: RawImageModel['classes'] = [
  { name: 'NOTAVENTA', attributes: [], position: { x: 0.13, y: 0.27 } },
  { name: 'PRODUCTO', attributes: [], position: { x: 0.55, y: 0.28 } },
  { name: 'DETALLE_VENTA', attributes: [], position: { x: 0.33, y: 0.59 } },
];

const MANY_TO_MANY: RawImageModel['relationships'][number] = {
  relationshipType: 'ASSOCIATION',
  sourceClass: 'NOTAVENTA',
  targetClass: 'PRODUCTO',
  sourceMultiplicity: '0..*',
  targetMultiplicity: '1..*',
  associationClass: null,
};

function toActions(model: RawImageModel): {
  actions: RawAction[];
  warnings: string[];
} {
  return service['toActions'](model, EMPTY_DIAGRAM);
}

/** Las asociaciones creadas, escritas como «ORIGEN 1 -> DESTINO 0..*». */
function links(actions: RawAction[]): string[] {
  return actions
    .filter((action) => action.action === 'CREATE_RELATIONSHIP')
    .map(
      (action) =>
        `${action.sourceClass} ${action.sourceMultiplicity} -> ${action.targetClasses.join(',')} ${action.targetMultiplicity}`,
    );
}

describe('CU05 — la caja que cuelga de una línea discontinua', () => {
  it('la une a las dos clases y no crea la línea directa', () => {
    const { actions, warnings } = toActions({
      classes: CLASSES,
      relationships: [{ ...MANY_TO_MANY, associationClass: 'DETALLE_VENTA' }],
      problems: [],
    });

    // Las mismas dos asociaciones que pone la herramienta del lienzo.
    expect(links(actions)).toEqual([
      'NOTAVENTA 1 -> DETALLE_VENTA 0..*',
      'PRODUCTO 1 -> DETALLE_VENTA 0..*',
    ]);
    expect(warnings.join(' ')).toContain('DETALLE_VENTA');
  });

  it('la reconoce por dónde está dibujada aunque el modelo pierda la línea', () => {
    // La línea discontinua es fina y se pierde al reducir la imagen: la caja
    // llega entonces sin ninguna relación, pero sigue estando entre las dos.
    const { actions } = toActions({
      classes: CLASSES,
      relationships: [MANY_TO_MANY],
      problems: [],
    });

    expect(links(actions)).toEqual([
      'NOTAVENTA 1 -> DETALLE_VENTA 0..*',
      'PRODUCTO 1 -> DETALLE_VENTA 0..*',
    ]);
  });

  it('no se inventa nada con una caja suelta que está en otra parte del dibujo', () => {
    const { actions } = toActions({
      classes: [
        ...CLASSES.slice(0, 2),
        { name: 'AUDITORIA', attributes: [], position: { x: 0.95, y: 0.95 } },
      ],
      relationships: [MANY_TO_MANY],
      problems: [],
    });

    expect(links(actions)).toEqual(['NOTAVENTA 0..* -> PRODUCTO 1..*']);
  });

  it('deja en paz una línea de uno a muchos: ahí no cuelga ninguna caja', () => {
    const { actions } = toActions({
      classes: CLASSES,
      relationships: [{ ...MANY_TO_MANY, sourceMultiplicity: '1' }],
      problems: [],
    });

    expect(links(actions)).toEqual(['NOTAVENTA 1 -> PRODUCTO 1..*']);
  });
});

/**
 * El diagrama entero de la nota de venta, con sus columnas.
 *
 * Es la imagen que se usa para comprobar CU05, transcrita como la devuelve el
 * modelo: las cinco cajas con sus atributos —incluido el «ID» de CATEGORIA, que
 * está dibujado— y las tres líneas. Existe porque la clave primaria implícita
 * se llevó por delante la lectura de la entidad intermedia: mientras se le pidió
 * al modelo que además se saltara la columna «id», dejó de reconocerla. Ahora se
 * transcribe el dibujo entero y el «id» lo descarta esta cadena, que no se
 * distrae.
 */
const NOTA_DE_VENTA: RawImageModel = {
  classes: [
    {
      name: 'NOTAVENTA',
      attributes: [
        { name: 'Nro', type: null },
        { name: 'Fecha', type: null },
        { name: 'Monto', type: null },
      ],
      position: { x: 0.13, y: 0.27 },
    },
    {
      name: 'PRODUCTO',
      attributes: [
        { name: 'codigo', type: null },
        { name: 'nombre', type: null },
        { name: 'precio', type: null },
        { name: 'stock', type: null },
      ],
      position: { x: 0.55, y: 0.28 },
    },
    {
      name: 'DETALLE_VENTA',
      attributes: [
        { name: 'Precio', type: null },
        { name: 'Cantidad', type: null },
      ],
      position: { x: 0.33, y: 0.59 },
    },
    {
      name: 'CLIENTE',
      attributes: [
        { name: 'CI', type: null },
        { name: 'Nombre', type: null },
        { name: 'Telefono', type: null },
      ],
      position: { x: 0.13, y: 0.82 },
    },
    {
      name: 'CATEGORIA',
      attributes: [
        { name: 'ID', type: null },
        { name: 'Nombre', type: null },
      ],
      position: { x: 0.88, y: 0.28 },
    },
  ],
  relationships: [
    { ...MANY_TO_MANY, associationClass: 'DETALLE_VENTA' },
    {
      relationshipType: 'ASSOCIATION',
      sourceClass: 'CLIENTE',
      targetClass: 'NOTAVENTA',
      sourceMultiplicity: '1',
      targetMultiplicity: '1..*',
      associationClass: null,
    },
    {
      relationshipType: 'ASSOCIATION',
      sourceClass: 'PRODUCTO',
      targetClass: 'CATEGORIA',
      sourceMultiplicity: '1..*',
      targetMultiplicity: '1..1',
      associationClass: null,
    },
  ],
  problems: [],
};

describe('CU05 — el diagrama de la nota de venta, de la imagen a las acciones', () => {
  const executor = new AiExecutorService(null as never, null as never);

  it('resuelve el muchos a muchos con la entidad intermedia y descarta el id', () => {
    const { actions } = toActions(NOTA_DE_VENTA);
    // La misma política que usa CU05: de una foto se lee lo que se lee.
    const plan = executor.plan(EMPTY_DIAGRAM, actions, 'keep-null');

    expect(plan.rejections).toEqual([]);

    const created = plan.steps.filter((step) => step.kind === 'CREATE_CLASS');
    expect(created.map((step) => step.name)).toEqual([
      'NOTAVENTA',
      'PRODUCTO',
      'DETALLE_VENTA',
      'CLIENTE',
      'CATEGORIA',
    ]);

    // DETALLE_VENTA cuelga de la línea NOTAVENTA—PRODUCTO: se une a las dos y
    // la línea directa no se crea, que es lo que dejaba un muchos a muchos sin
    // resolver y sin dónde guardar el precio y la cantidad.
    expect(links(actions)).toEqual([
      'NOTAVENTA 1 -> DETALLE_VENTA 0..*',
      'PRODUCTO 1 -> DETALLE_VENTA 0..*',
      'CLIENTE 1 -> NOTAVENTA 1..*',
      'PRODUCTO 1..* -> CATEGORIA 1..1',
    ]);

    // La columna «ID» dibujada en CATEGORIA no se guarda: su clave primaria la
    // pone la herramienta, y guardarla además daría dos columnas iguales.
    const categoria = created.find((step) => step.name === 'CATEGORIA')!;
    expect(categoria.attributes.map((attribute) => attribute.name)).toEqual(['Nombre']);
    expect(plan.warnings.join(' ')).toContain('«ID»');
  });
});
