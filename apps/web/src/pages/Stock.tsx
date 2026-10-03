import { useMemo, useState } from 'react';
import {
  daysBetween,
  fmtQty,
  foodCardMonth,
  monthOf,
  newId,
  round2,
  shoppingListText,
  STOCK_PLACES,
  STOCK_UNITS,
  stockItemSchema,
  stockOverview,
  UNIT_LABEL,
  type StockItem,
  type StockMove,
  type StockPlace,
  type StockStatus,
  type StockUnit,
} from '@lifty/core';
import { openExplain, openMenu, openPrompt } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Segmented, Sheet, Toggle, toast } from '../components/ui';
import { dayLabel, money, parseAmount } from '../lib/format';
import { local } from '../lib/local';
import { addStockMove, recordPurchase, type PurchaseLine } from '../lib/stock';
import { useData, useToday } from '../lib/store';
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

type Tab = 'tengo' | 'lista' | 'vence';

function useOverview() {
  const data = useData();
  const today = useToday();
  return useMemo(
    () => stockOverview(data.stockItems, data.stockMoves, today, data.settings),
    [data.stockItems, data.stockMoves, today, data.settings],
  );
}

const isWhole = (u: StockUnit) => u === 'u' || u === 'paq';

export function Stock() {
  const data = useData();
  const today = useToday();
  const o = useOverview();
  const [tab, setTabState] = useState<Tab>(() => (local.get('lifty-stock-tab') as Tab) || 'tengo');
  const setTab = (t: Tab) => {
    setTabState(t);
    local.set('lifty-stock-tab', t === 'tengo' ? null : t);
  };
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const [buying, setBuying] = useState<PurchaseLine[] | null>(null);
  const [query, setQuery] = useState('');
  const viewed = o.statuses.find((s) => s.item.id === viewing) ?? null;
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
        <StockEmpty onNew={() => setEditing('new')} />
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
              { value: 'lista', label: `Comprar${o.shopping.length ? ` (${o.shopping.length})` : ''}` },
              { value: 'vence', label: 'Vence' },
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

          {tab === 'lista' && <ShoppingList onBuy={(lines) => setBuying(lines)} onOpen={setViewing} />}

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
  const [note, setNote] = useState(item?.note ?? '');
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
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Arroz" maxLength={60} />
          </Field>
        </div>
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

function ShoppingList({ onBuy, onOpen }: { onBuy: (lines: PurchaseLine[]) => void; onOpen: (id: string) => void }) {
  const data = useData();
  const today = useToday();
  const o = useOverview();
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const rows = [...o.shopping, ...o.statuses.filter((s) => extra.includes(s.item.id) && s.need === 'ok')];
  const quantityOf = (s: StockStatus) => parseAmount(qty[s.item.id] ?? '') ?? (s.toBuy || s.item.packSize || 1);
  const chosen = rows.filter((s) => !skip.has(s.item.id));
  const unitPrice = (s: StockStatus) => s.prices.last ?? s.prices.average;
  const total = round2(chosen.reduce((sum, s) => sum + (unitPrice(s) ?? 0) * quantityOf(s), 0));
  const noPrice = chosen.filter((s) => unitPrice(s) === null).length;
  const food = data.accounts.find((a) => a.type === 'food' && !a.archived);
  const foodLeft = food ? (foodCardMonth(data, food.id, monthOf(today), today)?.available ?? null) : null;
  const others = o.statuses.filter((s) => s.need === 'ok' && !extra.includes(s.item.id));

  const share = async () => {
    const text = `Lista de compras\n${shoppingListText(chosen.map((s) => ({ status: s, quantity: quantityOf(s) })))}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Lista copiada: pegala donde quieras');
      }
    } catch {
      /* cancelado */
    }
  };

  if (!rows.length)
    return (
      <Empty icon="cart" title="No hace falta comprar nada">
        Con lo que usás, lo que tenés te alcanza hasta la próxima compra ({data.settings.shoppingDays} días).
        {others.length > 0 && (
          <button className="btn" onClick={() => setExtra([others[0].item.id])}>
            Agregar algo igual
          </button>
        )}
      </Empty>
    );

  return (
    <Section
      title="Lista de compras"
      action={
        <button className="link" onClick={() => void share()}>
          Compartir
        </button>
      }
    >
      <div className="card list">
        {rows.map((s) => {
          const on = !skip.has(s.item.id);
          const price = unitPrice(s);
          return (
            <div key={s.item.id} className={`tx-row static shop-row ${on ? '' : 'off'}`}>
              <button
                className="check"
                aria-pressed={on}
                aria-label={on ? `Sacar ${s.item.name} de la lista` : `Volver a poner ${s.item.name}`}
                onClick={() => {
                  const next = new Set(skip);
                  if (on) next.add(s.item.id);
                  else next.delete(s.item.id);
                  setSkip(next);
                }}
              >
                <Icon name="check" size={16} />
              </button>
              <button className="tx-main" onClick={() => onOpen(s.item.id)}>
                <span className="tx-title">
                  {s.item.icon} {s.item.name}
                </span>
                <span className="tx-meta">
                  {s.reason}
                  {price !== null ? ` · ~${money(Math.round(price * quantityOf(s)))}` : ' · sin precio'}
                </span>
              </button>
              <label className="shop-qty">
                <input
                  inputMode="decimal"
                  value={qty[s.item.id] ?? String(quantityOf(s)).replace('.', ',')}
                  onChange={(e) => setQty({ ...qty, [s.item.id]: e.target.value })}
                  aria-label={`Cantidad de ${s.item.name}`}
                />
                <span>{UNIT_LABEL[s.item.unit]}</span>
              </label>
            </div>
          );
        })}
      </div>
      {others.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && setExtra([...extra, e.target.value])}
          aria-label="Agregar otro producto a la lista"
        >
          <option value="">+ Agregar otro producto a la lista…</option>
          {others.map((s) => (
            <option key={s.item.id} value={s.item.id}>
              {s.item.icon} {s.item.name} (tenés {fmtQty(s.quantity, s.item.unit)})
            </option>
          ))}
        </select>
      )}
      <div className="card pad shop-total">
        <div className="limit-head">
          <span>
            Estimado ({chosen.length} producto{chosen.length === 1 ? '' : 's'})
          </span>
          <strong>~{money(Math.round(total))}</strong>
        </div>
        {noPrice > 0 && <p className="muted small">{noPrice} sin precio todavía: se completa cuando registres la compra.</p>}
        {foodLeft !== null && (
          <p className={`small ${foodLeft >= total ? 'text-income' : 'text-expense'}`}>
            🍽️ En la tarjeta de alimentación te quedan {money(Math.round(foodLeft))}:{' '}
            {foodLeft >= total ? 'te alcanza' : `te faltan ~${money(Math.round(total - foodLeft))}`}.
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={!chosen.length}
          onClick={() =>
            onBuy(
              chosen.map((s) => {
                const q = quantityOf(s);
                const price = unitPrice(s);
                return { itemId: s.item.id, quantity: q, price: price !== null ? round2(price * q) : null, expiry: null };
              }),
            )
          }
        >
          <Icon name="cart" /> Ya compré esto
        </button>
      </div>
    </Section>
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
