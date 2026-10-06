import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  autopilot,
  computeMonths,
  defaultSettings,
  fixedSchema,
  goalMonths,
  goalSchema,
  habitSchema,
  incomeSchema,
  monthPlanProposal,
  paceAlerts,
  reminderSchema,
  seedRecords,
  subjectSchema,
  toLiftyData,
  transactionSchema,
  weekPlan,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>, settings: Partial<LiftyData['settings']> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-07', ...settings } };
}
const tx = (id: string, date: string, amount: number, categoryId: string, extra = {}) =>
  transactionSchema.parse({ id, date, kind: 'expense', amount, categoryId, ...extra });

describe('plan del mes con un toque', () => {
  it('propone lo que gastás normalmente y achica si no alcanza', () => {
    const d = data({
      incomes: [incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 30000, netOverride: 30000, startMonth: '2026-07' })],
      fixed: [fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 15000, startMonth: '2026-07' })],
      transactions: [
        tx('s7', '2026-07-05', 9000, 'cat-super'),
        tx('s8', '2026-08-05', 10000, 'cat-super'),
        tx('s9', '2026-09-05', 11040, 'cat-super'),
        tx('o8', '2026-08-06', 4000, 'cat-ocio'),
        tx('o9', '2026-09-06', 6000, 'cat-ocio'),
        // Una sola vez: no entra en el plan.
        tx('x9', '2026-09-07', 5000, 'cat-salud'),
      ],
    });
    const months = computeMonths(d, '2026-07', '2026-10', '2026-10-02');
    const p = monthPlanProposal(d, months.slice(0, 3), months[3])!;
    // Súper: mediana 10.000; Ocio: mediana de (0, 4000, 6000) = 4000. Total 14.000 ≤ 15.000 libres.
    expect(p.lines.map((l) => [l.categoryId, l.suggested])).toEqual([
      ['cat-super', 10000],
      ['cat-ocio', 4000],
    ]);
    expect(p).toMatchObject({ income: 30000, fixed: 15000, assigned: 14000, free: 1000, scaled: false });

    // Con una meta de ahorro de 5.000 no alcanza: se achica todo en la misma proporción.
    const d2 = { ...d, settings: { ...d.settings, savingsMode: 'amount' as const, savingsValue: 5000 } };
    const m2 = computeMonths(d2, '2026-07', '2026-10', '2026-10-02');
    const p2 = monthPlanProposal(d2, m2.slice(0, 3), m2[3])!;
    expect(p2.scaled).toBe(true);
    expect(p2.assigned).toBeLessThanOrEqual(10000);
  });
});

describe('avisos de ritmo', () => {
  it('avisa cuando en una categoría vas mucho más rápido que de costumbre', () => {
    const d = data({
      transactions: [
        tx('a7', '2026-07-10', 3000, 'cat-ocio'),
        tx('a8', '2026-08-10', 3000, 'cat-ocio'),
        tx('a9', '2026-09-10', 3000, 'cat-ocio'),
        tx('b10', '2026-10-05', 2500, 'cat-ocio'),
        // Súper va normal.
        tx('s7', '2026-07-10', 9000, 'cat-super'),
        tx('s8', '2026-08-10', 9000, 'cat-super'),
        tx('s10', '2026-10-05', 3000, 'cat-super'),
      ],
    });
    const months = computeMonths(d, '2026-07', '2026-10', '2026-10-10');
    const a = paceAlerts(d, months.slice(0, 3), months[3], '2026-10-10');
    expect(a.map((x) => x.categoryId)).toEqual(['cat-ocio']);
    expect(a[0]).toMatchObject({ spent: 2500, usual: 3000, projected: 7750 });
  });
});

describe('metas que se ajustan solas', () => {
  it('si un mes pusiste menos, sube lo que hay que separar en los que quedan', () => {
    const goal = goalSchema.parse({
      id: 'viaje',
      name: 'Viaje',
      target: 12000,
      targetMonth: '2026-12',
      startMonth: '2026-07',
    });
    // Plan original: 12.000 en 6 meses = 2.000 por mes. Puso 2.000 en julio y nada más.
    const d = data({
      goals: [goal],
      transactions: [transactionSchema.parse({ id: 's', date: '2026-07-10', kind: 'saving', amount: 2000, goalId: 'viaje' })],
    });
    const [g] = goalMonths(d, '2026-10-05');
    expect(g).toMatchObject({ original: 2000, perMonth: round(10000 / 3), savedThisMonth: 0, adjusted: 'up', monthsLeft: 3 });
  });

  it('el piloto separa lo de cada meta cuando cobraste', () => {
    const d = data(
      {
        goals: [goalSchema.parse({ id: 'viaje', name: 'Viaje', target: 6000, targetMonth: '2026-12', startMonth: '2026-10' })],
        incomes: [incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 30000, netOverride: 30000, startMonth: '2026-07' })],
        transactions: [
          transactionSchema.parse({
            id: 'pay',
            date: '2026-10-01',
            kind: 'income',
            amount: 30000,
            linkKind: 'salary',
            linkId: 'job',
            linkMonth: '2026-10',
          }),
        ],
      },
      { autoSaveGoals: true },
    );
    const months = computeMonths(d, '2026-10', '2026-10', '2026-10-05');
    const actions = autopilot(d, months[0], '2026-10-05');
    expect(actions.map((a) => [a.key, a.records[0].record])).toEqual([
      ['goal:viaje:2026-10', expect.objectContaining({ kind: 'saving', amount: 2000, goalId: 'viaje', accountId: 'acc-brou' })],
    ]);
  });
});

describe('semana planificada', () => {
  it('junta pagos, cobros, vencimientos, exámenes y rutinas de los próximos 7 días', () => {
    const today = '2026-10-05';
    const d = data({
      incomes: [
        incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 30000, netOverride: 30000, startMonth: '2026-07', payDay: 8 }),
      ],
      fixed: [fixedSchema.parse({ id: 'ute', name: 'UTE', amount: 1800, startMonth: '2026-07', dayOfMonth: 10 })],
      reminders: [reminderSchema.parse({ id: 'r', name: 'Cédula', date: '2026-10-09' })],
      subjects: [subjectSchema.parse({ id: 'm', name: 'Mate', examDate: '2026-10-11', goalHours: 10 })],
      habits: [habitSchema.parse({ id: 'h', name: 'Gimnasio', days: [1, 3, 5] })],
    });
    const [b] = computeMonths(d, '2026-10', '2026-10', today);
    const w = weekPlan(d, b, today);
    expect(w.days).toHaveLength(7);
    const day = (date: string) => w.days.find((x) => x.date === date)!;
    expect(day('2026-10-08').items.map((i) => i.text)).toEqual(['Sueldo']);
    expect(day('2026-10-10').items.map((i) => i.text)).toEqual(['UTE']);
    expect(day('2026-10-09').items.map((i) => i.text)).toEqual(['Vence: Cédula']);
    expect(day('2026-10-11').items.map((i) => i.text)).toEqual(['Examen: Mate']);
    expect(w).toMatchObject({ payments: 1800, incomes: 30000 });
    // Lunes 5, miércoles 7 y viernes 9: gimnasio.
    expect(w.days.map((x) => x.habits)).toEqual([1, 0, 1, 0, 1, 0, 0]);
    expect(w.studyPerDay).toBe(100);
  });
});

function round(v: number) {
  return Math.round(v * 100) / 100;
}
