import type { Currency } from './schema';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convierte a pesos uruguayos. `rate` = pesos por dólar. */
export function toUYU(amount: number, currency: Currency, rate: number): number {
  return currency === 'UYU' ? amount : amount * rate;
}

export function fromUYU(amountUYU: number, currency: Currency, rate: number): number {
  return currency === 'UYU' ? amountUYU : amountUYU / rate;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: Currency = 'UYU', opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? (currency === 'USD' || !Number.isInteger(round2(amount)));
  const key = `${currency}:${decimals}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('es-UY', {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    formatters.set(key, fmt);
  }
  const symbol = currency === 'USD' ? 'US$' : '$';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol} ${fmt.format(Math.abs(round2(amount)))}`;
}
