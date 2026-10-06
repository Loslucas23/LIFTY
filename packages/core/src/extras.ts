import { convert } from './accounts';
import {
  categoryRootFn,
  countsInBudget,
  offBudgetAccounts,
  ownAmount,
  reservedAccounts,
  savingFromTransfer,
  txRate,
} from './budget';
import { exerciseVsWeight, habitsToday } from './habits';
import { addMonths, daysInMonth, isActiveIn, monthOf } from './months';
import { round2 } from './money';
import type { FixedExpense, LiftyData, Reminder, Settings, StockItem, StockMove, YearGoal } from './schema';
import { stockStatus } from './stock';
import { addDays, dailyWeights, daysBetween } from './weight';

/** Lo pasado a cuentas de ahorro (menos lo sacado) entre dos fechas, en pesos. */
function savedByTransfer(data: LiftyData, from: string, to: string): number {
  const reserved = reservedAccounts(data);
  if (!reserved.size) return 0;
  let s = 0;
  for (const t of data.transactions) {
    if (t.date < from || t.date > to) continue;
    const v = savingFromTransfer(t, reserved);
    if (v !== null) s += v * txRate(t, data.settings.usdRate);
  }
  return s;
}

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
  const subs = items.filter((i) => categoryRootFn(data.categories)(i.fixed.categoryId) === 'cat-suscripciones');
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
  /** Diario de la semana: horas de sueño y ánimo promedio. */
  sleep: { hours: number | null; mood: number | null; days: number } | null;
  /** Lo que pagaste en compras registradas en el stock. */
  groceries: number;
  /** Lo que vence en los 7 días siguientes a la semana (vencimientos de la casa). */
  nextWeek: { name: string; date: string }[];
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
  const root = categoryRootFn(data.categories);
  const spendDays = new Set<string>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !countsInBudget(t, off) || !inRange(t.date, from, last)) continue;
    byCat.set(root(t.categoryId), (byCat.get(root(t.categoryId)) ?? 0) + ownAmount(t) * txRate(t, rate));
    if (!t.linkKind && t.amount > 0) spendDays.add(t.date);
  }
  const sumKind = (k: 'income' | 'saving') =>
    data.transactions
      .filter((t) => t.kind === k && countsInBudget(t, off) && inRange(t.date, from, last))
      .reduce((s, t) => s + t.amount * txRate(t, rate), 0) + (k === 'saving' ? savedByTransfer(data, from, last) : 0);

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
    sleep: (() => {
      const js = data.journal.filter((j) => inRange(j.date, from, last));
      if (!js.length) return null;
      const hs = js.filter((j) => j.sleepHours !== null).map((j) => j.sleepHours!);
      const ms = js.filter((j) => j.mood !== null).map((j) => j.mood!);
      const mean = (xs: number[]) => (xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
      return { hours: mean(hs), mood: mean(ms), days: js.length };
    })(),
    groceries: round2(
      data.stockMoves.filter((m) => m.kind === 'buy' && m.price && inRange(m.date, from, last)).reduce((s, m) => s + m.price!, 0),
    ),
    nextWeek: data.reminders
      .filter((r) => !r.archived && inRange(r.date, addDays(last, 1), addDays(last, 7)))
      .map((r) => ({ name: r.name, date: r.date }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------- Dónde conviene comprar ----------------

export interface StorePrices {
  /** Por producto: último precio por unidad en cada súper (últimos 6 meses). */
  items: {
    item: StockItem;
    prices: { store: string; unitPrice: number; date: string }[];
    best: string | null;
    spread: number | null;
  }[];
  stores: string[];
  /** Si comprás lo que consumís en un mes todo en un súper (solo productos con precio ahí). */
  basket: { store: string; total: number; items: number }[];
  /** Comprando cada cosa donde está más barata, cuánto ahorrás por mes contra tu precio promedio. */
  monthlySavings: number;
}

export function storePrices(
  items: StockItem[],
  moves: StockMove[],
  today: string,
  settings: Pick<Settings, 'shoppingDays'>,
): StorePrices {
  const since = addDays(today, -180);
  const stores = new Set<string>();
  const out: StorePrices['items'] = [];
  const basket = new Map<string, { total: number; items: number }>();
  let monthlySavings = 0;
  for (const item of items.filter((i) => !i.archived)) {
    const latest = new Map<string, { unitPrice: number; date: string }>();
    for (const m of moves) {
      if (m.itemId !== item.id || m.kind !== 'buy' || !m.price || !m.quantity || !m.store.trim() || m.date < since) continue;
      const store = m.store.trim();
      const prev = latest.get(store);
      if (!prev || m.date >= prev.date) latest.set(store, { unitPrice: m.price / m.quantity, date: m.date });
    }
    if (!latest.size) continue;
    const prices = [...latest.entries()]
      .map(([store, p]) => ({ store, unitPrice: round2(p.unitPrice), date: p.date }))
      .sort((a, b) => a.unitPrice - b.unitPrice);
    prices.forEach((p) => stores.add(p.store));
    const spread =
      prices.length > 1
        ? Math.round(((prices[prices.length - 1].unitPrice - prices[0].unitPrice) / prices[0].unitPrice) * 100)
        : null;
    out.push({ item, prices, best: prices.length > 1 ? prices[0].store : null, spread });
    const s = stockStatus(item, moves, today, settings);
    if (s.usage) {
      const monthQty = s.usage.perDay * 30;
      for (const p of prices) {
        const b = basket.get(p.store) ?? { total: 0, items: 0 };
        b.total += monthQty * p.unitPrice;
        b.items++;
        basket.set(p.store, b);
      }
      if (s.prices.average !== null) monthlySavings += monthQty * Math.max(0, s.prices.average - prices[0].unitPrice);
    }
  }
  return {
    items: out.sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1)),
    stores: [...stores].sort(),
    basket: [...basket.entries()]
      .map(([store, b]) => ({ store, total: round2(b.total), items: b.items }))
      .sort((a, b) => b.items - a.items || a.total - b.total),
    monthlySavings: round2(monthlySavings),
  };
}

// ---------------- Metas del año ----------------

export interface YearGoalStatus {
  goal: YearGoal;
  /** Lo que llevás (para peso: lo que bajaste o subiste desde el principio del año hacia la meta). */
  current: number;
  /** De 0 a 1. */
  progress: number;
  /** Lo que deberías llevar a esta altura del año si vas parejo (0 a 1). */
  expected: number;
  status: 'done' | 'ahead' | 'on-track' | 'behind';
  /** Texto corto del avance ("$ 12.000 de $ 50.000", "78,4 kg → 75 kg"). */
  detail: string;
  /** Lo que falta por mes (o por semana para hábitos) para llegar. */
  needed: string | null;
}

export function yearGoalStatus(goal: YearGoal, data: LiftyData, today: string): YearGoalStatus {
  const from = `${goal.year}-01-01`;
  const to = `${goal.year}-12-31`;
  const last = today < to ? today : to;
  const total = daysBetween(from, to) + 1;
  const elapsed = Math.min(total, Math.max(0, daysBetween(from, last) + 1));
  const expected = elapsed / total;
  const monthsLeft = Math.max(1, 12 - Number(last.slice(5, 7)) + 1);
  const rate = data.settings.usdRate;
  const n = (v: number) => Math.round(v).toLocaleString('es-UY');
  let current = 0;
  let progress = 0;
  let detail = '';
  let needed: string | null = null;
  if (goal.kind === 'savings') {
    current =
      data.transactions
        .filter((t) => t.kind === 'saving' && t.date >= from && t.date <= last)
        .reduce((s, t) => s + t.amount * txRate(t, rate), 0) + savedByTransfer(data, from, last);
    progress = current / goal.target;
    detail = `$ ${n(current)} de $ ${n(goal.target)}`;
    if (current < goal.target) needed = `$ ${n((goal.target - current) / monthsLeft)} por mes`;
  } else if (goal.kind === 'weight') {
    const ws = dailyWeights(data.weights);
    const start = ws.find((w) => w.date >= from) ?? ws[ws.length - 1];
    const now = [...ws].reverse().find((w) => w.date <= last);
    if (start && now) {
      const totalChange = start.kg - goal.target;
      current = now.kg;
      progress = totalChange === 0 ? 1 : (start.kg - now.kg) / totalChange;
      detail = `${now.kg.toLocaleString('es-UY')} kg → ${goal.target.toLocaleString('es-UY')} kg (empezaste en ${start.kg.toLocaleString('es-UY')})`;
      const left = Math.abs(now.kg - goal.target);
      if (progress < 1) needed = `${(Math.round((left / monthsLeft) * 10) / 10).toLocaleString('es-UY')} kg por mes`;
    } else detail = 'Todavía no hay pesajes';
  } else if (goal.kind === 'study') {
    const minutes = data.studySessions
      .filter((s) => s.date >= from && s.date <= last && (!goal.refId || s.subjectId === goal.refId))
      .reduce((a, s) => a + s.minutes, 0);
    current = round2(minutes / 60);
    progress = current / goal.target;
    detail = `${current.toLocaleString('es-UY')} h de ${n(goal.target)} h`;
    if (progress < 1)
      needed = `${(Math.round(((goal.target - current) / Math.max(1, (total - elapsed) / 7)) * 10) / 10).toLocaleString('es-UY')} h por semana`;
  } else if (goal.kind === 'habit') {
    const habit = data.habits.find((h) => h.id === goal.refId);
    current = habit
      ? data.habitLogs.filter((l) => l.habitId === habit.id && l.date >= from && l.date <= last && l.value >= habit.target).length
      : 0;
    progress = current / goal.target;
    detail = `${n(current)} de ${n(goal.target)} días`;
    if (progress < 1)
      needed = `${(Math.round(((goal.target - current) / Math.max(1, (total - elapsed) / 7)) * 10) / 10).toLocaleString('es-UY')} días por semana`;
  } else {
    current = goal.manualValue;
    progress = current / goal.target;
    detail = `${n(current)} de ${n(goal.target)}${goal.unit ? ` ${goal.unit}` : ''}`;
  }
  progress = Math.max(0, Math.min(1, progress));
  const status: YearGoalStatus['status'] =
    progress >= 1 ? 'done' : progress >= expected + 0.05 ? 'ahead' : progress >= expected - 0.05 ? 'on-track' : 'behind';
  return { goal, current: round2(current), progress, expected, status, detail, needed };
}
