import { describe, expect, it } from 'vitest';
import { formatMoney, formatNumber } from '../src/money';

/** El formato hecho a mano tiene que dar lo mismo que Intl en es-UY. */
describe('formatNumber', () => {
  const intl = (n: number, max: number, min = max) =>
    new Intl.NumberFormat('es-UY', { maximumFractionDigits: max, minimumFractionDigits: min }).format(n);

  it('coincide con Intl en montos enteros, con centavos y con un decimal', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const values = [0, 1, 5, 999, 1000, 1234, 12345, 999999, 1000000, 1234567.89, 0.5, 1.005, 2.675, 12.35, 0.05, 99.995];
    for (let i = 0; i < 2000; i++) values.push(Math.round(rand() * 10 ** (1 + (i % 8)) * 100) / 100, rand() * 10 ** (i % 7));
    for (const v of values) {
      expect(formatNumber(v, 0)).toBe(intl(v, 0));
      expect(formatNumber(v, 2)).toBe(intl(v, 2));
      expect(formatNumber(v, 1, 0)).toBe(intl(v, 1, 0));
      expect(formatNumber(-v, 2)).toBe(intl(-v, 2).replace(/^-0,00$/, '0,00'));
    }
  });

  it('formatMoney con símbolo y signo', () => {
    expect(formatMoney(1234)).toBe('$ 1.234');
    expect(formatMoney(-1234.5)).toBe('-$ 1.234,50');
    expect(formatMoney(12.3, 'USD')).toBe('US$ 12,30');
    expect(formatMoney(1500.4, 'UYU', { decimals: false })).toBe('$ 1.500');
  });
});
