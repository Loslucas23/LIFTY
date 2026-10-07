import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  autopilot,
  autopilotMutations,
  computeMonth,
  defaultSettings,
  fixedSchema,
  incomeSchema,
  matchRule,
  ruleSchema,
  seedRecords,
  stockItemSchema,
  stockMoveSchema,
  suggestRules,
  toLiftyData,
  transactionSchema,
  undoAutopilot,
  type LiftyData,
  type Mutation,
  type RecordStore,
} from '../src';

/** Arma los datos desde un store, para poder aplicar las mutaciones del piloto como la app. */
function build(partial: Partial<LiftyData>, settings: Partial<LiftyData['settings']> = {}) {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  const lists: [string, { id: string }[] | undefined][] = [
    ['income', partial.incomes],
    ['fixed', partial.fixed],
    ['transaction', partial.transactions],
    ['rule', partial.rules],
    ['stockItem', partial.stockItems],
    ['stockMove', partial.stockMoves],
  ];
  for (const [entity, list] of lists)
    for (const r of list ?? [])
      applyMutation(store, { entity, op: 'upsert', id: r.id, updatedAt: '2026-01-01T00:00:00Z', record: r });
  const data = () => ({ ...toLiftyData(store), settings: { ...defaultSettings(), startMonth: '2026-09', ...settings } });
  const apply = (ms: Mutation[]) => ms.forEach((m) => applyMutation(store, m));
  return { data, apply };
}

describe('piloto automático', () => {
  const today = '2026-10-21';

  it('marca pagados los fijos con débito y cobrado el sueldo, una sola vez', () => {
    const { data, apply } = build({
      incomes: [
        incomeSchema.parse({
          id: 'job',
          name: 'Sueldo',
          gross: 40000,
          netOverride: 40000,
          startMonth: '2026-09',
          payDay: 5,
          autoConfirm: true,
        }),
      ],
      fixed: [
        fixedSchema.parse({ id: 'ute', name: 'UTE', amount: 1800, startMonth: '2026-09', dayOfMonth: 20, autopay: true }),
        fixedSchema.parse({ id: 'rent', name: 'Alquiler', amount: 16000, startMonth: '2026-09', dayOfMonth: 10 }),
        fixedSchema.parse({ id: 'gym', name: 'Gimnasio', amount: 1500, startMonth: '2026-09', dayOfMonth: 25, autopay: true }),
      ],
    });
    const actions = autopilot(data(), computeMonth(data(), '2026-10', today), today);
    // UTE vence el 20 (ya pasó) y se debita; el alquiler no tiene débito; el gimnasio vence el 25.
    expect(actions.map((a) => a.key)).toEqual(['fixed:ute:2026-10', 'income:job:2026-10']);
    expect(actions[0].records[0].record).toMatchObject({
      kind: 'expense',
      amount: 1800,
      date: '2026-10-20',
      linkKind: 'fixed',
      linkId: 'ute',
    });
    apply(autopilotMutations(actions, today));
    const b = computeMonth(data(), '2026-10', today);
    expect(b.fixed.items.find((l) => l.refId === 'ute')?.confirmed).toBe(true);
    expect(b.income.pending).toBe(0);
    // La segunda vez no hace nada.
    expect(autopilot(data(), b, today)).toEqual([]);
  });

  it('ahorra solo lo que falta de la meta cuando ya cobraste, y deshacer no lo repite', () => {
    const { data, apply } = build(
      {
        incomes: [
          incomeSchema.parse({
            id: 'job',
            name: 'Sueldo',
            gross: 40000,
            netOverride: 40000,
            startMonth: '2026-09',
            payDay: 5,
            autoConfirm: true,
          }),
        ],
        transactions: [
          transactionSchema.parse({ id: 's1', date: '2026-10-06', kind: 'saving', amount: 1000, goalId: 'goal-uyu' }),
        ],
      },
      { savingsMode: 'amount', savingsValue: 4000, autoSave: true },
    );
    // Primero se cobra el sueldo (y en la misma pasada todavía no ahorra: falta cobrar).
    const first = autopilot(data(), computeMonth(data(), '2026-10', today), today);
    expect(first.map((a) => a.kind)).toEqual(['income']);
    apply(autopilotMutations(first, today));
    const second = autopilot(data(), computeMonth(data(), '2026-10', today), today);
    expect(second.map((a) => [a.key, a.records[0].record])).toEqual([
      ['saving:2026-10', expect.objectContaining({ kind: 'saving', amount: 3000, goalId: 'goal-uyu' })],
    ]);
    apply(autopilotMutations(second, today));
    expect(computeMonth(data(), '2026-10', today).savingsGoal.pending).toBe(0);
    // Deshacer: se borra el ahorro y no se vuelve a hacer.
    const log = data().autoLogs.find((l) => l.id === 'saving:2026-10')!;
    apply(undoAutopilot(log));
    expect(data().transactions.some((t) => t.id === second[0].records[0].record.id)).toBe(false);
    expect(autopilot(data(), computeMonth(data(), '2026-10', today), today)).toEqual([]);
  });

  it('categoriza con reglas lo que quedó sin categoría y sugiere reglas', () => {
    const { data, apply } = build({
      rules: [ruleSchema.parse({ id: 'r1', contains: 'uber', categoryId: 'cat-transporte' })],
      transactions: [
        transactionSchema.parse({ id: 'a', date: '2026-10-10', kind: 'expense', amount: 300, description: 'Uber al centro' }),
        transactionSchema.parse({ id: 'b', date: '2026-10-11', kind: 'expense', amount: 300, description: 'Kiosco' }),
        ...[1, 2, 3, 4].map((i) =>
          transactionSchema.parse({
            id: `f${i}`,
            date: `2026-09-0${i}`,
            kind: 'expense',
            amount: 500,
            description: 'Farmacia',
            categoryId: 'cat-salud',
          }),
        ),
      ],
    });
    expect(matchRule(data().rules, 'UBER noche')?.id).toBe('r1');
    const actions = autopilot(data(), computeMonth(data(), '2026-10', today), today);
    expect(actions.map((a) => a.key)).toEqual(['category:a']);
    apply(autopilotMutations(actions, today));
    expect(data().transactions.find((t) => t.id === 'a')?.categoryId).toBe('cat-transporte');
    // Deshacer vuelve a "sin categoría".
    apply(undoAutopilot(data().autoLogs[0]));
    expect(data().transactions.find((t) => t.id === 'a')?.categoryId).toBeNull();
    expect(suggestRules(data())).toEqual([{ contains: 'farmacia', categoryId: 'cat-salud', count: 4 }]);
  });

  it('manda a la lista lo que se termina, una vez por compra', () => {
    const { data, apply } = build(
      {
        stockItems: [stockItemSchema.parse({ id: 'leche', name: 'Leche', unit: 'l' })],
        stockMoves: [stockMoveSchema.parse({ id: 'm1', itemId: 'leche', date: '2026-10-01', kind: 'count', quantity: 0 })],
      },
      { autoShop: true },
    );
    const actions = autopilot(data(), computeMonth(data(), '2026-10', today), today);
    expect(actions.map((a) => [a.key, a.records[0].record])).toEqual([
      ['shop:leche:nunca', expect.objectContaining({ itemId: 'leche', name: 'Leche', checked: false })],
    ]);
    apply(autopilotMutations(actions, today));
    expect(autopilot(data(), computeMonth(data(), '2026-10', today), today)).toEqual([]);
  });
});
