import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyMutation,
  cashFlow,
  computeMonth,
  computeMonths,
  defaultSettings,
  fixedSchema,
  habitLogSchema,
  habitSchema,
  incomeSchema,
  journalSchema,
  monthReview,
  moodFactors,
  seedRecords,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-09' } };
}

describe('qué te cambia el ánimo', () => {
  it('compara el ánimo los días que hacés algo contra los que no', () => {
    const today = '2026-10-20';
    const habit = habitSchema.parse({ id: 'gym', name: 'Gimnasio', area: 'ejercicio' });
    const journal = [];
    const habitLogs = [];
    const transactions = [];
    for (let i = 0; i < 12; i++) {
      const date = addDays(today, -i);
      const gym = i % 2 === 0;
      if (gym) habitLogs.push(habitLogSchema.parse({ id: `gym:${date}`, habitId: 'gym', date, value: 1 }));
      // Los días de gimnasio, ánimo 4; los demás, 2. Dormir no cambia nada (siempre 7 h).
      journal.push(journalSchema.parse({ id: date, date, sleepHours: 7, mood: gym ? 4 : 2 }));
      // Los días sin gimnasio, comida afuera.
      if (!gym)
        transactions.push(transactionSchema.parse({ id: `t${i}`, date, kind: 'expense', amount: 500, categoryId: 'cat-comida' }));
    }
    const f = moodFactors(data({ habits: [habit], habitLogs, journal, transactions }), today);
    expect(f.find((x) => x.key === 'habit:gym')).toMatchObject({ with: 4, without: 2, withDays: 6, withoutDays: 6, diff: 2 });
    expect(f.find((x) => x.key === 'cat:cat-comida')).toMatchObject({ diff: -2 });
    expect(f.find((x) => x.key === 'sleep')).toBeUndefined();
  });

  it('con pocos días no saca conclusiones', () => {
    const journal = [journalSchema.parse({ id: '2026-10-20', date: '2026-10-20', mood: 5 })];
    expect(moodFactors(data({ journal }), '2026-10-20')).toEqual([]);
  });
});

describe('¿llego a fin de mes?', () => {
  it('suma lo que falta cobrar, resta los fijos el día que vencen y avisa el punto más bajo', () => {
    const today = '2026-10-10';
    const d = data({
      incomes: [
        incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 30000, netOverride: 30000, startMonth: '2026-09', payDay: 28 }),
      ],
      fixed: [fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 15000, startMonth: '2026-09', dayOfMonth: 15 })],
      transactions: [
        // Lo que hay hoy en el BROU y lo gastado este mes (10 días × 300).
        transactionSchema.parse({
          id: 'in',
          date: '2026-10-01',
          kind: 'income',
          amount: 12000,
          accountId: 'acc-brou',
          categoryId: 'cat-extras',
        }),
        ...Array.from({ length: 9 }, (_, i) =>
          transactionSchema.parse({
            id: `e${i}`,
            date: addDays('2026-10-01', i),
            kind: 'expense',
            amount: 300,
            accountId: 'acc-brou',
          }),
        ),
      ],
    });
    const f = cashFlow(d, computeMonth(d, '2026-10', today), today)!;
    expect(f.start).toBe(12000 - 2700);
    // Ritmo del mes: 2700 en 10 días = 270 por día.
    expect(f.typicalPerDay).toBe(270);
    const day = (date: string) => f.days.find((x) => x.date === date)!;
    expect(day('2026-10-15').events).toEqual([{ label: 'Alquiler', amount: -15000 }]);
    expect(day('2026-10-28').events).toEqual([{ label: 'Sueldo', amount: 30000 }]);
    // Lo más bajo: el 27, antes de cobrar.
    expect(f.lowest.date).toBe('2026-10-27');
    expect(f.lowest.balance).toBeLessThan(0);
    expect(f.end).toBeGreaterThan(f.lowest.balance);
  });
});

describe('resumen del mes', () => {
  it('junta plata y vida, con lo que se destaca', () => {
    const today = '2026-11-02';
    const journal = Array.from({ length: 10 }, (_, i) =>
      journalSchema.parse({ id: `2026-10-${10 + i}`, date: `2026-10-${10 + i}`, sleepHours: 6, mood: 4 }),
    );
    const d = data({
      incomes: [incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 40000, netOverride: 40000, startMonth: '2026-09' })],
      transactions: [
        transactionSchema.parse({ id: 's1', date: '2026-09-10', kind: 'expense', amount: 10000, categoryId: 'cat-comida' }),
        transactionSchema.parse({ id: 'o1', date: '2026-10-10', kind: 'expense', amount: 8000, categoryId: 'cat-comida' }),
        transactionSchema.parse({ id: 'o2', date: '2026-10-12', kind: 'saving', amount: 6000, goalId: 'goal-uyu' }),
      ],
      journal,
    });
    d.categories = d.categories.map((c) => (c.id === 'cat-comida' ? { ...c, monthlyLimit: 6000 } : c));
    const [sep, oct] = computeMonths(d, '2026-09', '2026-10', today);
    const r = monthReview(d, oct, sep, today);
    expect(r.days).toBe(31);
    expect(r.money).toMatchObject({
      income: 40000,
      spent: 8000,
      saved: 6000,
      savingsRate: 0.15,
      prevSpent: 10000,
      changePct: -20,
    });
    expect(r.money.over).toEqual([{ categoryId: 'cat-comida', spent: 8000, limit: 6000 }]);
    expect(r.life).toMatchObject({ avgSleep: 6, avgMood: 4, journalDays: 10 });
    expect(r.highlights.map((h) => h.text)).toEqual([
      'Ahorraste 15% de lo que entró ($ 6.000).',
      'Gastaste 20% menos que en setiembre en el día a día.',
      'Te pasaste $ 2.000 en comida afuera.',
      expect.stringContaining('días sin gastar'),
      'Dormiste 6 h por noche en promedio.',
      'Tu ánimo promedio fue 4 de 5.',
    ]);
  });
});
