import { computeMonths } from './budget';
import { addMonths, monthOf } from './months';
import { round2 } from './money';
import type { LiftyData, Recipe } from './schema';
import { ingredientInItemUnit } from './menu';
import type { StockStatus } from './stock';

// ---------------- Recetas ----------------

export interface RecipeStatus {
  recipe: Recipe;
  /** Cuántas veces la podés hacer con lo que hay. */
  times: number;
  canCook: boolean;
  missing: { status: StockStatus | undefined; itemId: string; need: number; have: number }[];
  /** Costo total y por porción (con el precio promedio de cada ingrediente); null si falta algún precio. */
  cost: number | null;
  perServing: number | null;
  /** Ingredientes sin precio todavía. */
  withoutPrice: number;
}

export function recipeStatus(recipe: Recipe, statuses: StockStatus[]): RecipeStatus {
  const byId = new Map(statuses.map((s) => [s.item.id, s]));
  let times = Infinity;
  let cost = 0;
  let withoutPrice = 0;
  const missing: RecipeStatus['missing'] = [];
  for (const ing of recipe.ingredients) {
    const s = byId.get(ing.itemId);
    const have = s?.quantity ?? 0;
    // "2 cebollas" con el stock en kilos: se pasa a la unidad del producto.
    const qty = ingredientInItemUnit(ing, s?.item);
    // Los básicos (sal, aceite) alcanzan mientras haya algo.
    const enough = s?.item.staple ? have > 0 : have >= qty - 1e-9;
    times = Math.min(times, s?.item.staple && have > 0 ? Infinity : Math.floor(have / qty + 1e-9));
    if (!enough) missing.push({ status: s, itemId: ing.itemId, need: round2(qty - have), have });
    const price = s?.prices.average ?? s?.prices.last ?? null;
    if (price === null) withoutPrice++;
    else cost += price * qty;
  }
  if (!recipe.ingredients.length) times = 0;
  const total = withoutPrice ? null : round2(cost);
  return {
    recipe,
    times: Number.isFinite(times) ? times : 0,
    canCook: missing.length === 0 && recipe.ingredients.length > 0,
    missing,
    cost: total,
    perServing: total !== null ? round2(total / recipe.servings) : null,
    withoutPrice,
  };
}

// ---------------- ¿Me lo puedo comprar? ----------------

export interface AffordMonth {
  month: string;
  /** Lo que te queda libre ese mes sin la compra: ingresos − fijos − cuotas − ahorro − tu gasto promedio. */
  before: number;
  installment: number;
  after: number;
}

export interface Affordability {
  months: AffordMonth[];
  /** Gasto del día a día promedio de los últimos 3 meses terminados (se usa para los meses que vienen). */
  avgSpending: number;
  ok: boolean;
  firstShort: AffordMonth | null;
  /** Si lo juntás en vez de comprarlo ya: meses ahorrando lo libre de cada mes (null si no sobra nada). */
  monthsToSave: number | null;
}

export function affordability(
  data: LiftyData,
  today: string,
  opts: { amount: number; installments: number; startMonth?: string },
): Affordability {
  const current = monthOf(today);
  const start = opts.startMonth ?? current;
  const n = Math.max(1, Math.round(opts.installments));
  const horizon = Math.max(6, n + (start > current ? 1 : 0));
  const past = computeMonths(data, addMonths(current, -3), addMonths(current, -1), today);
  const withData = past.filter((m) => m.variable.total + m.card.total > 0);
  const avgSpending = withData.length
    ? round2(
        withData.reduce(
          (s, m) => s + m.variable.total + m.card.items.filter((l) => !l.installment).reduce((a, l) => a + l.amount, 0),
          0,
        ) / withData.length,
      )
    : 0;
  const future = computeMonths(data, current, addMonths(current, horizon - 1), today);
  const per = round2(opts.amount / n);
  const months = future.map((m, i) => {
    const reserve = m.savingsGoal.reserve;
    // Cuotas ya comprometidas (las compras en cuotas que ya cargaste); el gasto suelto se estima con el promedio.
    const committed = m.card.items.filter((l) => l.installment).reduce((s, l) => s + l.amount, 0);
    const spending =
      i === 0
        ? Math.max(avgSpending, m.variable.total + m.card.items.filter((l) => !l.installment).reduce((s, l) => s + l.amount, 0))
        : avgSpending;
    const before = round2(m.income.total - m.fixed.total - committed - reserve - spending);
    const installment = m.month >= start && m.month < addMonths(start, n) ? per : 0;
    return { month: m.month, before, installment, after: round2(before - installment) };
  });
  const firstShort = months.find((m) => m.installment > 0 && m.after < 0) ?? null;
  const avgFree = months.reduce((s, m) => s + m.before, 0) / months.length;
  return {
    months,
    avgSpending,
    ok: !firstShort,
    firstShort,
    monthsToSave: avgFree > 0 ? Math.ceil(opts.amount / avgFree) : null,
  };
}
