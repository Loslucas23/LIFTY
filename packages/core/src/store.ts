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
    weights: list('weight').sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt)),
  };
}
