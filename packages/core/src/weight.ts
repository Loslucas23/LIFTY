import { round2 } from './money';
import type { WeightEntry } from './schema';

/** Días entre dos fechas "YYYY-MM-DD" (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Índice de masa corporal. */
export function bmi(kg: number, heightCm: number): number {
  const m = heightCm / 100;
  return round2(kg / (m * m));
}

export function bmiLabel(value: number): string {
  if (value < 18.5) return 'Bajo peso';
  if (value < 25) return 'Normal';
  if (value < 30) return 'Sobrepeso';
  return 'Obesidad';
}

/** Un valor por día (si hay varios pesajes el mismo día, cuenta el último cargado). */
export function dailyWeights(entries: WeightEntry[]): { date: string; kg: number }[] {
  const byDay = new Map<string, WeightEntry>();
  for (const e of entries) {
    const prev = byDay.get(e.date);
    if (!prev || e.updatedAt >= prev.updatedAt) byDay.set(e.date, e);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ date: e.date, kg: e.kg }));
}

/**
 * Promedio móvil de los últimos `days` días calendario (incluido el día), para ver la
 * tendencia sin el ruido de un pesaje puntual.
 */
export function movingAverage(points: { date: string; kg: number }[], days = 7): { date: string; kg: number }[] {
  return points.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && daysBetween(points[j].date, p.date) < days; j--) {
      sum += points[j].kg;
      n++;
    }
    return { date: p.date, kg: round2(sum / n) };
  });
}

export interface WeightStats {
  latest: { date: string; kg: number } | null;
  /** Cambio respecto del pesaje más cercano a hace 7 / 30 días (null si no hay datos). */
  change7: number | null;
  change30: number | null;
  /** Promedio de los últimos 7 días. */
  average7: number | null;
  min: number | null;
  max: number | null;
  bmi: number | null;
  /** Lo que falta para la meta (positivo = hay que bajar). */
  toGoal: number | null;
}

function changeSince(points: { date: string; kg: number }[], latest: { date: string; kg: number }, days: number): number | null {
  const target = addDays(latest.date, -days);
  // El pesaje más reciente que sea de hace al menos `days` días (con tolerancia de una semana).
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= target) {
      return daysBetween(points[i].date, target) <= 7 ? round2(latest.kg - points[i].kg) : null;
    }
  }
  return null;
}

export function weightStats(
  entries: WeightEntry[],
  opts: { heightCm?: number | null; goalKg?: number | null } = {},
): WeightStats {
  const points = dailyWeights(entries);
  const latest = points[points.length - 1] ?? null;
  if (!latest) {
    return { latest: null, change7: null, change30: null, average7: null, min: null, max: null, bmi: null, toGoal: null };
  }
  const avg = movingAverage(points, 7);
  return {
    latest,
    change7: changeSince(points, latest, 7),
    change30: changeSince(points, latest, 30),
    average7: avg[avg.length - 1].kg,
    min: Math.min(...points.map((p) => p.kg)),
    max: Math.max(...points.map((p) => p.kg)),
    bmi: opts.heightCm ? bmi(latest.kg, opts.heightCm) : null,
    toGoal: opts.goalKg ? round2(latest.kg - opts.goalKg) : null,
  };
}
