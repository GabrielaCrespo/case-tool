import { describe, expect, it } from 'vitest';
import { normalizeActionNames, toIdentifier } from './identifiers.js';
import type { RawAction } from './uml-actions.js';

describe('toIdentifier', () => {
  it('deja igual un nombre que ya es válido', () => {
    expect(toIdentifier('NotaVenta')).toBe('NotaVenta');
    expect(toIdentifier('nro_revista')).toBe('nro_revista');
  });

  it('cambia espacios, barras y guiones por _', () => {
    expect(toIdentifier('DETALLE DE VENTA')).toBe('DETALLE_DE_VENTA');
    expect(toIdentifier('DATETIME / UUID')).toBe('DATETIME_UUID');
    expect(toIdentifier('fecha-alta')).toBe('fecha_alta');
  });

  it('quita tildes y la ñ', () => {
    expect(toIdentifier('AÑO_PUBLIC')).toBe('ANO_PUBLIC');
    expect(toIdentifier('Categoría')).toBe('Categoria');
  });

  it('no deja que empiece por un dígito', () => {
    expect(toIdentifier('1er nombre')).toBe('_1er_nombre');
  });

  it('si no queda nada, devuelve el original', () => {
    expect(toIdentifier('???')).toBe('???');
  });
});

describe('normalizeActionNames', () => {
  it('renombra la clase y también las relaciones que la nombran', () => {
    const actions: RawAction[] = [
      {
        action: 'CREATE_CLASS',
        className: 'DETALLE DE VENTA',
        attributes: [{ name: 'CANTIDAD', type: null }],
        position: null,
      },
      {
        action: 'CREATE_CLASS',
        className: 'REVISTA',
        attributes: [{ name: 'AÑO_PUBLIC', type: null }],
        position: null,
      },
      {
        action: 'CREATE_RELATIONSHIP',
        relationshipType: 'ASSOCIATION',
        sourceClass: 'NOTAVENTA',
        targetClasses: ['DETALLE DE VENTA'],
        sourceMultiplicity: null,
        targetMultiplicity: null,
        name: 'tiene',
      },
    ];

    const { actions: fixed, warnings } = normalizeActionNames(actions);

    expect(fixed[0]).toMatchObject({ className: 'DETALLE_DE_VENTA' });
    expect(fixed[1]).toMatchObject({ attributes: [{ name: 'ANO_PUBLIC' }] });
    expect(fixed[2]).toMatchObject({
      sourceClass: 'NOTAVENTA',
      targetClasses: ['DETALLE_DE_VENTA'],
      name: 'tiene',
    });
    // Un aviso por nombre distinto, aunque aparezca en varias acciones.
    expect(warnings).toHaveLength(2);
  });
});
