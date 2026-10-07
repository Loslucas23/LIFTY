import { countsInBudget, offBudgetAccounts, ownAmount, txRate } from './budget';
import { convert } from './accounts';
import { habitDay } from './habits';
import { round2 } from './money';
import type { LiftyData } from './schema';
import { stockStatus } from './stock';
import { addDays } from './weight';

// ---------------- Diario: sueño y ánimo ----------------

export interface Comparison {
  /** Qué se compara: "gasto del día", "rutinas cumplidas", "minutos de estudio". */
  metric: string;
  /** Promedio en los días "malos" (dormiste poco / ánimo bajo) y en los demás. */
  bad: number;
  good: number;
  badDays: number;
  goodDays: number;
  /** Diferencia de los días malos contra los demás (%). */
  diff: number | null;
}

export interface JournalInsights {
  days: number;
  avgSleep: number | null;
  avgMood: number | null;
  /** Comparaciones por sueño (< 6 h) y por ánimo (1 o 2). */
  bySleep: Comparison[];
  byMood: Comparison[];
}

/** Cruza el diario de los últimos `days` días con lo que gastaste, tus rutinas y tu estudio. */
export function journalInsights(data: LiftyData, today: string, days = 60): JournalInsights {
  const from = addDays(today, -days + 1);
  const entries = data.journal.filter((j) => j.date >= from && j.date <= today);
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  const spentBy = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off) || t.date < from || t.date > today) continue;
    spentBy.set(t.date, (spentBy.get(t.date) ?? 0) + ownAmount(t) * txRate(t, rate));
  }
  const studyBy = new Map<string, number>();
  for (const s of data.studySessions) studyBy.set(s.date, (studyBy.get(s.date) ?? 0) + s.minutes);
  const habitPct = (date: string) => {
    const h = habitDay(data.habits, data.habitLogs, date);
    return h.due.length ? (h.done.length / h.due.length) * 100 : null;
  };
  const metrics: { name: string; value: (date: string) => number | null }[] = [
    { name: 'gasto del día', value: (d) => spentBy.get(d) ?? 0 },
    ...(data.habits.length ? [{ name: 'rutinas cumplidas (%)', value: habitPct }] : []),
    ...(data.studySessions.length ? [{ name: 'minutos de estudio', value: (d: string) => studyBy.get(d) ?? 0 }] : []),
  ];
  const compare = (isBad: (j: (typeof entries)[number]) => boolean | null): Comparison[] =>
    metrics.map((m) => {
      const bad: number[] = [];
      const good: number[] = [];
      for (const j of entries) {
        const flag = isBad(j);
        const v = m.value(j.date);
        if (flag === null || v === null) continue;
        (flag ? bad : good).push(v);
      }
      const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
      const b = avg(bad);
      const g = avg(good);
      return {
        metric: m.name,
        bad: round2(b),
        good: round2(g),
        badDays: bad.length,
        goodDays: good.length,
        diff: bad.length && good.length && g > 0 ? Math.round(((b - g) / g) * 100) : null,
      };
    });
  const sleeps = entries.filter((j) => j.sleepHours !== null).map((j) => j.sleepHours!);
  const moods = entries.filter((j) => j.mood !== null).map((j) => j.mood!);
  return {
    days: entries.length,
    avgSleep: sleeps.length ? round2(sleeps.reduce((s, x) => s + x, 0) / sleeps.length) : null,
    avgMood: moods.length ? round2(moods.reduce((s, x) => s + x, 0) / moods.length) : null,
    bySleep: compare((j) => (j.sleepHours === null ? null : j.sleepHours < 6)),
    byMood: compare((j) => (j.mood === null ? null : j.mood <= 2)),
  };
}

// ---------------- Tu inflación ----------------

export interface InflationItem {
  name: string;
  kind: 'stock' | 'fixed';
  /** Precio de hace ~un año (o el primero que hay) y el de ahora. */
  before: number;
  now: number;
  change: number;
  /** Cuánto pesa en tu gasto (pesos por mes). */
  weight: number;
}

/**
 * Cuánto subió lo que vos comprás: cada producto del stock (precio por unidad) y cada gasto
 * fijo, comparando con el precio de hace hasta un año, pesado por lo que gastás por mes.
 */
export function personalInflation(
  data: LiftyData,
  today: string,
): { items: InflationItem[]; total: number | null; since: string } {
  const since = addDays(today, -365);
  const items: InflationItem[] = [];
  for (const item of data.stockItems) {
    const buys = data.stockMoves
      .filter((m) => m.itemId === item.id && m.kind === 'buy' && m.price && m.quantity && m.date >= since && m.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (buys.length < 2) continue;
    const first = buys[0].price! / buys[0].quantity;
    const last = buys[buys.length - 1].price! / buys[buys.length - 1].quantity;
    const st = stockStatus(item, data.stockMoves, today, data.settings);
    const weight = st.monthlyCost ?? buys.reduce((s, m) => s + m.price!, 0) / 12;
    items.push({
      name: item.name,
      kind: 'stock',
      before: round2(first),
      now: round2(last),
      change: round2(((last - first) / first) * 100),
      weight: round2(weight),
    });
  }
  const rate = data.settings.usdRate;
  const byName = new Map<string, typeof data.fixed>();
  for (const f of data.fixed) {
    const k = f.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), f]);
  }
  const month = today.slice(0, 7);
  for (const chain of byName.values()) {
    const sorted = [...chain].sort((a, b) => a.startMonth.localeCompare(b.startMonth));
    const current = sorted.filter((f) => f.startMonth <= month && (!f.endMonth || f.endMonth >= month)).pop();
    if (!current) continue;
    const oneYearAgo = since.slice(0, 7);
    const old = sorted.filter((f) => f.startMonth <= oneYearAgo).pop() ?? sorted[0];
    if (old === current || old.amount === current.amount) continue;
    items.push({
      name: current.name,
      kind: 'fixed',
      before: old.amount,
      now: current.amount,
      change: round2(((current.amount - old.amount) / old.amount) * 100),
      weight: round2(convert(current.amount, current.currency, 'UYU', rate) / (current.everyMonths ?? 1)),
    });
  }
  items.sort((a, b) => b.change - a.change);
  const w = items.reduce((s, i) => s + i.weight, 0);
  return { items, total: w > 0 ? round2(items.reduce((s, i) => s + i.change * i.weight, 0) / w) : null, since };
}
