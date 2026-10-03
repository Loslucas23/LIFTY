import { useMemo, useState } from 'react';
import { countsInBudget, monthOf, offBudgetAccounts, ownAmount, round2, txRate, type TxKind } from '@lifty/core';
import { Icon } from '../components/Icon';
import { TxRow } from '../components/TxRow';
import { Chips, Empty, MonthPicker, PageHeader } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { navigate, useQuery } from '../lib/router';
import { useData, useLookups, useToday } from '../lib/store';

export function Movements({ month: monthParam }: { month?: string }) {
  const data = useData();
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const { category, account } = useLookups();
  const params = useQuery();
  const [kind, setKind] = useState<TxKind | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>(params.get('categoria') ?? '');
  const [accountId, setAccountId] = useState<string>(params.get('cuenta') ?? '');
  const off = useMemo(() => offBudgetAccounts(data), [data]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (monthOf(t.date) !== month) return false;
      if (kind && t.kind !== kind) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (!q) return true;
      const hay = [t.description, category.get(t.categoryId ?? '')?.name, account.get(t.accountId ?? '')?.name, String(t.amount)]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, month, kind, query, category, account, categoryId, accountId]);

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
      <MonthPicker month={month} onChange={(m) => navigate(`/movimientos/${m}`, { replace: true })} />

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
        <div className="row">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filtrar por categoría">
            <option value="">Todas las categorías</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
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
        </div>
      </div>

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
          {query || kind || categoryId || accountId ? 'Probá con otro filtro.' : 'Tocá + para cargar uno.'}
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
