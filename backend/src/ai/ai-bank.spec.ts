// Los demás tests no leen el .env porque no lo necesitan; éste sí, porque
// llama a la API de verdad y necesita la clave.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { AiExecutorService } from './ai-executor.service.js';
import { AiService } from './ai.service.js';
import { GroqService } from './groq.service.js';
import { diagramContext, imageSystemPrompt, interpretSystemPrompt } from './prompts.js';
import { parseActions, parseImageModel } from './uml-actions.js';

/**
 * CU04/CU05 — El banco de pruebas del modelo.
 *
 * Esto no es un test del código: es la comprobación de que **el modelo** sigue
 * leyendo bien. Llama a Groq de verdad, así que cuesta dinero, necesita
 * conexión y no da siempre el mismo resultado. Por eso no corre con los demás:
 *
 *   AI_BANK=1 npx vitest run src/ai/ai-bank.spec.ts
 *
 * Hay que pasarlo en dos momentos: al cambiar cualquiera de los prompts y al
 * cambiar de modelo. La razón de que exista está documentada: al pedirle al
 * lector de imágenes que además se saltara la columna «id», dejó de reconocer
 * la entidad intermedia de este mismo diagrama, y eso no lo detecta ningún test
 * automático porque la cadena que va después estaba —y sigue— correcta.
 *
 * Para añadir un caso nuevo: la imagen en test/fixtures/diagrams/ y lo que
 * debería leerse de ella aquí abajo. Cuantos más casos, más fiable es la
 * comparación el día que haya que cambiar de modelo otra vez.
 */

const enabled = process.env.AI_BANK === '1';

const groq = new GroqService();
const executor = new AiExecutorService(null as never, null as never);
const service = new AiService(null as never, null as never, null as never);

const EMPTY_DIAGRAM: FullDiagramResponse = {
  id: '00000000-0000-0000-0000-000000000001',
  project_id: '00000000-0000-0000-0000-000000000002',
  name: 'Banco de pruebas',
  description: null,
  created_by: '00000000-0000-0000-0000-000000000003',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  classes: [],
  relationships: [],
};

/**
 * La imagen como URL de datos, que es exactamente como viaja en producción:
 * dentro de la petición, codificada, sin guardarse en ninguna parte.
 */
function dataUri(name: string): string {
  const bytes = readFileSync(`test/fixtures/diagrams/${name}`);

  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Lo que se leyó, escrito como «ORIGEN mult -> DESTINO mult». */
function links(actions: ReturnType<typeof parseActions>['actions']): string[] {
  return actions
    .filter((action) => action.action === 'CREATE_RELATIONSHIP')
    .map(
      (action) =>
        `${action.sourceClass} ${action.sourceMultiplicity} -> ${action.targetClasses.join(',')} ${action.targetMultiplicity}`,
    );
}

describe.skipIf(!enabled)('CU05 — el banco de imágenes', () => {
  it(
    'nota-venta.png: lee las cinco cajas y resuelve el muchos a muchos',
    { timeout: 180_000 },
    async () => {
      const started = Date.now();
      const raw = await groq.askJson(
        imageSystemPrompt(),
        'Transcribe este diagrama de clases.',
        dataUri('nota-venta.png'),
      );
      const seconds = (Date.now() - started) / 1000;
      const model = parseImageModel(raw);

      console.info(`[banco] nota-venta.png leída en ${seconds.toFixed(1)} s`);
      console.info(`[banco] clases: ${model.classes.map((c) => c.name).join(', ')}`);

      // Las cinco cajas del dibujo, con el nombre tal como está escrito.
      expect(model.classes.map((umlClass) => umlClass.name).sort()).toEqual([
        'CATEGORIA',
        'CLIENTE',
        'DETALLE_VENTA',
        'NOTAVENTA',
        'PRODUCTO',
      ]);

      const { actions } = service['toActions'](model, EMPTY_DIAGRAM);
      const plan = executor.plan(EMPTY_DIAGRAM, actions, 'keep-null');

      console.info(`[banco] relaciones: ${links(actions).join(' | ')}`);
      expect(plan.rejections).toEqual([]);

      // Lo que costó la regresión: DETALLE_VENTA cuelga de la línea entre
      // NOTAVENTA y PRODUCTO, así que se une a las dos y la línea directa entre
      // ellas no se crea. Si esto falla, el modelo no está leyendo la entidad
      // intermedia y no hay que seguir adelante con él.
      expect(links(actions)).toContain('NOTAVENTA 1 -> DETALLE_VENTA 0..*');
      expect(links(actions)).toContain('PRODUCTO 1 -> DETALLE_VENTA 0..*');
      expect(links(actions).join(' ')).not.toContain('NOTAVENTA 0..* -> PRODUCTO');

      /*
       * Y las otras dos líneas del dibujo, que son de uno a muchos.
       *
       * Se comprueban en cualquiera de los dos sentidos a propósito. Una
       * asociación no tiene dirección: el modelo puede leer la línea empezando
       * por CLIENTE («CLIENTE 1 — NOTAVENTA 1..*») o por NOTAVENTA
       * («NOTAVENTA 1..* — CLIENTE 1»), y las dos dicen lo mismo. Exigir un
       * sentido concreto sería suspender al modelo por algo que el dibujo no
       * decide, y además la clave foránea acaba en el mismo sitio.
       */
      const une = (a: string, b: string): boolean =>
        links(actions).some(
          (link) => link === `${a} -> ${b}` || link === `${b} -> ${a}`,
        );

      expect(une('CLIENTE 1', 'NOTAVENTA 1..*')).toBe(true);
      expect(
        links(actions).some(
          (link) => link.includes('PRODUCTO') && link.includes('CATEGORIA'),
        ),
      ).toBe(true);

      // La columna «ID» de CATEGORIA está dibujada y no se guarda: la clave
      // primaria la pone la herramienta.
      const categoria = plan.steps.find(
        (step) => step.kind === 'CREATE_CLASS' && step.name === 'CATEGORIA',
      );
      expect(categoria?.kind === 'CREATE_CLASS' && categoria.attributes.map((a) => a.name)).toEqual(
        ['Nombre'],
      );
    },
  );
});

/**
 * Las instrucciones escritas. La de la herencia está a propósito: es el único
 * punto del prompt donde «origen» y «destino» no significan lo obvio, y es lo
 * primero que se rompe al cambiar de modelo.
 */
const INSTRUCCIONES: { orden: string; espera: string }[] = [
  // Producto, y no Cliente: el diagrama de abajo ya tiene Cliente, y pedirle
  // que lo cree otra vez es una instrucción que el modelo debe rechazar. Es lo
  // que hizo la primera vez que se pasó el banco, con razón.
  { orden: 'Crea la entidad Producto con nombre y precio', espera: 'CREATE_CLASS Producto' },
  { orden: 'Agrega el atributo telefono de tipo String a Cliente', espera: 'ADD_ATTRIBUTE' },
  {
    orden: 'Un Cliente puede tener muchos Pedidos y cada Pedido es de un solo Cliente',
    espera: 'CREATE_RELATIONSHIP Cliente -> Pedido',
  },
  { orden: 'Haz que Cliente herede de Usuario', espera: 'INHERITANCE Usuario -> Cliente' },
  { orden: 'Mueve Pedido debajo de Cliente', espera: 'MOVE_CLASS Pedido' },
];

describe.skipIf(!enabled)('CU04 — el banco de instrucciones', () => {
  const diagram: FullDiagramResponse = {
    ...EMPTY_DIAGRAM,
    classes: ['Cliente', 'Pedido', 'Usuario'].map((name, index) => ({
      id: `c${index}`,
      diagram_id: EMPTY_DIAGRAM.id,
      name,
      stereotype: null,
      is_abstract: false,
      visibility: 'public',
      pos_x: index * 300,
      pos_y: 0,
      width: null,
      height: null,
      created_at: EMPTY_DIAGRAM.created_at,
      updated_at: EMPTY_DIAGRAM.updated_at,
      attributes: [],
      methods: [],
    })),
  };

  for (const caso of INSTRUCCIONES) {
    it(`«${caso.orden}» → ${caso.espera}`, { timeout: 120_000 }, async () => {
      const started = Date.now();
      const raw = await groq.askJson(
        interpretSystemPrompt(),
        `${diagramContext(diagram)}\n\nInstrucción del usuario:\n${caso.orden}`,
      );
      const seconds = (Date.now() - started) / 1000;
      const parsed = parseActions(raw);

      console.info(
        `[banco] ${seconds.toFixed(1)} s — ${JSON.stringify(parsed.actions)} ${parsed.error ?? ''}`,
      );

      // No se comprueba el detalle de cada acción, que depende de cómo redacte
      // el modelo: se comprueba que entendió algo ejecutable y que el ejecutor
      // lo acepta. El detalle se lee en la salida de arriba.
      expect(parsed.error).toBeNull();
      expect(parsed.problems).toEqual([]);
      expect(parsed.actions.length).toBeGreaterThan(0);

      const plan = executor.plan(diagram, parsed.actions, 'reject');
      expect(plan.rejections).toEqual([]);
      expect(plan.steps.length).toBeGreaterThan(0);
      console.info(`[banco] pasos: ${plan.steps.map((step) => step.description).join(' | ')}`);
    });
  }
});
