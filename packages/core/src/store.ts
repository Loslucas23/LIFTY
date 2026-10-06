import { defaultSettings } from './defaults';
import type { EntityName, EntityTypes, LiftyData, Mutation } from './schema';

/** Registros agrupados por entidad e id: la forma en que el cliente guarda los datos. */
export type RecordStore = { [E in EntityName]?: Record<string, EntityTypes[E]> } & {
  [entity: string]: Record<string, { id: string; updatedAt: string }> | undefined;
};

/** Gana el cambio más nuevo (last-write-wins). Devuelve true si se aplicó. */
export function isNewer(incoming: string, existing: string | undefined): boolean {
  return existing === undefined || incoming >= existing;
}

/** Aplica una mutación a un RecordStore (en el lugar). */
export function applyMutation(store: RecordStore, m: Mutation): void {
  const table = (store[m.entity] ??= {});
  const current = table[m.id];
  if (current && !isNewer(m.updatedAt, current.updatedAt)) return;
  if (m.op === 'delete') delete table[m.id];
  else table[m.id] = { ...(m.record as object), id: m.id, updatedAt: m.updatedAt } as never;
}

const bySort = <T extends { sort: number; name: string }>(a: T, b: T) => a.sort - b.sort || a.name.localeCompare(b.name);

export function toLiftyData(store: RecordStore): LiftyData {
  const list = <E extends EntityName>(e: E) => Object.values(store[e] ?? {}) as EntityTypes[E][];
  return {
    settings: { ...defaultSettings(), ...(store.settings?.main ?? {}) },
    accounts: list('account').sort(bySort),
    categories: list('category').sort(bySort),
    transactions: list('transaction').sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)),
    incomes: list('income').sort((a, b) => a.startMonth.localeCompare(b.startMonth)),
    fixed: list('fixed').sort((a, b) => (a.dayOfMonth ?? 99) - (b.dayOfMonth ?? 99) || a.name.localeCompare(b.name)),
    goals: list('goal').sort((a, b) => a.name.localeCompare(b.name)),
    closings: list('closing').sort((a, b) => a.id.localeCompare(b.id)),
    budgets: list('budget').sort((a, b) => a.id.localeCompare(b.id)),
    debts: list('debt').sort((a, b) => b.date.localeCompare(a.date)),
    stockItems: list('stockItem').sort((a, b) => a.name.localeCompare(b.name, 'es')),
    shopEntries: list('shopEntry').sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'es')),
    habits: list('habit').sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'es')),
    habitLogs: list('habitLog').sort((a, b) => a.date.localeCompare(b.date)),
    subjects: list('subject').sort(
      (a, b) => (a.examDate ?? '9999').localeCompare(b.examDate ?? '9999') || a.name.localeCompare(b.name, 'es'),
    ),
    studySessions: list('studySession').sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)),
    yearGoals: list('yearGoal').sort((a, b) => a.name.localeCompare(b.name, 'es')),
    recipes: list('recipe').sort((a, b) => a.name.localeCompare(b.name, 'es')),
    journal: list('journal').sort((a, b) => a.date.localeCompare(b.date)),
    reminders: list('reminder').sort((a, b) => a.date.localeCompare(b.date)),
    stockMoves: list('stockMove').sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt)),
    weights: list('weight').sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt)),
  };
}

/**
 * La bandeja de salida guarda solo el último cambio de cada registro: si sin conexión editás
 * 10 veces el mismo gasto, se manda una sola vez (el servidor se queda igual con el más nuevo).
 * Los cambios que quedan conservan su identidad (sirve para sacar de la bandeja lo ya enviado).
 */
export function compactOutbox(outbox: Mutation[]): Mutation[] {
  const last = new Map<string, Mutation>();
  for (const m of outbox) {
    const key = `${m.entity}:${m.id}`;
    const prev = last.get(key);
    if (!prev || prev.updatedAt <= m.updatedAt) {
      last.delete(key);
      last.set(key, m);
    }
  }
  return [...last.values()];
}
