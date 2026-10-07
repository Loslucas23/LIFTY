import { describe, expect, it } from 'vitest';
import { benefitFor, benefitSavings, benefitSchema, benefitsOn, defaultSettings, transactionSchema } from '../src';

describe('beneficios y descuentos', () => {
  // Martes 25% en Tienda Inglesa con BROU, tope $ 500 por mes.
  const ti = benefitSchema.parse({
    id: 'b',
    name: '25% en el súper',
    store: 'Tienda Inglesa',
    days: [2],
    accountId: 'acc-brou',
    percent: 25,
    cap: 500,
  });
  const data = { benefits: [ti], settings: defaultSettings(), transactions: [] as ReturnType<typeof transactionSchema.parse>[] };

  it('vale el día que toca', () => {
    expect(benefitsOn(data, '2026-10-06').map((b) => b.id)).toEqual(['b']); // martes
    expect(benefitsOn(data, '2026-10-07')).toEqual([]);
  });

  it('al cargar el gasto: si pagás con otra cuenta, sugiere la del beneficio', () => {
    const t = { date: '2026-10-06', description: 'Tienda Inglesa Pocitos', categoryId: 'cat-super', accountId: 'acc-tarjeta' };
    expect(benefitFor(data, t)).toMatchObject({ ok: false, benefit: { id: 'b' } });
    expect(benefitFor(data, { ...t, accountId: 'acc-brou' })).toMatchObject({ ok: true });
    expect(benefitFor(data, { ...t, date: '2026-10-07' })).toBeNull();
  });

  it('cuánto te ahorraste este mes (con el tope)', () => {
    data.transactions = [
      transactionSchema.parse({
        id: '1',
        kind: 'expense',
        date: '2026-10-06',
        amount: 1200,
        description: 'Tienda Inglesa',
        accountId: 'acc-brou',
      }),
      transactionSchema.parse({
        id: '2',
        kind: 'expense',
        date: '2026-10-13',
        amount: 1600,
        description: 'TIENDA INGLESA',
        accountId: 'acc-brou',
      }),
      // Otro día o con otra tarjeta no cuenta.
      transactionSchema.parse({
        id: '3',
        kind: 'expense',
        date: '2026-10-07',
        amount: 1000,
        description: 'Tienda Inglesa',
        accountId: 'acc-brou',
      }),
      transactionSchema.parse({
        id: '4',
        kind: 'expense',
        date: '2026-10-06',
        amount: 1000,
        description: 'Tienda Inglesa',
        accountId: 'acc-itau',
      }),
    ];
    // 25% de 2.800 = 700, con tope de 500.
    expect(benefitSavings(data, '2026-10-20')).toEqual([{ benefit: ti, count: 2, saved: 500 }]);
    expect(benefitSavings(data, '2026-10-10')[0]).toMatchObject({ count: 1, saved: 300 });
  });
});
