import { describe, expect, it } from 'vitest';
import {
  catalogFor,
  convertQty,
  ingredientLabel,
  ingredientUnits,
  mealSchema,
  mealUses,
  recipeSchema,
  recipeStatus,
  stockItemSchema,
  stockMoveSchema,
  stockOverview,
  weekMenu,
} from '../src';

const today = '2026-10-05'; // lunes
const item = (p: object) => stockItemSchema.parse(p);
const cebolla = item({ id: 'ceb', name: 'Cebolla', unit: 'kg', unitWeight: 150, shelfDays: 30 });
const tomate = item({ id: 'tom', name: 'Tomate', unit: 'kg', unitWeight: 150, shelfDays: 7 });
const carne = item({ id: 'car', name: 'Carne picada', unit: 'kg' });
const fideos = item({ id: 'fid', name: 'Fideos', unit: 'g', packSize: 500 });
const sal = item({ id: 'sal', name: 'Sal', unit: 'kg', staple: true });
const items = [cebolla, tomate, carne, fideos, sal];
const buy = (id: string, itemId: string, quantity: number, price: number, date = '2026-10-01') =>
  stockMoveSchema.parse({ id, itemId, date, kind: 'buy', quantity, price });
const moves = [
  buy('b1', 'ceb', 0.5, 40),
  buy('b2', 'car', 0.5, 200),
  buy('b3', 'fid', 500, 60),
  buy('b4', 'sal', 1, 30),
  buy('b5', 'tom', 1, 90, '2026-09-20'),
];
const tuco = recipeSchema.parse({
  id: 'r1',
  name: 'Fideos con tuco',
  servings: 2,
  ingredients: [
    { itemId: 'ceb', quantity: 2, unit: 'u' },
    { itemId: 'car', quantity: 300, unit: 'g' },
    { itemId: 'fid', quantity: 250 },
    { itemId: 'sal', quantity: 5, unit: 'g' },
  ],
});
const ensalada = recipeSchema.parse({
  id: 'r2',
  name: 'Ensalada',
  servings: 2,
  ingredients: [{ itemId: 'tom', quantity: 2, unit: 'u' }],
});

describe('productos a fondo', () => {
  it('catálogo: por el nombre sabe cuánto pesa una unidad y cuánto dura', () => {
    expect(catalogFor('cebollas')).toMatchObject({ unit: 'kg', unitWeight: 150, shelfDays: 30 });
    expect(catalogFor('Huevo colorado')).toMatchObject({ name: 'Huevos', unitWeight: 60, packSize: 12 });
    expect(catalogFor('Carne picada especial')?.name).toBe('Carne picada');
    expect(catalogFor('Detergente')).toBeNull();
  });

  it('unidades: 2 cebollas son 0,3 kg; litros no pasan a unidades', () => {
    expect(convertQty(2, 'u', 'kg', 150)).toBeCloseTo(0.3);
    expect(convertQty(300, 'g', 'kg', null)).toBeCloseTo(0.3);
    expect(convertQty(0.45, 'kg', 'u', 150)).toBeCloseTo(3);
    expect(convertQty(1, 'l', 'u', null)).toBeNull();
    expect(ingredientUnits(cebolla)).toEqual(['u', 'kg', 'g']);
    expect(ingredientLabel(tuco.ingredients[0], cebolla)).toBe('2 u. (≈300 g)');
  });

  it('una receta con "2 cebollas" se compara bien con el stock en kilos (y la sal se da por hecha)', () => {
    const { statuses } = stockOverview(items, moves, today, { shoppingDays: 7 });
    const s = recipeStatus(tuco, statuses);
    expect(s.canCook).toBe(true);
    // 0,3 kg × $80 + 0,3 kg × $400 + 250 g × $0,12 + 5 g de sal × $0,03.
    expect(s.cost).toBe(24 + 120 + 30 + 0.15);
    expect(mealUses(tuco, items, 4)).toEqual([
      { itemId: 'ceb', quantity: 0.6 },
      { itemId: 'car', quantity: 0.6 },
      { itemId: 'fid', quantity: 500 },
      { itemId: 'sal', quantity: 0.01 },
    ]);
  });
});

describe('menú de la semana', () => {
  it('suma lo de todas las comidas, compra lo que falta en unidades y dice cuánto sale', () => {
    const { statuses } = stockOverview(items, moves, today, { shoppingDays: 7 });
    const meals = [
      mealSchema.parse({ id: 'm1', date: '2026-10-05', slot: 'cena', recipeId: 'r1', servings: 2 }),
      mealSchema.parse({ id: 'm2', date: '2026-10-07', slot: 'cena', recipeId: 'r1', servings: 4 }),
      mealSchema.parse({ id: 'm3', date: '2026-10-09', slot: 'almuerzo', recipeId: 'r2', servings: 2 }),
    ];
    const w = weekMenu({ meals, recipes: [tuco, ensalada], stockItems: items }, statuses, '2026-10-05', '2026-10-11', today);
    const by = (id: string) => w.needs.find((n) => n.item.id === id)!;
    // Cebolla: 0,3 + 0,6 = 0,9 kg; hay 0,5: faltan 0,4 kg → 3 cebollas (0,45 kg).
    expect(by('ceb')).toMatchObject({ need: 0.9, have: 0.5, missing: 0.4, buyUnits: 3, buy: 0.45, leftover: 0.05, cost: 36 });
    // Fideos: 750 g, hay 500: faltan 250 → un paquete de 500 g (sobran 250).
    expect(by('fid')).toMatchObject({ missing: 250, buy: 500, leftover: 250 });
    // La sal se da por hecha.
    expect(by('sal')).toMatchObject({ missing: 0, buy: 0 });
    // Tomate: el que había ya se echó a perder (comprado el 20/9, dura 7 días)… igual se cuenta lo que hay.
    expect(by('tom').need).toBeCloseTo(0.3);
    expect(w.shopping.map((n) => n.item.id).sort()).toEqual(['car', 'ceb', 'fid']);
    expect(w.meals[0].cost).toBe(174.15);
    expect(w.meals[1].cost).toBe(348.3);
    expect(w.weekCost).toBe(174.15 + 348.3 + 27);
    expect(w.perMeal).toBe(round((174.15 + 348.3 + 27) / 3));
  });

  it('lo que se echa a perder antes de usarlo: comprarlo más cerca del día', () => {
    const { statuses } = stockOverview(items, [], today, { shoppingDays: 7 });
    const meals = [mealSchema.parse({ id: 'm', date: '2026-10-20', slot: 'cena', recipeId: 'r2', servings: 2 })];
    const w = weekMenu({ meals, recipes: [tuco, ensalada], stockItems: items }, statuses, '2026-10-05', '2026-10-25', today);
    expect(w.needs[0]).toMatchObject({ buyUnits: 2, buyLater: '2026-10-18' });
  });
});

const round = (v: number) => Math.round(v * 100) / 100;
