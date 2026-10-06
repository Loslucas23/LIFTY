import { remember } from './memo';
import { round2 } from './money';
import type { Habit, HabitLog } from './schema';
import { addDays } from './weight';

/** Rutinas y hábitos: qué toca hoy, rachas y cómo viene la semana. Cuentas simples. */

export const habitLogId = (habitId: string, date: string) => `${habitId}:${date}`;

const weekdays = new Map<string, number>();
const weekday = (date: string) => {
  let w = weekdays.get(date);
  if (w === undefined) {
    w = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekdays.size > 20_000) weekdays.clear();
    weekdays.set(date, w);
  }
  return w;
};

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

/** Lo anotado de cada hábito, agrupado una sola vez por lista de registros (se reusa entre llamadas). */
const byHabitCache = new WeakMap<HabitLog[], { size: number; map: Map<string, Map<string, number>> }>();
function logsByHabit(logs: HabitLog[]): Map<string, Map<string, number>> {
  const hit = byHabitCache.get(logs);
  if (hit && hit.size === logs.length) return hit.map;
  const map = new Map<string, Map<string, number>>();
  for (const l of logs) {
    let dates = map.get(l.habitId);
    if (!dates) map.set(l.habitId, (dates = new Map()));
    dates.set(l.date, l.value);
  }
  byHabitCache.set(logs, { size: logs.length, map });
  return map;
}

/**
 * Qué rutinas tocaban un día y cuáles se cumplieron (sin rachas): para las cuentas de muchos
 * días (semana, mes, balance de vida), que no necesitan recalcular todo el historial.
 */
export function habitDay(habits: Habit[], logs: HabitLog[], date: string): { due: Habit[]; done: Habit[] } {
  const m = logsByHabit(logs);
  const due = habits.filter((h) => !h.archived && isDue(h, date));
  return { due, done: due.filter((h) => (m.get(h.id)?.get(date) ?? 0) >= h.target) };
}

export function habitStatus(h: Habit, logs: HabitLog[], today: string): HabitStatus {
  const byDate = logsByHabit(logs).get(h.id) ?? new Map<string, number>();
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
  const r = remember(logs, `today:${today}`, [habits, habits.length, logs.length], () => computeDay(habits, logs, today));
  // Copias de las listas: hay quien las ordena (la mejor racha) y no debe tocar la recordada.
  return { ...r, statuses: r.statuses.slice(), due: r.due.slice() };
}

function computeDay(habits: Habit[], logs: HabitLog[], today: string): HabitsDay {
  const statuses = habits.filter((h) => !h.archived).map((h) => habitStatus(h, logs, today));
  const due = statuses.filter((s) => s.dueToday);
  return { statuses, due, doneCount: due.filter((s) => s.done).length };
}

// ---------------- Ejercicio y peso ----------------

export interface ExerciseWeek {
  /** Lunes de la semana. */
  week: string;
  /** Días con algún hábito de ejercicio cumplido. */
  workouts: number;
  /** Peso promedio de la semana (null si no te pesaste). */
  avgKg: number | null;
  /** Cambio contra la semana anterior (null si falta alguna de las dos). */
  change: number | null;
}

export interface ExerciseVsWeight {
  weeks: ExerciseWeek[];
  threshold: number;
  /** Semanas con `threshold` o más entrenamientos, y las demás: cuántas y cambio promedio de peso. */
  active: { weeks: number; avgChange: number | null };
  rest: { weeks: number; avgChange: number | null };
}

const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

/** Cruza los días que entrenaste con cómo cambió tu peso cada semana (sin la semana en curso). */
export function exerciseVsWeight(
  habits: Habit[],
  logs: HabitLog[],
  weights: { date: string; kg: number }[],
  today: string,
  count = 12,
  threshold = 3,
): ExerciseVsWeight {
  const exercise = new Map(habits.filter((h) => h.area === 'ejercicio').map((h) => [h.id, h]));
  const workoutDays = new Set(
    logs.filter((l) => exercise.has(l.habitId) && l.value >= exercise.get(l.habitId)!.target).map((l) => l.date),
  );
  const thisMonday = mondayOf(today);
  const weeks: ExerciseWeek[] = [];
  let prevAvg: number | null = null;
  // Una semana más al principio para tener contra qué comparar la primera.
  for (let i = count; i >= 1; i--) {
    const week = addDays(thisMonday, -7 * i);
    const end = addDays(week, 6);
    const ws = weights.filter((w) => w.date >= week && w.date <= end);
    const avgKg = ws.length ? round2(ws.reduce((s, w) => s + w.kg, 0) / ws.length) : null;
    let workouts = 0;
    for (let d = 0; d < 7; d++) if (workoutDays.has(addDays(week, d))) workouts++;
    weeks.push({ week, workouts, avgKg, change: avgKg !== null && prevAvg !== null ? round2(avgKg - prevAvg) : null });
    if (avgKg !== null) prevAvg = avgKg;
    else prevAvg = null;
  }
  const group = (f: (w: ExerciseWeek) => boolean) => {
    const ws = weeks.filter((w) => w.change !== null && f(w));
    return { weeks: ws.length, avgChange: ws.length ? round2(ws.reduce((s, w) => s + w.change!, 0) / ws.length) : null };
  };
  return { weeks, threshold, active: group((w) => w.workouts >= threshold), rest: group((w) => w.workouts < threshold) };
}
