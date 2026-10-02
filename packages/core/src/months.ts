/** Meses en formato "YYYY-MM" y fechas en formato "YYYY-MM-DD". */

export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Setiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

export function isDate(value: string): boolean {
  return DATE_RE.test(value);
}

export function makeMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonth(month: string): { year: number; month: number } {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const { year, month: m } = parseMonth(month);
  const index = year * 12 + (m - 1) + delta;
  return makeMonth(Math.floor(index / 12), (index % 12) + 1);
}

/** Cantidad de meses de `from` a `to` (puede ser negativa). */
export function monthDiff(from: string, to: string): number {
  const a = parseMonth(from);
  const b = parseMonth(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Lista inclusiva de meses entre `from` y `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

export function monthLabel(month: string, withYear = true): string {
  const { year, month: m } = parseMonth(month);
  const name = MONTH_NAMES[m - 1];
  return withYear ? `${name} ${year}` : name;
}

/** Fecha local de hoy en "YYYY-MM-DD" (sin desfasaje por zona horaria). */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isActiveIn(month: string, startMonth: string, endMonth: string | null | undefined): boolean {
  return startMonth <= month && (!endMonth || month <= endMonth);
}
