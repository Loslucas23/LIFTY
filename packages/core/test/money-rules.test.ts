import { describe, expect, it } from 'vitest';
import {
  accountBalances,
  applyMutation,
  cardStatements,
  computeMonth,
  debtSchema,
  debtStatus,
  debtTotals,
  defaultSettings,
  fixedSchema,
  foodCardMonth,
  goalPlans,
  goalSchema,
  incomeSchema,
  initialBalanceFor,
  monthInsights,
  netWorthAt,
  seedRecords,
  sinkingFunds,
  toLiftyData,
  transactionSchema,
  upcomingEvents,
  type LiftyData,
  type RecordStore,
  type Settings,
} from '../src';

let seq = 0;
const tx = (t: Record<string, unknown>) => transactionSchema.parse({ id: `t${++seq}`, ...t });

function data(partial: Partial<LiftyData> = {}, settings: Partial<Settings> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords()) {
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  }
  const base = toLiftyData(store);
  base.accounts = base.accounts.map((a) => (a.id === 'acc-alimentacion' ? { ...a, monthlyLoad: 7000, loadDay: 1 } : a));
  return { ...base, ...partial, settings: { ...defaultSettings(), startMonth: '2026-10', ...settings } };
}

const salary = incomeSchema.parse({
  id: 'job',
  name: 'Trabajo',
  gross: 40000,
  netOverride: 40000,
  startMonth: '2026-01',
  aguinaldo: false,
  accountId: 'acc-brou',
  payDay: 5,
});
const rent = fixedSchema.parse({
  id: 'rent',
  name: 'Alquiler',
  amount: 16000,
  startMonth: '2026-01',
  dayOfMonth: 10,
  categoryId: 'cat-casa',
});

describe('gasto diario disponible', () => {
  // Octubre 2026 tiene 31 días; "hoy" es el 11 → quedan 21 días contando hoy.
  const today = '2026-10-11';

  it('sigue la fórmula: (ingresos − fijos − cuotas − ahorro − gastado) ÷ días que quedan', () => {
    const d = data(
      {
        incomes: [salary],
        fixed: [rent],
        transactions: [
          // Cuota de una compra de septiembre: está comprometida.
          tx({
            date: '2026-09-15',
            kind: 'expense',
            amount: 3000,
            accountId: 'acc-tarjeta',
            installments: 3,
            categoryId: 'cat-otros',
          }),
          tx({ date: '2026-10-03', kind: 'expense', amount: 2000, categoryId: 'cat-super' }),
          tx({ date: '2026-10-11', kind: 'expense', amount: 500, categoryId: 'cat-comida' }),
        ],
      },
      { savingsMode: 'amount', savingsValue: 5000 },
    );
    const b = computeMonth(d, '2026-10', today);
    const daily = b.daily!;
    expect(daily.committedCard).toBe(1000);
    expect(daily.base).toBe(40000 - 16000 - 1000 - 5000);
    expect(daily.spentBefore).toBe(2000);
    expect(daily.spentToday).toBe(500);
    expect(daily.daysLeft).toBe(21);
    expect(daily.perDay).toBeCloseTo((18000 - 2000) / 21, 2);
    expect(daily.todayLeft).toBeCloseTo(16000 / 21 - 500, 2);
    // Si no gasto más hoy, mañana: (16000 − 500) ÷ 20.
    expect(daily.tomorrowPerDay).toBeCloseTo(15500 / 20, 2);
    // 11/10/2026 es domingo: la semana termina hoy.
    expect(daily.weekDays).toBe(1);
  });

  it('las compras nuevas con tarjeta cuentan el día de la compra, no como comprometidas', () => {
    const d = data({
      incomes: [salary],
      transactions: [
        tx({ date: '2026-10-11', kind: 'expense', amount: 900, accountId: 'acc-tarjeta', categoryId: 'cat-comida' }),
      ],
    });
    const daily = computeMonth(d, '2026-10', today).daily!;
    expect(daily.committedCard).toBe(0);
    expect(daily.spentToday).toBe(900);
  });

  it('la meta de ahorro se aparta primero (el mayor entre la meta y lo ahorrado)', () => {
    const d = data(
      { incomes: [salary], transactions: [tx({ date: '2026-10-02', kind: 'saving', amount: 2000, goalId: 'goal-uyu' })] },
      {
        savingsMode: 'percent',
        savingsValue: 10,
      },
    );
    const b = computeMonth(d, '2026-10', today);
    expect(b.savingsGoal).toEqual({ target: 4000, saved: 2000, reserve: 4000, pending: 2000 });
    expect(b.daily!.savings).toBe(4000);
    // Si ahorro más que la meta, se aparta lo ahorrado.
    d.transactions.push(tx({ date: '2026-10-05', kind: 'saving', amount: 3000, goalId: 'goal-uyu' }));
    expect(computeMonth(d, '2026-10', today).savingsGoal.reserve).toBe(5000);
  });

  it('pronostica cómo terminás el mes y en qué día te pasás de una categoría', () => {
    const d = data({
      incomes: [salary],
      transactions: [tx({ date: '2026-10-05', kind: 'expense', amount: 2200, categoryId: 'cat-comida' })],
    });
    d.categories = d.categories.map((c) => (c.id === 'cat-comida' ? { ...c, monthlyLimit: 4000 } : c));
    const b = computeMonth(d, '2026-10', today);
    expect(b.daily!.pace).toBeCloseTo(200, 2);
    expect(b.daily!.forecastEnd).toBeCloseTo(40000 - 200 * 31, 2);
    const insights = monthInsights(d, b, today);
    // 2200 en 11 días = 200/día → 4000 ÷ 200 = día 20.
    expect(insights.find((i) => i.id === 'hit-cat-comida')?.text).toContain('día 20');
  });

  it('compara con el mes pasado hasta el mismo día', () => {
    const d = data({
      transactions: [
        tx({ date: '2026-09-04', kind: 'expense', amount: 1000, categoryId: 'cat-ocio' }),
        tx({ date: '2026-09-25', kind: 'expense', amount: 5000, categoryId: 'cat-ocio' }), // después del día 11: no cuenta
        tx({ date: '2026-10-04', kind: 'expense', amount: 1500, categoryId: 'cat-ocio' }),
      ],
    });
    const b = computeMonth(d, '2026-10', today);
    expect(monthInsights(d, b, today).find((i) => i.id === 'cmp-cat-ocio')?.text).toBe(
      'Gastaste 50% más en ocio que el mes pasado.',
    );
  });
});

describe('qué cuenta en el presupuesto', () => {
  it('la tarjeta de alimentación no es plata: va aparte', () => {
    const d = data({
      incomes: [salary],
      transactions: [
        tx({
          date: '2026-10-01',
          kind: 'income',
          amount: 7000,
          accountId: 'acc-alimentacion',
          linkKind: 'load',
          linkId: 'acc-alimentacion',
          linkMonth: '2026-10',
        }),
        tx({ date: '2026-10-03', kind: 'expense', amount: 2500, accountId: 'acc-alimentacion', categoryId: 'cat-super' }),
      ],
    });
    const b = computeMonth(d, '2026-10', '2026-10-11');
    expect(b.income.total).toBe(40000);
    expect(b.expenses).toBe(0);
    const food = foodCardMonth(d, 'acc-alimentacion', '2026-10', '2026-10-11')!;
    expect(food).toMatchObject({ loaded: 7000, spent: 2500, balance: 4500, loadConfirmed: true, available: 4500, daysLeft: 21 });
    expect(food.perDay).toBeCloseTo(4500 / 21, 2);
  });

  it('cuenta la carga que falta confirmar como disponible en la tarjeta de alimentación', () => {
    const d = data();
    expect(foodCardMonth(d, 'acc-alimentacion', '2026-10', '2026-10-11')).toMatchObject({
      loadConfirmed: false,
      available: 7000,
    });
  });

  it('las transferencias (cajero, pagar la tarjeta) no son gasto ni ingreso', () => {
    const d = data({
      incomes: [salary],
      transactions: [
        tx({ date: '2026-10-05', kind: 'transfer', amount: 3000, accountId: 'acc-brou', toAccountId: 'acc-efectivo' }),
      ],
    });
    const b = computeMonth(d, '2026-10', '2026-10-11');
    expect(b.expenses).toBe(0);
    const bal = new Map(accountBalances(d, '2026-10-11').map((x) => [x.account.id, x.balance]));
    expect(bal.get('acc-brou')).toBe(-3000);
    expect(bal.get('acc-efectivo')).toBe(3000);
  });

  it('en un gasto dividido solo cuenta mi parte, pero de la cuenta sale el total', () => {
    const d = data({
      transactions: [
        tx({
          id: 'dinner',
          date: '2026-10-05',
          kind: 'expense',
          amount: 2000,
          sharedAmount: 1000,
          sharedWith: 'Juan',
          accountId: 'acc-brou',
          categoryId: 'cat-comida',
        }),
      ],
      debts: [
        debtSchema.parse({
          id: 'd1',
          person: 'Juan',
          direction: 'lent',
          amount: 1000,
          date: '2026-10-05',
          fromTxId: 'dinner',
          accountId: 'acc-brou',
        }),
      ],
    });
    const b = computeMonth(d, '2026-10', '2026-10-11');
    expect(b.variable.total).toBe(1000);
    expect(accountBalances(d, '2026-10-11').find((x) => x.account.id === 'acc-brou')?.balance).toBe(-2000);
    expect(debtTotals(d)).toEqual({ owedToMe: 1000, iOwe: 0 });
  });

  it('gastos anuales o cada N meses caen solo en sus meses, y se sugiere cuánto apartar', () => {
    const patente = fixedSchema.parse({ id: 'pat', name: 'Patente', amount: 12000, startMonth: '2026-05', everyMonths: 12 });
    const d = data({ fixed: [patente] });
    expect(computeMonth(d, '2026-05', '2026-05-01').fixed.total).toBe(12000);
    expect(computeMonth(d, '2026-06', '2026-06-01').fixed.total).toBe(0);
    expect(computeMonth(d, '2027-05', '2027-05-01').fixed.items[0]).toMatchObject({ detail: 'Una vez al año', amount: 12000 });
    expect(sinkingFunds(d, '2026-10')).toEqual([
      expect.objectContaining({ name: 'Patente', nextMonth: '2027-05', perMonth: 1000 }),
    ]);
  });

  it('un ingreso por única vez no genera aguinaldo', () => {
    const vacacional = incomeSchema.parse({
      id: 'vac',
      name: 'Salario vacacional',
      gross: 15000,
      netOverride: 15000,
      startMonth: '2026-12',
      endMonth: '2026-12',
    });
    const d = data({ incomes: [vacacional] });
    const dec = computeMonth(d, '2026-12', '2026-12-01');
    expect(dec.income.planned.map((l) => [l.kind, l.amount])).toEqual([['salary', 15000]]);
  });
});

describe('cuentas, deudas y patrimonio', () => {
  it('ajustar el saldo calcula el saldo inicial necesario', () => {
    const d = data({ transactions: [tx({ date: '2026-10-02', kind: 'expense', amount: 500, accountId: 'acc-efectivo' })] });
    expect(initialBalanceFor(d, 'acc-efectivo', 2000, '2026-10-11')).toBe(2500);
  });

  it('convierte los movimientos a la moneda de la cuenta (compra de dólares)', () => {
    const d = data(
      {
        transactions: [
          tx({
            date: '2026-10-02',
            kind: 'transfer',
            amount: 100,
            currency: 'USD',
            fxRate: 40,
            accountId: 'acc-brou',
            toAccountId: 'acc-brou-usd',
          }),
        ],
      },
      { usdRate: 41 },
    );
    const bal = new Map(accountBalances(d, '2026-10-11').map((x) => [x.account.id, x.balance]));
    expect(bal.get('acc-brou')).toBe(-4000);
    expect(bal.get('acc-brou-usd')).toBe(100);
  });

  it('las deudas se van pagando y mueven la plata de las cuentas', () => {
    const debt = debtSchema.parse({
      id: 'd',
      person: 'Mamá',
      direction: 'borrowed',
      amount: 10000,
      date: '2026-10-01',
      accountId: 'acc-brou',
      payments: [{ id: 'p1', date: '2026-10-08', amount: 4000, accountId: 'acc-brou' }],
    });
    const d = data({ debts: [debt] });
    expect(debtStatus(debt)).toMatchObject({ paid: 4000, remaining: 6000, done: false });
    expect(accountBalances(d, '2026-10-11').find((x) => x.account.id === 'acc-brou')?.balance).toBe(6000);
    const nw = netWorthAt(d, '2026-10-11');
    expect(nw).toMatchObject({ cash: 6000, iOwe: 6000, total: 0 });
  });
});

describe('metas con fecha', () => {
  it('calcula cuánto separar por mes y si vas atrasado', () => {
    const viaje = goalSchema.parse({
      id: 'viaje',
      name: 'Viaje',
      currency: 'USD',
      target: 2000,
      startMonth: '2026-07',
      targetMonth: '2026-12',
    });
    const d = data(
      {
        goals: [viaje],
        transactions: [tx({ date: '2026-08-01', kind: 'saving', amount: 300, currency: 'USD', fxRate: 40, goalId: 'viaje' })],
      },
      { usdRate: 40 },
    );
    const [plan] = goalPlans(d, '2026-10-11');
    // Faltan 1700 en 3 meses (oct, nov, dic).
    expect(plan.monthsLeft).toBe(3);
    expect(plan.perMonth).toBeCloseTo(566.67, 2);
    expect(plan.perMonthUYU).toBeCloseTo(566.67 * 40, 0);
    // De 6 meses pasaron 3: deberías tener 1000.
    expect(plan.expected).toBe(1000);
    expect(plan.status).toBe('behind');
  });
});

describe('lo que viene', () => {
  it('lista vencimientos, cobros y cargas de los próximos días (y lo vencido)', () => {
    const internet = fixedSchema.parse({ id: 'net', name: 'Internet', amount: 1500, startMonth: '2026-01', dayOfMonth: 14 });
    const d = data({ incomes: [salary], fixed: [rent, internet] });
    const b = computeMonth(d, '2026-10', '2026-10-11');
    const events = upcomingEvents(d, b, '2026-10-11');
    expect(events.map((e) => [e.name, e.date, e.overdue])).toEqual([
      ['Alquiler', '2026-10-10', true],
      ['Internet', '2026-10-14', false],
    ]);
  });
});

describe('resumen de la tarjeta', () => {
  it('separa pesos y dólares, y pagar el resumen no es gasto', () => {
    const d = data(
      {
        transactions: [
          // Heladera en 3 cuotas desde septiembre: en octubre cae la 2.ª.
          tx({
            date: '2026-09-02',
            kind: 'expense',
            amount: 9000,
            accountId: 'acc-tarjeta',
            installments: 3,
            categoryId: 'cat-casa',
          }),
          tx({ date: '2026-10-03', kind: 'expense', amount: 20, currency: 'USD', fxRate: 40, accountId: 'acc-tarjeta' }),
          // Pago parcial del resumen de octubre desde el BROU.
          tx({
            date: '2026-10-05',
            kind: 'transfer',
            amount: 2000,
            accountId: 'acc-brou',
            toAccountId: 'acc-tarjeta',
            linkKind: 'cardbill',
            linkId: 'acc-tarjeta',
            linkMonth: '2026-10',
          }),
        ],
      },
      { usdRate: 40 },
    );
    const b = computeMonth(d, '2026-10', '2026-10-11');
    const [s] = cardStatements(d, b);
    expect(s.uyu).toBe(3000);
    expect(s.usd).toBe(20);
    expect(s.totalUYU).toBe(3800);
    expect(s.paidUYU).toBe(2000);
    expect(s.pendingUYU).toBe(1000);
    expect(s.pendingUSD).toBe(20);
    expect(s.status).toBe('partial');
    // El pago no suma a los gastos del mes: solo la cuota y la compra en dólares.
    expect(b.expenses).toBe(3800);
    // La deuda con la tarjeta baja con el pago (9000 + 800 − 2000).
    const card = accountBalances(d, '2026-10-31').find((a) => a.account.id === 'acc-tarjeta')!;
    expect(card.balance).toBe(-7800);
  });
});
