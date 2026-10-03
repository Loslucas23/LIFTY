import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  defaultSettings,
  fixedSchema,
  journalInsights,
  journalSchema,
  personalInflation,
  seedRecords,
  stockItemSchema,
  stockMoveSchema,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: defaultSettings() };
}

describe('diario', () => {
  it('compara lo que gastás los días que dormís poco con los demás', () => {
    const j = (date: string, sleepHours: number, mood: number) => journalSchema.parse({ id: date, date, sleepHours, mood });
    const tx = (date: string, amount: number) => transactionSchema.parse({ id: date, date, kind: 'expense', amount });
    const d = data({
      journal: [j('2026-10-01', 5, 2), j('2026-10-02', 8, 4), j('2026-10-03', 5, 3), j('2026-10-04', 8, 5)],
      transactions: [tx('2026-10-01', 1200), tx('2026-10-02', 600), tx('2026-10-03', 800), tx('2026-10-04', 400)],
    });
    const r = journalInsights(d, '2026-10-04');
    expect(r).toMatchObject({ days: 4, avgSleep: 6.5, avgMood: 3.5 });
    // Durmiendo < 6 h: (1200 + 800) / 2 = 1000; los demás (600 + 400) / 2 = 500 → +100%.
    expect(r.bySleep[0]).toMatchObject({ metric: 'gasto del día', bad: 1000, good: 500, diff: 100 });
    // Ánimo 1-2: solo el 1/10 (1200) contra el promedio de los otros (600).
    expect(r.byMood[0]).toMatchObject({ bad: 1200, good: 600, diff: 100 });
  });
});

describe('tu inflación', () => {
  it('pesa cada aumento por lo que gastás en eso', () => {
    let i = 0;
    const buy = (date: string, quantity: number, price: number) =>
      stockMoveSchema.parse({ id: `b${++i}`, updatedAt: String(i), itemId: 'arroz', date, kind: 'buy', quantity, price });
    const d = data({
      stockItems: [stockItemSchema.parse({ id: 'arroz', name: 'Arroz', unit: 'kg' })],
      // De $ 50 a $ 60 el kg (+20%); sin consumo anotado pesa lo gastado / 12 = (100 + 120) / 12.
      stockMoves: [buy('2026-01-10', 2, 100), buy('2026-09-10', 2, 120)],
      fixed: [
        fixedSchema.parse({ id: 'n1', name: 'Internet', amount: 1000, startMonth: '2025-06', endMonth: '2026-03' }),
        fixedSchema.parse({ id: 'n2', name: 'Internet', amount: 1100, startMonth: '2026-04' }),
      ],
    });
    const r = personalInflation(d, '2026-10-01');
    expect(r.items.map((x) => [x.name, x.change])).toEqual([
      ['Arroz', 20],
      ['Internet', 10],
    ]);
    // Pesos: arroz 18,33/mes, internet 1100/mes → casi todo internet.
    expect(r.total).toBeCloseTo((20 * 18.33 + 10 * 1100) / (18.33 + 1100), 1);
  });
});
