import { describe, expect, it } from 'vitest';
import {
  activeInstallmentPlans,
  addMonths,
  aguinaldoFor,
  applyMutation,
  budgetId,
  computeMonth,
  computeMonths,
  defaultSettings,
  goalBalances,
  incomeSchema,
  installmentsOf,
  monthRange,
  netBreakdown,
  parseEntity,
  seedRecords,
  toLiftyData,
  transactionSchema,
  URUGUAY_DEDUCTIONS,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords()) {
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  }
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), ...(partial.settings ?? {}) } };
}

const tx = (t: Record<string, unknown>) => transactionSchema.parse({ id: Math.random().toString(36).slice(2), ...t });
const income = (t: Record<string, unknown>) => incomeSchema.parse({ id: Math.random().toString(36).slice(2), ...t });

describe('meses', () => {
  it('suma meses cruzando años', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('sueldo', () => {
  it('calcula el líquido con los descuentos de Uruguay como en la planilla', () => {
    const b = netBreakdown({
      gross: 48000,
      netOverride: null,
      deductions: [...URUGUAY_DEDUCTIONS.slice(0, 4), { label: 'IRPF', percent: 0, extraBase: 0, fixed: 240 }],
    });
    // 15% + 3% + 0,1% + 1,5% de 48000 + 240 de IRPF
    expect(b.totalDeductions).toBeCloseTo(7200 + 1440 + 48 + 720 + 240, 2);
    expect(b.net).toBeCloseTo(48000 - 9648, 2);
  });

  it('respeta el líquido manual', () => {
    expect(netBreakdown({ gross: 38000, netOverride: 31000, deductions: URUGUAY_DEDUCTIONS }).net).toBe(31000);
  });

  it('aguinaldo: 1/12 del semestre en junio y diciembre', () => {
    const src = income({ name: 'Trabajo', gross: 12000, netOverride: 12000, startMonth: '2025-01' });
    expect(aguinaldoFor(src, '2026-06')?.amount).toBe(6000);
    expect(aguinaldoFor(src, '2026-12')?.amount).toBe(6000);
    expect(aguinaldoFor(src, '2026-07')).toBeNull();
  });

  it('aguinaldo proporcional cuando el trabajo arranca a mitad del semestre', () => {
    const src = income({ name: 'Nuevo', gross: 12000, netOverride: 12000, startMonth: '2026-05' });
    expect(aguinaldoFor(src, '2026-06')?.amount).toBe(1000);
  });

  it('aguinaldo de liquidación en el mes en que termina', () => {
    const src = income({ name: 'Viejo', gross: 12000, netOverride: 12000, startMonth: '2026-01', endMonth: '2026-04' });
    // dic-2025 no trabajó; ene-abr = 4 meses
    expect(aguinaldoFor(src, '2026-04')).toMatchObject({ amount: 4000, settlement: true });
    expect(aguinaldoFor(src, '2026-06')).toBeNull();
  });

  it('sin aguinaldo si no corresponde', () => {
    const src = income({ name: 'BPS', gross: 30000, startMonth: '2026-10', aguinaldo: false });
    expect(aguinaldoFor(src, '2026-12')).toBeNull();
  });
});

describe('cuotas', () => {
  it('reparte el total y la última cuota absorbe el redondeo', () => {
    const inst = installmentsOf({ amount: 100, date: '2026-03-03', installments: 3, firstInstallmentMonth: null });
    expect(inst.map((i) => i.month)).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(inst.map((i) => i.amount)).toEqual([33.33, 33.33, 33.34]);
  });
});

describe('presupuesto mensual', () => {
  const base = () =>
    data({
      settings: { ...defaultSettings(), usdRate: 40, startMonth: '2026-01', startBalance: 0 },
      incomes: [
        income({ id: 'job', name: 'Trabajo', gross: 30000, netOverride: 30000, startMonth: '2026-01', aguinaldo: false }),
      ],
      fixed: [
        {
          id: 'rent',
          updatedAt: '',
          name: 'Alquiler',
          amount: 16000,
          currency: 'UYU',
          categoryId: 'cat-casa',
          accountId: null,
          dayOfMonth: 1,
          startMonth: '2026-01',
          endMonth: null,
          everyMonths: 1,
          archived: false,
        },
        {
          id: 'gym',
          updatedAt: '',
          name: 'Gimnasio',
          amount: 1600,
          currency: 'UYU',
          categoryId: 'cat-salud',
          accountId: null,
          dayOfMonth: 10,
          startMonth: '2026-01',
          endMonth: '2026-01',
          everyMonths: 1,
          archived: false,
        },
      ],
      transactions: [
        tx({ date: '2026-01-15', kind: 'income', amount: 9000, categoryId: 'cat-regalos', description: 'Cumpleaños' }),
        tx({ date: '2026-01-16', kind: 'expense', amount: 326, categoryId: 'cat-comida' }),
        tx({ date: '2026-01-31', kind: 'saving', amount: 1000, goalId: 'goal-uyu' }),
        tx({
          date: '2026-01-05',
          kind: 'expense',
          amount: 3.49 * 3,
          currency: 'USD',
          fxRate: 40,
          accountId: 'acc-tarjeta',
          installments: 3,
          categoryId: 'cat-suscripciones',
        }),
      ],
    });

  it('suma ingresos, gastos fijos, variables, tarjeta y ahorro', () => {
    const b = computeMonth(base(), '2026-01', '2026-01-20');
    expect(b.income.total).toBe(39000);
    expect(b.fixed.total).toBe(17600);
    expect(b.variable.total).toBe(326);
    expect(b.card.total).toBeCloseTo(139.6, 2);
    expect(b.savings.total).toBe(1000);
    expect(b.result).toBeCloseTo(39000 - 17600 - 326 - 139.6 - 1000, 2);
    expect(b.daily).toMatchObject({ day: 20, daysLeft: 12 });
  });

  it('arrastra el saldo proyectado, o el real si el mes está cerrado', () => {
    const d = base();
    const [jan, feb] = computeMonths(d, '2026-01', '2026-02', '2026-02-01');
    expect(feb.carryover).toMatchObject({ amount: jan.result, source: 'projected', fromMonth: '2026-01' });
    expect(feb.fixed.total).toBe(16000); // el gimnasio terminó en enero
    expect(feb.card.total).toBeCloseTo(139.6, 2); // cuota 2 de 3

    d.closings = [{ id: '2026-01', updatedAt: '', realBalance: 20500.5, note: '' }];
    const feb2 = computeMonth(d, '2026-02', '2026-02-01');
    expect(feb2.carryover).toMatchObject({ amount: 20500.5, source: 'real' });
  });

  it('confirmar un sueldo o un fijo reemplaza lo planificado (sin contarlo dos veces)', () => {
    const d = base();
    d.transactions.push(
      tx({
        date: '2026-01-01',
        kind: 'expense',
        amount: 16500,
        linkKind: 'fixed',
        linkId: 'rent',
        linkMonth: '2026-01',
        categoryId: 'cat-casa',
      }),
      tx({ date: '2026-01-02', kind: 'income', amount: 29800, linkKind: 'salary', linkId: 'job', linkMonth: '2026-01' }),
    );
    const b = computeMonth(d, '2026-01', '2026-01-20');
    const rent = b.fixed.items.find((l) => l.refId === 'rent')!;
    expect(rent).toMatchObject({ confirmed: true, planned: 16000, actual: 16500, amount: 16500 });
    expect(b.fixed.total).toBe(16500 + 1600);
    expect(b.fixed.pending).toBe(1600);
    expect(b.income.total).toBe(29800 + 9000);
    expect(b.variable.items).toHaveLength(1);
  });

  it('reporta gasto por categoría con presupuesto (los fijos van aparte)', () => {
    const d = base();
    d.categories = d.categories.map((c) => (c.id === 'cat-comida' ? { ...c, monthlyLimit: 3000 } : c));
    const b = computeMonth(d, '2026-01', '2026-01-20');
    expect(b.categories.find((c) => c.categoryId === 'cat-comida')).toMatchObject({
      spent: 326,
      limit: 3000,
      limitSource: 'default',
      remaining: 2674,
    });
    expect(b.categories.find((c) => c.categoryId === 'cat-casa')).toMatchObject({ spent: 0, fixed: 16000, total: 16000 });
  });

  it('un presupuesto de un mes puntual reemplaza al de todos los meses', () => {
    const d = base();
    d.categories = d.categories.map((c) => (c.id === 'cat-comida' ? { ...c, monthlyLimit: 3000 } : c));
    d.budgets = [
      { id: budgetId('2026-01', 'cat-comida'), updatedAt: '', month: '2026-01', categoryId: 'cat-comida', amount: 5000 },
    ];
    expect(computeMonth(d, '2026-01', '2026-01-20').categories.find((c) => c.categoryId === 'cat-comida')).toMatchObject({
      limit: 5000,
      limitSource: 'month',
    });
    expect(computeMonth(d, '2026-02', '2026-02-01').categories.find((c) => c.categoryId === 'cat-comida')).toMatchObject({
      limit: 3000,
      limitSource: 'default',
    });
  });

  it('arma el plan: lo asignado, lo que falta asignar y cómo terminás si lo cumplís', () => {
    const d = base();
    d.categories = d.categories.map((c) =>
      c.id === 'cat-comida' ? { ...c, monthlyLimit: 3000 } : c.id === 'cat-suscripciones' ? { ...c, monthlyLimit: 100 } : c,
    );
    const b = computeMonth(d, '2026-01', '2026-01-20');
    // ingresos 39000 − fijos 17600 − ahorro 1000 − asignado 3100 − sin presupuesto 0
    expect(b.plan.assigned).toBe(3100);
    expect(b.plan.overspent).toBeCloseTo(39.6, 2); // suscripciones: 139,60 de 100
    expect(b.plan.remaining).toBe(2674);
    expect(b.plan.unbudgeted).toBe(0);
    expect(b.plan.unassigned).toBe(39000 - 17600 - 1000 - 3100);
    expect(b.plan.projected).toBeCloseTo(b.result - 2674, 2);
    expect(b.daily).toMatchObject({ daysLeft: 12 });
  });

  it('lista las cuotas pendientes y los ahorros por meta', () => {
    const d = base();
    const plans = activeInstallmentPlans(d, '2026-02');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ current: 2, lastMonth: '2026-03' });
    expect(plans[0].remainingOriginal).toBeCloseTo(6.98, 2);
    const goals = goalBalances(d);
    expect(goals.find((g) => g.goalId === 'goal-uyu')?.balance).toBe(1000);
  });
});

describe('sincronización', () => {
  it('gana el cambio más nuevo', () => {
    const store: RecordStore = {};
    const rec = parseEntity('goal', { id: 'g', name: 'Viaje' });
    applyMutation(store, { entity: 'goal', op: 'upsert', id: 'g', updatedAt: '2026-01-02T00:00:00Z', record: rec });
    applyMutation(store, {
      entity: 'goal',
      op: 'upsert',
      id: 'g',
      updatedAt: '2026-01-01T00:00:00Z',
      record: { ...rec, name: 'Viejo' },
    });
    expect(store.goal?.g).toMatchObject({ name: 'Viaje' });
    applyMutation(store, { entity: 'goal', op: 'delete', id: 'g', updatedAt: '2026-01-03T00:00:00Z' });
    expect(store.goal?.g).toBeUndefined();
  });

  it('valida los movimientos', () => {
    expect(() => transactionSchema.parse({ id: 'x', date: '2026-13-01', kind: 'expense', amount: 1 })).toThrow();
    expect(() => transactionSchema.parse({ id: 'x', date: '2026-01-01', kind: 'expense', amount: 0 })).toThrow();
    expect(() =>
      transactionSchema.parse({ id: 'x', date: '2026-01-01', kind: 'expense', amount: 5, linkKind: 'fixed' }),
    ).toThrow();
  });
});
