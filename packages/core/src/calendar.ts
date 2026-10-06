import { convert } from './accounts';
import { countsInBudget, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { cardAutoPayments } from './card';
import { habitsToday } from './habits';
import { daysInMonth } from './months';
import { round2 } from './money';
import type { LiftyData, Period } from './schema';
import { addDays } from './weight';

/**
 * Calendario de todo: en un solo mes, lo que entra y sale de plata (sueldos, fijos, tarjeta),
 * vencimientos, exámenes, vacaciones, y cómo te fue cada día (gasto, ánimo, rutinas).
 */

export interface CalendarItem {
  icon: string;
  text: string;
  /** + entra, − sale (pesos). */
  amount?: number;
  kind: 'income' | 'fixed' | 'card' | 'load' | 'reminder' | 'exam' | 'period';
  done?: boolean;
}

export interface CalendarDay {
  date: string;
  /** Gasto del día (lo que cuenta para el presupuesto) y lo que entró. */
  spent: number;
  earned: number;
  movements: number;
  mood: number | null;
  sleep: number | null;
  habits: { done: number; due: number };
  items: CalendarItem[];
  periods: Period[];
  /** "Hoy no gasté" anotado en el diario (o un día que pasó sin gastos). */
  noSpend: boolean;
}

export function monthCalendar(data: LiftyData, b: MonthBudget, today: string): CalendarDay[] {
  const month = b.month;
  const n = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(n).padStart(2, '0')}`;
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  const days: CalendarDay[] = [];
  const at = new Map<string, CalendarDay>();
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const day: CalendarDay = {
      date: d,
      spent: 0,
      earned: 0,
      movements: 0,
      mood: null,
      sleep: null,
      habits: { done: 0, due: 0 },
      items: [],
      periods: (data.periods ?? []).filter((p) => !p.archived && p.from <= d && p.to >= d),
      noSpend: false,
    };
    days.push(day);
    at.set(d, day);
  }
  const dayOf = (dayNum: number | null) =>
    dayNum ? at.get(`${month}-${String(Math.min(dayNum, n)).padStart(2, '0')}`) : undefined;

  // Movimientos de cada día.
  for (const t of data.transactions) {
    const day = at.get(t.date);
    if (!day) continue;
    day.movements++;
    const v = convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);
    if (t.kind === 'expense' && !t.linkKind && countsInBudget(t, off)) day.spent += v;
    if (t.kind === 'income') day.earned += v;
  }
  // Lo planificado del mes: sueldos y gastos fijos en su día.
  for (const l of b.income.planned) {
    const day = dayOf(l.day);
    if (day) day.items.push({ icon: '💼', text: l.name, amount: round2(l.amount), kind: 'income', done: l.confirmed });
  }
  for (const l of b.fixed.items) {
    const day = dayOf(l.day);
    if (day) day.items.push({ icon: '📅', text: l.name, amount: -round2(l.amount), kind: 'fixed', done: l.confirmed });
  }
  for (const a of data.accounts) {
    if (a.type !== 'food' || !a.monthlyLoad || !a.loadDay || a.archived) continue;
    const day = dayOf(a.loadDay);
    const loaded = data.transactions.some((t) => t.linkKind === 'load' && t.linkId === a.id && t.linkMonth === month);
    if (day) day.items.push({ icon: '🍽️', text: `Carga ${a.name}`, amount: a.monthlyLoad, kind: 'load', done: loaded });
  }
  for (const p of cardAutoPayments(data, last)) {
    const day = at.get(p.date);
    if (!day) continue;
    const amount = round2(convert(p.amount, p.currency, 'UYU', p.currency === 'USD' ? p.fxRate || rate : 1));
    day.items.push({ icon: '💳', text: p.description, amount: -amount, kind: 'card', done: p.date <= today });
  }
  for (const r of data.reminders) {
    const day = !r.archived ? at.get(r.date) : undefined;
    if (day) day.items.push({ icon: r.icon, text: `Vence: ${r.name}`, kind: 'reminder' });
  }
  for (const s of data.subjects) {
    const day = !s.archived && s.examDate ? at.get(s.examDate) : undefined;
    if (day) day.items.push({ icon: s.icon, text: `Examen: ${s.name}`, kind: 'exam' });
  }
  for (const p of data.periods ?? []) {
    if (p.archived) continue;
    const start = at.get(p.from);
    if (start) start.items.push({ icon: p.kind === 'vacation' ? '🏖️' : '🧮', text: `Empieza: ${p.name}`, kind: 'period' });
    const end = p.to !== p.from ? at.get(p.to) : undefined;
    if (end) end.items.push({ icon: p.kind === 'vacation' ? '🏖️' : '🧮', text: `Termina: ${p.name}`, kind: 'period' });
  }
  // Cómo te fue: ánimo, sueño y rutinas.
  for (const j of data.journal) {
    const day = at.get(j.date);
    if (!day) continue;
    day.mood = j.mood;
    day.sleep = j.sleepHours;
    if (j.noSpend) day.noSpend = true;
  }
  const habits = data.habits.filter((h) => !h.archived);
  for (const day of days) {
    if (habits.length && day.date <= today) {
      const h = habitsToday(habits, data.habitLogs, day.date);
      day.habits = { done: h.doneCount, due: h.due.length };
    }
    day.spent = round2(day.spent);
    day.earned = round2(day.earned);
    if (day.date < today && day.spent === 0 && day.movements > 0) day.noSpend = true;
  }
  return days;
}
