import { describe, expect, it } from 'vitest';
import { defaultSettings, fxNews, fxRateSchema } from '../src';

describe('dólar automático: aviso', () => {
  const rates = (values: number[]) =>
    values.map((rate, i) => fxRateSchema.parse({ id: `d${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, rate }));

  it('avisa cuando baja a lo que querías o 2% por debajo del promedio del mes', () => {
    const flat = rates([40, 40, 40, 40, 40, 40]);
    expect(fxNews({ fxRates: flat, settings: defaultSettings() }, '2026-10-06')).toMatchObject({ rate: 40, good: false });
    const drop = rates([40, 40, 40, 40, 40, 38.8]);
    expect(fxNews({ fxRates: drop, settings: defaultSettings() }, '2026-10-06')).toMatchObject({ good: true, change: -2.51 });
    expect(fxNews({ fxRates: drop, settings: defaultSettings() }, '2026-10-06')?.reason).toContain('2,5%');
    expect(fxNews({ fxRates: flat, settings: { ...defaultSettings(), rateAlert: 40 } }, '2026-10-06')?.reason).toContain(
      '40 o menos',
    );
    expect(fxNews({ fxRates: [], settings: defaultSettings() }, '2026-10-06')).toBeNull();
  });
});
