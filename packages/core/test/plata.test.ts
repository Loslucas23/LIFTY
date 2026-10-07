import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  computeMonths,
  debtSchema,
  defaultSettings,
  fixedSchema,
  incomeSchema,
  investEstimate,
  paydayPlan,
  plata,
  seedRecords,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function base(): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  const d = toLiftyData(store);
  return { ...d, settings: { ...defaultSettings(), startMonth: '2026-01', usdRate: 40 } };
}
const tx = (p: object) => transactionSchema.parse({ date: '2026-10-02', ...p });

/** Un mes armado a mano: BROU con $ 60.000, dólares guardados, una meta sin lugar, sueldo el 28 y fijos. */
function scenario(): LiftyData {
  const d = base();
  d.accounts = d.accounts.map((a) =>
    a.id === 'acc-brou' ? { ...a, initialBalance: 60000 } : a.id === 'acc-brou-usd' ? { ...a, initialBalance: 200 } : a,
  );
  d.transactions = [
    // US$ 100 a la meta en dólares (vive en BROU dólares): sale de BROU y entra en BROU dólares.
    tx({ id: 's1', kind: 'saving', amount: 100, currency: 'USD', fxRate: 40, accountId: 'acc-brou', goalId: 'goal-usd' }),
    // $ 1.000 a la meta en pesos, que no dice dónde está.
    tx({ id: 's2', kind: 'saving', amount: 1000, accountId: 'acc-brou', goalId: 'goal-uyu' }),
  ];
  d.incomes = [
    incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 50000, netOverride: 50000, startMonth: '2026-01', payDay: 28 }),
  ];
  d.fixed = [
    fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 18000, startMonth: '2026-01', dayOfMonth: 10 }),
    fixedSchema.parse({ id: 'ute', name: 'UTE', amount: 2000, startMonth: '2026-01', dayOfMonth: 3 }),
    fixedSchema.parse({ id: 'patente', name: 'Patente', amount: 12000, startMonth: '2026-03', dayOfMonth: 15, everyMonths: 12 }),
  ];
  return d;
}

describe('tu plata', () => {
  it('cada peso tiene lugar y destino: te sobra lo libre de verdad hasta el cobro', () => {
    const d = scenario();
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-06');
    const p = plata(d, b, '2026-10-06');
    expect(p.nextIncome).toMatchObject({ date: '2026-10-28', name: 'Sueldo', amount: 50000 });
    expect(p.days).toBe(22);
    // BROU: 60.000 − 4.000 (dólares) − 1.000 (meta en pesos, sin lugar) = 55.000.
    expect(p.spend).toBe(55000);
    // BROU dólares: US$ 300 = $ 12.000, de los que US$ 100 son de la meta: $ 8.000 sin destino.
    const usd = p.places.find((x) => x.account.id === 'acc-brou-usd')!;
    expect(usd).toMatchObject({ group: 'saved', balance: 300, balanceUYU: 12000, goalsUYU: 4000, unassignedUYU: 8000 });
    expect(p.unassigned).toBe(8000);
    // La meta en pesos no dice dónde está: se sugiere BROU.
    expect(p.homeless.map((h) => [h.goal.id, h.suggested?.id])).toEqual([['goal-uyu', 'acc-brou']]);
    // Comprometido: UTE vencida, alquiler el 10 y la patente (vence en marzo: 7/12 de 12.000).
    expect(p.commitments.map((c) => [c.name, c.amount])).toEqual([
      ['UTE', 2000],
      ['Alquiler', 18000],
      ['Patente', 7000],
    ]);
    expect(p.commitments[0].overdue).toBe(true);
    expect(p.committed).toBe(27000);
    expect(p.free).toBe(28000);
    expect(p.freePerDay).toBe(1272.73);
    // Patrimonio: 55.000 + 12.000 + 1.000 (la meta sin lugar).
    expect(p.netWorth).toMatchObject({ assets: 68000, debts: 0, total: 68000, totalUSD: 1700 });
  });

  it('pagar un fijo lo saca de lo comprometido', () => {
    const d = scenario();
    d.transactions.push(
      tx({
        id: 'p1',
        date: '2026-10-03',
        kind: 'expense',
        amount: 2000,
        accountId: 'acc-brou',
        linkKind: 'fixed',
        linkId: 'ute',
        linkMonth: '2026-10',
      }),
    );
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-06');
    const p = plata(d, b, '2026-10-06');
    expect(p.commitments.map((c) => c.name)).toEqual(['Alquiler', 'Patente']);
    // Bajó la plata y bajó lo comprometido: lo libre queda igual.
    expect(p.free).toBe(28000);
  });

  it('un préstamo en cuotas entra en lo comprometido hasta el cobro', () => {
    const d = scenario();
    d.debts = [
      debtSchema.parse({
        id: 'loan',
        person: 'BROU',
        direction: 'borrowed',
        amount: 12000,
        date: '2026-08-01',
        description: 'Préstamo',
        installmentAmount: 2000,
        payDay: 15,
      }),
    ];
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-06');
    const p = plata(d, b, '2026-10-06');
    const loan = p.commitments.find((c) => c.kind === 'loan')!;
    expect(loan).toMatchObject({ date: '2026-10-15', amount: 2000, name: 'Cuota: Préstamo' });
    expect(loan.note).toContain('6 cuotas');
    expect(p.netWorth.iOwe).toBe(12000);
  });

  it('plazo fijo: intereses estimados, lo que tenés al vencer, y no cuenta como ingreso del mes', () => {
    const d = scenario();
    d.accounts.push({
      ...d.accounts.find((a) => a.id === 'acc-itau')!,
      id: 'pf',
      name: 'Plazo fijo',
      reserved: true,
      investKind: 'plazo-fijo',
      rate: 10,
      maturity: '2027-01-01',
    });
    d.transactions.push(
      tx({ id: 't1', date: '2026-01-01', kind: 'transfer', amount: 36500, accountId: 'acc-brou', toAccountId: 'pf' }),
    );
    const e = investEstimate(d, d.accounts.find((a) => a.id === 'pf')!, '2026-10-06')!;
    // 36.500 × 10% × 278 días / 365.
    expect(e).toMatchObject({ accrued: 2780, since: '2026-01-01', daysToMaturity: 87, atMaturity: 40150 });
    // Anotar los intereses: entran al plazo fijo y no son ingreso del mes (es ahorro que crece).
    d.transactions.push(
      tx({ id: 'i1', date: '2026-10-06', kind: 'income', amount: 2780, accountId: 'pf', categoryId: 'cat-rendimientos' }),
    );
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-06');
    // Solo el sueldo planificado: los intereses no suman.
    expect(b.income.total).toBe(50000);
    const p = plata(d, b, '2026-10-06');
    expect(p.places.find((x) => x.account.id === 'pf')).toMatchObject({ group: 'invest', balance: 39280 });
    expect(p.invested).toBe(39280);
    expect(p.places.find((x) => x.account.id === 'pf')!.invest!.accrued).toBe(0);
  });

  it('repartir el cobro: lo que tiene fecha hasta el próximo cobro, las metas y lo que queda por día', () => {
    const d = scenario();
    // Octubre pagado.
    for (const f of ['rent', 'ute'])
      d.transactions.push(
        tx({
          id: `p-${f}`,
          kind: 'expense',
          amount: f === 'rent' ? 18000 : 2000,
          accountId: 'acc-brou',
          linkKind: 'fixed',
          linkId: f,
          linkMonth: '2026-10',
        }),
      );
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-28');
    const goal = d.goals.find((g) => g.id === 'goal-usd')!;
    const plan = paydayPlan(d, b, '2026-10-28', 50000, [{ goal, pending: 50 }]);
    expect(plan.until).toBe('2026-11-28');
    expect(plan.days).toBe(31);
    expect(plan.lines.map((l) => [l.kind, l.name, l.amount])).toEqual([
      ['fixed', 'UTE', 2000],
      ['fixed', 'Alquiler', 18000],
      ['goal', '💵 Ahorro en dólares', 2000],
      ['provision', 'Para lo que pagás cada tanto', 1000],
    ]);
    expect(plan.lines.find((l) => l.kind === 'goal')).toMatchObject({ currency: 'USD', original: 50, action: true });
    expect(plan.left).toBe(27000);
    expect(plan.perDay).toBe(870.97);
  });
});
