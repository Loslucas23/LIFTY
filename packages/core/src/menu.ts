import { fold, formatNumber, round2 } from './money';
import type { Meal, Recipe, StockItem, StockPlace, StockUnit } from './schema';
import { roundToBuy, UNIT_LABEL, type StockStatus } from './stock';
import { addDays, daysBetween } from './weight';

/**
 * Menú de la semana: elegís recetas para cada día y Lifty suma los ingredientes, los compara
 * con lo que hay en el stock, arma la lista con lo que falta (en unidades que se compran: "3
 * cebollas", no "0,45 kg") y dice cuánto sale cada comida y la semana. Todo con cuentas simples.
 */

// ---------------- Productos: cuánto pesa una unidad y cuánto dura ----------------

export interface ProductInfo {
  name: string;
  icon: string;
  unit: StockUnit;
  place: StockPlace;
  /** Gramos que pesa una unidad (para pasar de "2 cebollas" a kilos). */
  unitWeight: number | null;
  /** Días que dura desde la compra. */
  shelfDays: number | null;
  staple?: boolean;
  packSize?: number;
}

const P = (
  name: string,
  icon: string,
  unit: StockUnit,
  place: StockPlace,
  unitWeight: number | null,
  shelfDays: number | null,
  extra: Partial<ProductInfo> = {},
): ProductInfo => ({ name, icon, unit, place, unitWeight, shelfDays, ...extra });

/** Lo más común de la feria y el súper en Uruguay, con valores típicos (se pueden cambiar). */
export const PRODUCT_CATALOG: ProductInfo[] = [
  P('Cebolla', '🧅', 'kg', 'despensa', 150, 30),
  P('Papa', '🥔', 'kg', 'despensa', 200, 30),
  P('Boniato', '🍠', 'kg', 'despensa', 300, 30),
  P('Zanahoria', '🥕', 'kg', 'heladera', 100, 21),
  P('Tomate', '🍅', 'kg', 'heladera', 150, 7),
  P('Morrón', '🫑', 'kg', 'heladera', 180, 10),
  P('Zapallito', '🥒', 'kg', 'heladera', 250, 10),
  P('Zapallo', '🎃', 'kg', 'despensa', 1500, 30),
  P('Lechuga', '🥬', 'u', 'heladera', 400, 5),
  P('Acelga', '🥬', 'u', 'heladera', 500, 5),
  P('Ajo', '🧄', 'u', 'despensa', 50, 60),
  P('Limón', '🍋', 'kg', 'heladera', 100, 21),
  P('Manzana', '🍎', 'kg', 'heladera', 180, 21),
  P('Banana', '🍌', 'kg', 'despensa', 150, 6),
  P('Naranja', '🍊', 'kg', 'despensa', 200, 21),
  P('Mandarina', '🍊', 'kg', 'despensa', 120, 14),
  P('Palta', '🥑', 'u', 'despensa', 200, 5),
  P('Huevos', '🥚', 'u', 'heladera', 60, 25, { packSize: 12 }),
  P('Leche', '🥛', 'l', 'heladera', null, 7, { packSize: 1 }),
  P('Yogur', '🥛', 'u', 'heladera', null, 14),
  P('Manteca', '🧈', 'g', 'heladera', null, 45, { packSize: 200 }),
  P('Queso', '🧀', 'kg', 'heladera', null, 21),
  P('Jamón', '🥓', 'kg', 'heladera', null, 7),
  P('Pan', '🍞', 'u', 'despensa', 60, 3),
  P('Carne picada', '🥩', 'kg', 'heladera', null, 2),
  P('Carne', '🥩', 'kg', 'heladera', null, 3),
  P('Pollo', '🍗', 'kg', 'heladera', null, 2),
  P('Pescado', '🐟', 'kg', 'heladera', null, 2),
  P('Arroz', '🍚', 'kg', 'despensa', null, 365, { packSize: 1 }),
  P('Fideos', '🍝', 'g', 'despensa', null, 365, { packSize: 500 }),
  P('Harina', '🌾', 'kg', 'despensa', null, 180, { packSize: 1 }),
  P('Polenta', '🌽', 'g', 'despensa', null, 365, { packSize: 500 }),
  P('Lentejas', '🫘', 'g', 'despensa', null, 365, { packSize: 400 }),
  P('Atún', '🐟', 'u', 'despensa', 170, 730),
  P('Puré de tomate', '🥫', 'u', 'despensa', 520, 365),
  P('Azúcar', '🍬', 'kg', 'despensa', null, 730, { packSize: 1 }),
  P('Sal', '🧂', 'kg', 'despensa', null, null, { staple: true }),
  P('Aceite', '🫒', 'l', 'despensa', null, 365, { staple: true, packSize: 0.9 }),
  P('Vinagre', '🍶', 'l', 'despensa', null, 730, { staple: true }),
  P('Café', '☕', 'g', 'despensa', null, 180, { packSize: 250 }),
  P('Yerba', '🧉', 'kg', 'despensa', null, 365, { packSize: 1 }),
];

/** Lo que sabemos de un producto por su nombre ("cebollas", "Huevo colorado" → huevos). */
export function catalogFor(name: string): ProductInfo | null {
  const n = fold(name).replace(/[^a-z ñ]/g, ' ');
  const words = n.split(/\s+/).filter(Boolean);
  const singular = (w: string) => w.replace(/(es|s)$/, '');
  let best: ProductInfo | null = null;
  for (const p of PRODUCT_CATALOG) {
    const key = fold(p.name);
    const keyWords = key.split(' ');
    const hit = keyWords.every((k) => words.some((w) => w === k || singular(w) === singular(k)));
    if (hit && (!best || p.name.length > best.name.length)) best = p;
  }
  return best;
}

// ---------------- Unidades ----------------

const GRAMS: Partial<Record<StockUnit, number>> = { kg: 1000, g: 1 };
const ML: Partial<Record<StockUnit, number>> = { l: 1000, ml: 1 };

/**
 * Pasa una cantidad de una unidad a otra: kg ↔ g, l ↔ ml y, con el peso de una unidad, u ↔ kg/g.
 * Null si no se puede (ej: litros a unidades).
 */
export function convertQty(qty: number, from: StockUnit, to: StockUnit, unitWeight: number | null): number | null {
  if (from === to) return qty;
  const isUnit = (u: StockUnit) => u === 'u' || u === 'paq';
  if (isUnit(from) && isUnit(to)) return qty;
  if (GRAMS[from] && GRAMS[to]) return (qty * GRAMS[from]!) / GRAMS[to]!;
  if (ML[from] && ML[to]) return (qty * ML[from]!) / ML[to]!;
  if (unitWeight && isUnit(from) && GRAMS[to]) return (qty * unitWeight) / GRAMS[to]!;
  if (unitWeight && GRAMS[from] && isUnit(to)) return (qty * GRAMS[from]!) / unitWeight;
  return null;
}

/** Unidades en que se puede pedir un producto en una receta. */
export function ingredientUnits(item: Pick<StockItem, 'unit' | 'unitWeight'>): StockUnit[] {
  const all: StockUnit[] = ['u', 'kg', 'g', 'l', 'ml'];
  return all.filter((u) => u === item.unit || convertQty(1, u, item.unit, item.unitWeight) !== null);
}

/** La cantidad de un ingrediente en la unidad del producto (si no se puede pasar, tal cual). */
export function ingredientInItemUnit(
  ing: Recipe['ingredients'][number],
  item: Pick<StockItem, 'unit' | 'unitWeight'> | undefined,
): number {
  if (!item || !ing.unit) return ing.quantity;
  return convertQty(ing.quantity, ing.unit, item.unit, item.unitWeight) ?? ing.quantity;
}

/** "2 u. de Cebolla (≈300 g)" */
export function ingredientLabel(ing: Recipe['ingredients'][number], item: StockItem | undefined): string {
  const unit = ing.unit ?? item?.unit ?? 'u';
  const base = `${formatNumber(ing.quantity, 2, 0)} ${UNIT_LABEL[unit]}`;
  if (!item) return base;
  if (unit === 'u' && item.unitWeight && (item.unit === 'kg' || item.unit === 'g'))
    return `${base} (≈${formatNumber(ing.quantity * item.unitWeight, 0)} g)`;
  return base;
}

// ---------------- Menú de la semana ----------------

export interface MenuNeed {
  item: StockItem;
  status: StockStatus | undefined;
  /** Lo que piden las comidas (en la unidad del producto). */
  need: number;
  have: number;
  missing: number;
  /** Cuánto comprar (redondeado a como se compra) y, si se puede, en unidades ("3 cebollas"). */
  buy: number;
  buyUnits: number | null;
  /** Lo que sobra después de comprar y cocinar todo. */
  leftover: number;
  /** Primer día que se usa. */
  firstUse: string;
  unitPrice: number | null;
  cost: number | null;
  /** Se echa a perder antes de usarlo si lo comprás hoy: conviene comprarlo más cerca. */
  buyLater: string | null;
}

export interface MenuMeal {
  meal: Meal;
  recipe: Recipe | undefined;
  /** Lo que sale esta comida (null si falta el precio de algún ingrediente). */
  cost: number | null;
  perServing: number | null;
}

export interface WeekMenu {
  from: string;
  to: string;
  meals: MenuMeal[];
  needs: MenuNeed[];
  /** Lo que hay que comprar (lo que falta), con su costo estimado. */
  shopping: MenuNeed[];
  buyCost: number;
  /** Lo que sale la semana (todas las comidas, con lo que ya tenés incluido). */
  weekCost: number;
  perMeal: number | null;
  withoutPrice: number;
  /** Recetas que usan lo que vence pronto y no están en el menú. */
  useSoon: { recipe: Recipe; items: string[] }[];
}

const priceOf = (s: StockStatus | undefined) => s?.prices.average ?? s?.prices.last ?? null;

export function weekMenu(
  data: { meals: Meal[]; recipes: Recipe[]; stockItems: StockItem[] },
  statuses: StockStatus[],
  from: string,
  to: string,
  today: string,
): WeekMenu {
  const recipes = new Map(data.recipes.map((r) => [r.id, r]));
  const items = new Map(data.stockItems.map((i) => [i.id, i]));
  const byItem = new Map(statuses.map((s) => [s.item.id, s]));
  const meals = data.meals
    .filter((m) => m.date >= from && m.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
  const need = new Map<string, { qty: number; first: string; uses: { date: string; qty: number }[] }>();
  const menuMeals: MenuMeal[] = meals.map((meal) => {
    const recipe = recipes.get(meal.recipeId);
    if (!recipe) return { meal, recipe, cost: null, perServing: null };
    const factor = meal.servings / recipe.servings;
    let cost = 0;
    let unknown = false;
    for (const ing of recipe.ingredients) {
      const item = items.get(ing.itemId);
      const qty = ingredientInItemUnit(ing, item) * factor;
      const price = priceOf(byItem.get(ing.itemId));
      if (price === null) unknown = true;
      else cost += price * qty;
      // Lo ya cocinado salió del stock: no se vuelve a pedir.
      if (!meal.cooked && meal.date >= today) {
        const prev = need.get(ing.itemId);
        need.set(ing.itemId, {
          qty: (prev?.qty ?? 0) + qty,
          first: prev && prev.first < meal.date ? prev.first : meal.date,
          uses: [...(prev?.uses ?? []), { date: meal.date, qty }],
        });
      }
    }
    const total = unknown ? null : round2(cost);
    return { meal, recipe, cost: total, perServing: total !== null ? round2(total / meal.servings) : null };
  });

  const needs: MenuNeed[] = [];
  for (const [itemId, n] of need) {
    const item = items.get(itemId);
    if (!item) continue;
    const status = byItem.get(itemId);
    const have = status?.quantity ?? 0;
    // Los básicos (sal, aceite) se dan por hechos mientras haya algo.
    const missing = item.staple && have > 0 ? 0 : Math.max(0, round2(n.qty - have));
    let buy = 0;
    let buyUnits: number | null = null;
    if (missing > 0) {
      if (item.unitWeight && (item.unit === 'kg' || item.unit === 'g') && !item.packSize) {
        buyUnits = Math.ceil(convertQty(missing, item.unit, 'u', item.unitWeight)! - 1e-9);
        buy = round2(convertQty(buyUnits, 'u', item.unit, item.unitWeight)!);
      } else {
        buy = roundToBuy(missing, item);
        if (item.unit === 'u' || item.unit === 'paq') buyUnits = buy;
      }
    }
    const unitPrice = priceOf(status);
    // El día en que lo que hay deja de alcanzar: hasta ahí no hace falta comprarlo.
    let acc = 0;
    let needDate = n.first;
    for (const u of [...n.uses].sort((a, b) => a.date.localeCompare(b.date))) {
      acc += u.qty;
      if (acc > have + 1e-9) {
        needDate = u.date;
        break;
      }
    }
    const daysUntil = daysBetween(today, needDate);
    needs.push({
      item,
      status,
      need: round2(n.qty),
      have,
      missing,
      buy,
      buyUnits,
      leftover: round2(Math.max(0, have + buy - n.qty)),
      firstUse: n.first,
      unitPrice,
      cost: unitPrice !== null && buy > 0 ? round2(unitPrice * buy) : null,
      buyLater:
        missing > 0 && item.shelfDays && daysUntil > item.shelfDays ? addDays(needDate, -Math.min(2, item.shelfDays)) : null,
    });
  }
  needs.sort((a, b) => a.firstUse.localeCompare(b.firstUse) || a.item.name.localeCompare(b.item.name, 'es'));
  const shopping = needs.filter((n) => n.buy > 0);
  const weekCost = round2(menuMeals.reduce((s, m) => s + (m.cost ?? 0), 0));
  const priced = menuMeals.filter((m) => m.cost !== null);

  // Lo que vence en los próximos 5 días y qué receta lo usa.
  const soon = new Set(
    statuses.filter((s) => s.nextExpiry && daysBetween(today, s.nextExpiry) <= 5 && s.quantity > 0).map((s) => s.item.id),
  );
  const planned = new Set(meals.map((m) => m.recipeId));
  const useSoon = data.recipes
    .filter((r) => !r.archived && !planned.has(r.id))
    .map((r) => ({
      recipe: r,
      items: r.ingredients.filter((i) => soon.has(i.itemId)).map((i) => items.get(i.itemId)?.name ?? ''),
    }))
    .filter((x) => x.items.length)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 4);

  return {
    from,
    to,
    meals: menuMeals,
    needs,
    shopping,
    buyCost: round2(shopping.reduce((s, n) => s + (n.cost ?? 0), 0)),
    weekCost,
    perMeal: priced.length ? round2(weekCost / priced.length) : null,
    withoutPrice: shopping.filter((n) => n.cost === null).length,
    useSoon,
  };
}

/** Los ingredientes de una comida en la unidad de cada producto (para descontar del stock al cocinar). */
export function mealUses(recipe: Recipe, items: StockItem[], servings: number): { itemId: string; quantity: number }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const factor = servings / recipe.servings;
  return recipe.ingredients.map((ing) => ({
    itemId: ing.itemId,
    quantity: round2(ingredientInItemUnit(ing, byId.get(ing.itemId)) * factor),
  }));
}
