import { describe, expect, it } from 'vitest';
import {
  accountBalances,
  antExpenses,
  applyMutation,
  cardAutoPayments,
  cardChoices,
  cardInstallments,
  cardPayDate,
  cardStatements,
  cashVsInstallments,
  categorySchema,
  computeMonths,
  costPerUse,
  debtReminderText,
  debtSchema,
  debtsToRemind,
  defaultSettings,
  fixedSchema,
  habitLogSchema,
  habitSchema,
  incomeSchema,
  leftoversToSave,
  seedRecords,
  suggestUseLinks,
  toLiftyData,
  transactionSchema,
  whatsappLink,
  workHour,
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
const tx = (p: object) => transactionSchema.parse({ date: '2026-10-02', kind: 'expense', accountId: 'acc-brou', ...p });

describe('tarjeta con día de cierre', () => {
  const card = () => {
    const d = base();
    d.accounts = d.accounts.map((a) => (a.id === 'acc-tarjeta' ? { ...a, closingDay: 22, payDay: 10 } : a));
    return d;
  };

  it('lo comprado después del cierre entra en el resumen siguiente', () => {
    const d = card();
    const c = d.accounts.find((a) => a.id === 'acc-tarjeta')!;
    const before = tx({ id: 'a', date: '2026-10-20', amount: 1000, accountId: c.id });
    const after = tx({ id: 'b', date: '2026-10-25', amount: 3000, accountId: c.id, installments: 3 });
    expect(cardInstallments(c, before).map((i) => i.month)).toEqual(['2026-10']);
    expect(cardInstallments(c, after).map((i) => i.month)).toEqual(['2026-11', '2026-12', '2027-01']);
    // Cierra el 22 y se paga el 10 del mes siguiente.
    expect(cardPayDate(c, '2026-10')).toBe('2026-11-10');
    // Si el pago es después del cierre, es el mismo mes.
    expect(cardPayDate({ closingDay: 5, payDay: 20 }, '2026-10')).toBe('2026-10-20');
  });

  it('el débito automático y el resumen usan el mismo corte, y el gasto sigue en su mes', () => {
    const d = card();
    d.transactions = [
      tx({ id: 'a', date: '2026-10-20', amount: 1000, accountId: 'acc-tarjeta' }),
      tx({ id: 'b', date: '2026-10-25', amount: 2000, accountId: 'acc-tarjeta' }),
    ];
    const pays = cardAutoPayments(d, '2026-12-31');
    expect(pays.map((p) => [p.linkMonth, p.date, p.amount])).toEqual([
      ['2026-10', '2026-11-10', 1000],
      ['2026-11', '2026-12-10', 2000],
    ]);
    const [oct, nov] = computeMonths(d, '2026-10', '2026-11', '2026-10-26');
    // El presupuesto cuenta los dos gastos en octubre (cuando compraste).
    expect(oct.card.total).toBe(3000);
    expect(nov.card.total).toBe(0);
    // El resumen de noviembre trae la compra del 25.
    expect(cardStatements(d, oct, '2026-10-26')[0].uyu).toBe(1000);
    expect(cardStatements(d, nov, '2026-10-26')[0].uyu).toBe(2000);
    // La plata sale del banco cuando se paga cada resumen: cuadra.
    const brou = (day: string) => accountBalances(d, day).find((x) => x.account.id === 'acc-brou')!.balance;
    expect(brou('2026-11-10')).toBe(-1000);
    expect(brou('2026-12-10')).toBe(-3000);
  });

  it('con qué tarjeta conviene pagar hoy: la que recién cerró da más días', () => {
    const d = card();
    d.accounts = [
      ...d.accounts,
      { ...d.accounts.find((a) => a.id === 'acc-tarjeta')!, id: 'oca', name: 'OCA', closingDay: 5, payDay: 20 },
    ];
    // 6 de octubre: la Visa (cierra el 22) se paga el 10/11; la OCA cerró ayer: se paga el 20/11.
    const [first, second] = cardChoices(d, '2026-10-06');
    expect(first.card.id).toBe('oca');
    expect(first.pays).toBe('2026-11-20');
    expect(first.days).toBe(45);
    expect(second.pays).toBe('2026-11-10');
    expect(second.closes).toBe('2026-10-22');
  });
});

describe('lo que sobra de una categoría', () => {
  it('se acumula al mes siguiente solo desde que lo activás, y lo que te pasaste no resta', () => {
    const d = base();
    d.categories = d.categories.map((c) =>
      c.id === 'cat-personal'
        ? categorySchema.parse({ ...c, monthlyLimit: 3000, rollover: 'carry', rolloverFrom: '2026-08' })
        : c,
    );
    d.transactions = [
      tx({ id: 'jul', date: '2026-07-10', amount: 500, categoryId: 'cat-personal' }),
      tx({ id: 'ago', date: '2026-08-10', amount: 1000, categoryId: 'cat-personal' }),
      tx({ id: 'sep', date: '2026-09-10', amount: 6000, categoryId: 'cat-personal' }),
      tx({ id: 'oct', date: '2026-10-10', amount: 500, categoryId: 'cat-personal' }),
    ];
    const months = computeMonths(d, '2026-07', '2026-11', '2026-10-15');
    const cat = (m: number) => months[m].categories.find((c) => c.categoryId === 'cat-personal')!;
    // Julio y agosto no acumulan (empieza a contar lo que sobra de agosto).
    expect(cat(0).limit).toBe(3000);
    expect(cat(1).limit).toBe(3000);
    // Septiembre: 3.000 + 2.000 que sobraron de agosto.
    expect(cat(2)).toMatchObject({ limit: 5000, carry: 2000, remaining: -1000 });
    // Octubre: en septiembre te pasaste: no arrastra nada.
    expect(cat(3).limit).toBe(3000);
    expect(cat(3).carry).toBeUndefined();
    // Noviembre: 3.000 + 2.500.
    expect(cat(4)).toMatchObject({ limit: 5500, carry: 2500 });
  });

  it('"va al ahorro": propone pasar lo que sobró el mes pasado, una sola vez', () => {
    const d = base();
    d.categories = d.categories.map((c) =>
      c.id === 'cat-ocio' ? categorySchema.parse({ ...c, monthlyLimit: 4000, rollover: 'save' }) : c,
    );
    d.transactions = [tx({ id: 'o', date: '2026-09-10', amount: 2500, categoryId: 'cat-ocio' })];
    const [sep] = computeMonths(d, '2026-09', '2026-09', '2026-10-02');
    const [l] = leftoversToSave(d, sep);
    expect(l).toMatchObject({ amount: 1500, description: 'Lo que sobró de ocio en setiembre' });
    d.transactions.push(tx({ id: 's', kind: 'saving', amount: 1500, date: '2026-09-30', description: l.description }));
    expect(leftoversToSave(d, sep)).toEqual([]);
  });
});

describe('gastos hormiga', () => {
  it('lo chico que se repite, por mes, por año y en horas de trabajo', () => {
    const d = base();
    d.incomes = [incomeSchema.parse({ id: 'job', name: 'Sueldo', gross: 60000, netOverride: 52000, startMonth: '2026-01' })];
    const txs = [];
    // Café: 3 por semana durante 12 semanas a $ 150.
    for (let w = 0; w < 12; w++)
      for (const day of [1, 3, 5]) {
        const date = new Date(Date.UTC(2026, 6, 13 + w * 7 + day)).toISOString().slice(0, 10);
        txs.push(tx({ id: `cafe${w}-${day}`, date, amount: 150, description: `Café ${w}`, categoryId: 'cat-comida' }));
      }
    // Algo chico pero de una sola vez, y algo grande que se repite: no son hormiga.
    txs.push(tx({ id: 'regalo', date: '2026-09-01', amount: 400, description: 'Regalo' }));
    // Hay datos desde enero: se miran los 90 días enteros.
    txs.push(tx({ id: 'viejo', date: '2026-01-05', amount: 5000, description: 'Heladera' }));
    for (let m = 0; m < 3; m++) txs.push(tx({ id: `super${m}`, date: `2026-0${7 + m}-20`, amount: 3000, description: 'Súper' }));
    d.transactions = txs.sort((a, b) => b.date.localeCompare(a.date));
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-06');
    const hour = workHour(d, b)!;
    expect(hour.hoursPerMonth).toBe(173.33);
    expect(hour.value).toBe(300);
    const r = antExpenses(d, '2026-10-06', hour);
    expect(r.groups.map((g) => g.name)).toEqual(['Café']);
    const cafe = r.groups[0];
    // En los últimos 90 días: los cafés que caen adentro (desde el 9 de julio).
    expect(cafe.count).toBe(36);
    expect(cafe.monthly).toBe(1800);
    expect(r.yearly).toBe(21600);
    expect(r.hours).toBe(72);
    expect(r.halfSaving).toBe(10800);
  });
});

describe('contado o cuotas', () => {
  it('10% contado contra 12 cuotas sin recargo, con 5% de inflación: conviene contado', () => {
    const r = cashVsInstallments({ price: 12000, discount: 10, count: 12, surcharge: 0, annualRate: 5 });
    expect(r.cash).toBe(10800);
    expect(r.each).toBe(1000);
    expect(r.best).toBe('cash');
    // Las cuotas en plata de hoy: menos que 12.000 pero más que 10.800.
    expect(r.presentValue).toBeGreaterThan(11600);
    expect(r.presentValue).toBeLessThan(12000);
    expect(r.difference).toBe(round(r.presentValue - 10800));
    // Con 3% contado da más o menos lo mismo que las cuotas (por eso conviene cuotas).
    expect(r.breakEven).toBeGreaterThan(2);
    expect(r.breakEven).toBeLessThan(3);
    const small = cashVsInstallments({ price: 12000, discount: 2, count: 12, surcharge: 0, annualRate: 5 });
    expect(small.best).toBe('installments');
  });
  const round = (v: number) => Math.round(v * 100) / 100;
});

describe('cuánto te sale cada uso', () => {
  it('cuota del gimnasio ÷ las veces que fuiste este mes', () => {
    const d = base();
    const gym = habitSchema.parse({ id: 'gym', name: 'Ir al gimnasio', days: [1, 3, 5], target: 1 });
    d.habits = [gym];
    d.fixed = [fixedSchema.parse({ id: 'f', name: 'Gimnasio', amount: 1600, startMonth: '2026-01', habitId: 'gym' })];
    d.habitLogs = ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'].map((date) =>
      habitLogSchema.parse({ id: `gym:${date}`, habitId: 'gym', date, value: 1 }),
    );
    const [u] = costPerUse(d, '2026-10-15');
    expect(u).toMatchObject({ month: '2026-10', uses: 4, perUse: 400, monthly: 1600 });
    // Recién empieza el mes y no fuiste: mira el mes anterior.
    d.habitLogs = [habitLogSchema.parse({ id: 'gym:2026-09-30', habitId: 'gym', date: '2026-09-30', value: 1 })];
    expect(costPerUse(d, '2026-10-03')[0]).toMatchObject({ month: '2026-09', uses: 1, perUse: 1600 });
    // Sin unir: lo sugiere por el nombre.
    d.fixed = [{ ...d.fixed[0], habitId: null }];
    expect(suggestUseLinks(d).map((s) => s.habit.id)).toEqual(['gym']);
  });
});

describe('recordar a quien te debe', () => {
  it('arma el mensaje con lo que falta y el link de WhatsApp', () => {
    const d = debtSchema.parse({
      id: 'x',
      person: 'Juan Pérez',
      direction: 'lent',
      amount: 1500,
      date: '2026-09-12',
      description: 'la cena',
      payments: [{ id: 'p', date: '2026-09-20', amount: 500, accountId: null }],
    });
    const text = debtReminderText(d, 'amable', 'Ana');
    expect(text).toContain('¡Hola Juan!');
    expect(text).toContain('$ 1.500');
    expect(text).toContain('faltan $ 1.000');
    expect(text).toContain('de la cena (12/9)');
    expect(whatsappLink('hola', '099 123 456')).toBe('https://wa.me/59899123456?text=hola');
    expect(whatsappLink('hola que tal')).toBe('https://wa.me/?text=hola%20que%20tal');
    const data = { ...base(), debts: [d] };
    expect(debtsToRemind(data, '2026-10-06')).toHaveLength(1);
    expect(debtsToRemind({ ...data, debts: [{ ...d, remindedAt: '2026-10-02' }] }, '2026-10-06')).toHaveLength(0);
  });
});
