import { round2 } from './money';
import type { Asset, AssetKind, LiftyData } from './schema';
import { daysBetween } from './weight';

/**
 * Bienes (auto, casa, moto…) en el patrimonio. Lo que vale hoy = lo que valía (al comprarlo o
 * en la última tasación) × (1 − depreciación anual) elevado a los años que pasaron. Un auto
 * pierde ~12% por año; una casa o un terreno suelen mantener o ganar valor.
 */

/** Depreciación típica por año (%), para sugerir. */
export const ASSET_DEPRECIATION: Record<AssetKind, number> = { auto: 12, moto: 15, casa: 0, terreno: 0, otro: 20 };

export interface AssetValue {
  asset: Asset;
  /** En la moneda del bien. */
  value: number;
  valueUYU: number;
  /** De dónde sale: la compra o la tasación, y cuántos años pasaron. */
  from: 'purchase' | 'appraisal';
  baseValue: number;
  years: number;
  /** Lo que perdió (o ganó, si es negativo) desde la compra. */
  change: number;
}

export function assetValue(asset: Asset, date: string, rate: number): AssetValue | null {
  if (asset.date > date || (asset.soldDate && asset.soldDate <= date)) return null;
  const appraised = asset.appraisal !== null && asset.appraisalDate !== null && asset.appraisalDate <= date;
  const baseValue = appraised ? asset.appraisal! : asset.value;
  const baseDate = appraised ? asset.appraisalDate! : asset.date;
  const years = Math.max(0, daysBetween(baseDate, date) / 365.25);
  const value = round2(baseValue * Math.pow(1 - asset.depreciation / 100, years));
  return {
    asset,
    value,
    valueUYU: round2(asset.currency === 'USD' ? value * rate : value),
    from: appraised ? 'appraisal' : 'purchase',
    baseValue,
    years: round2(years),
    change: round2(asset.value - value),
  };
}

/** Todos los bienes que tenías a esa fecha, y el total en pesos. */
export function assetsAt(data: Pick<LiftyData, 'assets' | 'settings'>, date: string) {
  const list = (data.assets ?? [])
    .map((a) => assetValue(a, date, data.settings.usdRate))
    .filter((x): x is AssetValue => x !== null);
  return { list, totalUYU: round2(list.reduce((s, x) => s + x.valueUYU, 0)) };
}
