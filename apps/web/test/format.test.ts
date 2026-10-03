import { describe, expect, it } from 'vitest';
import { parseAmount } from '../src/lib/format';

describe('parseAmount', () => {
  it('entiende los formatos de Uruguay', () => {
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseAmount('3.49')).toBe(3.49);
    expect(parseAmount('$ 900')).toBe(900);
    expect(parseAmount('1.000.000')).toBe(1000000);
  });

  it('hace cuentas simples como la planilla', () => {
    expect(parseAmount('8000+5600')).toBe(13600);
    expect(parseAmount('600+900-20')).toBe(1480);
    expect(parseAmount('-370')).toBe(-370);
  });

  it('rechaza lo que no es un monto', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('hola')).toBeNull();
    expect(parseAmount('2*3')).toBeNull();
  });
});
