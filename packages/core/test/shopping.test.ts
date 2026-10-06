import { describe, expect, it } from 'vitest';
import {
  aisleOf,
  groupByAisle,
  listByStore,
  matchStockItem,
  parseShopText,
  priceAlerts,
  routineItems,
  shopEntrySchema,
  stockItemSchema,
  stockMoveSchema,
} from '../src';

const item = (id: string, name: string, extra: object = {}) => stockItemSchema.parse({ id, name, ...extra });
const buy = (id: string, itemId: string, date: string, quantity: number, price: number | null = null, store = '') =>
  stockMoveSchema.parse({ id, itemId, date, kind: 'buy', quantity, price, store });
const entry = (id: string, name: string, itemId: string | null, quantity: number | null = 1) =>
  shopEntrySchema.parse({ id, name, itemId, quantity });

describe('lista del súper', () => {
  it('reconoce el sector por el nombre', () => {
    expect(aisleOf('Tomates perita')).toBe('verduleria');
    expect(aisleOf('Pan flauta')).toBe('panaderia');
    expect(aisleOf('Panceta')).toBe('fiambreria');
    expect(aisleOf('Dulce de leche')).toBe('lacteos');
    expect(aisleOf('Leche descremada')).toBe('lacteos');
    expect(aisleOf('Yogur de frutilla')).toBe('lacteos');
    expect(aisleOf('Papel higiénico')).toBe('higiene');
    expect(aisleOf('Pañales')).toBe('higiene');
    expect(aisleOf('Jabón en polvo')).toBe('limpieza');
    expect(aisleOf('Papas fritas')).toBe('almacen');
    expect(aisleOf('Papas')).toBe('verduleria');
    expect(aisleOf('Yerba')).toBe('almacen');
    expect(aisleOf('Cerveza')).toBe('bebidas');
    // Si no se reconoce, por dónde lo guardás.
    expect(aisleOf('Cosa rara', 'freezer')).toBe('congelados');
    expect(aisleOf('Cosa rara')).toBe('otros');
  });

  it('agrupa la lista en el orden del súper', () => {
    const groups = groupByAisle(
      [entry('1', 'Detergente', null), entry('2', 'Bananas', null), entry('3', 'Arroz', null), entry('4', 'Leche', null)],
      [],
    );
    expect(groups.map((g) => g.aisle)).toEqual(['verduleria', 'lacteos', 'almacen', 'limpieza']);
  });

  it('entiende cantidades al escribir', () => {
    expect(parseShopText('2 kg arroz')).toEqual({ name: 'arroz', quantity: 2, unit: 'kg' });
    expect(parseShopText('leche x3')).toEqual({ name: 'leche', quantity: 3, unit: '' });
    expect(parseShopText('1/2 kg de queso')).toEqual({ name: 'queso', quantity: 0.5, unit: 'kg' });
    expect(parseShopText('huevos 1 docena')).toEqual({ name: 'huevos', quantity: 12, unit: 'u.' });
    expect(parseShopText('velas de cumpleaños')).toEqual({ name: 'velas de cumpleaños', quantity: null, unit: '' });
  });

  it('encuentra el producto aunque lo escribas distinto', () => {
    const items = [item('l', 'Leche'), item('y', 'Yerba'), item('h', 'Huevo'), item('p', 'Papel higiénico')];
    expect(matchStockItem(items, 'leche')?.id).toBe('l');
    expect(matchStockItem(items, 'huevos')?.id).toBe('h');
    expect(matchStockItem(items, 'yer')?.id).toBe('y');
    expect(matchStockItem(items, 'lehce')?.id).toBe('l');
    expect(matchStockItem(items, 'papel higienico')?.id).toBe('p');
    expect(matchStockItem(items, 'velas')).toBeNull();
  });

  it('lo de siempre: compras con ritmo parejo', () => {
    const yerba = item('y', 'Yerba');
    const moves = [
      buy('a', 'y', '2026-08-01', 1),
      buy('b', 'y', '2026-08-15', 1),
      buy('c', 'y', '2026-08-30', 1),
      buy('d', 'y', '2026-09-14', 1),
    ];
    const [r] = routineItems([yerba], moves, '2026-09-27');
    expect(r).toMatchObject({ every: 15, last: '2026-09-14', next: '2026-09-29', due: true, usualQty: 1, times: 4 });
    expect(routineItems([yerba], moves, '2026-09-18')[0].due).toBe(false);
    // Irregular: no es "de siempre".
    const odd = [buy('a', 'y', '2026-01-01', 1), buy('b', 'y', '2026-01-04', 1), buy('c', 'y', '2026-03-20', 1)];
    expect(routineItems([yerba], odd, '2026-03-25')).toEqual([]);
  });

  it('dónde sale menos la lista y cuánto ahorrás dividiendo', () => {
    const moves = [
      buy('1', 'arroz', '2026-09-01', 1, 60, 'Disco'),
      buy('2', 'arroz', '2026-09-10', 1, 50, 'Tata'),
      buy('3', 'leche', '2026-09-01', 1, 40, 'Disco'),
      buy('4', 'leche', '2026-09-10', 1, 45, 'Tata'),
    ];
    const r = listByStore([entry('a', 'Arroz', 'arroz', 2), entry('b', 'Leche', 'leche', 3)], moves, '2026-10-01');
    expect(r.stores).toEqual(
      [
        { store: 'Disco', total: 240, covered: 2 },
        { store: 'Tata', total: 235, covered: 2 },
      ].sort((a, b) => a.total - b.total),
    );
    expect(r.best?.store).toBe('Tata');
    expect(r.split).toEqual([
      { store: 'Disco', items: ['Leche'], total: 120 },
      { store: 'Tata', items: ['Arroz'], total: 100 },
    ]);
    // En Tata la leche sale 45 (3 → 135) y en Disco 40 (120): 15 de ahorro.
    expect(r.splitSavings).toBe(15);
  });

  it('avisa lo que subió de precio y dónde estaba más barato', () => {
    const moves = [
      buy('1', 'y', '2026-07-01', 1, 200, 'Tata'),
      buy('2', 'y', '2026-08-01', 1, 210, 'Tata'),
      buy('3', 'y', '2026-09-20', 1, 260, 'Disco'),
    ];
    const [a] = priceAlerts([item('y', 'Yerba')], moves, '2026-10-01');
    expect(a).toMatchObject({ last: 260, before: 205, change: 27, store: 'Disco', cheaperAt: { store: 'Tata', unitPrice: 210 } });
    // Una suba chica no avisa.
    expect(priceAlerts([item('y', 'Yerba')], moves.slice(0, 2), '2026-10-01')).toEqual([]);
  });
});
