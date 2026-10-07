import { round2 } from './money';
import type { LiftyData } from './schema';
import { addDays } from './weight';

/**
 * El dólar: con la cotización automática, la compu guarda la de cada día. Aviso cuando baja a lo
 * que elegiste, o cuando está bastante más barato que su promedio del último mes.
 */
export interface FxNews {
  rate: number;
  date: string;
  /** Promedio de los últimos 30 días (null si hay pocos datos). */
  average: number | null;
  /** Cambio contra el promedio (%). */
  change: number | null;
  /** Bajó a tu aviso, o está 2% o más por debajo del promedio: buen momento para comprar. */
  good: boolean;
  reason: string | null;
}

export function fxNews(data: Pick<LiftyData, 'fxRates' | 'settings'>, today: string): FxNews | null {
  const list = (data.fxRates ?? []).filter((r) => r.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const last = list[list.length - 1];
  if (!last) return null;
  const month = list.filter((r) => r.date >= addDays(today, -30));
  const average = month.length >= 5 ? round2(month.reduce((s, r) => s + r.rate, 0) / month.length) : null;
  const change = average ? round2(((last.rate - average) / average) * 100) : null;
  const alert = data.settings.rateAlert;
  let reason: string | null = null;
  if (alert && last.rate <= alert) reason = `bajó a lo que querías (${alert} o menos)`;
  else if (change !== null && change <= -2)
    reason = `está ${Math.abs(change).toFixed(1).replace('.', ',')}% más barato que el promedio del último mes`;
  return { rate: last.rate, date: last.date, average, change, good: reason !== null, reason };
}
