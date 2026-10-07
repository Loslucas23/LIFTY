import { describe, expect, it } from 'vitest';
import { accountSchema, parseQuick } from '../src';

const acc = (id: string, name: string, type: 'bank' | 'cash' | 'credit' | 'food', currency: 'UYU' | 'USD' = 'UYU') =>
  accountSchema.parse({ id, name, type, currency, icon: '🏦' });
const data = {
  accounts: [
    acc('brou', 'BROU', 'bank'),
    acc('brou-usd', 'BROU dólares', 'bank', 'USD'),
    acc('itau', 'Itaú', 'bank'),
    acc('cash', 'Efectivo', 'cash'),
    acc('visa', 'Visa', 'credit'),
    acc('food', 'Tarjeta alimentación', 'food'),
  ],
};
const T = '2026-10-07'; // miércoles
const q = (s: string) => parseQuick(s, data, T);

describe('cargar con una frase', () => {
  it('«gasté 450 en la feria»', () => {
    expect(q('gasté 450 en la feria')).toMatchObject({
      kind: 'expense',
      amount: 450,
      currency: 'UYU',
      date: T,
      description: 'Feria',
      accountId: null,
      installments: null,
    });
    expect(q('gasté 450 en la feria').understood).toEqual(['gasto', '$ 450', '«Feria»']);
  });

  it('números con palabras, lucas, mil y miles con punto', () => {
    expect(q('gasté cuatrocientos cincuenta pesos en la feria')).toMatchObject({ amount: 450, description: 'Feria' });
    expect(q('dos lucas en el súper')).toMatchObject({ amount: 2000, description: 'Súper' });
    expect(q('luca y media de carne')).toMatchObject({ amount: 1500, description: 'Carne' });
    expect(q('pagué mil quinientos de luz')).toMatchObject({ amount: 1500, description: 'Luz' });
    expect(q('dos mil trescientos cincuenta en la farmacia').amount).toBe(2350);
    expect(q('2 mil 500 de nafta').amount).toBe(2500);
    expect(q('1.500 de nafta').amount).toBe(1500);
    expect(q('compré pan 120,50').amount).toBe(120.5);
    expect(q('treinta y cinco del bondi')).toMatchObject({ amount: 35, description: 'Bondi' });
    expect(q('3k de ropa').amount).toBe(3000);
  });

  it('fechas: ayer, anteayer, hace N días, el lunes, el 5, 3/10, 3 de octubre', () => {
    expect(q('ayer gasté 300 en uber')).toMatchObject({ date: '2026-10-06', description: 'Uber' });
    expect(q('anteayer 200 de pan').date).toBe('2026-10-05');
    expect(q('antes de ayer 200 de pan')).toMatchObject({ date: '2026-10-05', description: 'Pan' });
    expect(q('hace tres días 500 de pizza').date).toBe('2026-10-04');
    expect(q('el lunes 200 de pan')).toMatchObject({ date: '2026-10-05', description: 'Pan' });
    // Hoy es miércoles: «el miércoles» es el de la semana pasada.
    expect(q('el miércoles 200 de pan').date).toBe('2026-09-30');
    expect(q('pagué 300 el 5')).toMatchObject({ date: '2026-10-05', amount: 300 });
    // El 20 todavía no llegó: es el del mes pasado.
    expect(q('pagué 300 el 20').date).toBe('2026-09-20');
    expect(q('3/10 900 de gas')).toMatchObject({ date: '2026-10-03', amount: 900, description: 'Gas' });
    expect(q('el 3 de octubre 900 de gas')).toMatchObject({ date: '2026-10-03', description: 'Gas' });
    expect(q('25/12 900 de regalos').date).toBe('2025-12-25');
  });

  it('cuentas, cuotas y dólares', () => {
    expect(q('ayer 2 lucas de nafta con la visa en 3 cuotas')).toMatchObject({
      amount: 2000,
      description: 'Nafta',
      accountId: 'visa',
      installments: 3,
      date: '2026-10-06',
    });
    expect(q('450 en la feria en efectivo')).toMatchObject({ accountId: 'cash', description: 'Feria' });
    expect(q('gasté 450 en la feria con la tarjeta de alimentación')).toMatchObject({
      accountId: 'food',
      description: 'Feria',
    });
    expect(q('20 dólares de spotify')).toMatchObject({ amount: 20, currency: 'USD', description: 'Spotify' });
    expect(q('US$ 15 de netflix con BROU dólares')).toMatchObject({ currency: 'USD', accountId: 'brou-usd' });
    expect(q('con la tarjeta 800 de ropa')).toMatchObject({ accountId: 'visa', description: 'Ropa' });
    // «2 kilos» es cantidad, no plata.
    expect(q('2 kilos de tomate 180')).toMatchObject({ amount: 180 });
  });

  it('la tarjeta por su marca aunque se llame «Tarjeta de crédito»', () => {
    const one = { accounts: [acc('brou', 'BROU', 'bank'), acc('tc', 'Tarjeta de crédito', 'credit')] };
    expect(parseQuick('ayer 2 lucas de nafta con la visa en 3 cuotas', one, T)).toMatchObject({
      accountId: 'tc',
      description: 'Nafta',
      installments: 3,
    });
    expect(parseQuick('900 de ropa con la tarjeta de crédito', one, T)).toMatchObject({ accountId: 'tc', description: 'Ropa' });
    // Con dos tarjetas, la de la marca nombrada.
    const two = { accounts: [acc('v', 'Visa BROU', 'credit'), acc('o', 'OCA', 'credit')] };
    expect(parseQuick('500 de farmacia con la visa', two, T).accountId).toBe('v');
    expect(parseQuick('500 de farmacia con la tarjeta', two, T).accountId).toBeNull();
    // «tarjeta débito» no es la de crédito.
    expect(parseQuick('BROU: compra por $ 300 en DISCO con tarjeta débito', one, T).accountId).toBe('brou');
  });

  it('ingresos, ahorro y movimientos entre cuentas', () => {
    expect(q('cobré el sueldo 45000')).toMatchObject({ kind: 'income', amount: 45000, description: 'Sueldo' });
    expect(q('me pagaron 500 de la deuda')).toMatchObject({ kind: 'income', description: 'Deuda' });
    expect(q('me cobraron 90 de comisión')).toMatchObject({ kind: 'expense', description: 'Comisión' });
    expect(q('ahorré 3000')).toMatchObject({ kind: 'saving', amount: 3000 });
    expect(q('saqué 2000 del cajero con BROU')).toMatchObject({
      kind: 'transfer',
      amount: 2000,
      accountId: 'brou',
      toAccountId: 'cash',
      description: '',
    });
    expect(q('pasé 1000 de BROU a efectivo')).toMatchObject({ kind: 'transfer', accountId: 'brou', toAccountId: 'cash' });
  });

  it('el aviso del banco: monto con moneda, comercio, tarjeta y fecha', () => {
    const brou = q(
      'BROU informa: Compra aprobada por $ 1.234,00 en TIENDA INGLESA con tarjeta Débito terminada en 4589 el 05/10/2026 14:32',
    );
    expect(brou).toMatchObject({
      fromBank: true,
      kind: 'expense',
      amount: 1234,
      currency: 'UYU',
      description: 'Tienda Inglesa',
      accountId: 'brou',
      date: '2026-10-05',
    });
    const itau = q('Itaú: compra aprobada en FARMASHOP por UYU 850,00 con tarjeta Visa ***1234');
    expect(itau).toMatchObject({ amount: 850, description: 'Farmashop', accountId: 'visa' });
    expect(q('Santander: compra con tu tarjeta en AMAZON por USD 20,00')).toMatchObject({
      amount: 20,
      currency: 'USD',
      description: 'Amazon',
    });
    expect(q('BROU: transferencia recibida por $ 5.000 de JUAN PEREZ')).toMatchObject({ kind: 'income', amount: 5000 });
  });

  it('no inventa: sin número no hay monto', () => {
    expect(q('feria')).toMatchObject({ amount: null, description: 'Feria' });
    expect(q('')).toMatchObject({ amount: null, description: '', kind: 'expense' });
    expect(q('pagué 450 con la tarjeta terminada en 1234').amount).toBe(450);
  });
});
