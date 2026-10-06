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

/**
 * Número como se escribe en Uruguay: punto de miles y coma decimal ("1.234,5"). Redondea como
 * Intl (la mitad hacia arriba, sobre el número tal como se escribe). Se hace a mano porque la
 * primera vez que se usa Intl carga los datos del idioma y demora el arranque en el celular.
 */
export function formatNumber(value: number, maxDecimals: number, minDecimals = maxDecimals): string {
  const abs = Math.abs(value);
  let r = Number(`${Math.round(Number(`${abs}e${maxDecimals}`))}e-${maxDecimals}`);
  if (!Number.isFinite(r)) r = Number(abs.toFixed(maxDecimals));
  const [int, rawFrac = ''] = r.toFixed(maxDecimals).split('.');
  let frac = rawFrac.replace(/0+$/, '');
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 && r !== 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

export function formatMoney(amount: number, currency: Currency = 'UYU', opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? (currency === 'USD' || !Number.isInteger(round2(amount)));
  const symbol = currency === 'USD' ? 'US$' : '$';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol} ${formatNumber(Math.abs(round2(amount)), decimals ? 2 : 0)}`;
}

/** Saca tildes y pasa a minúsculas para comparar ("azucar" encuentra "Azúcar"). */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
