/**
 * CU12/CU15 — Recupera el objeto JSON de lo que escribió el modelo del chat.
 *
 * Es la misma lógica que `GroqService.toJson` usa para CU04 y CU05, replicada
 * aquí porque allí es privada y ese archivo no se toca. La razón es la misma:
 * aunque se le pida sólo JSON, un modelo a veces envuelve el objeto en un
 * bloque de código, añade una frase antes o deja un bloque de razonamiento.
 * Recortar hasta las llaves exteriores recupera esos casos.
 *
 * A diferencia de aquélla, no lanza: quien la llama decide si pide al modelo
 * que repare su respuesta (ChatLlmClient.completeJson) o si se rinde.
 */
export type ModelJson = { ok: true; value: unknown } | { ok: false };

export function parseModelJson(content: string): ModelJson {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  for (const candidate of [cleaned, betweenBraces(cleaned)]) {
    if (candidate === null || candidate.length === 0) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      continue;
    }
  }

  return { ok: false };
}

function betweenBraces(content: string): string | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}
