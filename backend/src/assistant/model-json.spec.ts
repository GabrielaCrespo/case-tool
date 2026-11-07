import { describe, expect, it } from 'vitest';
import { parseModelJson } from './model-json.js';

/**
 * CU12/CU15 — Lo que el modelo del chat escribe alrededor del JSON se recorta;
 * lo que no se puede leer se dice, para que el cliente pida la reparación.
 */
describe('parseModelJson', () => {
  it('lee un objeto limpio', () => {
    expect(parseModelJson('{"reply":"hola","actions":[]}')).toEqual({
      ok: true,
      value: { reply: 'hola', actions: [] },
    });
  });

  it('quita el bloque de código y el razonamiento', () => {
    const content = '<think>miro el diagrama</think>\n```json\n{"reply":"listo"}\n```';

    expect(parseModelJson(content)).toEqual({ ok: true, value: { reply: 'listo' } });
  });

  it('recorta hasta las llaves cuando hay una frase antes y otra después', () => {
    const content = 'Claro, aquí tienes: {"reply":"CLIENTE tiene 3 atributos"} Espero que sirva.';

    expect(parseModelJson(content)).toEqual({
      ok: true,
      value: { reply: 'CLIENTE tiene 3 atributos' },
    });
  });

  it('no inventa nada cuando el JSON está roto', () => {
    expect(parseModelJson('{reply: "sin comillas"')).toEqual({ ok: false });
  });

  it('una respuesta vacía no es JSON', () => {
    expect(parseModelJson('   ')).toEqual({ ok: false });
  });
});
