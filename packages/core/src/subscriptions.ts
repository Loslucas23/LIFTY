import { convert } from './accounts';
import { categoryRootFn } from './budget';
import { fold, round2 } from './money';
import { addMonths, isActiveIn, monthDiff, monthOf } from './months';
import type { FixedExpense, LiftyData } from './schema';

/**
 * Revisar suscripciones (como Rocket Money): una vez por mes, "¿usaste esto?". Lo que das de
 * baja deja de contar desde el mes siguiente y Lifty lleva la cuenta de lo que ahorrás.
 */

/** Servicios conocidos (aunque no tengan la categoría Suscripciones). */
const KNOWN =
  /netflix|spotify|hbo|\bmax\b|disney|prime video|amazon prime|youtube|apple|icloud|google one|paramount|star\+|crunchyroll|chatgpt|openai|claude|canva|adobe|office|microsoft 365|dropbox|deezer|tidal|xbox|playstation|nintendo|duolingo|kindle|audible/;

const monthlyOf = (f: FixedExpense, rate: number) =>
  round2(convert(f.amount, f.currency, 'UYU', rate) / Math.max(1, f.everyMonths || 1));

export function isSubscription(data: Pick<LiftyData, 'categories'>, f: FixedExpense): boolean {
  return categoryRootFn(data.categories)(f.categoryId) === 'cat-suscripciones' || KNOWN.test(fold(f.name));
}

export interface SubscriptionReview {
  /** Las vigentes este mes. */
  active: { fixed: FixedExpense; monthly: number; reviewed: boolean }[];
  /** Las que todavía no revisaste este mes. */
  pending: number;
  monthly: number;
  /** Lo que dejaste de pagar por darlas de baja: por mes, por año y lo que llevás ahorrado. */
  cancelled: { fixed: FixedExpense; monthly: number; since: string; saved: number }[];
  savedMonthly: number;
  savedYearly: number;
  savedSoFar: number;
}

export function subscriptionReview(data: LiftyData, today: string): SubscriptionReview {
  const month = monthOf(today);
  const rate = data.settings.usdRate;
  const active = data.fixed
    .filter((f) => !f.archived && isActiveIn(month, f.startMonth, f.endMonth) && isSubscription(data, f))
    .map((f) => ({ fixed: f, monthly: monthlyOf(f, rate), reviewed: f.reviewedMonth === month }))
    .sort((a, b) => b.monthly - a.monthly);
  const cancelled = data.fixed
    .filter((f) => f.cancelled && f.endMonth && f.endMonth < month)
    .map((f) => {
      const since = addMonths(f.endMonth!, 1);
      const monthly = monthlyOf(f, rate);
      // Los meses que ya no pagaste, contando este.
      return { fixed: f, monthly, since, saved: round2(monthly * (monthDiff(since, month) + 1)) };
    });
  const savedMonthly = round2(cancelled.reduce((s, c) => s + c.monthly, 0));
  return {
    active,
    pending: active.filter((a) => !a.reviewed).length,
    monthly: round2(active.reduce((s, a) => s + a.monthly, 0)),
    cancelled,
    savedMonthly,
    savedYearly: round2(savedMonthly * 12),
    savedSoFar: round2(cancelled.reduce((s, c) => s + c.saved, 0)),
  };
}
