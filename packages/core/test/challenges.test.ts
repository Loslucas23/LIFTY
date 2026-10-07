import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  challengeSchema,
  challengeStatus,
  computeMonths,
  defaultSettings,
  habitLogSchema,
  habitSchema,
  seedRecords,
  suggestChallenges,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>, settings: Partial<LiftyData['settings']> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-07', ...settings } };
}
const spend = (id: string, date: string, amount: number, categoryId = 'cat-comida') =>
  transactionSchema.parse({ id, date, kind: 'expense', amount, categoryId });
const ch = (p: object) =>
  challengeSchema.parse({ id: 'c', name: 'Desafío', target: 7, from: '2026-10-01', to: '2026-10-07', ...p });

describe('desafíos', () => {
  it('7 días sin pedir comida: se pierde si gastás en esa categoría', () => {
    const c = ch({ kind: 'no-spend-category', categoryId: 'cat-comida' });
    expect(challengeStatus(c, data({}), '2026-10-04')).toMatchObject({ status: 'active', text: '4 de 7 días', daysLeft: 3 });
    expect(challengeStatus(c, data({}), '2026-10-09')).toMatchObject({ status: 'won' });
    const d = data({ transactions: [spend('t', '2026-10-03', 500)] });
    expect(challengeStatus(c, d, '2026-10-04')).toMatchObject({ status: 'lost', text: 'Gastaste el 03/10' });
  });

  it('no pasar de un tope y días sin gastar', () => {
    const d = data({ transactions: [spend('a', '2026-10-02', 3000), spend('b', '2026-10-03', 1500)] });
    expect(challengeStatus(ch({ kind: 'spend-under', categoryId: 'cat-comida', target: 5000 }), d, '2026-10-04')).toMatchObject({
      status: 'active',
      text: '$ 4.500 de $ 5.000',
    });
    // Días sin gastar: 1 y (hoy, día 4, todavía no cuenta) → 1 de 3; quedan 4 días (4 al 7): se puede.
    const free = ch({ kind: 'no-spend-days', target: 3 });
    expect(challengeStatus(free, d, '2026-10-04')).toMatchObject({ status: 'active', text: '1 de 3 días sin gastar' });
    expect(challengeStatus(free, d, '2026-10-08')).toMatchObject({ status: 'won', text: '5 de 3 días sin gastar' });
  });

  it('rutina: se pierde cuando ya no te dan los días', () => {
    const h = habitSchema.parse({ id: 'gym', name: 'Gimnasio', days: [1, 3, 5] });
    // Del jueves 1 al miércoles 7 de octubre de 2026: tocan vie 2, lun 5, mié 7.
    const c = ch({ kind: 'habit-days', habitId: 'gym', target: 3 });
    const logs = [habitLogSchema.parse({ id: 'gym:2026-10-02', habitId: 'gym', date: '2026-10-02', value: 1 })];
    expect(challengeStatus(c, data({ habits: [h], habitLogs: logs }), '2026-10-05')).toMatchObject({
      status: 'active',
      text: '1 de 3 días de Gimnasio',
    });
    // El lunes 5 no fue: ya no llega a 3.
    expect(challengeStatus(c, data({ habits: [h], habitLogs: logs }), '2026-10-06').status).toBe('lost');
  });

  it('sugiere desafíos según tus números', () => {
    const d = data(
      {
        transactions: [
          spend('a7', '2026-07-10', 3000, 'cat-ocio'),
          spend('a8', '2026-08-10', 3000, 'cat-ocio'),
          spend('a9', '2026-09-10', 3000, 'cat-ocio'),
          spend('b10', '2026-10-05', 2500, 'cat-ocio'),
        ],
      },
      { savingsMode: 'amount', savingsValue: 2000 },
    );
    const months = computeMonths(d, '2026-07', '2026-10', '2026-10-10');
    const ideas = suggestChallenges(d, months.slice(0, 3), months[3], '2026-10-10');
    expect(ideas.map((i) => i.key)).toEqual(['pace-cat-ocio', 'no-spend-week', 'save-month']);
    expect(ideas[0].challenge).toMatchObject({ kind: 'spend-under', target: 3000, from: '2026-10-01', to: '2026-10-31' });
  });
});
