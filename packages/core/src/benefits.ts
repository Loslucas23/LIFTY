import { convert } from './accounts';
import { ownAmount } from './budget';
import { fold, round2 } from './money';
import { monthOf } from './months';
import type { Benefit, LiftyData, Transaction } from './schema';

/**
 * Beneficios y descuentos (como Fintonic): los cargás ("martes 25% en el súper con BROU") y
 * Lifty te dice cuáles valen hoy, dónde conviene comprar y con qué pagar, y cuánto te ahorraste.
 */

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** ¿Vale ese día? */
export function benefitActive(b: Benefit, date: string): boolean {
  if (b.archived || (b.until && b.until < date)) return false;
  return !b.days.length || b.days.includes(weekday(date));
}

export function benefitsOn(data: Pick<LiftyData, 'benefits'>, date: string): Benefit[] {
  return (data.benefits ?? []).filter((b) => benefitActive(b, date)).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
}

/** ¿Este gasto entra en el beneficio? (mismo lugar, si tiene; misma cuenta, si pide; ese día). */
export function benefitApplies(
  b: Benefit,
  t: Pick<Transaction, 'date' | 'description' | 'accountId' | 'categoryId' | 'kind'>,
): boolean {
  if (t.kind !== 'expense' || !benefitActive(b, t.date)) return false;
  if (b.store && !fold(t.description).includes(fold(b.store))) return false;
  if (b.accountId && t.accountId !== b.accountId) return false;
  if (!b.store && b.categoryId && t.categoryId !== b.categoryId) return false;
  return true;
}

/**
 * Para un gasto que estás cargando: el beneficio de hoy en ese lugar, si pagás con otra cuenta
 * (para sugerir pagar con la del beneficio).
 */
export function benefitFor(
  data: Pick<LiftyData, 'benefits'>,
  t: Pick<Transaction, 'date' | 'description' | 'accountId' | 'categoryId'>,
): { benefit: Benefit; ok: boolean } | null {
  const d = fold(t.description);
  const hits = benefitsOn(data, t.date).filter((b) =>
    b.store ? d.includes(fold(b.store)) : !!b.categoryId && b.categoryId === t.categoryId,
  );
  if (!hits.length) return null;
  const ok = hits.find((b) => !b.accountId || b.accountId === t.accountId);
  return ok ? { benefit: ok, ok: true } : { benefit: hits[0], ok: false };
}

export interface BenefitSavings {
  benefit: Benefit;
  /** Gastos que entraron este mes y lo que te ahorraste (con el tope). */
  count: number;
  saved: number;
}

/** Lo que te ahorraste este mes con cada beneficio (porcentaje × lo gastado, hasta el tope). */
export function benefitSavings(data: Pick<LiftyData, 'benefits' | 'transactions' | 'settings'>, today: string): BenefitSavings[] {
  const month = monthOf(today);
  const rate = data.settings.usdRate;
  return (data.benefits ?? [])
    .filter((b) => !b.archived && b.percent)
    .map((b) => {
      const txs = data.transactions.filter((t) => monthOf(t.date) === month && t.date <= today && benefitApplies(b, t));
      const spent = txs.reduce((s, t) => s + convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' ? t.fxRate : rate), 0);
      const raw = (spent * (b.percent ?? 0)) / 100;
      return { benefit: b, count: txs.length, saved: round2(b.cap !== null ? Math.min(b.cap, raw) : raw) };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.saved - a.saved);
}
