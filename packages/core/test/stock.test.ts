import { describe, expect, it } from 'vitest';
import { shoppingListText, stockItemSchema, stockLevel, stockMoveSchema, stockOverview, stockStatus } from '../src';

let seq = 0;
const move = (m: Record<string, unknown>) =>
  stockMoveSchema.parse({ id: `m${++seq}`, updatedAt: String(seq).padStart(4, '0'), ...m });
const settings = { shoppingDays: 7 };

const arroz = stockItemSchema.parse({ id: 'arroz', name: 'Arroz', unit: 'kg', packSize: 1 });
const arrozMoves = [
  move({ itemId: 'arroz', date: '2026-09-01', kind: 'buy', quantity: 3, price: 150, store: 'Disco' }),
  // Conté y quedaba 1,5: se usaron 1,5 sin anotar.
  move({ itemId: 'arroz', date: '2026-09-15', kind: 'count', quantity: 1.5 }),
  move({ itemId: 'arroz', date: '2026-09-20', kind: 'buy', quantity: 2, price: 110, store: 'Tienda Inglesa' }),
  move({ itemId: 'arroz', date: '2026-10-01', kind: 'use', quantity: 1 }),
];

describe('stock', () => {
  it('lleva la cantidad con compras, usos y conteos', () => {
    expect(stockLevel(arrozMoves)).toBe(2.5);
    expect(stockLevel(arrozMoves, '2026-09-16')).toBe(1.5);
  });

  it('calcula cuánto usás, cuánto te dura y los precios', () => {
    const s = stockStatus(arroz, arrozMoves, '2026-10-01', settings);
    // 1,5 (bajó al contar) + 1 (anotado) en 30 días.
    expect(s.usage).toMatchObject({ from: '2026-09-01', days: 30, used: 2.5, confident: true });
    expect(s.daysLeft).toBe(30);
    expect(s.runsOut).toBe('2026-10-31');
    expect(s.need).toBe('ok');
    // Por kg: 50 en Disco, 55 en Tienda Inglesa (+10%).
    expect(s.prices).toMatchObject({ last: 55, previous: 50, change: 10, average: 52 });
    expect(s.prices.cheapestStore).toEqual({ store: 'Disco', unitPrice: 50 });
    // 2,5 kg cada 30 días × $ 52 el kg.
    expect(s.monthlyCost).toBe(130);
  });

  it('pide comprar para cubrir los días hasta la próxima compra, redondeando al paquete', () => {
    const s = stockStatus(arroz, arrozMoves, '2026-10-01', { shoppingDays: 40 });
    expect(s.need).toBe('low');
    // Para 40 + 2 días hacen falta 3,5 kg; hay 2,5 → 1 kg (paquetes de 1 kg) ≈ $ 55.
    expect(s.toBuy).toBe(1);
    expect(s.estimatedCost).toBe(55);
  });

  it('avisa con el mínimo y cuando no queda nada', () => {
    const leche = stockItemSchema.parse({ id: 'leche', name: 'Leche', unit: 'l', minQuantity: 2 });
    const low = stockStatus(
      leche,
      [move({ itemId: 'leche', date: '2026-10-01', kind: 'buy', quantity: 1 })],
      '2026-10-01',
      settings,
    );
    expect(low).toMatchObject({ need: 'low', toBuy: 1 });
    const yerba = stockItemSchema.parse({ id: 'yerba', name: 'Yerba', unit: 'paq', packSize: 2 });
    const out = stockStatus(
      yerba,
      [move({ itemId: 'yerba', date: '2026-10-01', kind: 'count', quantity: 0 })],
      '2026-10-01',
      settings,
    );
    expect(out).toMatchObject({ need: 'out', toBuy: 2 });
  });

  it('sabe qué vence (usás primero lo más viejo) y cuánto tiraste', () => {
    const yogur = stockItemSchema.parse({ id: 'yogur', name: 'Yogur', unit: 'u' });
    const moves = [
      move({ itemId: 'yogur', date: '2026-09-28', kind: 'buy', quantity: 6, price: 300, expiry: '2026-10-03' }),
      move({ itemId: 'yogur', date: '2026-09-30', kind: 'use', quantity: 4 }),
      move({ itemId: 'yogur', date: '2026-10-01', kind: 'buy', quantity: 6, price: 300, expiry: '2026-10-10' }),
      move({ itemId: 'yogur', date: '2026-10-01', kind: 'waste', quantity: 1 }),
    ];
    const s = stockStatus(yogur, moves, '2026-10-01', settings);
    expect(s.quantity).toBe(7);
    expect(s.batches).toEqual([
      { date: '2026-09-28', expiry: '2026-10-03', quantity: 1 },
      { date: '2026-10-01', expiry: '2026-10-10', quantity: 6 },
    ]);
    expect(s.wasted).toEqual({ quantity: 1, cost: 50 });
    const o = stockOverview([yogur, arroz], [...moves, ...arrozMoves], '2026-10-01', settings);
    expect(o.expiring.map((e) => [e.status.item.name, e.daysLeft, e.batch.quantity])).toEqual([['Yogur', 2, 1]]);
  });

  it('arma la lista de compras con su costo estimado', () => {
    const o = stockOverview([arroz], arrozMoves, '2026-10-01', { shoppingDays: 40 });
    expect(o.shopping.map((s) => s.item.name)).toEqual(['Arroz']);
    expect(o.shoppingCost).toBe(55);
    expect(shoppingListText(o.shopping.map((s) => ({ status: s, quantity: s.toBuy })))).toBe('• Arroz: 1 kg');
  });
});
