import { useMemo, useSyncExternalStore } from 'react';
import { computeMonths, todayISO, toLiftyData, type LiftyData, type MonthBudget } from '@lifty/core';
import { getState, subscribe, type SyncState } from './sync';

export function useSync(): SyncState {
  return useSyncExternalStore(subscribe, getState);
}

let cache: { records: unknown; data: LiftyData } | null = null;

/** Todos los datos como objetos tipados (memorizado mientras no cambien). */
export function useData(): LiftyData {
  const { records } = useSync();
  if (!cache || cache.records !== records) cache = { records, data: toLiftyData(records) };
  return cache.data;
}

export function useToday(): string {
  return todayISO();
}

/** Presupuestos de un rango de meses. */
export function useMonths(from: string, to: string): MonthBudget[] {
  const data = useData();
  const today = useToday();
  return useMemo(() => computeMonths(data, from, to, today), [data, from, to, today]);
}

export function useMonth(month: string): MonthBudget {
  return useMonths(month, month)[0];
}

export function useLookups() {
  const data = useData();
  return useMemo(
    () => ({
      category: new Map(data.categories.map((c) => [c.id, c])),
      account: new Map(data.accounts.map((a) => [a.id, a])),
      goal: new Map(data.goals.map((g) => [g.id, g])),
    }),
    [data],
  );
}
