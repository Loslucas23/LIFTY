import { fold, round2 } from './money';
import type { ShopEntry, StockItem, StockMove, StockPlace } from './schema';
import { median } from './smart';
import { addDays, daysBetween } from './weight';

/**
 * La lista del súper, más inteligente: ordenada por sector (como recorrés el súper), lo que
 * comprás cada tanto ("lo de siempre"), en qué súper te sale menos la lista, y avisos cuando
 * algo subió de precio. Cuentas simples con lo que anotaste al comprar.
 */

// ---------------- Sectores del súper ----------------

export const AISLES = [
  'verduleria',
  'panaderia',
  'carniceria',
  'fiambreria',
  'lacteos',
  'almacen',
  'bebidas',
  'congelados',
  'limpieza',
  'higiene',
  'mascotas',
  'otros',
] as const;
export type Aisle = (typeof AISLES)[number];

export const AISLE_LABEL: Record<Aisle, string> = {
  verduleria: '🥬 Frutas y verduras',
  panaderia: '🥖 Panadería',
  carniceria: '🥩 Carnes y pescado',
  fiambreria: '🧀 Fiambres y quesos',
  lacteos: '🥛 Lácteos y huevos',
  almacen: '🥫 Almacén',
  bebidas: '🥤 Bebidas',
  congelados: '❄️ Congelados',
  limpieza: '🧽 Limpieza',
  higiene: '🧼 Higiene y farmacia',
  mascotas: '🐾 Mascotas',
  otros: '📦 Otras cosas',
};

/** Frases de varias palabras que se miran primero ("dulce de leche" es lácteo, no almacén). */
const AISLE_PHRASES: [Aisle, RegExp][] = [
  ['almacen', /^(papas fritas|choclo en lata|tomate en lata|atun en lata|pan rallado|mate cocido|galletitas?)/],
  ['congelados', /^(papas congeladas|pizzas? congeladas?|empanadas? congeladas?|verduras? congeladas?)/],
  ['lacteos', /^(dulce de leche|queso crema|leche en polvo)/],
  ['fiambreria', /^(queso rallado|bondiola feteada)/],
  ['limpieza', /^(jabon en polvo|jabon liquido para ropa|bolsas? de (residuos?|basura)|papel de cocina|rollo de cocina)/],
  [
    'higiene',
    /^(papel higienico|pasta de dientes|pasta dental|hilo dental|crema (dental|de enjuague|de manos|corporal|facial|para))/,
  ],
  ['mascotas', /^(alimento para|comida (de|para) (perro|gato)|piedras sanitarias|arena para gatos?)/],
];

/**
 * El comienzo de las palabras de cada sector (las cortas, enteras: "pan" no es "panceta").
 * Se mira la primera palabra que se reconoce: en "yogur de frutilla" manda "yogur".
 */
const AISLE_WORDS: [Aisle, RegExp][] = [
  [
    'verduleria',
    /^(fruta|verdura|papas?$|boniato|cebolla|tomate|lechuga|zanahoria|zapall|morron|ajos?$|banana|manzana|naranja|mandarina|limon|pera$|peras$|frutilla|uvas?$|kiwi|palta|acelga|espinaca|brocoli|choclo|pepino|berenjena|perejil|albahaca|durazno|ciruela|anana|melon|sandia|calabaza|remolacha|apio|puerro|rucula|hongo|champi)/,
  ],
  ['panaderia', /^(pan$|panes$|bizcocho|medialuna|tostada|grisin|tortas?$|alfajor|factura|baguette|flauta|pebete|masas?$)/],
  [
    'carniceria',
    /^(carne|picada|pollo|milanesa|asado|chorizo|morcilla|bifes?$|nalga|cuadril|pulpa|pescado|merluza|cerdo|costilla|lomo|matambre|hamburguesa|pechuga|muslo|salchich|vacio|entrecot|colita|osobuco|higado|pavo)/,
  ],
  ['fiambreria', /^(jamon|queso|salame|mortadela|panceta|fiambre|leberwurst|dambo|muzzarella|mozzarella|ricota)/],
  ['lacteos', /^(leche|yogur|manteca|crema|huevo|postre|flan|margarina|kefir|danette|conaprole)/],
  [
    'bebidas',
    /^(aguas?$|refresco|coca|pepsi|sprite|fanta|jugo|cerveza|vino|whisky|fernet|grappa|sidra|soda|gaseosa|energizante|pilsen|patricia|zillertal|salus|nix$)/,
  ],
  ['congelados', /^(helado|congelad|hielo|nugget)/],
  [
    'limpieza',
    /^(detergente|suavizante|lavandina|cloro|limpiador|desengrasante|esponja|trapo|servilleta|escoba|lampazo|insecticida|fosforo|velas?$|nylon|aluminio|film$|lavavajilla|perfumol|virulana)/,
  ],
  [
    'higiene',
    /^(shampoo|champu|acondicionador|jabon|desodorante|cepillo|toalla|toallita|tampon|algodon|hisopo|afeitar|gillette|protector|alcohol|curita|perfume|panal|enjuague|ibuprofeno|paracetamol|perifar|aspirina|remedio)/,
  ],
  ['mascotas', /^(racion|dog|cat$|whiskas|pedigree)/],
  [
    'almacen',
    /^(arroz|fideo|tallarin|harina|polenta|azucar|sal$|aceite|vinagre|yerba|cafe|te$|cacao|lenteja|poroto|garbanzo|atun|sardina|arveja|salsa|pure|mayonesa|ketchup|mostaza|caldo|condimento|oregano|pimienta|mermelada|miel|cereal|avena|snack|mani$|chocolate|caramelo|gelatina|levadura|edulcorante|conserva|lata$|latas$)/,
  ],
];

const PLACE_AISLE: Record<StockPlace, Aisle> = {
  despensa: 'almacen',
  heladera: 'lacteos',
  freezer: 'congelados',
  limpieza: 'limpieza',
  higiene: 'higiene',
  otros: 'otros',
};

/** En qué sector del súper está algo, por el nombre (o, si no se sabe, por dónde lo guardás). */
export function aisleOf(name: string, place?: StockPlace | null): Aisle {
  const n = fold(name).trim();
  for (const [aisle, re] of AISLE_PHRASES) if (re.test(n)) return aisle;
  for (const w of n.split(/[^a-z0-9]+/).filter((x) => x.length >= 2))
    for (const [aisle, re] of AISLE_WORDS) if (re.test(w)) return aisle;
  return place ? PLACE_AISLE[place] : 'otros';
}

// ---------------- Agregar escribiendo: "2 kg arroz", "leche x3" ----------------

export interface ParsedShopText {
  name: string;
  quantity: number | null;
  unit: string;
}

const UNIT_WORDS: Record<string, string> = {
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  k: 'kg',
  g: 'g',
  gr: 'g',
  gramos: 'g',
  l: 'l',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  u: 'u.',
  un: 'u.',
  unidad: 'u.',
  unidades: 'u.',
  paq: 'paq.',
  paquete: 'paq.',
  paquetes: 'paq.',
  docena: 'docena',
};

/** Separa cantidad, unidad y nombre: "2 kg arroz", "arroz 2kg", "leche x3", "1/2 kg queso". */
export function parseShopText(text: string): ParsedShopText {
  let t = text.trim().replace(/\s+/g, ' ');
  let quantity: number | null = null;
  let unit = '';
  const num = (s: string) => (s.includes('/') ? Number(s.split('/')[0]) / Number(s.split('/')[1]) : Number(s.replace(',', '.')));
  const unitRe = Object.keys(UNIT_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const lead = new RegExp(`^(\\d+(?:[.,]\\d+)?|\\d+/\\d+)\\s*(${unitRe})?\\.?\\s+(?:de\\s+)?(.+)$`, 'i').exec(t);
  const tail = new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:[.,]\\d+)?|\\d+/\\d+)\\s*(${unitRe})?\\.?$`, 'i').exec(t);
  if (lead) {
    quantity = num(lead[1]);
    unit = lead[2] ? UNIT_WORDS[lead[2].toLowerCase()] : '';
    t = lead[3];
  } else if (tail) {
    quantity = num(tail[2]);
    unit = tail[3] ? UNIT_WORDS[tail[3].toLowerCase()] : '';
    t = tail[1];
  }
  if (unit === 'docena' && quantity) {
    quantity *= 12;
    unit = 'u.';
  }
  return { name: t.trim(), quantity: quantity && Number.isFinite(quantity) && quantity > 0 ? round2(quantity) : null, unit };
}

/** Distancia de edición, contando dos letras cambiadas de lugar como un error ("lehce" → leche). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const singular = (w: string) => w.replace(/(es|s)$/, '');

/**
 * El producto del stock que quisiste escribir: igual, en singular/plural, el comienzo
 * ("yer" → Yerba) o con un error de tipeo ("lehce" → Leche).
 */
export function matchStockItem<T extends Pick<StockItem, 'name' | 'archived'>>(items: T[], text: string): T | null {
  const q = fold(text).trim();
  if (q.length < 2) return null;
  const live = items.filter((i) => !i.archived);
  const named = live.map((i) => ({ i, n: fold(i.name).trim() }));
  return (
    named.find((x) => x.n === q)?.i ??
    named.find((x) => singular(x.n) === singular(q))?.i ??
    (q.length >= 3 ? named.filter((x) => x.n.startsWith(q)).sort((a, b) => a.n.length - b.n.length)[0]?.i : undefined) ??
    (q.length >= 4
      ? named
          .map((x) => ({ ...x, d: editDistance(singular(x.n), singular(q)) }))
          .filter((x) => x.d <= (q.length >= 7 ? 2 : 1))
          .sort((a, b) => a.d - b.d)[0]?.i
      : undefined) ??
    null
  );
}

// ---------------- Lo de siempre ----------------

export interface RoutineItem {
  item: StockItem;
  /** Cada cuántos días lo comprás (mediana entre compras). */
  every: number;
  last: string;
  next: string;
  /** Ya toca (o casi: falta 15% del intervalo o menos). */
  due: boolean;
  /** Lo que comprás normalmente cada vez. */
  usualQty: number;
  times: number;
}

/**
 * Lo que comprás cada tanto aunque no anotes cuánto usás: con 3 compras o más y un ritmo
 * parejo (cada ~7, ~15, ~30 días), avisa cuando ya toca.
 */
export function routineItems(items: StockItem[], moves: StockMove[], today: string): RoutineItem[] {
  const out: RoutineItem[] = [];
  for (const item of items) {
    if (item.archived) continue;
    const dates = [
      ...new Set(moves.filter((m) => m.itemId === item.id && m.kind === 'buy' && m.date <= today).map((m) => m.date)),
    ].sort();
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const every = Math.round(median(gaps));
    if (every < 3 || every > 120) continue;
    // Parejo: la mayoría de las compras a ±50% del intervalo típico.
    const regular = gaps.filter((g) => Math.abs(g - every) <= every * 0.5).length / gaps.length;
    if (regular < 0.6) continue;
    const last = dates[dates.length - 1];
    // Si hace mucho que no lo comprás (3 intervalos), dejó de ser "de siempre".
    if (daysBetween(last, today) > every * 3) continue;
    const qtys = moves.filter((m) => m.itemId === item.id && m.kind === 'buy').map((m) => m.quantity);
    out.push({
      item,
      every,
      last,
      next: addDays(last, every),
      due: daysBetween(last, today) >= every * 0.85,
      usualQty: round2(median(qtys)),
      times: dates.length,
    });
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}

// ---------------- Precios: dónde te sale menos y qué subió ----------------

interface StorePrice {
  store: string;
  unitPrice: number;
  date: string;
}

/** El último precio por unidad de cada producto en cada lugar (últimos 6 meses). */
export function latestPrices(moves: StockMove[], today: string): Map<string, StorePrice[]> {
  const since = addDays(today, -180);
  const byItem = new Map<string, Map<string, StorePrice>>();
  for (const m of moves) {
    if (m.kind !== 'buy' || !m.price || !m.quantity || !m.store.trim() || m.date < since || m.date > today) continue;
    const store = m.store.trim();
    const per = byItem.get(m.itemId) ?? new Map<string, StorePrice>();
    const prev = per.get(fold(store));
    if (!prev || m.date >= prev.date) per.set(fold(store), { store, unitPrice: m.price / m.quantity, date: m.date });
    byItem.set(m.itemId, per);
  }
  return new Map([...byItem.entries()].map(([id, m]) => [id, [...m.values()].sort((a, b) => a.unitPrice - b.unitPrice)]));
}

export interface ListByStore {
  /** Cuánto sale la lista en cada lugar (solo lo que tiene precio ahí). */
  stores: { store: string; total: number; covered: number }[];
  /** Cuántos productos de la lista tienen algún precio. */
  priced: number;
  /** El lugar donde conviene comprar todo (el que tiene más productos y, entre esos, el más barato). */
  best: { store: string; total: number; covered: number } | null;
  /** Comprando cada cosa donde está más barata: dónde va cada una y cuánto ahorrás contra `best`. */
  split: { store: string; items: string[]; total: number }[];
  splitSavings: number;
}

/** Para lo que falta comprar de la lista: en qué súper sale menos (con tus últimos precios). */
export function listByStore(entries: ShopEntry[], moves: StockMove[], today: string): ListByStore {
  const prices = latestPrices(moves, today);
  const pending = entries.filter((e) => !e.checked && e.itemId && prices.has(e.itemId));
  const totals = new Map<string, { store: string; total: number; covered: number }>();
  const split = new Map<string, { store: string; items: string[]; total: number }>();
  for (const e of pending) {
    const q = e.quantity ?? 1;
    const ps = prices.get(e.itemId!)!;
    for (const p of ps) {
      const t = totals.get(fold(p.store)) ?? { store: p.store, total: 0, covered: 0 };
      t.total += p.unitPrice * q;
      t.covered++;
      totals.set(fold(p.store), t);
    }
    const cheapest = ps[0];
    const s = split.get(fold(cheapest.store)) ?? { store: cheapest.store, items: [], total: 0 };
    s.items.push(e.name);
    s.total += cheapest.unitPrice * q;
    split.set(fold(cheapest.store), s);
  }
  const stores = [...totals.values()]
    .map((t) => ({ ...t, total: round2(t.total) }))
    .sort((a, b) => b.covered - a.covered || a.total - b.total);
  const best = stores[0] ?? null;
  const splitList = [...split.values()].map((s) => ({ ...s, total: round2(s.total) })).sort((a, b) => b.total - a.total);
  // El ahorro de dividir, comparado solo en lo que el mejor lugar tiene.
  let splitSavings = 0;
  if (best && splitList.length > 1) {
    for (const e of pending) {
      const ps = prices.get(e.itemId!)!;
      const atBest = ps.find((p) => fold(p.store) === fold(best.store));
      if (atBest) splitSavings += (atBest.unitPrice - ps[0].unitPrice) * (e.quantity ?? 1);
    }
  }
  return { stores, priced: pending.length, best, split: splitList, splitSavings: round2(splitSavings) };
}

export interface PriceAlert {
  item: StockItem;
  /** Último precio por unidad, el promedio de antes y el cambio (%). */
  last: number;
  before: number;
  change: number;
  store: string;
  date: string;
  /** Si en otro lugar lo pagaste menos (en los últimos 6 meses). */
  cheaperAt: { store: string; unitPrice: number } | null;
}

/**
 * Lo que subió (o bajó) de precio: la última compra contra el promedio de las anteriores de
 * los últimos 6 meses. Avisa desde 15% de diferencia.
 */
export function priceAlerts(items: StockItem[], moves: StockMove[], today: string, threshold = 0.15): PriceAlert[] {
  const since = addDays(today, -180);
  const prices = latestPrices(moves, today);
  const out: PriceAlert[] = [];
  for (const item of items) {
    if (item.archived) continue;
    const buys = moves
      .filter((m) => m.itemId === item.id && m.kind === 'buy' && m.price && m.quantity && m.date >= since && m.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));
    if (buys.length < 2) continue;
    const lastBuy = buys[buys.length - 1];
    const prev = buys.slice(0, -1);
    const last = lastBuy.price! / lastBuy.quantity;
    const before = prev.reduce((s, m) => s + m.price!, 0) / prev.reduce((s, m) => s + m.quantity, 0);
    const change = last / before - 1;
    if (Math.abs(change) < threshold) continue;
    const other = (prices.get(item.id) ?? []).find((p) => fold(p.store) !== fold(lastBuy.store) && p.unitPrice < last);
    out.push({
      item,
      last: round2(last),
      before: round2(before),
      change: Math.round(change * 100),
      store: lastBuy.store.trim(),
      date: lastBuy.date,
      cheaperAt: other ? { store: other.store, unitPrice: round2(other.unitPrice) } : null,
    });
  }
  return out.sort((a, b) => b.change - a.change);
}

// ---------------- La lista ordenada por sector ----------------

export interface AisleGroup<T> {
  aisle: Aisle;
  label: string;
  entries: T[];
}

/** Agrupa la lista por sector, en el orden en que se recorre el súper. */
export function groupByAisle<T extends Pick<ShopEntry, 'name' | 'itemId'>>(
  entries: T[],
  items: Pick<StockItem, 'id' | 'place'>[],
): AisleGroup<T>[] {
  const place = new Map(items.map((i) => [i.id, i.place]));
  const groups = new Map<Aisle, T[]>();
  for (const e of entries) {
    const a = aisleOf(e.name, e.itemId ? place.get(e.itemId) : null);
    groups.set(a, [...(groups.get(a) ?? []), e]);
  }
  return AISLES.filter((a) => groups.has(a)).map((a) => ({ aisle: a, label: AISLE_LABEL[a], entries: groups.get(a)! }));
}
