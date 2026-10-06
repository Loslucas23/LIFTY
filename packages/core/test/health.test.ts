import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyMutation,
  computeMonth,
  computeMonths,
  defaultSettings,
  financialHealth,
  habitLogSchema,
  habitSchema,
  incomeSchema,
  journalSchema,
  lifeBalance,
  seedRecords,
  toLiftyData,
  todayAgenda,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-07' } };
}

describe('salud financiera', () => {
  it('arma el puntaje con ahorro, colchón, presupuesto, deudas y orden', () => {
    const today = '2026-10-10';
    const tx = (id: string, date: string, kind: 'expense' | 'saving' | 'income', amount: number, extra = {}) =>
      transactionSchema.parse({ id, date, kind, amount, ...extra });
    // Sueldo de 40.000 y gasto de 30.000 por mes; ahorro 4.000 (10%).
    const transactions = ['2026-07', '2026-08', '2026-09'].flatMap((m) => [
      tx(`e-${m}`, `${m}-15`, 'expense', 30000, { accountId: 'acc-brou' }),
      tx(`s-${m}`, `${m}-16`, 'saving', 4000, { goalId: 'goal-uyu', accountId: 'acc-brou' }),
    ]);
    const d = data({
      incomes: [incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 40000, netOverride: 40000, startMonth: '2026-07' })],
      transactions,
    });
    const h = financialHealth(d, computeMonths(d, '2026-07', '2026-10', today), today)!;
    const part = (k: string) => h.parts.find((p) => p.key === k)!;
    expect(part('saving')).toMatchObject({ score: 50, value: '10% de lo que entra' });
    expect(part('budget')).toMatchObject({ score: 100, value: '3 de 3 meses' });
    expect(part('debt')).toMatchObject({ score: 100, value: 'Sin deudas' });
    // Gasta 30.000 por mes; ahorros fuera de las cuentas: 12.000 (las cuentas quedan en negativo, sin saldo real).
    expect(h.emergency.essentials).toBe(30000);
    expect(h.emergency.target).toBe(90000);
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThan(100);
    expect(part('saving').tip).toContain('$ 4.000');
  });

  it('sin meses con datos no da puntaje', () => {
    const d = data({});
    expect(financialHealth(d, computeMonths(d, '2026-07', '2026-10', '2026-10-10'), '2026-10-10')).toBeNull();
  });
});

describe('balance de vida', () => {
  it('promedia rutinas, sueño, ánimo y movimiento', () => {
    const today = '2026-10-30';
    const habits = [habitSchema.parse({ id: 'gym', name: 'Gimnasio', area: 'ejercicio', days: [1, 3, 5] })];
    const habitLogs = [];
    const journal = [];
    for (let i = 0; i < 30; i++) {
      const date = addDays(today, -i);
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      if ([1, 3, 5].includes(dow)) habitLogs.push(habitLogSchema.parse({ id: `gym:${date}`, habitId: 'gym', date, value: 1 }));
      journal.push(journalSchema.parse({ id: date, date, sleepHours: 7, mood: 5 }));
    }
    const l = lifeBalance(data({ habits, habitLogs, journal }), today)!;
    expect(l.parts.map((p) => [p.key, p.score])).toEqual([
      ['habits', 100],
      ['sleep', 100],
      ['mood', 100],
      ['move', 100],
    ]);
    expect(l.score).toBe(100);
    expect(lifeBalance(data({}), today)).toBeNull();
  });
});

describe('¿gastaste algo hoy?', () => {
  it('a la noche, si venís anotando, pregunta; si marcás que no gastaste, queda hecho', () => {
    const today = '2026-10-20';
    const d = data({
      transactions: [transactionSchema.parse({ id: 't', date: '2026-10-18', kind: 'expense', amount: 200 })],
    });
    const b = computeMonth(d, '2026-10', today);
    expect(todayAgenda(d, b, today, 10).items.some((i) => i.kind === 'checkin')).toBe(false);
    expect(todayAgenda(d, b, today, 20).items.find((i) => i.kind === 'checkin')).toMatchObject({ done: false });
    const marked = { ...d, journal: [journalSchema.parse({ id: today, date: today, noSpend: true })] };
    expect(todayAgenda(marked, b, today, 20).items.find((i) => i.kind === 'checkin')).toMatchObject({ done: true });
  });
});
