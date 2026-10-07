import { useState } from 'react';
import {
  addDays,
  fmtQty,
  formatNumber,
  mealSchema,
  newId,
  recipeStatus,
  stockOverview,
  weekMenu,
  weekStart,
  type Meal,
  type MealSlot,
  type MenuNeed,
} from '@lifty/core';
import { openMenu } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Empty, PageHeader, Section, Sheet, toast } from '../components/ui';
import { money } from '../lib/format';
import { addMenuToList, cookMeal } from '../lib/menu';
import { cached, useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ddmm = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
const dayName = (d: string) => DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** "3 u. (≈0,45 kg)" o "500 g" */
function buyText(n: MenuNeed) {
  if (n.buyUnits !== null && n.item.unit !== 'u' && n.item.unit !== 'paq')
    return `${n.buyUnits} u. (≈${fmtQty(n.buy, n.item.unit)})`;
  return fmtQty(n.buy, n.item.unit);
}

/** Menú de la semana: elegís qué comer y se arma la lista con lo que falta, y cuánto sale. */
export function Menu() {
  const data = useData();
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const [picking, setPicking] = useState<{ date: string; slot: MealSlot } | null>(null);
  const from = addDays(weekStart(today), offset * 7);
  const to = addDays(from, 6);
  const statuses = cached(data, `stock:${today}`, () =>
    stockOverview(data.stockItems, data.stockMoves, today, data.settings),
  ).statuses;
  const w = weekMenu(data, statuses, from, to, today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  const mealActions = (meal: Meal) => {
    const recipe = data.recipes.find((r) => r.id === meal.recipeId);
    openMenu(recipe?.name ?? 'Comida', [
      ...(!meal.cooked ? [{ label: 'Cociné: descontar del stock', run: () => cookMeal(data, meal, today) }] : []),
      {
        label: 'Cambiar para cuántos',
        run: () => {
          const next = meal.servings >= 8 ? 1 : meal.servings + 1;
          mutate('meal', 'upsert', { ...meal, servings: next });
          toast(`${recipe?.name}: para ${next}`);
        },
      },
      {
        label: 'Sacar del menú',
        tone: 'danger',
        run: () => {
          mutate('meal', 'delete', meal.id);
          toast('Sacada del menú', { action: { label: 'Deshacer', run: () => mutate('meal', 'upsert', meal) } });
        },
      },
    ]);
  };

  return (
    <div className="page narrow">
      <PageHeader
        title="Menú de la semana"
        subtitle={`Del ${ddmm(from)} al ${ddmm(to)}`}
        actions={
          <>
            <button className="btn" aria-label="Semana anterior" onClick={() => setOffset(offset - 1)}>
              <Icon name="left" />
            </button>
            {offset !== 0 && (
              <button className="btn" onClick={() => setOffset(0)}>
                Esta semana
              </button>
            )}
            <button className="btn" aria-label="Semana siguiente" onClick={() => setOffset(offset + 1)}>
              <Icon name="right" />
            </button>
          </>
        }
      />

      {!data.recipes.some((r) => !r.archived) ? (
        <Empty icon="food" title="Primero cargá tus recetas">
          El menú usa tus recetas (con sus ingredientes del stock) para saber qué falta comprar y cuánto sale.
          <a className="btn" href="#/recetas">
            Ir a recetas
          </a>
        </Empty>
      ) : (
        <>
          <div className="card pad menu-summary">
            {w.meals.length ? (
              <>
                <p>
                  La semana sale <strong>{money(Math.round(w.weekCost))}</strong>
                  {w.perMeal !== null ? ` (${money(Math.round(w.perMeal))} por comida)` : ''}.
                </p>
                {w.shopping.length ? (
                  <>
                    <p className="small">
                      Te falta comprar <strong>{w.shopping.length}</strong> cosa{w.shopping.length === 1 ? '' : 's'}
                      {w.buyCost > 0
                        ? ` (unos ${money(Math.round(w.buyCost))}${w.withoutPrice ? ', sin contar las que no tienen precio' : ''})`
                        : ''}
                      .
                    </p>
                    <button className="btn btn-primary" onClick={() => addMenuToList(data, w.shopping)}>
                      <Icon name="cart" /> Agregar a la lista del súper
                    </button>
                  </>
                ) : (
                  <p className="small">Con lo que tenés en casa te alcanza para todo el menú. 🎉</p>
                )}
              </>
            ) : (
              <p className="muted">Elegí qué vas a comer cada día: Lifty suma los ingredientes y te dice qué comprar.</p>
            )}
          </div>

          <div className="menu-days">
            {days.map((d) => (
              <section key={d} className={`card menu-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
                <header>
                  <strong>{d === today ? 'Hoy' : dayName(d)}</strong>
                  <span className="muted small">{ddmm(d)}</span>
                </header>
                {(['almuerzo', 'cena'] as const).map((slot) => {
                  const meals = w.meals.filter((m) => m.meal.date === d && m.meal.slot === slot);
                  return (
                    <div key={slot} className="menu-slot">
                      <span className="muted small menu-slot-name">{slot === 'almuerzo' ? 'Almuerzo' : 'Cena'}</span>
                      {meals.map((m) => (
                        <button
                          key={m.meal.id}
                          className={`menu-meal ${m.meal.cooked ? 'cooked' : ''}`}
                          onClick={() => mealActions(m.meal)}
                        >
                          <span>
                            {m.recipe?.icon ?? '🍽️'} {m.recipe?.name ?? 'Receta borrada'}
                            {m.meal.cooked ? ' ✓' : ''}
                          </span>
                          <span className="muted small">
                            para {m.meal.servings}
                            {m.cost !== null ? ` · ${money(Math.round(m.cost))}` : ''}
                          </span>
                        </button>
                      ))}
                      {!meals.length && (
                        <button className="link small" onClick={() => setPicking({ date: d, slot })}>
                          + Elegir
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>

          {w.shopping.length > 0 && (
            <Section title="Para comprar">
              <div className="card list">
                {w.shopping.map((n) => (
                  <div key={n.item.id} className="tx-row wrap-text">
                    <span className="tx-icon">{n.item.icon}</span>
                    <span className="tx-main">
                      <span className="tx-title">
                        {n.item.name}: {buyText(n)}
                      </span>
                      <span className="tx-meta">
                        Necesitás {fmtQty(n.need, n.item.unit)} y tenés {fmtQty(n.have, n.item.unit)}
                        {n.buyLater ? ` · dura ${n.item.shelfDays} días: compralo cerca del ${ddmm(n.buyLater)}` : ''}
                      </span>
                    </span>
                    <span className="tx-amount">{n.cost !== null ? money(Math.round(n.cost)) : '—'}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {w.needs.some((n) => n.buy > 0 && n.leftover > n.buy * 0.2) && (
            <Section title="Te va a sobrar">
              <p className="muted small">
                {w.needs
                  .filter((n) => n.buy > 0 && n.leftover > n.buy * 0.2)
                  .map((n) => `${n.item.name} (${fmtQty(n.leftover, n.item.unit)})`)
                  .join(', ')}
                : sumá una receta que lo use para no tirarlo.
              </p>
            </Section>
          )}

          {w.useSoon.length > 0 && (
            <Section title="Usá lo que vence">
              <div className="card list">
                {w.useSoon.map((u) => (
                  <div key={u.recipe.id} className="tx-row wrap-text">
                    <span className="tx-icon">{u.recipe.icon}</span>
                    <span className="tx-main">
                      <span className="tx-title">{u.recipe.name}</span>
                      <span className="tx-meta">Usa {u.items.join(', ')} (vence en estos días)</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {picking && <RecipePicker date={picking.date} slot={picking.slot} onClose={() => setPicking(null)} />}
    </div>
  );
}

function RecipePicker({ date, slot, onClose }: { date: string; slot: MealSlot; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const statuses = cached(data, `stock:${today}`, () =>
    stockOverview(data.stockItems, data.stockMoves, today, data.settings),
  ).statuses;
  const soon = new Set(statuses.filter((s) => s.nextExpiry && s.nextExpiry <= addDays(today, 5)).map((s) => s.item.id));
  const list = data.recipes
    .filter((r) => !r.archived)
    .map((r) => ({ s: recipeStatus(r, statuses), expiring: r.ingredients.filter((i) => soon.has(i.itemId)).length }))
    .sort(
      (a, b) =>
        b.expiring - a.expiring ||
        Number(b.s.canCook) - Number(a.s.canCook) ||
        a.s.recipe.name.localeCompare(b.s.recipe.name, 'es'),
    );
  const [servings, setServings] = useState(2);
  const pick = (recipeId: string) => {
    const meal = mealSchema.parse({ id: newId(), updatedAt: '', date, slot, recipeId, servings });
    mutate('meal', 'upsert', meal);
    onClose();
  };
  return (
    <Sheet title={`${dayName(date)} ${ddmm(date)} · ${slot}`} onClose={onClose}>
      <div className="form">
        <div className="stepper menu-servings">
          <span>Para</span>
          <button type="button" onClick={() => setServings(Math.max(1, servings - 1))} aria-label="Menos">
            −
          </button>
          <input
            inputMode="numeric"
            value={servings}
            onChange={(e) => setServings(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
            aria-label="Porciones"
          />
          <button type="button" onClick={() => setServings(Math.min(20, servings + 1))} aria-label="Más">
            +
          </button>
        </div>
        <div className="card list">
          {list.map(({ s, expiring }) => (
            <button key={s.recipe.id} className="tx-row wrap-text" onClick={() => pick(s.recipe.id)}>
              <span className="tx-icon">{s.recipe.icon}</span>
              <span className="tx-main">
                <span className="tx-title">{s.recipe.name}</span>
                <span className="tx-meta">
                  {s.canCook ? 'Tenés todo' : `Faltan ${s.missing.length}`}
                  {expiring ? ` · usa ${expiring} que vence${expiring === 1 ? '' : 'n'}` : ''}
                  {s.perServing !== null ? ` · ${money(Math.round(s.perServing))} la porción` : ''}
                </span>
              </span>
              {s.perServing !== null && <span className="tx-amount small">{money(Math.round(s.perServing * servings))}</span>}
            </button>
          ))}
        </div>
        <p className="muted small">
          Arriba: las que usan lo que vence pronto y las que podés hacer con lo que hay. {formatNumber(list.length, 0)} recetas.
        </p>
      </div>
    </Sheet>
  );
}
