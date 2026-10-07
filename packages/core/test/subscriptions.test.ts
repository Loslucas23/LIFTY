import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  defaultSettings,
  fixedSchema,
  seedRecords,
  subscriptionReview,
  toLiftyData,
  todayAgenda,
  computeMonths,
  type RecordStore,
} from '../src';

describe('revisar suscripciones', () => {
  const base = () => {
    const store: RecordStore = {};
    for (const { entity, record } of seedRecords())
      applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
    return { ...toLiftyData(store), settings: { ...defaultSettings(), usdRate: 40 } };
  };

  it('pregunta por las suscripciones (por categoría o por nombre) y lleva la cuenta de lo que ahorrás', () => {
    const d = base();
    d.fixed = [
      fixedSchema.parse({ id: 'n', name: 'Netflix', amount: 500, startMonth: '2026-01' }),
      fixedSchema.parse({
        id: 's',
        name: 'Música',
        amount: 300,
        startMonth: '2026-01',
        categoryId: 'cat-suscripciones',
        reviewedMonth: '2026-10',
      }),
      fixedSchema.parse({
        id: 'h',
        name: 'HBO',
        amount: 10,
        currency: 'USD',
        startMonth: '2026-01',
        endMonth: '2026-07',
        cancelled: true,
      }),
      fixedSchema.parse({ id: 'a', name: 'Alquiler', amount: 20000, startMonth: '2026-01' }),
    ];
    const r = subscriptionReview(d, '2026-10-03');
    expect(r.active.map((a) => [a.fixed.name, a.reviewed])).toEqual([
      ['Netflix', false],
      ['Música', true],
    ]);
    expect(r.pending).toBe(1);
    // HBO: US$ 10 = $ 400 por mes, sin pagar desde agosto: agosto, setiembre y octubre.
    expect(r).toMatchObject({ savedMonthly: 400, savedYearly: 4800, savedSoFar: 1200 });
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-03');
    expect(todayAgenda(d, b, '2026-10-03').items.find((i) => i.kind === 'subs')?.detail).toContain('1 para revisar');
    expect(todayAgenda(d, b, '2026-10-15').items.find((i) => i.kind === 'subs')).toBeUndefined();
  });
});
