import type { RawAction, RawAttribute } from './uml-actions.js';

/**
 * CU04/CU05 — Nombres que trae la IA convertidos en identificadores válidos.
 *
 * La IA copia los nombres tal como los ve en la foto o los oye en el dictado:
 * «DETALLE DE VENTA», «AÑO_PUBLIC», «DATETIME / UUID». El modelo sólo admite
 * identificadores de Java (letras ASCII, dígitos y _), y basta con un nombre
 * así para que se rechace la importación entera. Se corrigen aquí, antes de
 * validar, y se le cuenta al usuario qué se renombró.
 *
 * Se normalizan también las referencias (clase origen y destino de una
 * relación, la clase a la que se añade un atributo…), con la misma regla, para
 * que «DETALLE DE VENTA» siga encontrando a la clase que se acaba de crear
 * como «DETALLE_DE_VENTA». Un nombre que ya era válido no cambia, así que las
 * referencias a clases que ya están en el diagrama se resuelven igual que antes.
 */
export function toIdentifier(value: string): string {
  const converted = value
    .trim()
    .normalize('NFD')
    // Tildes y la virgulilla de la ñ: «AÑO» → «ANO», «Categoría» → «Categoria».
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');

  if (converted === '') {
    // No queda nada aprovechable: se deja como estaba y la validación lo
    // rechaza con su mensaje de siempre.
    return value;
  }
  return /^[0-9]/.test(converted) ? `_${converted}` : converted;
}

/** Acciones con los nombres corregidos y los avisos de lo que se renombró. */
export function normalizeActionNames(actions: RawAction[]): {
  actions: RawAction[];
  warnings: string[];
} {
  const renamed = new Map<string, string>();

  const fix = (value: string): string => {
    const identifier = toIdentifier(value);
    if (identifier !== value) renamed.set(value, identifier);
    return identifier;
  };
  const fixNullable = <T extends string | null | undefined>(value: T): T =>
    (typeof value === 'string' ? fix(value) : value) as T;
  const fixAttributes = (attributes: RawAttribute[]): RawAttribute[] =>
    attributes.map((attribute) => ({ ...attribute, name: fix(attribute.name) }));

  const normalized = actions.map((action): RawAction => {
    switch (action.action) {
      case 'CREATE_CLASS':
        return {
          ...action,
          className: fix(action.className),
          attributes: fixAttributes(action.attributes),
        };
      case 'UPDATE_CLASS':
        return { ...action, className: fix(action.className), newName: fix(action.newName) };
      case 'DELETE_CLASS':
        return { ...action, className: fix(action.className) };
      case 'ADD_ATTRIBUTE':
        return {
          ...action,
          className: fix(action.className),
          attributes: fixAttributes(action.attributes),
        };
      case 'UPDATE_ATTRIBUTE':
        return {
          ...action,
          className: fix(action.className),
          attributeName: fix(action.attributeName),
          newName: fixNullable(action.newName),
        };
      case 'DELETE_ATTRIBUTE':
        return {
          ...action,
          className: fix(action.className),
          attributeName: fix(action.attributeName),
        };
      case 'CREATE_RELATIONSHIP':
        return {
          ...action,
          sourceClass: fix(action.sourceClass),
          targetClasses: action.targetClasses.map(fix),
        };
      case 'UPDATE_RELATIONSHIP':
      case 'DELETE_RELATIONSHIP':
        return {
          ...action,
          sourceClass: fix(action.sourceClass),
          targetClass: fix(action.targetClass),
        };
      case 'MOVE_CLASS':
        return {
          ...action,
          className: fix(action.className),
          reference:
            action.reference === null
              ? null
              : { ...action.reference, className: fix(action.reference.className) },
        };
    }
  });

  const warnings = [...renamed].map(
    ([original, identifier]) =>
      `«${original}» se renombró como «${identifier}»: los nombres sólo pueden tener letras sin tilde, dígitos y _.`,
  );

  return { actions: normalized, warnings };
}
