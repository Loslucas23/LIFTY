import { convert } from './accounts';
import { countsInBudget, offBudgetAccounts, ownAmount, txRate } from './budget';
import { exerciseVsWeight, habitsToday } from './habits';
import { addMonths, daysInMonth, isActiveIn, monthOf } from './months';
import { round2 } from './money';
import type { FixedExpense, LiftyData, Reminder } from './schema';
import { addDays, dailyWeights, daysBetween } from './weight';

// ---------------- Suscripciones y gastos que se repiten ----------------

export interface RecurringItem {
  fixed: FixedExpense;
  /** Lo que sale por mes (los anuales divididos entre 12, etc.), en pesos. */
  monthly: number;
  yearly: number;
  /** Cada vez que cambió el monto (el más nuevo al final). */
  changes: { month: string; from: number; to: number; pct: number }[];
  /** Cuánto subió desde el primer monto registrado (%). */
  totalIncrease: number | null;
}

/** Todo lo que pagás periódicamente y está vigente en `month`, con su historia de aumentos. */
export function recurringSummary(data: LiftyData, month: string) {
  const rate = data.settings.usdRate;
  const active = data.fixed.filter((f) => !f.archived && isActiveIn(month, f.startMonth, f.endMonth));
  const items: RecurringItem[] = active.map((f) => {
    // La historia es la cadena de registros con el mismo nombre (cambiar el monto "desde un mes" crea uno nuevo).
    const chain = data.fixed
      .filter((x) => x.name.trim().toLowerCase() === f.name.trim().toLowerCase() && x.startMonth <= f.startMonth)
      .sort((a, b) => a.startMonth.localeCompare(b.startMonth));
    const changes: RecurringItem['changes'] = [];
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1].amount;
      const to = chain[i].amount;
      if (from !== to) changes.push({ month: chain[i].startMonth, from, to, pct: Math.round(((to - from) / from) * 100) });
    }
    const monthly = round2(convert(f.amount, f.currency, 'UYU', rate) / (f.everyMonths ?? 1));
    return {
      fixed: f,
      monthly,
      yearly: round2(monthly * 12),
      changes,
      totalIncrease:
        chain.length > 1 && chain[0].amount !== f.amount
          ? Math.round(((f.amount - chain[0].amount) / chain[0].amount) * 100)
          : null,
    };
  });
  items.sort((a, b) => b.monthly - a.monthly);
  const subs = items.filter((i) => i.fixed.categoryId === 'cat-suscripciones');
  return {
    items,
    monthly: round2(items.reduce((s, i) => s + i.monthly, 0)),
    yearly: round2(items.reduce((s, i) => s + i.yearly, 0)),
    subscriptions: { count: subs.length, monthly: round2(subs.reduce((s, i) => s + i.monthly, 0)) },
  };
}

// ---------------- Vencimientos de la casa ----------------

export interface ReminderStatus {
  reminder: Reminder;
  daysLeft: number;
  status: 'overdue' | 'soon' | 'ok';
}

export function reminderStatus(r: Reminder, today: string): ReminderStatus {
  const daysLeft = daysBetween(today, r.date);
  return { reminder: r, daysLeft, status: daysLeft < 0 ? 'overdue' : daysLeft <= r.notifyDays ? 'soon' : 'ok' };
}

/** Al renovar: la próxima fecha es la misma + los meses de renovación (sin pasarse del fin de mes). */
export function nextReminderDate(r: Reminder): string | null {
  if (!r.repeatMonths) return null;
  const m = addMonths(monthOf(r.date), r.repeatMonths);
  const day = Math.min(Number(r.date.slice(8)), daysInMonth(m));
  return `${m}-${String(day).padStart(2, '0')}`;
}

// ---------------- Resumen semanal ----------------

export const weekStart = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

export interface WeekSummary {
  from: string;
  to: string;
  spent: number;
  prevSpent: number;
  income: number;
  saved: number;
  noSpendDays: number;
  /** Días de la semana que ya pasaron (la semana en curso tiene menos de 7). */
  days: number;
  topCategories: { categoryId: string | null; amount: number }[];
  habits: { done: number; due: number; bestStreak: { name: string; days: number } | null } | null;
  studyMinutes: number;
  workouts: number;
  weight: { avg: number; change: number | null } | null;
}

export function weekSummary(data: LiftyData, from: string, today: string): WeekSummary {
  const to = addDays(from, 6);
  const last = to < today ? to : today;
  const days = Math.max(0, daysBetween(from, last) + 1);
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  const inRange = (d: string, a: string, b: string) => d >= a && d <= b;
  const spentIn = (a: string, b: string) =>
    data.transactions
      .filter((t) => t.kind === 'expense' && countsInBudget(t, off) && inRange(t.date, a, b))
      .reduce((s, t) => s + ownAmount(t) * txRate(t, rate), 0);
  const byCat = new Map<string | null, number>();
  const spendDays = new Set<string>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !countsInBudget(t, off) || !inRange(t.date, from, last)) continue;
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + ownAmount(t) * txRate(t, rate));
    if (!t.linkKind && t.amount > 0) spendDays.add(t.date);
  }
  const sumKind = (k: 'income' | 'saving') =>
    data.transactions
      .filter((t) => t.kind === k && countsInBudget(t, off) && inRange(t.date, from, last))
      .reduce((s, t) => s + t.amount * txRate(t, rate), 0);

  // Hábitos: cuántos tocaban en la semana y cuántos se cumplieron.
  let habits: WeekSummary['habits'] = null;
  if (data.habits.some((h) => !h.archived)) {
    let done = 0;
    let due = 0;
    for (let d = from; d <= last; d = addDays(d, 1)) {
      const day = habitsToday(data.habits, data.habitLogs, d);
      due += day.due.length;
      done += day.doneCount;
    }
    const best = habitsToday(data.habits, data.habitLogs, last).statuses.sort((a, b) => b.streak - a.streak)[0];
    habits = { done, due, bestStreak: best && best.streak > 0 ? { name: best.habit.name, days: best.streak } : null };
  }
  const studyMinutes = data.studySessions.filter((s) => inRange(s.date, from, last)).reduce((a, s) => a + s.minutes, 0);
  const ex = exerciseVsWeight(data.habits, data.habitLogs, [], addDays(from, 7), 1);
  const ws = dailyWeights(data.weights);
  const avg = (a: string, b: string) => {
    const xs = ws.filter((w) => inRange(w.date, a, b));
    return xs.length ? xs.reduce((s, w) => s + w.kg, 0) / xs.length : null;
  };
  const now = avg(from, last);
  const before = avg(addDays(from, -7), addDays(from, -1));
  return {
    from,
    to,
    spent: round2(spentIn(from, last)),
    prevSpent: round2(spentIn(addDays(from, -7), addDays(last, -7))),
    income: round2(sumKind('income')),
    saved: round2(sumKind('saving')),
    noSpendDays: days - spendDays.size,
    days,
    topCategories: [...byCat.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3),
    habits,
    studyMinutes,
    workouts: ex.weeks[0]?.workouts ?? 0,
    weight: now !== null ? { avg: round2(now), change: before !== null ? round2(now - before) : null } : null,
  };
}
