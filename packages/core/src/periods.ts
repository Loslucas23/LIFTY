import { convert } from './accounts';
import { countsInBudget, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { fold, round2 } from './money';
import type { LiftyData, Period, Transaction } from './schema';
import { addDays, daysBetween } from './weight';

/**
 * Épocas especiales: unas vacaciones (con su presupuesto total y su etiqueta) o un "mes
 * difícil" (con un tope por día más bajo). Cuentas simples con lo que cargás.
 */

export interface PeriodStatus {
  period: Period;
  state: 'upcoming' | 'active' | 'done';
  days: number;
  /** Días que faltan contando hoy (0 si terminó). */
  daysLeft: number;
  /** Lo gastado (vacaciones: lo etiquetado, aunque sea de antes, como los pasajes). */
  spent: number;
  spentToday: number;
  /** Vacaciones: lo que queda del presupuesto y por día. Mes difícil: el tope y lo que queda hoy. */
  remaining: number | null;
  perDay: number | null;
  /** Mes difícil: días terminados por debajo del tope, de los que pasaron. */
  underDays: number;
  pastDays: number;
}

const uyu = (t: Transaction, rate: number) =>
  convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);

export function periodStatus(p: Period, data: LiftyData, today: string): PeriodStatus {
  const rate = data.settings.usdRate;
  const days = daysBetween(p.from, p.to) + 1;
  const state = today < p.from ? 'upcoming' : today > p.to ? 'done' : 'active';
  const daysLeft = state === 'done' ? 0 : state === 'upcoming' ? days : daysBetween(today, p.to) + 1;
  const tag = fold(p.tag);
  let spent = 0;
  let spentToday = 0;
  let underDays = 0;
  let pastDays = 0;
  if (p.kind === 'vacation') {
    for (const t of data.transactions) {
      if (t.kind !== 'expense' || t.linkKind) continue;
      // Con etiqueta: todo lo etiquetado (los pasajes se compran antes). Sin etiqueta: lo de esas fechas.
      const mine = tag ? (t.tags ?? []).some((x) => fold(x) === tag) : t.date >= p.from && t.date <= p.to;
      if (!mine) continue;
      spent += uyu(t, rate);
      if (t.date === today) spentToday += uyu(t, rate);
    }
    const remaining = p.budget !== null ? round2(p.budget - spent) : null;
    return {
      period: p,
      state,
      days,
      daysLeft,
      spent: round2(spent),
      spentToday: round2(spentToday),
      remaining,
      perDay: remaining !== null && daysLeft > 0 ? round2(Math.max(0, remaining + spentToday) / daysLeft) : null,
      underDays: 0,
      pastDays: 0,
    };
  }
  // Mes difícil: el gasto de todos los días (lo que cuenta para el presupuesto) contra el tope.
  const off = offBudgetAccounts(data);
  const byDay = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off) || t.date < p.from || t.date > p.to) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + uyu(t, rate));
  }
  const last = state === 'done' ? p.to : addDays(today, -1);
  for (let d = p.from; d <= last; d = addDays(d, 1)) {
    pastDays++;
    if (p.budget !== null && (byDay.get(d) ?? 0) <= p.budget) underDays++;
  }
  spent = [...byDay.values()].reduce((s, v) => s + v, 0);
  spentToday = byDay.get(today) ?? 0;
  return {
    period: p,
    state,
    days,
    daysLeft,
    spent: round2(spent),
    spentToday: round2(spentToday),
    remaining: p.budget !== null ? round2(p.budget - spentToday) : null,
    perDay: p.budget,
    underDays,
    pastDays,
  };
}

/** Las épocas que están pasando hoy. */
export function activePeriods(data: Pick<LiftyData, 'periods'>, today: string): Period[] {
  return (data.periods ?? []).filter((p) => !p.archived && p.from <= today && p.to >= today);
}

/** ¿Hay que pausar rutinas y estudio hoy? */
export function routinesPaused(data: Pick<LiftyData, 'periods'>, today: string): boolean {
  return activePeriods(data, today).some((p) => p.pauseRoutines);
}

/** La etiqueta que se pone sola a un gasto de esa fecha (si estás de vacaciones). */
export function autoTagFor(data: Pick<LiftyData, 'periods'>, date: string): string | null {
  const p = activePeriods(data, date).find((x) => x.kind === 'vacation' && x.tag.trim());
  return p ? p.tag.trim() : null;
}

/**
 * Tope por día sugerido para un mes difícil: 20% menos de lo que podés gastar por día este
 * mes (redondeado a 50). Si no hay presupuesto, 20% menos de tu promedio de los últimos 30 días.
 */
export function suggestTightCap(data: LiftyData, b: MonthBudget, today: string): number | null {
  if (b.daily && b.daily.perDay > 0) return Math.max(50, Math.floor((b.daily.perDay * 0.8) / 50) * 50);
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  const from = addDays(today, -30);
  const total = data.transactions
    .filter((t) => t.kind === 'expense' && !t.linkKind && countsInBudget(t, off) && t.date >= from && t.date < today)
    .reduce((s, t) => s + uyu(t, rate), 0);
  return total > 0 ? Math.max(50, Math.floor(((total / 30) * 0.8) / 50) * 50) : null;
}
