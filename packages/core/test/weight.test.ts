import { describe, expect, it } from 'vitest';
import { bmi, bmiLabel, dailyWeights, movingAverage, weightSchema, weightStats } from '../src';

const w = (date: string, kg: number, updatedAt = `${date}T08:00:00Z`) =>
  weightSchema.parse({ id: `${date}-${kg}`, date, kg, updatedAt });

describe('peso', () => {
  it('calcula el IMC', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2);
    expect(bmiLabel(24.69)).toBe('Normal');
    expect(bmiLabel(31)).toBe('Obesidad');
  });

  it('usa un valor por día (el último cargado)', () => {
    const pts = dailyWeights([
      w('2026-01-02', 80, '2026-01-02T08:00:00Z'),
      w('2026-01-02', 79.5, '2026-01-02T20:00:00Z'),
      w('2026-01-01', 81),
    ]);
    expect(pts).toEqual([
      { date: '2026-01-01', kg: 81 },
      { date: '2026-01-02', kg: 79.5 },
    ]);
  });

  it('promedia los últimos 7 días calendario', () => {
    const avg = movingAverage([
      { date: '2026-01-01', kg: 80 },
      { date: '2026-01-05', kg: 78 },
      { date: '2026-01-09', kg: 76 },
    ]);
    expect(avg.map((p) => p.kg)).toEqual([80, 79, 77]);
  });

  it('resume cambios, meta e IMC', () => {
    const entries = [w('2026-01-01', 84), w('2026-01-24', 82), w('2026-01-31', 81)];
    const s = weightStats(entries, { heightCm: 180, goalKg: 78 });
    expect(s.latest).toEqual({ date: '2026-01-31', kg: 81 });
    expect(s.change7).toBe(-1);
    expect(s.change30).toBe(-3);
    expect(s.toGoal).toBe(3);
    expect(s.bmi).toBeCloseTo(25, 0);
    expect(s.min).toBe(81);
    expect(s.max).toBe(84);
  });

  it('sin datos devuelve todo vacío', () => {
    expect(weightStats([]).latest).toBeNull();
  });

  it('valida pesos razonables', () => {
    expect(() => weightSchema.parse({ id: 'x', date: '2026-01-01', kg: 5 })).toThrow();
  });
});
