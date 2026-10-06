import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  autoTagFor,
  computeMonths,
  defaultSettings,
  habitSchema,
  journalSchema,
  monthCalendar,
  periodSchema,
  periodStatus,
  reminderSchema,
  routinesPaused,
  seedRecords,
  toLiftyData,
  todayAgenda,
  transactionSchema,
  yearReview,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-01' } };
}
const spend = (id: string, date: string, amount: number, extra: object = {}) =>
  transactionSchema.parse({ id, date, kind: 'expense', amount, categoryId: 'cat-ocio', ...extra });

describe('vacaciones y mes difícil', () => {
  const trip = periodSchema.parse({
    id: 'v',
    kind: 'vacation',
    name: 'Floripa',
    from: '2026-10-10',
    to: '2026-10-19',
    budget: 30000,
    tag: 'floripa',
    pauseRoutines: true,
  });

  it('vacaciones: suma lo etiquetado (aunque sea de antes) y dice cuánto queda por día', () => {
    const d = data({
      periods: [trip],
      transactions: [
        spend('pasajes', '2026-09-01', 12000, { tags: ['Floripa'] }),
        spend('cena', '2026-10-12', 2000, { tags: ['floripa'] }),
        spend('otro', '2026-10-12', 500),
      ],
    });
    const s = periodStatus(trip, d, '2026-10-12');
    // 30.000 − 14.000 = 16.000; quedan 8 días contando hoy (y lo de hoy vuelve a la cuenta del día).
    expect(s).toMatchObject({
      state: 'active',
      days: 10,
      daysLeft: 8,
      spent: 14000,
      spentToday: 2000,
      remaining: 16000,
      perDay: 2250,
    });
    expect(autoTagFor(d, '2026-10-15')).toBe('floripa');
    expect(autoTagFor(d, '2026-10-25')).toBeNull();
    expect(routinesPaused(d, '2026-10-12')).toBe(true);
  });

  it('las rutinas no se piden en "Para hoy" durante las vacaciones', () => {
    const h = habitSchema.parse({ id: 'h', name: 'Gimnasio' });
    const d = data({ periods: [trip], habits: [h] });
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-12');
    expect(todayAgenda(d, b, '2026-10-12').items.some((i) => i.kind === 'habit')).toBe(false);
    expect(todayAgenda(d, b, '2026-10-22').items.some((i) => i.kind === 'habit')).toBe(true);
  });

  it('mes difícil: tope por día y días cumplidos', () => {
    const tight = periodSchema.parse({
      id: 't',
      kind: 'tight',
      name: 'Octubre',
      from: '2026-10-01',
      to: '2026-10-31',
      budget: 800,
    });
    const d = data({
      periods: [tight],
      transactions: [spend('a', '2026-10-01', 500), spend('b', '2026-10-02', 1200), spend('c', '2026-10-04', 300)],
    });
    expect(periodStatus(tight, d, '2026-10-04')).toMatchObject({
      state: 'active',
      underDays: 2,
      pastDays: 3,
      spentToday: 300,
      remaining: 500,
      perDay: 800,
    });
  });
});

describe('calendario de todo', () => {
  it('junta gastos, ánimo, vencimientos y vacaciones en cada día', () => {
    const d = data({
      periods: [periodSchema.parse({ id: 'v', kind: 'vacation', name: 'Floripa', from: '2026-10-10', to: '2026-10-12' })],
      transactions: [spend('a', '2026-10-03', 700), spend('b', '2026-10-03', 300)],
      journal: [journalSchema.parse({ id: '2026-10-03', date: '2026-10-03', mood: 4, sleepHours: 7 })],
      reminders: [reminderSchema.parse({ id: 'r', name: 'Cédula', date: '2026-10-20' })],
    });
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-15');
    const cal = monthCalendar(d, b, '2026-10-15');
    expect(cal).toHaveLength(31);
    expect(cal[2]).toMatchObject({ date: '2026-10-03', spent: 1000, movements: 2, mood: 4, sleep: 7 });
    expect(cal[9].items.some((i) => i.text === 'Empieza: Floripa')).toBe(true);
    expect(cal[10].periods.map((p) => p.id)).toEqual(['v']);
    expect(cal[19].items).toContainEqual({ icon: expect.any(String), text: 'Vence: Cédula', kind: 'reminder' });
  });
});

describe('tu año', () => {
  it('cuenta el año: gasto, categorías, días sin gastar y lo que más compraste', () => {
    const d = data({
      transactions: [
        transactionSchema.parse({ id: 'i', date: '2026-01-05', kind: 'income', amount: 50000, categoryId: 'cat-sueldo' }),
        spend('a', '2026-01-01', 300, { description: 'Café', categoryId: 'cat-comida' }),
        spend('b', '2026-01-02', 300, { description: 'cafe', categoryId: 'cat-comida' }),
        spend('c', '2026-01-06', 300, { description: 'Café', categoryId: 'cat-comida' }),
        spend('d', '2026-01-07', 9000, { description: 'Heladera', categoryId: 'cat-casa' }),
      ],
    });
    const months = computeMonths(d, '2026-01', '2026-12', '2026-01-10');
    const r = yearReview(d, months, 2026, '2026-01-10')!;
    expect(r.expenses).toBe(9900);
    expect(r.topCategories[0]).toMatchObject({ categoryId: 'cat-casa', amount: 9000 });
    expect(r.biggestExpense).toMatchObject({ description: 'Heladera', amount: 9000 });
    expect(r.favorite).toMatchObject({ description: 'Café', times: 3, total: 900 });
    // Del 1 al 9: gastó el 1, 2, 6 y 7 → 5 días sin gastar (3, 4, 5, 8, 9), racha de 3.
    expect(r.noSpendDays).toBe(5);
    expect(r.noSpendStreak).toBe(3);
    expect(yearReview(d, months, 2030, '2026-01-10')).toBeNull();
  });
});
