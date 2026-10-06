import { convert } from './accounts';
import { countsInBudget, effectiveBudget, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { addMonths, daysInMonth, monthOf } from './months';
import { fold, round2 } from './money';
import type { Category, LiftyData, Transaction, TxKind } from './schema';
import { addDays } from './weight';

/**
 * Cálculos "inteligentes" de Lifty: estadística simple y explicable (medianas, promedios por
 * día de la semana, frecuencias de palabras). Nada de IA: cada resultado trae los números
 * con los que se calculó, para el "¿de dónde sale?".
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dowOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percentil p (0 a 1) por interpolación lineal. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Lo que pagaste vos (sin la parte que te devuelven), en pesos y por cuota. */
function myUYU(t: Transaction, rate: number): number {
  const r = t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate;
  return convert(ownAmount(t), t.currency, 'UYU', r) / Math.max(1, t.installments);
}

/** Gastos del día a día (sin fijos, sin tarjeta de alimentación), del más nuevo al más viejo no importa. */
function dayToDay(data: LiftyData): Transaction[] {
  const off = offBudgetAccounts(data);
  return data.transactions.filter((t) => t.kind === 'expense' && !t.linkKind && countsInBudget(t, off) && t.amount > 0);
}

// ---------------- Pronóstico según cómo gastás cada día de la semana ----------------

export interface WeekdayForecast {
  /** Cómo terminás el mes (sin lo que viene del mes anterior), como `daily.forecastEnd`. */
  forecastEnd: number;
  spentSoFar: number;
  /** Lo que se espera gastar desde hoy hasta fin de mes. */
  expectedRest: number;
  /** Para cada día de la semana que queda: cuántos hay y lo típico de ese día. */
  rest: { weekday: string; days: number; typical: number }[];
  /** Los días con gastos muy grandes se cuentan como este tope (el 10% más alto). */
  cap: number;
  historyDays: number;
}

/**
 * En vez de "promedio del mes × días", mira las últimas 12 semanas: cuánto gastás normalmente
 * cada lunes, cada martes… (los días con una compra fuera de lo común se recortan al tope del
 * 10% más alto, para que una heladera no arruine el pronóstico). Lo que falta del mes se
 * estima sumando lo típico de cada día que queda.
 */
export function weekdayForecast(data: LiftyData, b: MonthBudget, today: string, weeks = 12): WeekdayForecast | null {
  const d = b.daily;
  if (!d) return null;
  const from = addDays(today, -weeks * 7);
  const rate = data.settings.usdRate;
  const perDay = new Map<string, number>();
  let first: string | null = null;
  for (const t of dayToDay(data)) {
    if (t.date < from || t.date >= today) continue;
    perDay.set(t.date, (perDay.get(t.date) ?? 0) + myUYU(t, rate));
    if (!first || t.date < first) first = t.date;
  }
  if (!first) return null;
  // Desde el primer gasto registrado (si empezaste a usar Lifty hace poco, no cuenta lo de antes).
  const days: string[] = [];
  for (let x = first; x < today; x = addDays(x, 1)) days.push(x);
  const spendDays = [...perDay.values()].filter((v) => v > 0).length;
  if (days.length < 28 || spendDays < 10) return null;
  const totals = days.map((x) => perDay.get(x) ?? 0);
  const cap = round2(percentile(totals, 0.9));
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  days.forEach((x, i) => {
    const w = dowOf(x);
    sums[w] += Math.min(totals[i], cap);
    counts[w]++;
  });
  const typical = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));

  const end = `${b.month}-${String(daysInMonth(b.month)).padStart(2, '0')}`;
  const restCount = [0, 0, 0, 0, 0, 0, 0];
  for (let x = addDays(today, 1); x <= end; x = addDays(x, 1)) restCount[dowOf(x)]++;
  // Hoy: lo que ya gastaste o lo típico del día, lo que sea más.
  const todayExpected = Math.max(d.spentToday, typical[dowOf(today)]);
  const restSum = restCount.reduce((s, n, i) => s + n * typical[i], 0);
  const expectedRest = round2(todayExpected - d.spentToday + restSum);
  const spentSoFar = round2(d.spentBefore + d.spentToday);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return {
    forecastEnd: round2(d.base - spentSoFar - expectedRest),
    spentSoFar,
    expectedRest,
    rest: order
      .filter((i) => restCount[i] > 0)
      .map((i) => ({ weekday: WEEKDAYS[i], days: restCount[i], typical: round2(typical[i]) })),
    cap,
    historyDays: days.length,
  };
}

// ---------------- Categoría sugerida por las palabras ----------------

export interface CategorySuggestion {
  categoryId: string;
  /** La palabra que más pesó y cuántas veces la usaste en esa categoría. */
  word: string;
  count: number;
  total: number;
  source: 'history' | 'keywords';
}

const words = (text: string) =>
  fold(text)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));

export type WordIndex = Map<string, Map<string, number>>;

/** Para cada palabra de las descripciones, cuántas veces fue a cada categoría. */
export function buildWordIndex(data: Pick<LiftyData, 'transactions'>, kind: TxKind): WordIndex {
  const index: WordIndex = new Map();
  for (const t of data.transactions) {
    if (t.kind !== kind || !t.categoryId || t.linkKind) continue;
    for (const w of new Set(words(t.description))) {
      let byCat = index.get(w);
      if (!byCat) index.set(w, (byCat = new Map()));
      byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + 1);
    }
  }
  return index;
}

/** Para cuando todavía no hay historia: palabras comunes en Uruguay. */
const KEYWORDS: [RegExp, string][] = [
  [
    /^(super|supermercado|disco|devoto|geant|tata|macro|kinko|almacen|autoservice|feria|verduleria|carniceria|panaderia|frigorifico)/,
    'cat-super',
  ],
  [
    /^(uber|cabify|taxi|stm|omnibus|bondi|boleto|nafta|ancap|petrobras|axion|peaje|estacionamiento|cutcsa|copsa|cot|turil)/,
    'cat-transporte',
  ],
  [
    /^(farmacia|farmashop|medico|mutualista|casmu|medica|hospital|emergencia|semm|ucm|dentista|odontologo|remedio|ticket)/,
    'cat-salud',
  ],
  [/^(ute|ose|antel|movistar|claro|internet|gas|montevideogas|tributos|contribucion|imm)/, 'cat-servicios'],
  [/^(netflix|spotify|disney|hbo|max|prime|youtube|icloud|google|chatgpt|suscripcion)/, 'cat-suscripciones'],
  [
    /^(pedidosya|rappi|delivery|pizza|pizzeria|chivito|hamburguesa|mcdonald|burger|restaurant|restoran|bar|cafe|cafeteria|almuerzo|cena|empanada)/,
    'cat-comida',
  ],
  [/^(cine|teatro|entrada|recital|salida|boliche|futbol|partido|juego|steam|playstation)/, 'cat-ocio'],
  [/^(facultad|udelar|curso|libro|libreria|fotocopia|cuota|matricula|ort|ucu)/, 'cat-estudios'],
  [/^(alquiler|gastos|comunes|expensas|ferreteria|sodimac|mueble|limpieza)/, 'cat-casa'],
  [/^(peluqueria|barberia|ropa|zapatillas|perfume|perfumeria|regalo)/, 'cat-personal'],
];

/**
 * Sugiere la categoría según las palabras de la descripción: para cada palabra, la parte de
 * las veces que la usaste en cada categoría; gana la que suma más. Si no hay historia,
 * prueba con palabras comunes (súper, UTE, Uber, farmacia…).
 */
export function suggestCategory(index: WordIndex, description: string, validIds: Set<string>): CategorySuggestion | null {
  const ws = words(description);
  if (!ws.length) return null;
  const score = new Map<string, number>();
  /** Para cada categoría, la palabra que más la respalda (para explicar la sugerencia). */
  const why = new Map<string, { word: string; count: number; total: number }>();
  ws.forEach((w, i) => {
    // La última palabra puede estar a medio escribir: vale como comienzo de una conocida.
    const matches = index.has(w)
      ? [w]
      : i === ws.length - 1 && w.length >= 4
        ? [...index.keys()].filter((k) => k.startsWith(w))
        : [];
    for (const m of matches) {
      const byCat = index.get(m)!;
      const total = [...byCat.values()].reduce((s, n) => s + n, 0);
      for (const [cat, n] of byCat) {
        if (!validIds.has(cat)) continue;
        score.set(cat, (score.get(cat) ?? 0) + n / total / matches.length);
        const prev = why.get(cat);
        if (!prev || n > prev.count) why.set(cat, { word: m, count: n, total });
      }
    }
  });
  if (score.size) {
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
    // Solo si está claro: si las palabras se reparten entre dos categorías, mejor no adivinar.
    if (ranked[0][1] - (ranked[1]?.[1] ?? 0) < 0.34) return null;
    return { categoryId: ranked[0][0], ...why.get(ranked[0][0])!, source: 'history' };
  }
  for (const w of ws)
    for (const [re, cat] of KEYWORDS)
      if (re.test(w) && validIds.has(cat)) return { categoryId: cat, word: w, count: 0, total: 0, source: 'keywords' };
  return null;
}

/**
 * Si la categoría tiene subcategorías y la descripción nombra una ("uber" → Transporte › Uber y
 * taxi, "farmacia" → Salud › Farmacia), devuelve esa. Compara palabra por palabra (o el comienzo).
 */
export function suggestSubcategory(
  categories: Pick<Category, 'id' | 'name' | 'parentId' | 'archived'>[],
  categoryId: string,
  description: string,
): string | null {
  const ws = words(description);
  if (!ws.length) return null;
  const close = (w: string, n: string) => w === n || (w.length >= 4 && n.startsWith(w)) || (n.length >= 4 && w.startsWith(n));
  for (const c of categories) {
    if (c.parentId !== categoryId || c.archived) continue;
    if (words(c.name).some((n) => ws.some((w) => close(w, n)))) return c.id;
  }
  return null;
}

// ---------------- ¿Ya lo cargaste? ----------------

/** Un movimiento casi igual (mismo tipo y monto, ±1 día, misma categoría o descripción). */
export function possibleDuplicate(
  data: Pick<LiftyData, 'transactions'>,
  tx: Pick<Transaction, 'id' | 'kind' | 'amount' | 'currency' | 'date' | 'categoryId' | 'description'>,
): Transaction | null {
  const desc = fold(tx.description);
  const lo = addDays(tx.date, -1);
  const hi = addDays(tx.date, 1);
  return (
    data.transactions.find(
      (t) =>
        t.id !== tx.id &&
        t.kind === tx.kind &&
        t.currency === tx.currency &&
        Math.abs(t.amount - tx.amount) <= Math.max(0.01, Math.abs(tx.amount) * 0.005) &&
        t.date >= lo &&
        t.date <= hi &&
        ((!!tx.categoryId && t.categoryId === tx.categoryId) || (!!desc && fold(t.description) === desc)),
    ) ?? null
  );
}

// ---------------- Gastos que parecen fijos ----------------

export interface RecurringCandidate {
  key: string;
  name: string;
  /** Mediana de lo que pagás por mes. */
  amount: number;
  min: number;
  max: number;
  dayOfMonth: number;
  categoryId: string | null;
  accountId: string | null;
  months: { month: string; amount: number; txIds: string[] }[];
}

const keyOf = (description: string) =>
  fold(description)
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mostCommon = <T>(xs: T[]): T | null => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/**
 * Busca gastos que se repiten todos los meses y no están como fijos: la misma descripción en
 * al menos 3 de los últimos 4 meses, con montos parecidos (no varían más de 25%).
 */
export function detectRecurring(data: LiftyData, today: string): RecurringCandidate[] {
  const month = monthOf(today);
  const window = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1), month];
  const rate = data.settings.usdRate;
  const groups = new Map<string, Transaction[]>();
  for (const t of dayToDay(data)) {
    if (t.installments > 1 || !window.includes(monthOf(t.date))) continue;
    const k = keyOf(t.description);
    if (k.length < 3) continue;
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const fixedKeys = data.fixed.filter((f) => !f.archived).map((f) => keyOf(f.name));
  const out: RecurringCandidate[] = [];
  for (const [k, txs] of groups) {
    if (fixedKeys.some((f) => f && (f === k || f.includes(k) || k.includes(f)))) continue;
    const byMonth = new Map<string, Transaction[]>();
    for (const t of txs) {
      const m = monthOf(t.date);
      byMonth.set(m, [...(byMonth.get(m) ?? []), t]);
    }
    // Una vez por mes (si lo pagás varias veces al mes, no es un fijo: es una costumbre).
    if (byMonth.size < 3 || [...byMonth.values()].some((x) => x.length > 1)) continue;
    // Tiene que estar en los meses ya terminados (el actual puede no haber llegado todavía).
    const closed = window.slice(0, 3).filter((m) => byMonth.has(m)).length;
    if (closed < 2) continue;
    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, list]) => ({
        month: m,
        amount: round2(list.reduce((s, t) => s + myUYU(t, rate), 0)),
        txIds: list.map((t) => t.id),
      }));
    const amounts = months.map((m) => m.amount);
    const med = median(amounts);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    if (med <= 0 || (max - min) / med > 0.25) continue;
    const last = [...txs].sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push({
      key: k,
      name: last.description.trim(),
      amount: round2(med),
      min,
      max,
      dayOfMonth: Math.round(median(txs.map((t) => Number(t.date.slice(8))))),
      categoryId: mostCommon(txs.map((t) => t.categoryId)),
      accountId: mostCommon(txs.map((t) => t.accountId)),
      months,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ---------------- Gastos fuera de lo común ----------------

export interface UnusualExpense {
  tx: Transaction;
  amount: number;
  /** Lo normal en esa categoría (mediana) y el tope "alto" (el 90% de los gastos está por debajo). */
  median: number;
  high: number;
  samples: number;
}

/**
 * Un gasto de los últimos días que es mucho más grande que lo normal en su categoría: más de
 * 2,5 veces la mediana y más que la mediana + 4 desvíos "robustos" (MAD × 1,4826), mirando
 * los últimos 6 meses (hacen falta al menos 8 gastos para comparar).
 */
export function unusualExpenses(data: LiftyData, today: string, days = 7): UnusualExpense[] {
  const rate = data.settings.usdRate;
  const recentFrom = addDays(today, -(days - 1));
  const historyFrom = addDays(today, -180);
  const byCat = new Map<string, number[]>();
  const recent: Transaction[] = [];
  for (const t of dayToDay(data)) {
    if (!t.categoryId || t.date > today) continue;
    if (t.date >= recentFrom) recent.push(t);
    else if (t.date >= historyFrom)
      byCat.set(t.categoryId, [...(byCat.get(t.categoryId) ?? []), myUYU(t, rate) * Math.max(1, t.installments)]);
  }
  const out: UnusualExpense[] = [];
  for (const t of recent) {
    const hist = byCat.get(t.categoryId!) ?? [];
    if (hist.length < 8) continue;
    const m = median(hist);
    const mad = median(hist.map((x) => Math.abs(x - m))) * 1.4826;
    const amount = round2(myUYU(t, rate) * Math.max(1, t.installments));
    if (amount < 500 || amount < 2.5 * m || amount < m + 4 * mad) continue;
    out.push({ tx: t, amount, median: round2(m), high: round2(percentile(hist, 0.9)), samples: hist.length });
  }
  return out.sort((a, b) => b.amount / b.median - a.amount / a.median);
}

// ---------------- Revisión del presupuesto ----------------

export interface BudgetAdvice {
  categoryId: string;
  kind: 'raise' | 'lower';
  current: number;
  suggested: number;
  months: { month: string; spent: number; limit: number }[];
}

const round100 = (v: number) => Math.ceil(v / 100) * 100;

/**
 * Mira los últimos 3 meses terminados de cada categoría con presupuesto: si te pasaste los 3,
 * el presupuesto no es realista (sugiere subirlo a lo que gastás normalmente); si los 3 usaste
 * menos del 70%, sobra (sugiere bajarlo y que esa plata vaya al ahorro).
 */
export function budgetReview(data: LiftyData, months: MonthBudget[]): BudgetAdvice[] {
  if (months.length < 4) return [];
  const current = months[months.length - 1];
  const past = months.slice(-4, -1);
  const out: BudgetAdvice[] = [];
  for (const c of data.categories) {
    if (c.archived || c.kind !== 'expense' || c.parentId) continue;
    const now = effectiveBudget(data, current.month, c.id).amount;
    if (!now) continue;
    const hist = past.map((b) => ({
      month: b.month,
      spent: round2(b.categories.find((x) => x.categoryId === c.id)?.spent ?? 0),
      limit: effectiveBudget(data, b.month, c.id).amount ?? 0,
    }));
    if (hist.some((h) => !h.limit)) continue;
    const spent = hist.map((h) => h.spent);
    if (hist.every((h) => h.spent > h.limit)) {
      const suggested = round100(median(spent));
      if (suggested > now) out.push({ categoryId: c.id, kind: 'raise', current: now, suggested, months: hist });
    } else if (Math.max(...spent) > 0 && hist.every((h) => h.spent < h.limit * 0.7)) {
      // (Si no gastaste nada en 3 meses, puede ser una reserva a propósito: no se sugiere nada.)
      const suggested = round100(Math.max(...spent) * 1.1);
      if (suggested < now) out.push({ categoryId: c.id, kind: 'lower', current: now, suggested, months: hist });
    }
  }
  return out.sort((a, b) => Math.abs(b.suggested - b.current) - Math.abs(a.suggested - a.current));
}
