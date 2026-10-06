import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  computeMonth,
  defaultSettings,
  fixedSchema,
  habitLogSchema,
  habitSchema,
  journalSchema,
  reminderSchema,
  searchAll,
  seedRecords,
  stockItemSchema,
  stockMoveSchema,
  studySessionSchema,
  subjectSchema,
  toLiftyData,
  todayAgenda,
  transactionSchema,
  weekSummary,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-10' } };
}

describe('para hoy', () => {
  it('junta plata, rutinas, estudio, stock, vencimientos y diario en una lista', () => {
    const today = '2026-10-11';
    const d = data({
      fixed: [fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 16000, startMonth: '2026-01', dayOfMonth: 10 })],
      habits: [
        habitSchema.parse({ id: 'agua', name: 'Agua', target: 8, unit: 'vasos' }),
        habitSchema.parse({ id: 'cama', name: 'Cama' }),
      ],
      habitLogs: [habitLogSchema.parse({ id: 'cama:2026-10-11', habitId: 'cama', date: today, value: 1 })],
      subjects: [subjectSchema.parse({ id: 'mate', name: 'Mate', examDate: '2026-10-21', goalHours: 10 })],
      studySessions: [studySessionSchema.parse({ id: 's', subjectId: 'mate', date: today, minutes: 30 })],
      stockItems: [stockItemSchema.parse({ id: 'leche', name: 'Leche', unit: 'l' })],
      stockMoves: [stockMoveSchema.parse({ id: 'm', itemId: 'leche', date: '2026-10-01', kind: 'count', quantity: 0 })],
      reminders: [reminderSchema.parse({ id: 'c', name: 'Cédula', date: '2026-10-20', notifyDays: 30 })],
      journal: [journalSchema.parse({ id: today, date: today, sleepHours: 7, mood: 4 })],
    });
    const a = todayAgenda(d, computeMonth(d, '2026-10', today), today);
    const byKind = (k: string) => a.items.filter((i) => i.kind === k);
    expect(byKind('fixed')[0]).toMatchObject({ title: 'Alquiler', urgency: 2, done: false });
    expect(byKind('habit').map((i) => [i.refId, i.done])).toEqual([
      ['agua', false],
      ['cama', true],
    ]);
    // 10 h en 10 días = 60 min por día; hoy van 30.
    expect(byKind('study')[0]).toMatchObject({ done: false, progress: { value: 30, target: 60, unit: 'min' } });
    expect(byKind('stock')[0]).toMatchObject({ refId: 'leche', urgency: 2 });
    expect(byKind('reminder')[0]).toMatchObject({ title: '📌 Cédula', urgency: 0 });
    expect(byKind('journal')[0].done).toBe(true);
    // Hechos: cama y diario. Cuentan todos menos el vencimiento que no es urgente.
    expect([a.done, a.total]).toEqual([2, 6]);
    // Lo pendiente primero.
    expect(a.items[a.items.length - 1].done).toBe(true);
  });
});

describe('buscar en todo', () => {
  it('encuentra sin tildes, en varios módulos y por monto', () => {
    const d = data({
      stockItems: [stockItemSchema.parse({ id: 'az', name: 'Azúcar', unit: 'kg' })],
      transactions: [
        transactionSchema.parse({ id: 't1', date: '2026-10-02', kind: 'expense', amount: 1500, description: 'Azúcar y yerba' }),
        transactionSchema.parse({
          id: 't2',
          date: '2026-10-05',
          kind: 'expense',
          amount: 320,
          description: 'Cabify',
          tags: ['viaje'],
        }),
      ],
    });
    expect(searchAll(d, 'azucar').map((r) => [r.kind, r.id])).toEqual([
      ['stock', 'az'],
      ['movement', 't1'],
    ]);
    expect(searchAll(d, '1500').map((r) => r.id)).toEqual(['t1']);
    expect(searchAll(d, '#viaje').map((r) => r.id)).toEqual(['t2']);
    expect(searchAll(d, 'a')).toEqual([]);
  });
});

describe('tu semana, más completa', () => {
  it('suma sueño, compras del súper y lo que vence la semana siguiente', () => {
    const d = data({
      journal: [
        journalSchema.parse({ id: '2026-10-06', date: '2026-10-06', sleepHours: 6, mood: 3 }),
        journalSchema.parse({ id: '2026-10-07', date: '2026-10-07', sleepHours: 8, mood: 5 }),
      ],
      stockMoves: [stockMoveSchema.parse({ id: 'b', itemId: 'x', date: '2026-10-08', kind: 'buy', quantity: 2, price: 900 })],
      reminders: [reminderSchema.parse({ id: 'r', name: 'Seguro', date: '2026-10-15' })],
    });
    const w = weekSummary(d, '2026-10-05', '2026-10-11');
    expect(w.sleep).toEqual({ hours: 7, mood: 4, days: 2 });
    expect(w.groceries).toBe(900);
    expect(w.nextWeek).toEqual([{ name: 'Seguro', date: '2026-10-15' }]);
  });
});
