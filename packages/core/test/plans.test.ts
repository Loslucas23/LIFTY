import { describe, expect, it } from 'vitest';
import {
  affordability,
  applyMutation,
  defaultSettings,
  fixedSchema,
  incomeSchema,
  recipeSchema,
  recipeStatus,
  seedRecords,
  stockItemSchema,
  stockMoveSchema,
  stockStatus,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

describe('recetas', () => {
  it('dice cuántas veces la podés hacer, qué falta y cuánto sale por porción', () => {
    let i = 0;
    const mv = (itemId: string, quantity: number, price: number | null) =>
      stockMoveSchema.parse({ id: `m${++i}`, updatedAt: String(i), itemId, date: '2026-10-01', kind: 'buy', quantity, price });
    const fideos = stockItemSchema.parse({ id: 'f', name: 'Fideos', unit: 'paq' });
    const salsa = stockItemSchema.parse({ id: 's', name: 'Salsa', unit: 'u' });
    const moves = [mv('f', 3, 150), mv('s', 1, 80)];
    const st = [fideos, salsa].map((x) => stockStatus(x, moves, '2026-10-02', { shoppingDays: 7 }));
    const r = recipeSchema.parse({
      id: 'r',
      name: 'Fideos con salsa',
      servings: 2,
      ingredients: [
        { itemId: 'f', quantity: 1 },
        { itemId: 's', quantity: 1 },
      ],
    });
    const s = recipeStatus(r, st);
    expect(s).toMatchObject({ times: 1, canCook: true, cost: 130, perServing: 65 });
    const doble = recipeStatus(
      {
        ...r,
        ingredients: [
          { itemId: 'f', quantity: 1 },
          { itemId: 's', quantity: 2 },
        ],
      },
      st,
    );
    expect(doble.canCook).toBe(false);
    expect(doble.missing.map((m) => [m.itemId, m.need])).toEqual([['s', 1]]);
  });
});

describe('¿me lo puedo comprar?', () => {
  function data(partial: Partial<LiftyData>): LiftyData {
    const store: RecordStore = {};
    for (const { entity, record } of seedRecords())
      applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
    return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-01' } };
  }
  it('compara lo libre de cada mes con la cuota', () => {
    const d = data({
      incomes: [
        incomeSchema.parse({
          id: 'job',
          name: 'Trabajo',
          gross: 40000,
          netOverride: 40000,
          startMonth: '2026-01',
          aguinaldo: false,
        }),
      ],
      fixed: [fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 20000, startMonth: '2026-01' })],
      // Gastos del día a día: 15000 por mes en julio, agosto y setiembre.
      transactions: ['2026-07-10', '2026-08-10', '2026-09-10'].map((date) =>
        transactionSchema.parse({ id: date, date, kind: 'expense', amount: 15000 }),
      ),
    });
    const a = affordability(d, '2026-10-02', { amount: 12000, installments: 3 });
    expect(a.avgSpending).toBe(15000);
    // Libre por mes: 40000 − 20000 − 15000 = 5000; cuota 4000 → te queda 1000.
    expect(a.months[0]).toEqual({ month: '2026-10', before: 5000, installment: 4000, after: 1000 });
    expect(a.ok).toBe(true);
    expect(a.monthsToSave).toBe(3);
    const caro = affordability(d, '2026-10-02', { amount: 18000, installments: 3 });
    expect(caro.ok).toBe(false);
    expect(caro.firstShort?.month).toBe('2026-10');
  });
});
