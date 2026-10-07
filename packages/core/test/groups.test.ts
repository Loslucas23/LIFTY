import { describe, expect, it } from 'vitest';
import {
  accountBalances,
  applyMutation,
  computeMonths,
  defaultSettings,
  equalSplit,
  groupExpenseSchema,
  groupReminderText,
  groupSchema,
  groupSummary,
  groupTotals,
  groupTransaction,
  ME,
  periodSchema,
  seedRecords,
  settleUp,
  toLiftyData,
  transactionSchema,
  type GroupExpense,
  type LiftyData,
  type RecordStore,
} from '../src';

function base(): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  const d = toLiftyData(store);
  return { ...d, settings: { ...defaultSettings(), startMonth: '2026-01', usdRate: 40, ownerName: 'Ana López' } };
}

const group = groupSchema.parse({
  id: 'g',
  name: 'Floripa',
  icon: '🏖️',
  members: [
    { id: ME, name: 'Ana' },
    { id: 'juan', name: 'Juan', phone: '099 111 222' },
    { id: 'lu', name: 'Lucía' },
  ],
  periodId: 'p',
});
const ex = (p: Partial<GroupExpense> & { amount: number; paidBy: string }) =>
  groupExpenseSchema.parse({
    groupId: 'g',
    date: '2026-10-02',
    split: equalSplit(p.amount, [ME, 'juan', 'lu']),
    ...p,
  });

describe('gastos en grupo', () => {
  it('partes iguales con los centavos repartidos', () => {
    expect(equalSplit(100, ['a', 'b', 'c']).map((s) => s.amount)).toEqual([33.34, 33.33, 33.33]);
  });

  it('quién debe a quién y cómo saldar con la menor cantidad de pagos', () => {
    const d = base();
    d.groups = [group];
    d.periods = [
      periodSchema.parse({ id: 'p', kind: 'vacation', name: 'Floripa', from: '2026-10-01', to: '2026-10-10', tag: 'floripa' }),
    ];
    d.groupExpenses = [
      ex({ id: 'e1', amount: 3000, paidBy: ME, description: 'Cena' }),
      ex({ id: 'e2', amount: 6000, paidBy: 'juan', description: 'Auto' }),
      ex({ id: 'e3', amount: 900, paidBy: 'lu', description: 'Helados' }),
    ];
    const s = groupSummary(d, group);
    // Cada uno: 3.300. Ana puso 3.000, Juan 6.000, Lucía 900.
    expect(s.balances.map((b) => b.balance)).toEqual([-300, 2700, -2400]);
    expect(s.payments.map((p) => [p.from.id, p.to.id, p.amount])).toEqual([
      ['lu', 'juan', 2400],
      [ME, 'juan', 300],
    ]);
    expect(s).toMatchObject({ total: 9900, myShare: 3300, myBalance: -300, count: 3 });
    expect(groupTotals(d).UYU).toEqual({ owedToMe: 0, iOwe: 300 });
    // Saldar: Ana le paga 300 a Juan.
    d.groupExpenses.push(
      groupExpenseSchema.parse({
        id: 's1',
        groupId: 'g',
        kind: 'settlement',
        date: '2026-10-11',
        amount: 300,
        paidBy: ME,
        split: [{ memberId: 'juan', amount: 300 }],
      }),
    );
    expect(groupSummary(d, group).payments.map((p) => [p.from.id, p.amount])).toEqual([['lu', 2400]]);
  });

  it('con tu plata cuadra: tu parte en el presupuesto, lo que pusiste sale de tu cuenta, saldar no es gasto', () => {
    const d = base();
    d.groups = [group];
    d.periods = [
      periodSchema.parse({ id: 'p', kind: 'vacation', name: 'Floripa', from: '2026-10-01', to: '2026-10-10', tag: 'floripa' }),
    ];
    const cena = ex({ id: 'e1', amount: 3000, paidBy: ME, description: 'Cena', accountId: 'acc-brou', categoryId: 'cat-comida' });
    const auto = ex({ id: 'e2', amount: 6000, paidBy: 'juan', description: 'Auto', categoryId: 'cat-transporte' });
    const pago = groupExpenseSchema.parse({
      id: 's1',
      groupId: 'g',
      kind: 'settlement',
      date: '2026-10-11',
      amount: 1000,
      paidBy: ME,
      split: [{ memberId: 'juan', amount: 1000 }],
      accountId: 'acc-brou',
    });
    const entreOtros = groupExpenseSchema.parse({
      id: 's2',
      groupId: 'g',
      kind: 'settlement',
      date: '2026-10-11',
      amount: 500,
      paidBy: 'lu',
      split: [{ memberId: 'juan', amount: 500 }],
    });
    d.groupExpenses = [cena, auto, pago, entreOtros];
    const txs = [cena, auto, pago, entreOtros].map((e) => groupTransaction(d, group, e, null));
    expect(txs[3]).toBeNull();
    // Todos son movimientos válidos.
    d.transactions = txs.filter((t) => t !== null).map((t) => transactionSchema.parse(t));
    expect(d.transactions.map((t) => [t.kind, t.amount, t.sharedAmount, t.accountId, t.tags])).toEqual([
      ['expense', 3000, 2000, 'acc-brou', ['floripa']],
      ['expense', 2000, 0, null, ['floripa']],
      ['transfer', 1000, 0, 'acc-brou', ['floripa']],
    ]);
    const [oct] = computeMonths(d, '2026-10', '2026-10', '2026-10-15');
    // Presupuesto: tu parte de la cena (1.000) + tu parte del auto (2.000).
    expect(oct.variable.total).toBe(3000);
    // BROU: −3.000 de la cena y −1.000 que le pagaste a Juan.
    expect(accountBalances(d, '2026-10-15').find((x) => x.account.id === 'acc-brou')!.balance).toBe(-4000);
  });

  it('mensaje para recordar lo que te deben', () => {
    const d = base();
    d.groups = [group];
    d.groupExpenses = [ex({ id: 'e1', amount: 3000, paidBy: ME, description: 'Cena' })];
    const text = groupReminderText(groupSummary(d, group), 'juan', d.settings.ownerName);
    expect(text).toContain('¡Hola Juan!');
    expect(text).toContain('$ 1.000');
    expect(text).toContain('«Floripa»');
    expect(settleUp([])).toEqual([]);
  });
});
