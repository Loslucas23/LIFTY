import { useMemo, useState } from 'react';
import { monthOf, round2, txToUYU, type TxKind } from '@lifty/core';
import { Icon } from '../components/Icon';
import { TxRow } from '../components/TxRow';
import { Chips, Empty, MonthPicker, PageHeader } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { navigate } from '../lib/router';
import { useData, useLookups, useToday } from '../lib/store';

export function Movements({ month: monthParam }: { month?: string }) {
  const data = useData();
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const { category, account } = useLookups();
  const [kind, setKind] = useState<TxKind | null>(null);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (monthOf(t.date) !== month) return false;
      if (kind && t.kind !== kind) return false;
      if (!q) return true;
      const hay = [t.description, category.get(t.categoryId ?? '')?.name, account.get(t.accountId ?? '')?.name, String(t.amount)]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, month, kind, query, category, account]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof list>();
    for (const t of list) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()];
  }, [list]);

  const rate = data.settings.usdRate;
  const totals = useMemo(() => {
    const sum = (k: TxKind) => round2(list.filter((t) => t.kind === k).reduce((s, t) => s + txToUYU(t, rate), 0));
    return { expense: sum('expense'), income: sum('income'), saving: sum('saving') };
  }, [list, rate]);

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
          ]}
        />
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
        Las compras en cuotas aparecen el día de la compra; en el presupuesto cuenta cada cuota en su mes.
      </p>

      {groups.length === 0 ? (
        <Empty icon="list" title="No hay movimientos">
          {query || kind ? 'Probá con otro filtro.' : 'Tocá + para cargar uno.'}
        </Empty>
      ) : (
        groups.map(([date, txs]) => {
          const dayTotal = round2(txs.filter((t) => t.kind === 'expense').reduce((s, t) => s + txToUYU(t, rate), 0));
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
