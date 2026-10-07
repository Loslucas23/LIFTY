import { mealUses, newId, UNIT_LABEL, type LiftyData, type Meal, type MenuNeed, type Mutation } from '@lifty/core';
import { toast } from '../components/ui';
import { mutateMany } from './sync';

/** Cociné: descuenta los ingredientes del stock (en la unidad de cada producto) y marca la comida. */
export function cookMeal(data: LiftyData, meal: Meal, today: string) {
  const recipe = data.recipes.find((r) => r.id === meal.recipeId);
  if (!recipe) return;
  const now = new Date().toISOString();
  const moves = mealUses(recipe, data.stockItems, meal.servings)
    .filter((u) => u.quantity > 0)
    .map((u) => ({
      id: newId(),
      updatedAt: now,
      itemId: u.itemId,
      date: meal.date <= today ? meal.date : today,
      kind: 'use' as const,
      quantity: u.quantity,
      price: null,
      store: '',
      expiry: null,
      txId: null,
    }));
  mutateMany([
    ...moves.map((m): Mutation => ({ entity: 'stockMove', op: 'upsert', id: m.id, updatedAt: now, record: m })),
    { entity: 'meal', op: 'upsert', id: meal.id, updatedAt: now, record: { ...meal, cooked: true, updatedAt: now } },
  ]);
  toast(`${recipe.name}: ingredientes descontados del stock`, {
    action: {
      label: 'Deshacer',
      run: () => {
        const at = new Date().toISOString();
        mutateMany([
          ...moves.map((m): Mutation => ({ entity: 'stockMove', op: 'delete', id: m.id, updatedAt: at })),
          { entity: 'meal', op: 'upsert', id: meal.id, updatedAt: at, record: { ...meal, cooked: false, updatedAt: at } },
        ]);
      },
    },
  });
}

/** Lo que falta para el menú, a la lista de compras (si ya está, se sube la cantidad). */
export function addMenuToList(data: LiftyData, shopping: MenuNeed[]) {
  const now = new Date().toISOString();
  const muts: Mutation[] = [];
  for (const n of shopping) {
    const existing = data.shopEntries.find((e) => e.itemId === n.item.id && !e.checked);
    if (existing) {
      if ((existing.quantity ?? 0) >= n.buy) continue;
      muts.push({
        entity: 'shopEntry',
        op: 'upsert',
        id: existing.id,
        updatedAt: now,
        record: { ...existing, quantity: n.buy, updatedAt: now },
      });
    } else {
      const id = newId();
      muts.push({
        entity: 'shopEntry',
        op: 'upsert',
        id,
        updatedAt: now,
        record: {
          id,
          updatedAt: now,
          itemId: n.item.id,
          name: n.item.name,
          quantity: n.buy,
          unit: UNIT_LABEL[n.item.unit],
          checked: false,
        },
      });
    }
  }
  if (!muts.length) return toast('Ya estaba todo en la lista');
  mutateMany(muts);
  toast(`${muts.length} producto${muts.length === 1 ? '' : 's'} a la lista de compras`);
}
