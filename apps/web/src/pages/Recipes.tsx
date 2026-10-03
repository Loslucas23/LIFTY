import { useMemo, useState } from 'react';
import {
  fmtQty,
  newId,
  recipeSchema,
  recipeStatus,
  stockOverview,
  UNIT_LABEL,
  type Recipe,
  type RecipeStatus,
} from '@lifty/core';
import { openExplain, openMenu } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Empty, Field, PageHeader, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { addStockMove } from '../lib/stock';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

/** Recetas: qué podés cocinar con lo que tenés, cuánto sale y "Cociné" descuenta del stock. */
export function Recipes() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const statuses = useMemo(
    () => stockOverview(data.stockItems, data.stockMoves, today, data.settings).statuses,
    [data.stockItems, data.stockMoves, today, data.settings],
  );
  const list = data.recipes
    .filter((r) => !r.archived)
    .map((r) => recipeStatus(r, statuses))
    .sort((a, b) => Number(b.canCook) - Number(a.canCook) || a.recipe.name.localeCompare(b.recipe.name, 'es'));
  const ready = list.filter((r) => r.canCook);
  const itemName = (id: string) => data.stockItems.find((i) => i.id === id);

  const cook = (s: RecipeStatus) => {
    const moves = s.recipe.ingredients.map((ing) => addStockMove(ing.itemId, 'use', ing.quantity, today));
    toast(`${s.recipe.name}: ingredientes descontados del stock`, {
      action: { label: 'Deshacer', run: () => moves.forEach((m) => mutate('stockMove', 'delete', m.id)) },
    });
  };
  const toList = (s: RecipeStatus) => {
    const existing = new Set(data.shopEntries.map((e) => e.itemId));
    let n = 0;
    for (const m of s.missing) {
      const item = itemName(m.itemId);
      if (!item || existing.has(item.id)) continue;
      n++;
      mutate('shopEntry', 'upsert', {
        id: newId(),
        updatedAt: '',
        itemId: item.id,
        name: item.name,
        quantity: m.need,
        unit: UNIT_LABEL[item.unit],
        checked: false,
      });
    }
    toast(n ? `${n} ingrediente${n === 1 ? '' : 's'} a la lista de compras` : 'Ya estaban en la lista');
  };

  return (
    <div className="page">
      <PageHeader
        title="Recetas"
        subtitle={ready.length ? `Con lo que tenés podés hacer ${ready.length}` : 'Qué podés cocinar con lo que tenés'}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!data.stockItems.length}>
            <Icon name="plus" /> Receta
          </button>
        }
      />
      {!data.stockItems.length ? (
        <Empty icon="box" title="Primero cargá tu stock">
          Las recetas usan los productos del stock: así Lifty sabe si te alcanza y cuánto sale cada plato.
          <a className="btn" href="#/stock">
            Ir al stock
          </a>
        </Empty>
      ) : list.length === 0 ? (
        <Empty icon="food" title="Todavía no hay recetas">
          Agregá tus comidas de siempre con sus ingredientes del stock.
        </Empty>
      ) : (
        <div className="goal-grid">
          {list.map((s) => (
            <article key={s.recipe.id} className="card goal recipe">
              <div className="goal-head">
                <span className="goal-icon">{s.recipe.icon}</span>
                <div>
                  <strong>{s.recipe.name}</strong>
                  <span className="muted small"> · {s.recipe.servings} porciones</span>
                </div>
                <button className="link small" onClick={() => setEditing(s.recipe)}>
                  Editar
                </button>
              </div>
              <div className="goal-plan">
                <span className={`tag ${s.canCook ? 'tag-good' : 'tag-bad'}`}>
                  {s.canCook ? (s.times > 1 ? `Te alcanza para ${s.times} veces` : 'Te alcanza') : `Faltan ${s.missing.length}`}
                </span>
                {s.cost !== null && (
                  <button
                    className="link small"
                    onClick={() =>
                      openExplain({
                        title: `${s.recipe.name}: cuánto sale`,
                        intro: 'Cada ingrediente con su precio promedio por unidad (de tus compras).',
                        rows: s.recipe.ingredients.map((ing) => {
                          const st = statuses.find((x) => x.item.id === ing.itemId);
                          const price = st?.prices.average ?? st?.prices.last ?? 0;
                          return {
                            label: `${st?.item.name ?? '?'} · ${fmtQty(ing.quantity, st?.item.unit ?? 'u')}`,
                            value: Math.round(price * ing.quantity * 100) / 100,
                            op: '+' as const,
                          };
                        }),
                        result: { label: 'Total', value: s.cost! },
                        footnote: `Por porción: ${money(s.perServing!)}.`,
                      })
                    }
                  >
                    {money(Math.round(s.cost))} · {money(Math.round(s.perServing!))} por porción
                  </button>
                )}
                {s.withoutPrice > 0 && <span className="muted small">({s.withoutPrice} sin precio)</span>}
              </div>
              <p className="muted small">
                {s.recipe.ingredients
                  .map((ing) => {
                    const it = itemName(ing.itemId);
                    const miss = s.missing.find((m) => m.itemId === ing.itemId);
                    return `${miss ? '✗ ' : ''}${it?.name ?? 'producto borrado'} ${it ? fmtQty(ing.quantity, it.unit) : ''}`;
                  })
                  .join(' · ')}
              </p>
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  disabled={!s.canCook}
                  onClick={() =>
                    openMenu(`¿Cocinaste ${s.recipe.name}?`, [
                      { label: 'Sí: descontar los ingredientes del stock', run: () => cook(s) },
                    ])
                  }
                >
                  Cociné
                </button>
                {s.missing.length > 0 && (
                  <button className="btn" onClick={() => toList(s)}>
                    Faltantes a la lista
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && <RecipeForm recipe={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RecipeForm({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const data = useData();
  const items = data.stockItems.filter((i) => !i.archived);
  const [name, setName] = useState(recipe?.name ?? '');
  const [icon, setIcon] = useState(recipe?.icon ?? '🍲');
  const [servings, setServings] = useState(String(recipe?.servings ?? 2));
  const [rows, setRows] = useState(
    (recipe?.ingredients.length ? recipe.ingredients : [{ itemId: '', quantity: 1 }]).map((i) => ({
      key: newId(),
      itemId: i.itemId,
      qty: String(i.quantity).replace('.', ','),
    })),
  );
  const [note, setNote] = useState(recipe?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const ingredients = rows
      .filter((r) => r.itemId)
      .map((r) => ({ itemId: r.itemId, quantity: parseAmount(r.qty) ?? 0 }))
      .filter((i) => i.quantity > 0);
    const r = recipeSchema.safeParse({
      ...(recipe ?? {}),
      id: recipe?.id ?? newId(),
      updatedAt: '',
      name,
      icon: icon || '🍲',
      servings: Math.max(1, Math.round(Number(servings) || 1)),
      ingredients,
      note,
    });
    if (!r.success || !ingredients.length) return setError('Poné el nombre y al menos un ingrediente con cantidad.');
    mutate('recipe', 'upsert', r.data);
    toast('Receta guardada');
    onClose();
  };
  return (
    <Sheet
      title={recipe ? 'Editar receta' : 'Nueva receta'}
      onClose={onClose}
      footer={
        <>
          {recipe && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('recipe', 'delete', recipe.id);
                toast('Receta borrada', { action: { label: 'Deshacer', run: () => mutate('recipe', 'upsert', recipe) } });
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Fideos con tuco"
              maxLength={60}
            />
          </Field>
        </div>
        <Field label="Porciones">
          <input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <strong className="small">Ingredientes (del stock)</strong>
        {rows.map((r) => {
          const it = items.find((i) => i.id === r.itemId);
          return (
            <div key={r.key} className="purchase-line">
              <select
                value={r.itemId}
                onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, itemId: e.target.value } : x)))}
                aria-label="Ingrediente"
              >
                <option value="">Elegí…</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.icon} {i.name}
                  </option>
                ))}
              </select>
              <label className="shop-qty">
                <input
                  inputMode="decimal"
                  value={r.qty}
                  onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))}
                  aria-label="Cantidad"
                />
                <span>{it ? UNIT_LABEL[it.unit] : ''}</span>
              </label>
              <span />
              <button className="icon-btn" aria-label="Sacar" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                <Icon name="x" size={16} />
              </button>
            </div>
          );
        })}
        <button className="btn btn-ghost" onClick={() => setRows([...rows, { key: newId(), itemId: '', qty: '1' }])}>
          <Icon name="plus" /> Otro ingrediente
        </button>
        <Field label="Cómo se hace (opcional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}
