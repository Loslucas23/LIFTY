import { formatNumber, round2 } from './money';
import type { Settings, StockItem, StockMove, StockUnit } from './schema';
import { addDays, daysBetween } from './weight';

/**
 * Módulo Stock: cuánto tenés de cada cosa, cuánto usás, cuándo se termina, qué comprar y
 * cuánto sale. Todo con cuentas simples a partir de lo que anotás (compré, usé, conté, tiré).
 */

export const UNIT_LABEL: Record<StockUnit, string> = { u: 'u.', kg: 'kg', g: 'g', l: 'l', ml: 'ml', paq: 'paq.' };

/** Ventana para calcular el consumo (días). */
const WINDOW = 90;

const chrono = (a: StockMove, b: StockMove) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt);

/** Aplica un movimiento a una cantidad. */
function apply(qty: number, m: StockMove): number {
  switch (m.kind) {
    case 'buy':
      return qty + m.quantity;
    case 'use':
    case 'waste':
      return Math.max(0, qty - m.quantity);
    case 'count':
      return m.quantity;
  }
}

/** Cantidad que hay hasta `upTo` (inclusive). */
export function stockLevel(moves: StockMove[], upTo?: string): number {
  let q = 0;
  for (const m of [...moves].sort(chrono)) if (!upTo || m.date <= upTo) q = apply(q, m);
  return round2(q);
}

/** Redondea una cantidad a comprar según cómo viene el producto. */
export function roundToBuy(qty: number, item: Pick<StockItem, 'unit' | 'packSize'>): number {
  if (qty <= 0) return 0;
  if (item.packSize) return round2(Math.ceil(qty / item.packSize - 1e-9) * item.packSize);
  if (item.unit === 'u' || item.unit === 'paq') return Math.ceil(qty - 1e-9);
  if (item.unit === 'kg' || item.unit === 'l') return Math.ceil(qty * 2 - 1e-9) / 2;
  return Math.ceil(qty / 100 - 1e-9) * 100;
}

export interface Batch {
  date: string;
  expiry: string;
  quantity: number;
}

export interface StockStatus {
  item: StockItem;
  quantity: number;
  /** Consumo: desde cuándo se calcula, cuánto se usó (anotado + lo que bajó al contar) y por día. */
  usage: { from: string; days: number; used: number; perDay: number; confident: boolean } | null;
  /** Días que te dura lo que tenés, y qué día se termina. */
  daysLeft: number | null;
  runsOut: string | null;
  /** Días que querés cubrir (los de Ajustes o los del producto). */
  cover: number;
  need: 'out' | 'low' | 'ok';
  /** Por qué hay que comprar (para "¿de dónde sale?"). */
  reason: string;
  /** Cuánto comprar (ya redondeado) y cuánto saldría. */
  toBuy: number;
  estimatedCost: number | null;
  prices: {
    last: number | null;
    previous: number | null;
    /** Promedio por unidad de los últimos 6 meses (pesado por cantidad). */
    average: number | null;
    /** Cambio del último precio contra el anterior (%). */
    change: number | null;
    cheapestStore: { store: string; unitPrice: number } | null;
  };
  /** Lo que gastás por mes en esto, a tu ritmo de consumo. */
  monthlyCost: number | null;
  /** Lo tirado en los últimos 30 días (cantidad y plata). */
  wasted: { quantity: number; cost: number | null };
  /** Lotes que siguen en casa con fecha de vencimiento (se asume que usás primero lo más viejo). */
  batches: Batch[];
  nextExpiry: string | null;
}

export function stockStatus(
  item: StockItem,
  allMoves: StockMove[],
  today: string,
  settings: Pick<Settings, 'shoppingDays'>,
): StockStatus {
  const moves = allMoves.filter((m) => m.itemId === item.id && m.date <= today).sort(chrono);
  const quantity = stockLevel(moves);

  // ---- Consumo: lo anotado como usado + lo que bajó cuando contaste (no cuenta lo tirado) ----
  let usage: StockStatus['usage'] = null;
  if (moves.length) {
    const from = moves[0].date > addDays(today, -WINDOW) ? moves[0].date : addDays(today, -WINDOW);
    let q = 0;
    let used = 0;
    for (const m of moves) {
      if (m.date >= from) {
        if (m.kind === 'use') used += Math.min(q, m.quantity);
        if (m.kind === 'count' && m.quantity < q) used += q - m.quantity;
      }
      q = apply(q, m);
    }
    const days = Math.max(1, daysBetween(from, today));
    if (used > 0 && days >= 3) {
      usage = { from, days, used: round2(used), perDay: used / days, confident: days >= 14 };
    }
  }

  const cover = item.coverDays ?? settings.shoppingDays;
  const daysLeft = usage ? Math.floor(quantity / usage.perDay + 1e-9) : null;
  const runsOut = daysLeft !== null ? addDays(today, daysLeft) : null;

  let need: StockStatus['need'] = 'ok';
  let reason = 'Tenés suficiente.';
  if (quantity <= 0) {
    need = 'out';
    reason = 'No te queda.';
  } else if (item.minQuantity !== null && quantity <= item.minQuantity) {
    need = 'low';
    reason = `Quedan ${fmtQty(quantity, item.unit)} y avisás con ${fmtQty(item.minQuantity, item.unit)} o menos.`;
  } else if (daysLeft !== null && daysLeft < cover) {
    need = 'low';
    reason = `Te dura ${daysLeft} día${daysLeft === 1 ? '' : 's'} y querés tener para ${cover}.`;
  }

  // Cuánto comprar: para cubrir los días que querés (+2 de margen) o llegar al mínimo.
  let toBuy = 0;
  if (need !== 'ok') {
    const target = Math.max(
      item.minQuantity !== null ? item.minQuantity + (item.packSize ?? (item.unit === 'u' || item.unit === 'paq' ? 1 : 0)) : 0,
      usage ? usage.perDay * (cover + 2) : 0,
    );
    toBuy = roundToBuy(Math.max(target - quantity, 0), item);
    if (toBuy === 0) toBuy = roundToBuy(item.packSize ?? 1, item);
  }

  // ---- Precios (por unidad) ----
  const buys = moves.filter((m) => m.kind === 'buy' && m.price !== null && m.price > 0 && m.quantity > 0);
  const unit = (m: StockMove) => m.price! / m.quantity;
  const last = buys.length ? unit(buys[buys.length - 1]) : null;
  const previous = buys.length > 1 ? unit(buys[buys.length - 2]) : null;
  const recent = buys.filter((m) => m.date >= addDays(today, -180));
  const recentQty = recent.reduce((s, m) => s + m.quantity, 0);
  const average = recentQty > 0 ? recent.reduce((s, m) => s + m.price!, 0) / recentQty : last;
  const byStore = new Map<string, number>();
  for (const m of recent) {
    if (!m.store.trim()) continue;
    const key = m.store.trim();
    byStore.set(key, Math.min(byStore.get(key) ?? Infinity, unit(m)));
  }
  const cheapest = [...byStore.entries()].sort((a, b) => a[1] - b[1])[0];
  const priceRef = last ?? average;

  // ---- Tirado en los últimos 30 días ----
  const wastedQty = moves.filter((m) => m.kind === 'waste' && m.date > addDays(today, -30)).reduce((s, m) => s + m.quantity, 0);

  // ---- Lotes con vencimiento: lo que queda son las compras más nuevas ----
  const batches: Batch[] = [];
  let left = quantity;
  for (const m of [...moves].reverse()) {
    if (left <= 0) break;
    if (m.kind !== 'buy') continue;
    const q = Math.min(left, m.quantity);
    left -= q;
    // Sin fecha anotada, la que se espera según cuánto dura el producto.
    const expiry = m.expiry ?? (item.shelfDays ? addDays(m.date, item.shelfDays) : null);
    if (expiry) batches.push({ date: m.date, expiry, quantity: round2(q) });
  }
  batches.sort((a, b) => a.expiry.localeCompare(b.expiry));

  return {
    item,
    quantity,
    usage,
    daysLeft,
    runsOut,
    cover,
    need,
    reason,
    toBuy,
    estimatedCost: priceRef !== null && toBuy > 0 ? round2(priceRef * toBuy) : null,
    prices: {
      last: last !== null ? round2(last) : null,
      previous: previous !== null ? round2(previous) : null,
      average: average !== null ? round2(average) : null,
      change: last !== null && previous ? Math.round(((last - previous) / previous) * 100) : null,
      cheapestStore: cheapest && byStore.size > 1 ? { store: cheapest[0], unitPrice: round2(cheapest[1]) } : null,
    },
    monthlyCost: usage && average !== null ? round2(usage.perDay * 30 * average) : null,
    wasted: { quantity: round2(wastedQty), cost: wastedQty > 0 && average !== null ? round2(wastedQty * average) : null },
    batches,
    nextExpiry: batches[0]?.expiry ?? null,
  };
}

export function fmtQty(q: number, unit: StockUnit): string {
  return `${formatNumber(q, 2, 0)} ${UNIT_LABEL[unit]}`;
}

export interface StockOverview {
  statuses: StockStatus[];
  /** Lo que hay que comprar, lo más urgente primero. */
  shopping: StockStatus[];
  shoppingCost: number;
  /** Cuántos productos de la lista no tienen precio todavía. */
  withoutPrice: number;
  /** Lotes que vencen en los próximos `days` días (o ya vencieron). */
  expiring: { status: StockStatus; batch: Batch; daysLeft: number }[];
  /** Lo que gasta la casa por mes en lo que está en stock (de los productos con consumo y precio). */
  monthlyCost: number;
  wastedCost: number;
}

export function stockOverview(
  items: StockItem[],
  moves: StockMove[],
  today: string,
  settings: Pick<Settings, 'shoppingDays'>,
  expiringDays = 5,
): StockOverview {
  const statuses = items.filter((i) => !i.archived).map((i) => stockStatus(i, moves, today, settings));
  const shopping = statuses
    .filter((s) => s.need !== 'ok')
    .sort((a, b) => (a.need === 'out' ? -1 : 0) - (b.need === 'out' ? -1 : 0) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const expiring = statuses
    .flatMap((status) => status.batches.map((batch) => ({ status, batch, daysLeft: daysBetween(today, batch.expiry) })))
    .filter((e) => e.daysLeft <= expiringDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    statuses,
    shopping,
    shoppingCost: round2(shopping.reduce((s, x) => s + (x.estimatedCost ?? 0), 0)),
    withoutPrice: shopping.filter((x) => x.estimatedCost === null).length,
    expiring,
    monthlyCost: round2(statuses.reduce((s, x) => s + (x.monthlyCost ?? 0), 0)),
    wastedCost: round2(statuses.reduce((s, x) => s + (x.wasted.cost ?? 0), 0)),
  };
}

/** La lista de compras como texto (para mandar por WhatsApp o copiar). */
export function shoppingListText(list: { status: StockStatus; quantity: number }[]): string {
  return list.map(({ status, quantity }) => `• ${status.item.name}: ${fmtQty(quantity, status.item.unit)}`).join('\n');
}
