import { round2 } from './money';
import type { Habit, HabitLog } from './schema';
import { addDays } from './weight';

/** Rutinas y hábitos: qué toca hoy, rachas y cómo viene la semana. Cuentas simples. */

export const habitLogId = (habitId: string, date: string) => `${habitId}:${date}`;

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** ¿Este hábito toca ese día? */
export const isDue = (h: Habit, date: string) => h.days.includes(weekday(date));

export interface HabitStatus {
  habit: Habit;
  today: number;
  done: boolean;
  dueToday: boolean;
  /** Días seguidos cumplidos (los días que no toca no cortan; hoy sin hacer todavía no corta). */
  streak: number;
  best: number;
  /** Cumplimiento de los últimos 7 días que tocaban (0 a 1). */
  week: number | null;
  /** Lo hecho en los últimos 7 y 30 días (minutos de estudio, vasos…). */
  total7: number;
  total30: number;
  /** Los últimos 7 días: null = no tocaba. */
  last7: { date: string; value: number; done: boolean | null }[];
}

export function habitStatus(h: Habit, logs: HabitLog[], today: string): HabitStatus {
  const byDate = new Map(logs.filter((l) => l.habitId === h.id).map((l) => [l.date, l.value]));
  const value = (d: string) => byDate.get(d) ?? 0;
  const ok = (d: string) => value(d) >= h.target;
  // Racha actual: hacia atrás desde hoy (si hoy no está hecho, se empieza desde ayer).
  let streak = 0;
  let d = ok(today) || !isDue(h, today) ? today : addDays(today, -1);
  for (let i = 0; i < 730; i++, d = addDays(d, -1)) {
    if (!isDue(h, d)) continue;
    if (!ok(d)) break;
    streak++;
  }
  // Mejor racha: recorre desde el primer registro.
  const first = [...byDate.keys()].sort()[0];
  let best = 0;
  let run = 0;
  if (first) {
    for (let x = first; x <= today; x = addDays(x, 1)) {
      if (!isDue(h, x)) continue;
      if (ok(x)) best = Math.max(best, ++run);
      else if (x !== today) run = 0;
    }
  }
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, value: value(date), done: isDue(h, date) ? ok(date) : null };
  });
  // Semana: no cuenta hoy si todavía no está hecho.
  const counted = last7.filter((x) => x.done !== null && !(x.date === today && !x.done));
  const sum = (days: number) => {
    let s = 0;
    for (let i = 0; i < days; i++) s += value(addDays(today, -i));
    return round2(s);
  };
  return {
    habit: h,
    today: value(today),
    done: ok(today),
    dueToday: isDue(h, today),
    streak,
    best: Math.max(best, streak),
    week: counted.length ? counted.filter((x) => x.done).length / counted.length : null,
    total7: sum(7),
    total30: sum(30),
    last7,
  };
}

export interface HabitsDay {
  statuses: HabitStatus[];
  due: HabitStatus[];
  doneCount: number;
}

export function habitsToday(habits: Habit[], logs: HabitLog[], today: string): HabitsDay {
  const statuses = habits.filter((h) => !h.archived).map((h) => habitStatus(h, logs, today));
  const due = statuses.filter((s) => s.dueToday);
  return { statuses, due, doneCount: due.filter((s) => s.done).length };
}
