import { describe, expect, it } from 'vitest';
import {
  applyMutation,
  categoryFamily,
  categoryPath,
  categoryRootFn,
  categorySchema,
  challengeSchema,
  challengeStatus,
  computeMonths,
  defaultSettings,
  seedRecords,
  sortedCategories,
  suggestSubcategory,
  toLiftyData,
  transactionSchema,
  type LiftyData,
  type RecordStore,
} from '../src';

function data(partial: Partial<LiftyData>): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  const base = toLiftyData(store);
  return {
    ...base,
    ...partial,
    categories: [...base.categories, ...(partial.categories ?? [])],
    settings: { ...defaultSettings(), startMonth: '2026-10' },
  };
}
const sub = (id: string, name: string, parentId: string, sort = 50) =>
  categorySchema.parse({ id, name, parentId, kind: 'expense', color: '#f97316', icon: '🛵', sort });
const spend = (id: string, date: string, amount: number, categoryId: string) =>
  transactionSchema.parse({ id, date, kind: 'expense', amount, categoryId });

describe('subcategorías', () => {
  const delivery = sub('cat-delivery', 'Delivery', 'cat-comida');
  const cafes = sub('cat-cafes', 'Cafés', 'cat-comida', 51);

  it('lo de una subcategoría suma a la de arriba (y a su presupuesto), con el detalle', () => {
    const d = data({
      categories: [delivery, cafes],
      transactions: [
        spend('a', '2026-10-02', 800, 'cat-delivery'),
        spend('b', '2026-10-03', 200, 'cat-cafes'),
        spend('c', '2026-10-04', 500, 'cat-comida'),
      ],
    });
    d.categories = d.categories.map((c) => (c.id === 'cat-comida' ? { ...c, monthlyLimit: 2000 } : c));
    const [b] = computeMonths(d, '2026-10', '2026-10', '2026-10-05');
    const comida = b.categories.find((c) => c.categoryId === 'cat-comida')!;
    expect(comida).toMatchObject({ spent: 1500, limit: 2000, remaining: 500 });
    expect(comida.subs).toEqual([
      { categoryId: 'cat-delivery', spent: 800 },
      { categoryId: 'cat-cafes', spent: 200 },
    ]);
    // La subcategoría no aparece sola.
    expect(b.categories.some((c) => c.categoryId === 'cat-delivery')).toBe(false);
  });

  it('familia, ruta, orden y una de arriba que ya no existe', () => {
    const cats = [...data({}).categories, delivery, cafes, sub('huerfana', 'Huérfana', 'borrada')];
    expect([...categoryFamily(cats, 'cat-comida')].sort()).toEqual(['cat-cafes', 'cat-comida', 'cat-delivery']);
    expect(categoryPath(cats, 'cat-delivery')).toBe('Comida afuera › Delivery');
    const root = categoryRootFn(cats);
    expect(root('cat-delivery')).toBe('cat-comida');
    expect(root('huerfana')).toBe('huerfana');
    const order = sortedCategories(cats.filter((c) => c.kind === 'expense')).map((c) => c.id);
    expect(order.indexOf('cat-delivery')).toBe(order.indexOf('cat-comida') + 1);
    expect(order.indexOf('cat-cafes')).toBe(order.indexOf('cat-comida') + 2);
    expect(order).toContain('huerfana');
  });

  it('sugiere la subcategoría que nombra la descripción', () => {
    const cats = [delivery, cafes, sub('cat-uber', 'Uber y taxi', 'cat-transporte')];
    expect(suggestSubcategory(cats, 'cat-comida', 'Delivery de sushi')).toBe('cat-delivery');
    expect(suggestSubcategory(cats, 'cat-comida', 'cafe con medialunas')).toBe('cat-cafes');
    expect(suggestSubcategory(cats, 'cat-transporte', 'uber al centro')).toBe('cat-uber');
    expect(suggestSubcategory(cats, 'cat-comida', 'pizza')).toBeNull();
  });

  it('un desafío sobre una categoría cuenta sus subcategorías', () => {
    const d = data({ categories: [delivery], transactions: [spend('a', '2026-10-02', 800, 'cat-delivery')] });
    const c = challengeSchema.parse({
      id: 'x',
      name: '7 días sin comida afuera',
      kind: 'no-spend-category',
      categoryId: 'cat-comida',
      target: 7,
      from: '2026-10-01',
      to: '2026-10-07',
    });
    expect(challengeStatus(c, d, '2026-10-04').status).toBe('lost');
  });
});
