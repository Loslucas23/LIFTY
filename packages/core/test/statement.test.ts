import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  cleanDescription,
  debtSchema,
  defaultSettings,
  detectColumns,
  parseDate,
  parseNumber,
  reconcile,
  ruleSchema,
  seedRecords,
  statementLines,
  toLiftyData,
  transactionSchema,
  type Cell,
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
const tx = (p: object) => transactionSchema.parse({ kind: 'expense', accountId: 'acc-brou', ...p });

describe('leer el extracto', () => {
  it('números y fechas como vienen de los bancos', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('-1234.56')).toBe(-1234.56);
    expect(parseNumber('(1.234,56)')).toBe(-1234.56);
    expect(parseNumber('$ 900')).toBe(900);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('1.500')).toBe(1500);
    expect(parseNumber('350-')).toBe(-350);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('Saldo')).toBeNull();
    expect(parseDate('15/09/2026')).toBe('2026-09-15');
    expect(parseDate('5/9/26')).toBe('2026-09-05');
    expect(parseDate('2026-09-15 10:32')).toBe('2026-09-15');
    expect(parseDate(46280)).toBe('2026-09-15');
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('extracto con débito, crédito y saldo (títulos después del encabezado del banco)', () => {
    const rows: Cell[][] = [
      ['Banco', null, null],
      ['Cuenta: 001234567', null, null],
      [],
      ['Fecha', 'Descripción', 'Número de documento', 'Débito', 'Crédito', 'Saldo'],
      ['01/09/2026', 'SALDO ANTERIOR', null, null, null, '10.000,00'],
      ['02/09/2026', 'COMPRA CON TARJETA DEBITO TATA 4589', '123', '1.250,50', null, '8.749,50'],
      ['05/09/2026', 'TRANSFERENCIA RECIBIDA', '124', null, '50.000,00', '58.749,50'],
    ];
    const map = detectColumns(rows)!;
    expect(map).toMatchObject({ header: 3, date: 0, description: [1], debit: 3, credit: 4, balance: 5 });
    const lines = statementLines(rows, map, 'UYU');
    expect(lines.map((l) => [l.date, l.amount])).toEqual([
      ['2026-09-02', -1250.5],
      ['2026-09-05', 50000],
    ]);
    expect(cleanDescription(lines[0].description)).toBe('Tata');
  });

  it('una sola columna de importe, y sin títulos', () => {
    const withAmount: Cell[][] = [
      ['Fecha', 'Concepto', 'Importe', 'Saldo'],
      ['03/09/2026', 'UTE', '-2.300,00', '7.700,00'],
    ];
    expect(statementLines(withAmount, detectColumns(withAmount)!, 'UYU')[0].amount).toBe(-2300);
    const bare: Cell[][] = [
      ['03/09/2026', 'FARMACIA', -450, 9550],
      ['04/09/2026', 'KIOSCO', -90, 9460],
      ['06/09/2026', 'DEVOLUCION', 120, 9580],
    ];
    const m = detectColumns(bare)!;
    expect(m).toMatchObject({ header: -1, date: 0, description: [1], amount: 2, balance: 3 });
  });

  it('tarjeta: los gastos vienen en positivo y en pesos y dólares', () => {
    const rows: Cell[][] = [
      ['Fecha', 'Comercio', 'Importe $', 'Importe U$S'],
      ['10/09/2026', 'NETFLIX', null, '12,99'],
      ['12/09/2026', 'TIENDA 3/6', '1.000,00', null],
    ];
    const map = detectColumns(rows)!;
    expect(map).toMatchObject({ amount: 2, amountUSD: 3 });
    const lines = statementLines(rows, map, 'UYU', true);
    expect(lines.map((l) => [l.amount, l.currency])).toEqual([
      [-12.99, 'USD'],
      [-1000, 'UYU'],
    ]);
  });
});

describe('conciliar', () => {
  const lines = (rows: [string, string, number, number?][]) =>
    rows.map(([date, description, amount, balance], row) => ({
      row,
      date,
      description,
      amount,
      currency: 'UYU' as const,
      balance: balance ?? null,
    }));

  it('lo que coincide, lo que falta anotar, lo repetido y lo que está solo en Lifty', () => {
    const d = base();
    d.accounts = d.accounts.map((a) =>
      a.id === 'acc-brou' ? { ...a, initialBalance: 10000, initialBalanceDate: '2026-08-31' } : a,
    );
    d.rules = [ruleSchema.parse({ id: 'r', contains: 'farmashop', categoryId: 'cat-salud' })];
    d.transactions = [
      tx({ id: 'super', date: '2026-09-03', amount: 1250.5, description: 'Súper Tata', categoryId: 'cat-super' }),
      // Cargado dos veces.
      tx({ id: 'super2', date: '2026-09-02', amount: 1250.5, description: 'Tata', categoryId: 'cat-super' }),
      tx({ id: 'sueldo', kind: 'income', date: '2026-09-05', amount: 50000, description: 'Sueldo', categoryId: 'cat-sueldo' }),
      // En Lifty pero no en el banco (¿lo pagaste en efectivo?).
      tx({ id: 'cena', date: '2026-09-06', amount: 800, description: 'Cena' }),
    ];
    d.debts = [
      debtSchema.parse({ id: 'm', person: 'Martín', direction: 'lent', amount: 1500, date: '2026-09-07', accountId: 'acc-brou' }),
    ];
    const r = reconcile(
      d,
      'acc-brou',
      lines([
        ['2026-09-02', 'COMPRA CON TARJETA DEBITO TATA 4589', -1250.5, 8749.5],
        ['2026-09-05', 'TRANSFERENCIA RECIBIDA', 50000, 58749.5],
        ['2026-09-07', 'TRANSFERENCIA A MARTIN', -1500, 57249.5],
        ['2026-09-08', 'FARMASHOP 22', -640, 56609.5],
        ['2026-09-09', 'PAGO TARJETA DE CREDITO', -3000, 53609.5],
      ]),
    )!;
    expect(r.matched.map((m) => m.movement.id)).toEqual(['tx:super2', 'tx:sueldo', 'debt:m']);
    expect(r.repeated.map((m) => m.id)).toEqual(['tx:super']);
    expect(r.extra.map((m) => m.id)).toEqual(['tx:cena']);
    expect(r.missing.map((m) => [m.kind, m.description, m.categoryId, m.toAccountId])).toEqual([
      ['transfer', 'Pago Tarjeta de crédito', null, 'acc-tarjeta'],
      ['expense', 'Farmashop', 'cat-salud', null],
    ]);
    // Saldo: el banco dice 53.609,50; Lifty, sin lo que falta y con lo repetido y la cena, otra cosa.
    expect(r.balance).toMatchObject({ date: '2026-09-09', bank: 53609.5 });
    expect(r.balance!.lifty).toBe(10000 - 1250.5 * 2 + 50000 - 800 - 1500);
  });

  it('tarjeta: las cuotas de compras viejas coinciden con su renglón y no aparecen como "solo en Lifty"', () => {
    const d = base();
    // Sin débito automático (si no, el pago del resumen de agosto aparece como "solo en Lifty").
    d.accounts = d.accounts.map((a) => (a.id === 'acc-tarjeta' ? { ...a, autopay: false } : a));
    d.transactions = [
      tx({ id: 'tv', accountId: 'acc-tarjeta', date: '2026-07-15', amount: 6000, installments: 6, description: 'Tele' }),
      tx({ id: 'cafe', accountId: 'acc-tarjeta', date: '2026-09-10', amount: 300, description: 'Café' }),
    ];
    const r = reconcile(
      d,
      'acc-tarjeta',
      lines([
        ['2026-07-15', 'TIENDA TELE 3/6', -1000],
        ['2026-09-10', 'CAFE', -300],
      ]),
    )!;
    expect(r.matched.map((m) => m.movement.id)).toEqual(['tx:tv:1', 'tx:cafe:1']);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('en el estado de la tarjeta, lo que entra es tu pago: se anota como "Mover" desde el banco al resumen', () => {
    const d = base();
    d.accounts = d.accounts.map((a) => (a.id === 'acc-tarjeta' ? { ...a, payDay: 10 } : a));
    const r = reconcile(d, 'acc-tarjeta', lines([['2026-09-10', 'SU PAGO', 4200]]))!;
    expect(r.missing[0]).toMatchObject({
      kind: 'transfer',
      accountId: 'acc-brou',
      toAccountId: 'acc-tarjeta',
      linkMonth: '2026-08',
    });
  });
});
