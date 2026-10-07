import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  nextOccurrence,
  occasionDate,
  occasionSchema,
  occasionStatus,
  OCCASION_IDEAS,
  transactionSchema,
  upcomingOccasions,
} from '../src';

describe('fechas caras y cumpleaños', () => {
  it('fechas fijas y las que cambian (2.º domingo de mayo)', () => {
    const madre = OCCASION_IDEAS.find((o) => o.name === 'Día de la Madre')!;
    expect(occasionDate(madre, 2026)).toBe('2026-05-10');
    expect(occasionDate(madre, 2027)).toBe('2027-05-09');
    expect(nextOccurrence({ monthDay: '12-24', rule: null }, '2026-10-07')).toBe('2026-12-24');
    expect(nextOccurrence({ monthDay: '03-15', rule: null }, '2026-10-07')).toBe('2027-03-15');
    expect(nextOccurrence({ monthDay: '02-29', rule: null }, '2026-10-07')).toBe('2027-02-28');
  });

  it('cuánto apartar por mes y cuánto llevás gastado', () => {
    const fiestas = occasionSchema.parse({ id: 'f', name: 'Fiestas', monthDay: '12-24', budget: 9000, tag: 'fiestas' });
    const data = {
      settings: defaultSettings(),
      transactions: [
        transactionSchema.parse({ id: 't', kind: 'expense', date: '2026-11-20', amount: 3000, tags: ['Fiestas'] }),
        transactionSchema.parse({ id: 'u', kind: 'expense', date: '2025-12-20', amount: 5000, tags: ['fiestas'] }),
      ],
      occasions: [fiestas, occasionSchema.parse({ id: 'c', kind: 'cumple', name: 'Mamá', monthDay: '10-21', budget: 2000 })],
    };
    // 7/10: faltan 3 meses contando este (oct, nov, dic): 9.000 ÷ 3.
    expect(occasionStatus(data, fiestas, '2026-10-07')).toMatchObject({
      date: '2026-12-24',
      daysLeft: 78,
      months: 3,
      perMonth: 3000,
      spent: 0,
      soon: false,
    });
    // El 25/11 ya gastaste 3.000 (lo del año pasado no cuenta): faltan 6.000 en 2 meses.
    expect(occasionStatus(data, fiestas, '2026-11-25')).toMatchObject({ spent: 3000, perMonth: 3000, soon: true });
    expect(upcomingOccasions(data, '2026-10-07').map((s) => s.occasion.id)).toEqual(['c', 'f']);
  });
});
