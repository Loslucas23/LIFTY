import { convert } from './accounts';
import { ownAmount } from './budget';
import { fold, round2 } from './money';
import { monthDiff, monthOf } from './months';
import type { LiftyData, Occasion } from './schema';
import { addDays, daysBetween } from './weight';

/**
 * Fechas caras y cumpleaños: cuándo es la próxima, cuánto falta, cuánto apartar por mes para
 * no llegar justo (presupuesto ÷ meses que faltan, contando este) y cuánto llevás gastado.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** El n-ésimo día de la semana `dow` (0 domingo) de un mes. */
function nthWeekday(year: number, month: number, n: number, dow: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** La fecha de ese año (null si no tiene fecha válida). */
export function occasionDate(o: Pick<Occasion, 'monthDay' | 'rule'>, year: number): string | null {
  if (o.monthDay) {
    const [m, d] = o.monthDay.split('-').map(Number);
    // El 29 de febrero, los años que no tienen, se festeja el 28.
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return `${year}-${pad(m)}-${pad(Math.min(d, last))}`;
  }
  if (o.rule) {
    const [m, n, dow] = o.rule.split(':').map(Number);
    return nthWeekday(year, m, n, dow);
  }
  return null;
}

/** La próxima vez (hoy cuenta). */
export function nextOccurrence(o: Pick<Occasion, 'monthDay' | 'rule'>, today: string): string | null {
  const y = Number(today.slice(0, 4));
  const d = occasionDate(o, y);
  if (!d) return null;
  return d >= today ? d : occasionDate(o, y + 1);
}

export interface OccasionStatus {
  occasion: Occasion;
  date: string;
  daysLeft: number;
  /** Meses para juntar la plata, contando este. */
  months: number;
  /** Presupuesto ÷ meses: lo que conviene apartar por mes (null sin presupuesto). */
  perMonth: number | null;
  /** Lo gastado para esta vez (lo anotado con su etiqueta en los últimos 60 días antes de la fecha). */
  spent: number;
  /** Ya toca avisar (dentro de los días de anticipación). */
  soon: boolean;
}

export function occasionStatus(
  data: Pick<LiftyData, 'transactions' | 'settings'>,
  o: Occasion,
  today: string,
): OccasionStatus | null {
  const date = nextOccurrence(o, today);
  if (!date) return null;
  const daysLeft = daysBetween(today, date);
  const months = Math.max(1, monthDiff(monthOf(today), monthOf(date)) + 1);
  const tag = fold(o.tag);
  const from = addDays(date, -Math.max(60, o.notice));
  const spent = tag
    ? data.transactions
        .filter(
          (t) =>
            t.kind === 'expense' &&
            t.date >= from &&
            t.date <= today &&
            t.date <= addDays(date, 3) &&
            t.tags.some((x) => fold(x) === tag),
        )
        .reduce((s, t) => s + convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' ? t.fxRate : 1), 0)
    : 0;
  const pending = o.budget !== null ? Math.max(0, o.budget - spent) : null;
  return {
    occasion: o,
    date,
    daysLeft,
    months,
    perMonth: pending !== null ? round2(pending / months) : null,
    spent: round2(spent),
    soon: daysLeft <= o.notice,
  };
}

/** Las que vienen, de la más cercana a la más lejana. */
export function upcomingOccasions(
  data: Pick<LiftyData, 'transactions' | 'settings' | 'occasions'>,
  today: string,
): OccasionStatus[] {
  return (data.occasions ?? [])
    .filter((o) => !o.archived)
    .map((o) => occasionStatus(data, o, today))
    .filter((s): s is OccasionStatus => s !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Ideas de fechas caras en Uruguay (se agregan con un toque y se pueden cambiar). */
export const OCCASION_IDEAS: Pick<Occasion, 'name' | 'icon' | 'monthDay' | 'rule' | 'notice' | 'tag'>[] = [
  { name: 'Fiestas (Navidad y fin de año)', icon: '🎄', monthDay: '12-24', rule: null, notice: 60, tag: 'fiestas' },
  { name: 'Día de Reyes', icon: '👑', monthDay: '01-06', rule: null, notice: 30, tag: 'reyes' },
  { name: 'Inicio de clases (útiles, uniformes)', icon: '🎒', monthDay: '03-01', rule: null, notice: 60, tag: 'clases' },
  { name: 'Día de la Madre', icon: '💐', monthDay: null, rule: '05:2:0', notice: 30, tag: 'dia de la madre' },
  { name: 'Día del Padre', icon: '👔', monthDay: null, rule: '07:2:0', notice: 30, tag: 'dia del padre' },
];
