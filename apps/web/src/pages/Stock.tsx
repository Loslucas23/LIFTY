import { useMemo, useState } from 'react';
import {
  AISLE_LABEL,
  aisleOf,
  daysBetween,
  fmtQty,
  groupByAisle,
  listByStore,
  matchStockItem,
  parseShopText,
  priceAlerts,
  routineItems,
  type RoutineItem,
  foodCardMonth,
  monthOf,
  newId,
  round2,
  STOCK_PLACES,
  STOCK_UNITS,
  stockItemSchema,
  stockOverview,
  storePrices,
  UNIT_LABEL,
  type StockItem,
  type ShopEntry,
  type StockMove,
  type StockPlace,
  type StockStatus,
  type StockUnit,
  catalogFor,
  benefitsOn,
} from '@lifty/core';
import { openExplain, openMenu, openPrompt } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Segmented, Sheet, Toggle, toast } from '../components/ui';
import { dayLabel, money, parseAmount } from '../lib/format';
import { local } from '../lib/local';
import { addStockMove, addToShoppingList, recordPurchase, type PurchaseLine } from '../lib/stock';
import { useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

export const PLACE_LABEL: Record<StockPlace, string> = {
  despensa: '🥫 Despensa',
  heladera: '🧊 Heladera',
  freezer: '❄️ Freezer',
  limpieza: '🧽 Limpieza',
  higiene: '🧼 Higiene',
  otros: '📦 Otros',
};

/** Productos comunes para arrancar rápido. */
const PRESETS: { name: string; icon: string; place: StockPlace; unit: StockUnit; packSize: number | null }[] = [
  { name: 'Arroz', icon: '🍚', place: 'despensa', unit: 'kg', packSize: 1 },
  { name: 'Fideos', icon: '🍝', place: 'despensa', unit: 'paq', packSize: null },
  { name: 'Yerba', icon: '🧉', place: 'despensa', unit: 'kg', packSize: 1 },
  { name: 'Azúcar', icon: '🍬', place: 'despensa', unit: 'kg', packSize: 1 },
  { name: 'Aceite', icon: '🫒', place: 'despensa', unit: 'l', packSize: 1 },
  { name: 'Café', icon: '☕', place: 'despensa', unit: 'paq', packSize: null },
  { name: 'Leche', icon: '🥛', place: 'heladera', unit: 'l', packSize: 1 },
  { name: 'Huevos', icon: '🥚', place: 'heladera', unit: 'u', packSize: 12 },
  { name: 'Queso', icon: '🧀', place: 'heladera', unit: 'kg', packSize: null },
  { name: 'Carne picada', icon: '🥩', place: 'freezer', unit: 'kg', packSize: null },
  { name: 'Papel higiénico', icon: '🧻', place: 'higiene', unit: 'u', packSize: 4 },
  { name: 'Pasta de dientes', icon: '🪥', place: 'higiene', unit: 'u', packSize: null },
  { name: 'Detergente', icon: '🧴', place: 'limpieza', unit: 'u', packSize: null },
  { name: 'Jabón en polvo', icon: '🫧', place: 'limpieza', unit: 'kg', packSize: null },
];

type Tab = 'tengo' | 'lista' | 'vence' | 'precios';

function useOverview() {
  const data = useData();
  const today = useToday();
  return useMemo(
    () => stockOverview(data.stockItems, data.stockMoves, today, data.settings),
    [data.stockItems, data.stockMoves, today, data.settings],
  );
}

const isWhole = (u: StockUnit) => u === 'u' || u === 'paq';

export function Stock({ initialTab }: { initialTab?: Tab } = {}) {
  const data = useData();
  const today = useToday();
  const o = useOverview();
  const [tab, setTabState] = useState<Tab>(() => initialTab ?? ((local.get('lifty-stock-tab') as Tab) || 'tengo'));
  const setTab = (t: Tab) => {
    setTabState(t);
    local.set('lifty-stock-tab', t === 'tengo' ? null : t);
  };
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const [buying, setBuying] = useState<PurchaseLine[] | null>(null);
  const [query, setQuery] = useState('');
  const viewed = o.statuses.find((s) => s.item.id === viewing) ?? null;
  const b = useMonth(monthOf(today));
  const superLimit = (() => {
    const line = b.categories.find((c) => c.categoryId === 'cat-super' && c.limit !== null);
    const cat = data.categories.find((c) => c.id === 'cat-super');
    return line && cat ? { name: cat.name, limit: line.limit! } : null;
  })();
  const archived = data.stockItems.filter((i) => i.archived);
  const expiringSoon = o.expiring.filter((e) => e.daysLeft <= 3).length;

  const changeShoppingDays = () =>
    openPrompt({
      title: '¿Cada cuántos días hacés las compras?',
      label: 'Días',
      initial: String(data.settings.shoppingDays),
      hint: 'Con esto Lifty decide qué tenés que comprar ahora para que no te falte hasta la próxima compra.',
      onSubmit: (v) => {
        const days = Math.round(v);
        if (days < 1 || days > 60) return 'Entre 1 y 60 días';
        mutate('settings', 'upsert', { ...data.settings, shoppingDays: days });
        toast(`Compras cada ${days} días`);
      },
    });

  return (
    <div className="page">
      <PageHeader
        title="Stock de la casa"
        subtitle={
          <button className="link" onClick={changeShoppingDays}>
            Hacés las compras cada {data.settings.shoppingDays} días · cambiar
          </button>
        }
        actions={
          <>
            <button className="btn" onClick={() => setEditing('new')}>
              <Icon name="plus" /> Producto
            </button>
            <button className="btn btn-primary" onClick={() => setBuying([])}>
              <Icon name="cart" /> Registrar compra
            </button>
          </>
        }
      />

      {data.stockItems.length === 0 ? (
        <>
          {/* La lista sirve aunque no lleves el stock. */}
          <ShoppingList onBuy={(lines) => setBuying(lines)} onOpen={setViewing} />
          <StockEmpty onNew={() => setEditing('new')} />
        </>
      ) : (
        <>
          <div className="stat-row">
            <button className="card stat" onClick={() => setTab('lista')}>
              <span>Para comprar</span>
              <strong>
                {o.shopping.length}
                {o.shoppingCost > 0 && <small className="muted"> · ~{money(Math.round(o.shoppingCost))}</small>}
              </strong>
            </button>
            <button className="card stat" onClick={() => setTab('vence')}>
              <span>Vencen pronto</span>
              <strong className={expiringSoon ? 'text-expense' : ''}>{o.expiring.length}</strong>
            </button>
            <button
              className="card stat"
              onClick={() =>
                openExplain({
                  title: 'Lo que gastás por mes en stock',
                  intro:
                    'Lo que usás por día de cada producto × 30 × su precio promedio. Solo cuenta lo que tiene consumo y precio.',
                  rows: o.statuses
                    .filter((s) => s.monthlyCost)
                    .sort((a, b) => (b.monthlyCost ?? 0) - (a.monthlyCost ?? 0))
                    .map((s) => ({
                      label: `${s.item.icon} ${s.item.name}`,
                      value: s.monthlyCost!,
                      op: '+' as const,
                      note: `${fmtQty(s.usage!.perDay * 30, s.item.unit)} × ${money(s.prices.average!)}`,
                    })),
                  result: { label: 'Por mes', value: o.monthlyCost },
                  footnote: superLimit
                    ? `Tu presupuesto de ${superLimit.name} es ${money(superLimit.limit)} por mes${o.monthlyCost > superLimit.limit ? ': según tu consumo no te alcanza. Podés cambiarlo en Presupuesto.' : '.'} Si comprás con la tarjeta de alimentación, eso va aparte.`
                    : 'Podés usar este número como presupuesto del súper (en Presupuesto, tocá Supermercado).',
                })
              }
            >
              <span>Consumo por mes</span>
              <strong>{o.monthlyCost > 0 ? `~${money(Math.round(o.monthlyCost))}` : '—'}</strong>
            </button>
            <div className="card stat">
              <span>Tirado (30 días)</span>
              <strong className={o.wastedCost > 0 ? 'text-expense' : ''}>{money(Math.round(o.wastedCost))}</strong>
            </div>
          </div>

          <Segmented
            label="Vista"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'tengo', label: 'Lo que tengo' },
              {
                value: 'lista',
                label: `Comprar${data.shopEntries.filter((e) => !e.checked).length ? ` (${data.shopEntries.filter((e) => !e.checked).length})` : o.shopping.length ? ` (${o.shopping.length})` : ''}`,
              },
              { value: 'vence', label: 'Vence' },
              { value: 'precios', label: 'Precios' },
            ]}
          />

          {tab === 'tengo' && (
            <>
              <div className="search">
                <Icon name="search" size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar…"
                  aria-label="Buscar en el stock"
                />
              </div>
              {STOCK_PLACES.map((place) => {
                const list = o.statuses.filter(
                  (s) => s.item.place === place && s.item.name.toLowerCase().includes(query.trim().toLowerCase()),
                );
                if (!list.length) return null;
                return (
                  <Section key={place} title={PLACE_LABEL[place]}>
                    <div className="card list">
                      {list.map((s) => (
                        <StockRow key={s.item.id} s={s} onOpen={() => setViewing(s.item.id)} onBuy={() => setBuying([line(s)])} />
                      ))}
                    </div>
                  </Section>
                );
              })}
              {archived.length > 0 && (
                <p className="muted small">
                  {archived.length} producto{archived.length === 1 ? '' : 's'} archivado{archived.length === 1 ? '' : 's'}:{' '}
                  {archived.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && ', '}
                      <button className="link" onClick={() => setEditing(a)}>
                        {a.name}
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}

          {tab === 'lista' && <TodayBenefits />}
          {tab === 'lista' && <ShoppingList onBuy={(lines) => setBuying(lines)} onOpen={setViewing} />}

          {tab === 'precios' && <PricesView />}

          {tab === 'vence' && (
            <Section title="Lo que vence (se usa primero lo más viejo)">
              {o.statuses.every((s) => s.batches.length === 0) ? (
                <Empty icon="calendar" title="No hay vencimientos anotados">
                  Cuando registres una compra, poné la fecha de vencimiento y Lifty te avisa antes.
                </Empty>
              ) : (
                <div className="card list">
                  {o.statuses
                    .flatMap((s) => s.batches.map((b) => ({ s, b, days: daysBetween(today, b.expiry) })))
                    .sort((a, b) => a.days - b.days)
                    .map(({ s, b, days }) => (
                      <div key={`${s.item.id}-${b.date}-${b.expiry}`} className="tx-row static">
                        <span className="tx-icon">{s.item.icon}</span>
                        <button className="tx-main" onClick={() => setViewing(s.item.id)}>
                          <span className="tx-title">
                            {s.item.name} · {fmtQty(b.quantity, s.item.unit)}
                          </span>
                          <span className={`tx-meta ${days < 0 ? 'due-bad' : days <= 3 ? 'due-warn' : ''}`}>
                            {days < 0
                              ? `Venció hace ${-days} día${days === -1 ? '' : 's'}`
                              : days === 0
                                ? 'Vence hoy'
                                : `Vence en ${days} día${days === 1 ? '' : 's'} (${dayLabel(b.expiry, today, true).toLowerCase()})`}
                          </span>
                        </button>
                        <button
                          className="btn btn-ghost small"
                          onClick={() =>
                            addStockMove(
                              s.item.id,
                              'use',
                              b.quantity,
                              today,
                              {},
                              `Usaste ${fmtQty(b.quantity, s.item.unit)} de ${s.item.name}`,
                            )
                          }
                        >
                          Usé
                        </button>
                        <button
                          className="btn btn-ghost small"
                          onClick={() =>
                            addStockMove(
                              s.item.id,
                              'waste',
                              b.quantity,
                              today,
                              {},
                              `Tiraste ${fmtQty(b.quantity, s.item.unit)} de ${s.item.name}`,
                            )
                          }
                        >
                          Tiré
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </Section>
          )}
        </>
      )}

      {viewed && !editing && !buying && (
        <ItemSheet
          s={viewed}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(viewed.item)}
          onBuy={() => setBuying([line(viewed)])}
        />
      )}
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {buying && <PurchaseSheet initial={buying} onClose={() => setBuying(null)} />}
    </div>
  );
}

/** Línea de compra sugerida para un producto. */
function line(s: StockStatus): PurchaseLine {
  const quantity = s.toBuy || s.item.packSize || 1;
  return { itemId: s.item.id, quantity, price: s.prices.last !== null ? round2(s.prices.last * quantity) : null, expiry: null };
}

function needLabel(s: StockStatus): { text: string; tone: string } {
  if (s.need === 'out') return { text: 'No queda', tone: 'tag-bad' };
  if (s.need === 'low') return { text: 'Comprar', tone: 'tag-bad' };
  return { text: '', tone: '' };
}

function lastsText(s: StockStatus, today: string): string {
  if (s.quantity <= 0) return 'No queda';
  if (s.daysLeft === null) return s.usage ? '' : 'Anotá lo que usás y te digo cuánto te dura';
  if (s.daysLeft === 0) return 'Se termina hoy';
  return `Te dura ~${s.daysLeft} día${s.daysLeft === 1 ? '' : 's'} (hasta el ${dayLabel(s.runsOut!, today, true).toLowerCase()})`;
}

function StockRow({ s, onOpen, onBuy }: { s: StockStatus; onOpen: () => void; onBuy: () => void }) {
  const today = useToday();
  const tag = needLabel(s);
  const use = () => {
    if (isWhole(s.item.unit))
      addStockMove(s.item.id, 'use', 1, today, {}, `Usaste 1 ${UNIT_LABEL[s.item.unit]} de ${s.item.name}`);
    else askQuantity(s, 'use', today);
  };
  const ratio = s.daysLeft !== null ? Math.min(1, s.daysLeft / Math.max(1, s.cover * 2)) : null;
  return (
    <div className="tx-row static stock-row">
      <span className="tx-icon">{s.item.icon}</span>
      <button className="tx-main" onClick={onOpen}>
        <span className="tx-title">
          {s.item.name} {tag.text && <span className={`tag ${tag.tone}`}>{tag.text}</span>}
        </span>
        <span className="tx-meta">
          {[lastsText(s, today), s.nextExpiry ? `vence ${dayLabel(s.nextExpiry, today, true).toLowerCase()}` : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {ratio !== null && (
          <span className="stock-bar" aria-hidden="true">
            <span className={s.need !== 'ok' ? 'low' : ''} style={{ width: `${Math.max(4, ratio * 100)}%` }} />
          </span>
        )}
      </button>
      <div className="stepper stock-stepper">
        <button type="button" onClick={use} aria-label={`Usé ${s.item.name}`} disabled={s.quantity <= 0}>
          −
        </button>
        <span className="stock-qty">{fmtQty(s.quantity, s.item.unit)}</span>
        <button type="button" onClick={onBuy} aria-label={`Compré ${s.item.name}`}>
          +
        </button>
      </div>
    </div>
  );
}

function askQuantity(s: StockStatus, kind: 'use' | 'waste' | 'count', today: string) {
  const unit = UNIT_LABEL[s.item.unit];
  const title =
    kind === 'use'
      ? `¿Cuánto usaste de ${s.item.name}?`
      : kind === 'waste'
        ? `¿Cuánto tiraste de ${s.item.name}?`
        : `¿Cuánto hay de ${s.item.name}?`;
  openPrompt({
    title,
    label: `Cantidad (${unit})`,
    initial: kind === 'count' ? String(s.quantity).replace('.', ',') : isWhole(s.item.unit) ? '1' : '',
    hint:
      kind === 'count'
        ? 'Contá lo que hay y Lifty corrige. Si bajó, lo cuenta como consumo (así aprende cuánto usás aunque no anotes cada vez).'
        : kind === 'waste'
          ? 'Lo tirado no cuenta como consumo: se muestra aparte, con lo que te costó.'
          : `Hay ${fmtQty(s.quantity, s.item.unit)}.`,
    onSubmit: (v) => {
      if (v < 0 || (kind !== 'count' && v === 0)) return 'Escribí una cantidad';
      const verb = kind === 'use' ? 'Usaste' : kind === 'waste' ? 'Tiraste' : 'Hay';
      addStockMove(s.item.id, kind, v, today, {}, `${verb} ${fmtQty(v, s.item.unit)} de ${s.item.name}`);
    },
  });
}

function explainStatus(s: StockStatus) {
  const u = s.item.unit;
  const rows: Parameters<typeof openExplain>[0]['rows'] = [];
  if (s.usage) {
    rows.push(
      {
        label: `Usaste desde el ${s.usage.from.split('-').reverse().join('/')}`,
        value: s.usage.used,
        raw: fmtQty(s.usage.used, u),
        note: 'anotado + lo que bajó al contar',
      },
      { label: 'Días', value: s.usage.days, op: '÷', raw: String(s.usage.days) },
      { label: 'Usás por día', value: s.usage.perDay, op: '=', raw: fmtQty(s.usage.perDay, u) },
      { label: 'Tenés', value: s.quantity, raw: fmtQty(s.quantity, u) },
      { label: 'Te dura', value: s.daysLeft ?? 0, op: '=', raw: `${s.daysLeft} días` },
    );
  }
  openExplain({
    title: `${s.item.name}: cuentas`,
    intro: s.usage
      ? `Lo que usaste ÷ los días = lo que usás por día. Lo que tenés ÷ eso = cuántos días te dura.${s.usage.confident ? '' : ' Todavía hay pocos días de datos: el número se va afinando.'}`
      : 'Todavía no hay datos de consumo: anotá lo que usás (o contá lo que hay cada tanto) y Lifty lo calcula.',
    rows,
    result: s.toBuy > 0 ? { label: 'Comprar', value: s.toBuy, raw: fmtQty(s.toBuy, u) } : undefined,
    footnote: `${s.reason}${
      s.toBuy > 0
        ? ` Se compra para ${s.cover} días + 2 de margen${s.item.minQuantity !== null ? ` (o hasta superar el mínimo de ${fmtQty(s.item.minQuantity, u)})` : ''}${s.item.packSize ? `, redondeado a paquetes de ${fmtQty(s.item.packSize, u)}` : ''}.`
        : ''
    }${s.estimatedCost !== null ? ` Al último precio: ~${money(s.estimatedCost)}.` : ''}`,
  });
}

function ItemSheet({
  s,
  onClose,
  onEdit,
  onBuy,
}: {
  s: StockStatus;
  onClose: () => void;
  onEdit: () => void;
  onBuy: () => void;
}) {
  const data = useData();
  const today = useToday();
  const u = s.item.unit;
  const moves = data.stockMoves
    .filter((m) => m.itemId === s.item.id)
    .slice(-30)
    .reverse();
  const tag = needLabel(s);
  const KIND: Record<StockMove['kind'], string> = { buy: 'Compré', use: 'Usé', waste: 'Tiré', count: 'Conté' };
  return (
    <Sheet
      title={`${s.item.icon} ${s.item.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onEdit}>
            Editar
          </button>
          <button className="btn btn-primary grow" onClick={onBuy}>
            Compré
          </button>
        </>
      }
    >
      <div className="form">
        <div className="net-box">
          <span>Tenés {tag.text && <span className={`tag ${tag.tone}`}>{tag.text}</span>}</span>
          <strong>{fmtQty(s.quantity, u)}</strong>
        </div>
        <button className="link small" onClick={() => explainStatus(s)}>
          {lastsText(s, today) || 'Sin datos de consumo'} · ¿de dónde sale?
        </button>
        <div className="btn-row">
          <button className="btn" onClick={() => askQuantity(s, 'use', today)} disabled={s.quantity <= 0}>
            Usé
          </button>
          <button className="btn" onClick={() => askQuantity(s, 'count', today)}>
            Conté
          </button>
          <button className="btn" onClick={() => askQuantity(s, 'waste', today)} disabled={s.quantity <= 0}>
            Tiré
          </button>
        </div>
        <dl className="receipt">
          {s.usage && (
            <Row label="Usás por semana" value={`${fmtQty(s.usage.perDay * 7, u)}${s.usage.confident ? '' : ' (pocos datos)'}`} />
          )}
          {s.toBuy > 0 && (
            <Row
              label="Comprar"
              value={`${fmtQty(s.toBuy, u)}${s.estimatedCost !== null ? ` · ~${money(s.estimatedCost)}` : ''}`}
            />
          )}
          {s.prices.last !== null && (
            <Row
              label={`Último precio por ${UNIT_LABEL[u]}`}
              value={`${money(s.prices.last)}${s.prices.change ? ` (${s.prices.change > 0 ? '+' : ''}${s.prices.change}%)` : ''}`}
              bad={(s.prices.change ?? 0) > 0}
            />
          )}
          {s.prices.average !== null && s.prices.average !== s.prices.last && (
            <Row label="Promedio (6 meses)" value={money(s.prices.average)} />
          )}
          {s.prices.cheapestStore && (
            <Row label="Más barato en" value={`${s.prices.cheapestStore.store} · ${money(s.prices.cheapestStore.unitPrice)}`} />
          )}
          {s.monthlyCost !== null && <Row label="Te sale por mes" value={`~${money(Math.round(s.monthlyCost))}`} />}
          {s.wasted.quantity > 0 && (
            <Row
              label="Tiraste (30 días)"
              value={`${fmtQty(s.wasted.quantity, u)}${s.wasted.cost !== null ? ` · ${money(s.wasted.cost)}` : ''}`}
              bad
            />
          )}
        </dl>
        {s.batches.length > 0 && (
          <div>
            <strong className="small">Vencimientos</strong>
            <ul className="plain-list">
              {s.batches.map((b) => {
                const d = daysBetween(today, b.expiry);
                return (
                  <li key={`${b.date}-${b.expiry}`} className={d < 0 ? 'due-bad' : d <= 3 ? 'due-warn' : ''}>
                    {fmtQty(b.quantity, u)} · vence {dayLabel(b.expiry, today, true).toLowerCase()}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {s.item.note && <p className="muted small">{s.item.note}</p>}
        {moves.length > 0 && (
          <div className="card list">
            {moves.map((m) => (
              <div key={m.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">
                    {KIND[m.kind]} {fmtQty(m.quantity, u)}
                    {m.price ? ` · ${money(m.price)}` : ''}
                  </span>
                  <span className="tx-meta">
                    {[
                      dayLabel(m.date, today, true),
                      m.store,
                      m.expiry ? `vence ${m.expiry.split('-').reverse().join('/')}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label="Borrar"
                  onClick={() => {
                    mutate('stockMove', 'delete', m.id);
                    toast('Borrado', { action: { label: 'Deshacer', run: () => mutate('stockMove', 'upsert', m) } });
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="receipt-row">
      <dt>{label}</dt>
      <dd className={bad ? 'text-expense' : ''}>{value}</dd>
    </div>
  );
}

function ItemForm({ item, onClose, preset }: { item: StockItem | null; onClose: () => void; preset?: (typeof PRESETS)[number] }) {
  const data = useData();
  const today = useToday();
  const base = item ?? preset;
  const [name, setName] = useState(base?.name ?? '');
  const [icon, setIcon] = useState(base?.icon ?? '📦');
  const [place, setPlace] = useState<StockPlace>(base?.place ?? 'despensa');
  const [unit, setUnit] = useState<StockUnit>(base?.unit ?? 'u');
  const [pack, setPack] = useState(base?.packSize ? String(base.packSize).replace('.', ',') : '');
  const [min, setMin] = useState(item?.minQuantity != null ? String(item.minQuantity).replace('.', ',') : '');
  const [cover, setCover] = useState(item?.coverDays ? String(item.coverDays) : '');
  // Un producto de los de siempre llega con lo que sabemos de él.
  const fromPreset = !item && preset ? catalogFor(preset.name) : null;
  const [weight, setWeight] = useState(
    item?.unitWeight ? String(item.unitWeight) : fromPreset?.unitWeight ? String(fromPreset.unitWeight) : '',
  );
  const [shelf, setShelf] = useState(
    item?.shelfDays ? String(item.shelfDays) : fromPreset?.shelfDays ? String(fromPreset.shelfDays) : '',
  );
  const [staple, setStaple] = useState(item?.staple ?? !!fromPreset?.staple);
  const [note, setNote] = useState(item?.note ?? '');
  /** Con el nombre, lo que ya sabemos del producto (cuánto pesa una unidad, cuánto dura…). */
  const known = !item ? catalogFor(name) : null;
  const fillFromCatalog = () => {
    if (!known) return;
    setIcon(icon === '📦' || !icon ? known.icon : icon);
    setUnit(known.unit);
    setPlace(known.place);
    if (known.unitWeight) setWeight(String(known.unitWeight));
    if (known.shelfDays) setShelf(String(known.shelfDays));
    if (known.packSize && !pack) setPack(String(known.packSize).replace('.', ','));
    setStaple(!!known.staple);
  };
  const [have, setHave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const result = stockItemSchema.safeParse({
      ...(item ?? {}),
      id: item?.id ?? newId(),
      updatedAt: '',
      name,
      icon: icon || '📦',
      place,
      unit,
      packSize: parseAmount(pack) || null,
      minQuantity: min.trim() ? parseAmount(min) : null,
      coverDays: cover.trim() ? Math.round(Number(cover)) || null : null,
      unitWeight: unit === 'l' || unit === 'ml' ? null : parseAmount(weight) || null,
      shelfDays: shelf.trim() ? Math.round(Number(shelf)) || null : null,
      staple,
      note,
    });
    if (!result.success) return setError('Poné el nombre (y revisá los números).');
    if (!item && data.stockItems.some((i) => i.name.toLowerCase() === result.data.name.toLowerCase() && !i.archived))
      return setError('Ya tenés un producto con ese nombre.');
    mutate('stockItem', 'upsert', result.data);
    const q = parseAmount(have);
    if (!item && q !== null && q >= 0 && have.trim()) addStockMove(result.data.id, 'count', q, today);
    toast(item ? 'Producto guardado' : `${result.data.name} agregado`);
    onClose();
  };
  return (
    <Sheet
      title={item ? 'Editar producto' : 'Nuevo producto'}
      onClose={onClose}
      footer={
        <>
          {item && (
            <button
              className="btn btn-danger-ghost"
              onClick={() =>
                openMenu(item.name, [
                  {
                    label: item.archived ? 'Volver a mostrar' : 'Archivar (ya no lo compro)',
                    hint: 'Se guarda la historia',
                    run: () => {
                      mutate('stockItem', 'upsert', { ...item, archived: !item.archived });
                      onClose();
                    },
                  },
                  {
                    label: 'Borrar con toda su historia',
                    tone: 'danger',
                    run: () => {
                      const moves = data.stockMoves.filter((m) => m.itemId === item.id);
                      mutate('stockItem', 'delete', item.id);
                      for (const m of moves) mutate('stockMove', 'delete', m.id);
                      toast(`${item.name} borrado`, {
                        action: {
                          label: 'Deshacer',
                          run: () => {
                            mutate('stockItem', 'upsert', item);
                            for (const m of moves) mutate('stockMove', 'upsert', m);
                          },
                        },
                      });
                      onClose();
                    },
                  },
                ])
              }
            >
              Más…
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
              onBlur={() => {
                // Si el producto es conocido y todavía no completaste nada, se completa solo.
                if (known && !weight && !shelf) fillFromCatalog();
              }}
              placeholder="Ej: Arroz"
              maxLength={60}
            />
          </Field>
        </div>
        {known &&
          (known.unitWeight || known.shelfDays) &&
          (weight !== String(known.unitWeight ?? '') || shelf !== String(known.shelfDays ?? '')) && (
            <button type="button" className="link small left" onClick={fillFromCatalog}>
              Completar como {known.name.toLowerCase()}: {UNIT_LABEL[known.unit]}
              {known.unitWeight ? `, 1 u. ≈ ${known.unitWeight} g` : ''}
              {known.shelfDays ? `, dura ${known.shelfDays} días` : ''}
            </button>
          )}
        <Field label="¿Dónde va?">
          <Chips
            label="Lugar"
            value={place}
            onChange={setPlace}
            options={STOCK_PLACES.map((p) => ({ value: p, label: PLACE_LABEL[p] }))}
          />
        </Field>
        <Field label="Se mide en">
          <Chips
            label="Unidad"
            value={unit}
            onChange={setUnit}
            options={STOCK_UNITS.map((x) => ({
              value: x,
              label: { u: 'unidades', kg: 'kg', g: 'gramos', l: 'litros', ml: 'ml', paq: 'paquetes' }[x],
            }))}
          />
        </Field>
        {!item && (
          <Field label="¿Cuánto tenés ahora? (opcional)">
            <input
              inputMode="decimal"
              value={have}
              onChange={(e) => setHave(e.target.value)}
              placeholder={`Ej: 2 (${UNIT_LABEL[unit]})`}
            />
          </Field>
        )}
        <div className="row">
          <Field label="Viene de a (opcional)" hint="Ej: paquete de 1 kg, maple de 12">
            <input inputMode="decimal" value={pack} onChange={(e) => setPack(e.target.value)} placeholder={UNIT_LABEL[unit]} />
          </Field>
          <Field label="Avisame con (opcional)" hint="Si queda esto o menos">
            <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder={UNIT_LABEL[unit]} />
          </Field>
        </div>
        <div className="row">
          {unit !== 'l' && unit !== 'ml' && (
            <Field
              label="Una unidad pesa (g)"
              hint={unit === 'kg' || unit === 'g' ? 'Así una receta puede pedir "2 cebollas"' : 'Para recetas en gramos'}
            >
              <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ej: 150" />
            </Field>
          )}
          <Field label="Dura (días)" hint="Desde que lo comprás: avisa antes de que venza">
            <input
              inputMode="numeric"
              value={shelf}
              onChange={(e) => setShelf(e.target.value.replace(/\D/g, ''))}
              placeholder="Ej: 7"
            />
          </Field>
        </div>
        <Toggle checked={staple} onChange={setStaple} label="Es un básico que siempre hay (sal, aceite): el menú no lo pide" />
        <Field
          label="Quiero tener para (días, opcional)"
          hint={`Si no ponés nada: ${data.settings.shoppingDays} días (cada cuánto hacés las compras)`}
        >
          <input inputMode="numeric" value={cover} onChange={(e) => setCover(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Nota">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: la marca que me gusta" maxLength={200} />
        </Field>
      </div>
    </Sheet>
  );
}

function StockEmpty({ onNew }: { onNew: () => void }) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(null);
  return (
    <>
      <Empty icon="box" title="Anotá lo que tenés en casa">
        <p>
          Lifty aprende cuánto usás de cada cosa, te dice cuándo se termina, arma la lista de compras con cantidades y cuánto va a
          salir, y te avisa lo que vence.
        </p>
        <button className="btn btn-primary" onClick={onNew}>
          <Icon name="plus" /> Agregar un producto
        </button>
      </Empty>
      <Section title="O empezá con los de siempre">
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => setPreset(p)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      </Section>
      {preset && <ItemForm item={null} preset={preset} onClose={() => setPreset(null)} />}
    </>
  );
}

/**
 * Lista de compras compartida: se guarda y se sincroniza (tildás en el súper desde el celular).
 * Arriba lo que ya está en la lista; abajo lo que Lifty sugiere según tu stock.
 */
function ShoppingList({ onBuy, onOpen }: { onBuy: (lines: PurchaseLine[]) => void; onOpen: (id: string) => void }) {
  const data = useData();
  const today = useToday();
  const o = useOverview();
  const b = useMonth(monthOf(today));
  const [text, setText] = useState('');
  const entries = data.shopEntries;
  const pending = entries.filter((e) => !e.checked);
  const checked = entries.filter((e) => e.checked);
  const inList = new Set(entries.map((e) => e.itemId).filter(Boolean));
  const suggested = o.shopping.filter((s) => !inList.has(s.item.id));
  const suggestedIds = new Set(suggested.map((s) => s.item.id));
  const statusOf = (id: string | null) => (id ? o.statuses.find((s) => s.item.id === id) : undefined);
  const unitPrice = (s?: StockStatus) => (s ? (s.prices.last ?? s.prices.average) : null);
  const cost = (e: ShopEntry) => {
    const p = unitPrice(statusOf(e.itemId));
    return p !== null && e.quantity ? p * e.quantity : null;
  };
  const total = round2(pending.reduce((s, e) => s + (cost(e) ?? 0), 0));
  const withoutPrice = pending.filter((e) => cost(e) === null).length;
  const food = data.accounts.find((a) => a.type === 'food' && !a.archived);
  // Solo si la usás (tiene carga o saldo): si no, el aviso no dice nada útil.
  const foodAvailable = food ? (foodCardMonth(data, food.id, monthOf(today), today)?.available ?? null) : null;
  const foodLeft = food && foodAvailable !== null && (food.monthlyLoad || foodAvailable > 0) ? foodAvailable : null;
  const superLine = b.categories.find((c) => c.categoryId === 'cat-super' && c.limit !== null);

  // Lo inteligente: lo de siempre, subas de precio, dónde conviene y la lista por sector.
  const routine = useMemo(() => routineItems(data.stockItems, data.stockMoves, today), [data.stockItems, data.stockMoves, today]);
  const routineDue = routine.filter((r) => r.due && !inList.has(r.item.id) && !suggestedIds.has(r.item.id));
  const alerts = useMemo(
    () => new Map(priceAlerts(data.stockItems, data.stockMoves, today).map((a) => [a.item.id, a])),
    [data.stockItems, data.stockMoves, today],
  );
  const stores = useMemo(() => listByStore(entries, data.stockMoves, today), [entries, data.stockMoves, today]);
  const groups = groupByAisle(pending, data.stockItems);

  // Lo que estás escribiendo: "2 kg arroz", "lehce" → Leche.
  const parsed = parseShopText(text);
  const match = parsed.name ? matchStockItem(data.stockItems, parsed.name) : null;
  const matchStatus = match ? statusOf(match.id) : undefined;

  const add = (s: StockStatus) => addToShoppingList(s);
  const addRoutine = (r: RoutineItem) =>
    mutate('shopEntry', 'upsert', {
      id: newId(),
      updatedAt: '',
      itemId: r.item.id,
      name: r.item.name,
      quantity: r.usualQty || r.item.packSize || 1,
      unit: UNIT_LABEL[r.item.unit],
      checked: false,
    });
  const addText = () => {
    if (!parsed.name) return;
    if (match) {
      const already = entries.find((e) => e.itemId === match.id && !e.checked);
      const qty = parsed.quantity ?? matchStatus?.toBuy ?? match.packSize ?? 1;
      if (already) {
        const quantity = round2((already.quantity ?? 0) + (parsed.quantity ?? 0)) || already.quantity;
        mutate('shopEntry', 'upsert', { ...already, quantity });
        toast(
          parsed.quantity ? `${match.name}: ahora ${quantity?.toLocaleString('es-UY')} ${already.unit}` : `${match.name} ya está`,
        );
      } else
        mutate('shopEntry', 'upsert', {
          id: newId(),
          updatedAt: '',
          itemId: match.id,
          name: match.name,
          quantity: qty || 1,
          unit: parsed.unit || UNIT_LABEL[match.unit],
          checked: false,
        });
    } else
      mutate('shopEntry', 'upsert', {
        id: newId(),
        updatedAt: '',
        itemId: null,
        name: parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1),
        quantity: parsed.quantity,
        unit: parsed.unit,
        checked: false,
      });
    setText('');
  };
  const finish = () => {
    const lines: PurchaseLine[] = checked
      .filter((e) => e.itemId && statusOf(e.itemId))
      .map((e) => {
        const p = unitPrice(statusOf(e.itemId));
        const q = e.quantity ?? 1;
        return { itemId: e.itemId!, quantity: q, price: p !== null ? round2(p * q) : null, expiry: null };
      });
    // Lo tildado sale de la lista (se puede deshacer).
    const removed = checked;
    for (const e of removed) mutate('shopEntry', 'delete', e.id);
    toast(`Saqué ${removed.length} de la lista`, {
      action: { label: 'Deshacer', run: () => removed.forEach((e) => mutate('shopEntry', 'upsert', e)) },
    });
    if (lines.length) onBuy(lines);
  };
  const share = async () => {
    const txt = `Lista de compras\n${groups
      .map(
        (g) =>
          `${g.label}\n${g.entries.map((e) => `• ${e.name}${e.quantity ? `: ${e.quantity.toLocaleString('es-UY')} ${e.unit}` : ''}`).join('\n')}`,
      )
      .join('\n\n')}`;
    try {
      if (navigator.share) await navigator.share({ text: txt });
      else {
        await navigator.clipboard.writeText(txt);
        toast('Lista copiada: pegala donde quieras');
      }
    } catch {
      /* cancelado */
    }
  };

  const row = (e: ShopEntry) => {
    const c = cost(e);
    const a = e.itemId ? alerts.get(e.itemId) : undefined;
    return (
      <div key={e.id} className={`tx-row static shop-row ${e.checked ? 'off' : ''}`}>
        <button
          className="check"
          aria-pressed={e.checked}
          aria-label={e.checked ? `Destildar ${e.name}` : `Tildar ${e.name}`}
          onClick={() => mutate('shopEntry', 'upsert', { ...e, checked: !e.checked })}
        >
          <Icon name="check" size={16} />
        </button>
        <button className="tx-main" onClick={() => e.itemId && onOpen(e.itemId)}>
          <span className="tx-title">
            {e.name}
            {a && !e.checked && (
              <span className={`tag ${a.change > 0 ? 'tag-bad' : 'tag-good'}`}>
                {a.change > 0 ? `subió ${a.change}%` : `bajó ${-a.change}%`}
              </span>
            )}
          </span>
          <span className="tx-meta">
            {[
              e.quantity ? `${e.quantity.toLocaleString('es-UY')} ${e.unit}` : null,
              c !== null ? `~${money(Math.round(c))}` : null,
              a?.cheaperAt && a.change > 0 && !e.checked
                ? `en ${a.cheaperAt.store} lo pagaste ${money(a.cheaperAt.unitPrice)}/${UNIT_LABEL[a.item.unit]}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || (e.itemId ? '' : 'no está en el stock')}
          </span>
        </button>
        <button
          className="icon-btn"
          aria-label={`Sacar ${e.name}`}
          onClick={() => {
            mutate('shopEntry', 'delete', e.id);
            toast(`${e.name} fuera de la lista`, {
              action: { label: 'Deshacer', run: () => mutate('shopEntry', 'upsert', e) },
            });
          }}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    );
  };

  return (
    <>
      <Section
        title={`Lista de compras${pending.length ? ` (${pending.length})` : ''}`}
        action={
          entries.length > 0 && (
            <button className="link" onClick={() => void share()}>
              Compartir
            </button>
          )
        }
      >
        <form
          className="add-row shop-add"
          onSubmit={(e) => {
            e.preventDefault();
            addText();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Agregar: «2 kg arroz», «leche x3», «velas»…"
            list="lifty-stock-names"
            aria-label="Agregar a la lista"
          />
          <datalist id="lifty-stock-names">
            {data.stockItems
              .filter((i) => !i.archived)
              .map((i) => (
                <option key={i.id} value={i.name} />
              ))}
          </datalist>
          <button className="btn" type="submit" disabled={!parsed.name}>
            <Icon name="plus" />
          </button>
        </form>
        {parsed.name && (
          <p className="muted small shop-preview">
            {match ? `→ ${match.icon} ${match.name} (del stock)` : `→ ${parsed.name}`}
            {parsed.quantity
              ? ` · ${parsed.quantity.toLocaleString('es-UY')} ${parsed.unit || (match ? UNIT_LABEL[match.unit] : '')}`
              : matchStatus?.toBuy
                ? ` · ${fmtQty(matchStatus.toBuy, matchStatus.item.unit)} (lo que te falta)`
                : ''}
            {` · ${AISLE_LABEL[aisleOf(match?.name ?? parsed.name, match?.place)]}`}
          </p>
        )}
        {entries.length === 0 ? (
          <p className="muted small">
            La lista está vacía. Se comparte entre tus dispositivos: tildá en el súper desde el celular. Se ordena sola por
            sector, como recorrés el súper.
          </p>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.aisle} className="shop-group">
                <h4 className="shop-aisle">{g.label}</h4>
                <div className="card list">{g.entries.map(row)}</div>
              </div>
            ))}
            {checked.length > 0 && (
              <div className="shop-group">
                <h4 className="shop-aisle">🛒 En el carrito ({checked.length})</h4>
                <div className="card list">{checked.map(row)}</div>
              </div>
            )}
          </>
        )}
        {entries.length > 0 && (
          <div className="card pad shop-total">
            <div className="limit-head">
              <span>Falta comprar (estimado)</span>
              <strong>~{money(Math.round(total))}</strong>
            </div>
            {withoutPrice > 0 && total > 0 && (
              <p className="muted small">{withoutPrice} sin precio todavía (se aprende cuando registrás la compra con precio).</p>
            )}
            {foodLeft !== null && total > 0 && (
              <p className={`small ${foodLeft >= total ? 'text-income' : 'text-expense'}`}>
                🍽️ En la tarjeta de alimentación te quedan {money(Math.round(foodLeft))}:{' '}
                {foodLeft >= total ? 'te alcanza' : `te faltan ~${money(Math.round(total - foodLeft))}`}.
              </p>
            )}
            {superLine && superLine.remaining !== null && total > 0 && (foodLeft === null || foodLeft < total) && (
              <p className={`small ${superLine.remaining >= total - Math.max(0, foodLeft ?? 0) ? 'muted' : 'text-expense'}`}>
                🛒 Del presupuesto del súper te quedan {money(Math.round(superLine.remaining))}
                {(() => {
                  const fromBudget = total - Math.max(0, foodLeft ?? 0);
                  const after = superLine.remaining - fromBudget;
                  return after >= 0
                    ? ` → con esta lista quedarían ${money(Math.round(after))}.`
                    : ` → con esta lista te pasarías ${money(Math.round(-after))}.`;
                })()}
              </p>
            )}
            <button className="btn btn-primary" disabled={!checked.length} onClick={finish}>
              <Icon name="cart" /> Terminé: registrar lo tildado ({checked.length})
            </button>
          </div>
        )}
      </Section>

      {stores.priced >= 2 && stores.stores.length > 1 && (
        <Section title="¿Dónde conviene hacer esta compra?">
          <ul className="card month-bars">
            {stores.stores.map((st) => (
              <li key={st.store}>
                <span>
                  {st.store === stores.best?.store ? '✓ ' : ''}
                  {st.store}
                </span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(st.total / Math.max(...stores.stores.map((x) => x.total))) * 100}%` }}
                  />
                </div>
                <strong>
                  {money(Math.round(st.total))}
                  <small className="muted">
                    {' '}
                    · {st.covered} de {stores.priced}
                  </small>
                </strong>
              </li>
            ))}
          </ul>
          {stores.split.length > 1 && stores.splitSavings >= 20 && (
            <p className="small">
              Dividiendo la compra ahorrás ~<strong>{money(Math.round(stores.splitSavings))}</strong>:{' '}
              {stores.split.map((x, i) => (
                <span key={x.store}>
                  {i > 0 && ' · '}
                  <strong>{x.store}</strong> ({x.items.join(', ')})
                </span>
              ))}
              .
            </p>
          )}
          <p className="muted small">
            Con el último precio que pagaste en cada lugar (últimos 6 meses), para lo de la lista que tiene precio.
          </p>
        </Section>
      )}

      {routineDue.length > 0 && (
        <Section
          title="Lo de siempre: ya toca"
          action={
            <button className="link" onClick={() => routineDue.forEach(addRoutine)}>
              Agregar todo
            </button>
          }
        >
          <div className="card list">
            {routineDue.map((r) => (
              <div key={r.item.id} className="tx-row static shop-row">
                <span className="tx-icon">{r.item.icon}</span>
                <button className="tx-main" onClick={() => onOpen(r.item.id)}>
                  <span className="tx-title">{r.item.name}</span>
                  <span className="tx-meta">
                    Lo comprás cada ~{r.every} días (última: {r.last.split('-').reverse().slice(0, 2).join('/')}) · casi siempre{' '}
                    {fmtQty(r.usualQty, r.item.unit)}
                  </span>
                </button>
                <button
                  className="btn btn-ghost small"
                  onClick={() => addRoutine(r)}
                  aria-label={`Agregar ${r.item.name} a la lista`}
                >
                  <Icon name="plus" size={16} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {suggested.length > 0 && (
        <Section
          title="Te falta según tu stock"
          action={
            <button className="link" onClick={() => suggested.forEach(add)}>
              Agregar todo
            </button>
          }
        >
          <div className="card list">
            {suggested.map((s) => (
              <div key={s.item.id} className="tx-row static shop-row">
                <span className="tx-icon">{s.item.icon}</span>
                <button className="tx-main" onClick={() => onOpen(s.item.id)}>
                  <span className="tx-title">{s.item.name}</span>
                  <span className="tx-meta">
                    {s.reason} Comprar {fmtQty(s.toBuy, s.item.unit)}
                    {s.estimatedCost !== null ? ` · ~${money(Math.round(s.estimatedCost))}` : ''}
                  </span>
                </button>
                <button className="btn btn-ghost small" onClick={() => add(s)} aria-label={`Agregar ${s.item.name} a la lista`}>
                  <Icon name="plus" size={16} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Registrar una compra: varios productos, con precio y vencimiento, y el gasto en la cuenta que elijas. */
function PurchaseSheet({ initial, onClose }: { initial: PurchaseLine[]; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const items = data.stockItems.filter((i) => !i.archived);
  const food = data.accounts.find((a) => a.type === 'food' && !a.archived);
  const stores = useMemo(() => [...new Set(data.stockMoves.map((m) => m.store).filter(Boolean))], [data.stockMoves]);
  const [date, setDate] = useState(today);
  const [store, setStore] = useState(stores[stores.length - 1] ?? '');
  const [accountId, setAccountId] = useState<string | null>(food?.id ?? null);
  const [withExpense, setWithExpense] = useState(true);
  type Row = { key: string; itemId: string; qty: string; price: string; expiry: string };
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length ? initial : [{ itemId: '', quantity: 1, price: null, expiry: null }]).map((l) => ({
      key: newId(),
      itemId: l.itemId,
      qty: String(l.quantity).replace('.', ','),
      price: l.price !== null ? String(Math.round(l.price)) : '',
      expiry: l.expiry ?? '',
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const setRow = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = round2(rows.reduce((s, r) => s + (parseAmount(r.price) ?? 0), 0));
  const o = useOverview();
  const statusOf = (id: string) => o.statuses.find((s) => s.item.id === id);

  const save = () => {
    const lines: PurchaseLine[] = [];
    for (const r of rows) {
      if (!r.itemId) continue;
      const q = parseAmount(r.qty);
      if (!q || q <= 0) return setError('Revisá las cantidades.');
      lines.push({ itemId: r.itemId, quantity: q, price: parseAmount(r.price), expiry: r.expiry || null });
    }
    if (!lines.length) return setError('Elegí al menos un producto.');
    recordPurchase({ date, store, accountId, lines, withExpense });
    onClose();
  };

  return (
    <Sheet
      title="Registrar compra"
      onClose={onClose}
      wide
      footer={
        <button className="btn btn-primary grow" onClick={save}>
          Guardar{total > 0 ? ` · ${money(total)}` : ''}
        </button>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <div className="row">
          <Field label="Fecha">
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Dónde">
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="Ej: Disco, Tata, feria"
              list="lifty-stores"
              maxLength={60}
            />
            <datalist id="lifty-stores">
              {stores.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="purchase-lines">
          {rows.map((r) => {
            const s = statusOf(r.itemId);
            const q = parseAmount(r.qty) ?? 0;
            const p = parseAmount(r.price);
            const unitNow = p && q ? p / q : null;
            const change = unitNow && s?.prices.last ? Math.round(((unitNow - s.prices.last) / s.prices.last) * 100) : null;
            return (
              <div key={r.key} className="purchase-line">
                <select value={r.itemId} onChange={(e) => setRow(r.key, { itemId: e.target.value })} aria-label="Producto">
                  <option value="">Elegí el producto…</option>
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
                    onChange={(e) => setRow(r.key, { qty: e.target.value })}
                    aria-label="Cantidad"
                  />
                  <span>{s ? UNIT_LABEL[s.item.unit] : ''}</span>
                </label>
                <label className="shop-qty">
                  <span>$</span>
                  <input
                    inputMode="decimal"
                    value={r.price}
                    onChange={(e) => setRow(r.key, { price: e.target.value })}
                    placeholder="total"
                    aria-label="Precio total"
                  />
                </label>
                <button className="icon-btn" aria-label="Sacar" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  <Icon name="x" size={16} />
                </button>
                <input
                  type="date"
                  value={r.expiry}
                  min={date}
                  onChange={(e) => setRow(r.key, { expiry: e.target.value })}
                  aria-label="Vence (opcional)"
                  title="Vence (opcional)"
                />
                {change !== null && Math.abs(change) >= 5 && (
                  <span className={`small purchase-note ${change > 0 ? 'text-expense' : 'text-income'}`}>
                    {change > 0 ? `Subió ${change}%` : `Bajó ${-change}%`} desde la última vez ({money(s!.prices.last!)} por{' '}
                    {UNIT_LABEL[s!.item.unit]})
                  </span>
                )}
              </div>
            );
          })}
          <button
            className="btn btn-ghost"
            onClick={() => setRows([...rows, { key: newId(), itemId: '', qty: '1', price: '', expiry: '' }])}
          >
            <Icon name="plus" /> Otro producto
          </button>
          <p className="muted small">El vencimiento es opcional. El precio es lo que pagaste en total por esa cantidad.</p>
        </div>
        <Toggle
          checked={withExpense}
          onChange={setWithExpense}
          label={`Cargar también el gasto${total > 0 ? ` de ${money(total)}` : ''}`}
        />
        {withExpense && (
          <Field label="¿Con qué pagaste?">
            <Chips
              label="Cuenta"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: null, label: 'Sin indicar' },
                ...data.accounts
                  .filter((a) => !a.archived)
                  .map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
              ]}
            />
          </Field>
        )}
        {withExpense && accountId && data.accounts.find((a) => a.id === accountId)?.type === 'food' && (
          <p className="note">🍽️ Con la tarjeta de alimentación: se descuenta de su saldo y no cuenta en tu presupuesto.</p>
        )}
      </div>
    </Sheet>
  );
}

/** Dónde conviene comprar: último precio por unidad de cada producto en cada súper. */
function PricesView() {
  const data = useData();
  const today = useToday();
  const r = useMemo(
    () => storePrices(data.stockItems, data.stockMoves, today, data.settings),
    [data.stockItems, data.stockMoves, today, data.settings],
  );
  const alerts = useMemo(() => priceAlerts(data.stockItems, data.stockMoves, today), [data.stockItems, data.stockMoves, today]);
  if (!r.items.length && !alerts.length)
    return (
      <Empty icon="cart" title="Todavía no hay precios">
        Cuando registres compras con precio y dónde compraste, acá ves en qué súper conviene cada cosa.
      </Empty>
    );
  const cheapest = r.basket[0];
  return (
    <>
      {alerts.length > 0 && (
        <Section title="Cambios de precio">
          <div className="card list">
            {alerts.map((a) => (
              <div key={a.item.id} className="tx-row static">
                <span className="tx-icon">{a.item.icon}</span>
                <span className="tx-main">
                  <span className="tx-title">
                    {a.item.name}{' '}
                    <span className={`tag ${a.change > 0 ? 'tag-bad' : 'tag-good'}`}>
                      {a.change > 0 ? `subió ${a.change}%` : `bajó ${-a.change}%`}
                    </span>
                  </span>
                  <span className="tx-meta">
                    {money(a.last)}/{UNIT_LABEL[a.item.unit]}
                    {a.store ? ` en ${a.store}` : ''} el {a.date.split('-').reverse().slice(0, 2).join('/')} · antes{' '}
                    {money(a.before)} en promedio
                    {a.cheaperAt && a.change > 0 ? ` · en ${a.cheaperAt.store} lo pagaste ${money(a.cheaperAt.unitPrice)}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="muted small">La última compra contra el promedio de las anteriores (6 meses). Avisa desde 15%.</p>
        </Section>
      )}
      {r.monthlySavings > 0 && (
        <div className="note note-good">
          Comprando cada cosa donde está más barata ahorrarías <strong>~{money(Math.round(r.monthlySavings))} por mes</strong>{' '}
          (contra lo que pagás en promedio, con lo que consumís).
        </div>
      )}
      {r.basket.length > 1 && (
        <Section title="Si comprás todo en un solo lugar (un mes de consumo)">
          <ul className="card month-bars">
            {r.basket.map((b) => (
              <li key={b.store}>
                <span>{b.store}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(b.total / Math.max(...r.basket.map((x) => x.total))) * 100}%` }}
                  />
                </div>
                <strong>
                  {money(Math.round(b.total))}
                  <small className="muted"> · {b.items} prod.</small>
                </strong>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Solo cuenta los productos con precio en ese lugar: compará los que tienen la misma cantidad de productos.
            {cheapest ? ` Con más productos y más barato: ${cheapest.store}.` : ''}
          </p>
        </Section>
      )}
      <Section title="Por producto">
        <div className="card list">
          {r.items.map((x) => (
            <div key={x.item.id} className="tx-row static">
              <span className="tx-icon">{x.item.icon}</span>
              <span className="tx-main">
                <span className="tx-title">
                  {x.item.name}
                  {x.spread !== null && x.spread >= 5 && <span className="tag tag-good">{x.spread}% de diferencia</span>}
                </span>
                <span className="tx-meta">
                  {x.prices
                    .map(
                      (p, i) =>
                        `${i === 0 && x.prices.length > 1 ? '✓ ' : ''}${p.store} ${money(p.unitPrice)}/${UNIT_LABEL[x.item.unit]}`,
                    )
                    .join(' · ')}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="muted small">El último precio que pagaste en cada lugar (últimos 6 meses).</p>
      </Section>
    </>
  );
}

/** En la lista del súper: "hoy conviene comprar acá" (por tus beneficios de hoy). */
function TodayBenefits() {
  const data = useData();
  const today = useToday();
  const list = benefitsOn(data, today).filter((b) => b.store || b.categoryId === 'cat-super');
  if (!list.length) return null;
  const acc = (id: string | null) => (id ? data.accounts.find((a) => a.id === id)?.name : null);
  return (
    <div className="card pad benefit-banner">
      🏷️ Hoy conviene:{' '}
      {list
        .map(
          (b) =>
            `${b.percent ? `${b.percent}% ` : ''}${b.store ? `en ${b.store}` : 'en el súper'}${acc(b.accountId) ? ` con ${acc(b.accountId)}` : ''}${b.cap ? ` (tope ${money(b.cap)})` : ''}`,
        )
        .join(' · ')}
    </div>
  );
}
