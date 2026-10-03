import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  defaultSettings,
  fixedSchema,
  nextReminderDate,
  recurringSummary,
  reminderSchema,
  reminderStatus,
  seedRecords,
  toLiftyData,
  transactionSchema,
  weekStart,
  weekSummary,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), usdRate: 40 } };
}

describe('suscripciones y gastos que se repiten', () => {
  it('suma por mes y por año (los anuales /12) y muestra los aumentos', () => {
    const d = data({
      fixed: [
        fixedSchema.parse({
          id: 'n1',
          name: 'Netflix',
          amount: 400,
          startMonth: '2026-01',
          endMonth: '2026-05',
          categoryId: 'cat-suscripciones',
        }),
        fixedSchema.parse({ id: 'n2', name: 'Netflix', amount: 460, startMonth: '2026-06', categoryId: 'cat-suscripciones' }),
        fixedSchema.parse({ id: 'p', name: 'Patente', amount: 12000, startMonth: '2026-03', everyMonths: 12 }),
        fixedSchema.parse({
          id: 's',
          name: 'Spotify',
          amount: 5,
          currency: 'USD',
          startMonth: '2026-01',
          categoryId: 'cat-suscripciones',
        }),
      ],
    });
    const r = recurringSummary(d, '2026-10');
    expect(r.items.map((i) => [i.fixed.name, i.monthly])).toEqual([
      ['Patente', 1000],
      ['Netflix', 460],
      ['Spotify', 200],
    ]);
    expect(r.monthly).toBe(1660);
    expect(r.yearly).toBe(19920);
    expect(r.subscriptions).toEqual({ count: 2, monthly: 660 });
    expect(r.items[1].changes).toEqual([{ month: '2026-06', from: 400, to: 460, pct: 15 }]);
    expect(r.items[1].totalIncrease).toBe(15);
  });
});

describe('vencimientos', () => {
  it('avisa con anticipación y calcula la próxima renovación', () => {
    const cedula = reminderSchema.parse({ id: 'c', name: 'Cédula', date: '2026-11-05', repeatMonths: 120, notifyDays: 60 });
    expect(reminderStatus(cedula, '2026-10-11')).toMatchObject({ daysLeft: 25, status: 'soon' });
    expect(reminderStatus(cedula, '2026-08-01').status).toBe('ok');
    expect(reminderStatus(cedula, '2026-11-06').status).toBe('overdue');
    expect(nextReminderDate(cedula)).toBe('2036-11-05');
    const seguro = reminderSchema.parse({ id: 's', name: 'Seguro', date: '2026-01-31', repeatMonths: 1 });
    expect(nextReminderDate(seguro)).toBe('2026-02-28');
  });
});

describe('resumen semanal', () => {
  it('junta lo gastado de la semana y lo compara con la anterior', () => {
    const tx = (date: string, amount: number, kind = 'expense') =>
      transactionSchema.parse({
        id: `${date}-${amount}`,
        date,
        kind,
        amount,
        categoryId: kind === 'expense' ? 'cat-comida' : null,
      });
    const d = data({
      transactions: [tx('2026-10-05', 500), tx('2026-10-07', 300), tx('2026-10-08', 1000, 'saving'), tx('2026-09-30', 400)],
    });
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    const w = weekSummary(d, '2026-10-05', '2026-10-11');
    expect(w).toMatchObject({ spent: 800, prevSpent: 400, saved: 1000, days: 7, noSpendDays: 5 });
    expect(w.topCategories).toEqual([{ categoryId: 'cat-comida', amount: 800 }]);
  });
});

describe('dónde conviene comprar', () => {
  it('compara el último precio por súper y calcula el ahorro', async () => {
    const { stockItemSchema, stockMoveSchema, storePrices } = await import('../src');
    let i = 0;
    const mv = (m: Record<string, unknown>) =>
      stockMoveSchema.parse({ id: `m${++i}`, updatedAt: String(i).padStart(3, '0'), itemId: 'arroz', ...m });
    const arroz = stockItemSchema.parse({ id: 'arroz', name: 'Arroz', unit: 'kg' });
    const moves = [
      mv({ date: '2026-09-01', kind: 'buy', quantity: 2, price: 120, store: 'Disco' }),
      mv({ date: '2026-09-15', kind: 'buy', quantity: 2, price: 100, store: 'Tata' }),
      mv({ date: '2026-10-01', kind: 'count', quantity: 1 }),
    ];
    const r = storePrices([arroz], moves, '2026-10-01', { shoppingDays: 7 });
    expect(r.items[0].prices.map((p) => [p.store, p.unitPrice])).toEqual([
      ['Tata', 50],
      ['Disco', 60],
    ]);
    expect(r.items[0]).toMatchObject({ best: 'Tata', spread: 20 });
    // Usaste 3 kg en 30 días: en Tata saldría $ 150 por mes, en Disco $ 180.
    expect(r.basket).toEqual([
      { store: 'Tata', total: 150, items: 1 },
      { store: 'Disco', total: 180, items: 1 },
    ]);
    // Promedio $ 55 el kg; en Tata $ 50: ahorrás $ 5 × 3 kg = $ 15 por mes.
    expect(r.monthlySavings).toBe(15);
  });
});

describe('metas del año', () => {
  it('mide el avance contra lo esperado a esta altura del año', async () => {
    const { yearGoalSchema, yearGoalStatus, weightSchema } = await import('../src');
    const d = data({
      transactions: [transactionSchema.parse({ id: 'a', date: '2026-03-01', kind: 'saving', amount: 30000 })],
      weights: [
        weightSchema.parse({ id: 'w1', date: '2026-01-05', kg: 85 }),
        weightSchema.parse({ id: 'w2', date: '2026-06-30', kg: 80 }),
      ],
    });
    // 30 de junio: pasó la mitad del año (181 de 365 días).
    const ahorro = yearGoalStatus(
      yearGoalSchema.parse({ id: 'g1', name: 'Ahorrar', year: 2026, kind: 'savings', target: 60000 }),
      d,
      '2026-06-30',
    );
    expect(ahorro).toMatchObject({ current: 30000, progress: 0.5, status: 'on-track', needed: '$ 4.286 por mes' }); // 30000 ÷ 7 meses (de junio a diciembre)
    const peso = yearGoalStatus(
      yearGoalSchema.parse({ id: 'g2', name: 'Bajar', year: 2026, kind: 'weight', target: 75 }),
      d,
      '2026-06-30',
    );
    // De 85 a 75: bajó 5 de 10 → 50%.
    expect(peso).toMatchObject({ current: 80, progress: 0.5, status: 'on-track' });
  });
});
