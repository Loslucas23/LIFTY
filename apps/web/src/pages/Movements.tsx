import { useEffect, useMemo, useState } from 'react';
import {
  categoryFamily,
  categoryPath,
  countsInBudget,
  daysInMonth,
  monthOf,
  occursIn,
  offBudgetAccounts,
  ownAmount,
  round2,
  sortedCategories,
  txRate,
  type Transaction,
  type TxKind,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { TxRow } from '../components/TxRow';
import { Chips, Empty, MonthPicker, PageHeader, Segmented } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { isPrivate } from '../lib/privacy';
import { local } from '../lib/local';
import { navigate, useQuery } from '../lib/router';
import { useData, useLookups, useToday } from '../lib/store';

export function Movements({ month: monthParam }: { month?: string }) {
  const data = useData();
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const { account } = useLookups();
  const params = useQuery();
  const [kind, setKind] = useState<TxKind | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>(params.get('categoria') ?? '');
  const [accountId, setAccountId] = useState<string>(params.get('cuenta') ?? '');
  const [tag, setTag] = useState<string>(params.get('etiqueta') ?? '');
  const [view, setViewState] = useState<'list' | 'calendar'>(local.get('lifty-mov-view') === 'calendar' ? 'calendar' : 'list');
  const [day, setDay] = useState<string | null>(null);
  const setView = (v: 'list' | 'calendar') => {
    setViewState(v);
    setDay(null);
    local.set('lifty-mov-view', v === 'calendar' ? 'calendar' : null);
  };
  // Si cambia la dirección (#/movimientos?etiqueta=…), se actualizan los filtros.
  const qCategory = params.get('categoria') ?? '';
  const qAccount = params.get('cuenta') ?? '';
  const qTag = params.get('etiqueta') ?? '';
  useEffect(() => {
    setCategoryId(qCategory);
    setAccountId(qAccount);
    setTag(qTag);
  }, [qCategory, qAccount, qTag]);
  const off = useMemo(() => offBudgetAccounts(data), [data]);
  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of data.transactions) for (const x of t.tags ?? []) if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), x);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data.transactions]);
  const tagKey = tag.toLowerCase();

  // Filtrar por una categoría incluye sus subcategorías.
  const family = useMemo(() => (categoryId ? categoryFamily(data.categories, categoryId) : null), [data.categories, categoryId]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions.filter((t) => {
      // Con una etiqueta se ven todas las fechas (un viaje puede durar varios meses).
      if (tagKey ? !(t.tags ?? []).some((x) => x.toLowerCase() === tagKey) : monthOf(t.date) !== month) return false;
      if (day && t.date !== day) return false;
      if (kind && t.kind !== kind) return false;
      if (family && !family.has(t.categoryId ?? '')) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (!q) return true;
      const hay = [
        t.description,
        categoryPath(data.categories, t.categoryId),
        account.get(t.accountId ?? '')?.name,
        String(t.amount),
        ...(t.tags ?? []).map((x) => `#${x}`),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, month, kind, query, account, family, accountId, tagKey, day]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof list>();
    for (const t of list) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  const rate = data.settings.usdRate;
  const totals = useMemo(() => {
    // Los totales son los de tu presupuesto: sin transferencias ni tarjeta de alimentación, y solo tu parte de lo dividido.
    const sum = (k: TxKind) =>
      round2(list.filter((t) => t.kind === k && countsInBudget(t, off)).reduce((s, t) => s + ownAmount(t) * txRate(t, rate), 0));
    return { expense: sum('expense'), income: sum('income'), saving: sum('saving') };
  }, [list, rate, off]);

  return (
    <div className="page">
      <PageHeader title="Movimientos" subtitle="Lo que entró, salió y ahorraste, día a día" />
      {tag ? (
        <div className="tag-banner">
          <span>
            <strong>#{tag}</strong> · todas las fechas
          </span>
          <button
            className="link"
            onClick={() => {
              setTag('');
              if (qTag) navigate('/movimientos', { replace: true });
            }}
          >
            Sacar filtro
          </button>
        </div>
      ) : (
        <MonthPicker
          month={month}
          onChange={(m) => {
            setDay(null);
            navigate(`/movimientos/${m}`, { replace: true });
          }}
        />
      )}

      <div className="filters">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" aria-label="Buscar movimientos" />
        </div>
        <Chips
          label="Filtrar por tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: null, label: 'Todos' },
            { value: 'expense', label: 'Gastos' },
            { value: 'income', label: 'Ingresos' },
            { value: 'saving', label: 'Ahorro' },
            { value: 'transfer', label: 'Transferencias' },
          ]}
        />
        <div className="filter-selects">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrar por categoría">
            <option value="">Todas las categorías</option>
            {sortedCategories(data.categories).map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '\u00a0\u00a0\u00a0↳ ' : ''}
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Filtrar por cuenta">
            <option value="">Todas las cuentas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
          {knownTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filtrar por etiqueta">
              <option value="">Todas las etiquetas</option>
              {knownTags.map((x) => (
                <option key={x} value={x}>
                  #{x}
                </option>
              ))}
            </select>
          )}
        </div>
        {!tag && (
          <Segmented
            label="Vista"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'Lista' },
              { value: 'calendar', label: 'Calendario' },
            ]}
          />
        )}
      </div>

      {view === 'calendar' && !tag && (
        <Calendar
          month={month}
          today={today}
          transactions={data.transactions.filter(
            (t) =>
              monthOf(t.date) === month &&
              (!kind || t.kind === kind) &&
              (!family || family.has(t.categoryId ?? '')) &&
              (!accountId || t.accountId === accountId),
          )}
          selected={day}
          onSelect={(d) => setDay(d === day ? null : d)}
        />
      )}
      {day && (
        <div className="tag-banner">
          <span>
            <strong>{dayLabel(day, today, true)}</strong>
          </span>
          <button className="link" onClick={() => setDay(null)}>
            Ver todo el mes
          </button>
        </div>
      )}

      <div className="totals-row">
        <span>
          Gastos <strong className="text-expense">{money(totals.expense)}</strong>
        </span>
        <span>
          Ingresos <strong className="text-income">{money(totals.income)}</strong>
        </span>
        <span>
          Ahorro <strong>{money(totals.saving)}</strong>
        </span>
      </div>
      <p className="muted small">
        Las compras en cuotas aparecen el día de la compra; en el presupuesto cuenta cada cuota en su mes. Los totales no incluyen
        transferencias ni la tarjeta de alimentación.
      </p>

      {groups.length === 0 ? (
        <Empty icon="list" title="No hay movimientos">
          {query || kind || categoryId || accountId || tag || day ? 'Probá con otro filtro.' : 'Tocá + para cargar uno.'}
        </Empty>
      ) : (
        groups.map(([date, txs]) => {
          const dayTotal = round2(
            txs
              .filter((t) => t.kind === 'expense' && countsInBudget(t, off))
              .reduce((s, t) => s + ownAmount(t) * txRate(t, rate), 0),
          );
          return (
            <section key={date} className="day-group">
              <div className="day-head">
                <span>{dayLabel(date, today)}</span>
                {dayTotal !== 0 && <span className="muted">{dayTotal > 0 ? `−${money(dayTotal)}` : `+${money(-dayTotal)}`}</span>}
              </div>
              <div className="card list">
                {txs.map((t) => (
                  <TxRow key={t.id} tx={t} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Monto cortito para el calendario: 850, 1,2k, 15k. */
function short(v: number): string {
  if (isPrivate()) return '•••';
  if (v < 1000) return String(Math.round(v));
  return `${(v / 1000).toLocaleString('es-UY', { maximumFractionDigits: v < 10000 ? 1 : 0 })}k`;
}

/** El mes en una grilla: cuánto gastaste cada día (lo que cuenta en el presupuesto) y qué vence. */
function Calendar({
  month,
  today,
  transactions,
  selected,
  onSelect,
}: {
  month: string;
  today: string;
  transactions: Transaction[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const data = useData();
  const off = useMemo(() => offBudgetAccounts(data), [data]);
  const rate = data.settings.usdRate;
  const dim = daysInMonth(month);
  const spent = new Map<number, number>();
  const income = new Set<number>();
  for (const t of transactions) {
    const d = Number(t.date.slice(8));
    if (t.kind === 'expense' && countsInBudget(t, off)) spent.set(d, (spent.get(d) ?? 0) + ownAmount(t) * txRate(t, rate));
    if (t.kind === 'income' && countsInBudget(t, off)) income.add(d);
  }
  const due = new Map<number, string[]>();
  for (const f of data.fixed) {
    if (!f.dayOfMonth || !occursIn(month, f.startMonth, f.endMonth, f.everyMonths ?? 1)) continue;
    const d = Math.min(f.dayOfMonth, dim);
    due.set(d, [...(due.get(d) ?? []), f.name]);
  }
  const max = Math.max(1, ...spent.values());
  // Lunes primero.
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [...Array(offset).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  return (
    <div className="card calendar" role="grid" aria-label="Gastos de cada día del mes">
      {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
        <span key={i} className="cal-head" aria-hidden="true">
          {d}
        </span>
      ))}
      {cells.map((d, i) => {
        if (d === null) return <span key={`e${i}`} />;
        const date = `${month}-${String(d).padStart(2, '0')}`;
        const v = spent.get(d) ?? 0;
        const label = [
          dayLabel(date, today, true),
          v > 0 ? `gastaste ${money(Math.round(v))}` : date <= today ? 'sin gastos' : null,
          due.get(d)?.length ? `vence ${due.get(d)!.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <button
            key={date}
            className={`cal-day ${date === today ? 'today' : ''} ${selected === date ? 'on' : ''} ${date > today ? 'future' : ''}`}
            style={{ '--heat': v > 0 ? 0.12 + 0.55 * (v / max) : 0 } as React.CSSProperties}
            onClick={() => onSelect(date)}
            aria-label={label}
            aria-pressed={selected === date}
          >
            <span className="cal-num">{d}</span>
            {v > 0 ? (
              <span className="cal-amount">{short(v)}</span>
            ) : date <= today ? (
              <span className="cal-zero" aria-hidden="true">
                ✓
              </span>
            ) : null}
            <span className="cal-marks" aria-hidden="true">
              {due.has(d) && <i className="mark-due" />}
              {income.has(d) && <i className="mark-income" />}
            </span>
          </button>
        );
      })}
      <p className="cal-legend muted small">
        <i className="mark-due" /> vence un fijo <i className="mark-income" /> entró plata ✓ día sin gastar
      </p>
    </div>
  );
}
