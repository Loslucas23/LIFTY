import { useState } from 'react';
import { isActiveIn, monthLabel, monthOf, netBreakdown, type FixedExpense, type IncomeSource } from '@lifty/core';
import { Icon } from '../components/Icon';
import { FixedForm, IncomeForm } from '../components/PlanForms';
import { Empty, PageHeader, Section } from '../components/ui';
import { money } from '../lib/format';
import { useData, useLookups, useToday } from '../lib/store';

function period(start: string, end: string | null) {
  return end ? `${monthLabel(start)} → ${monthLabel(end)}` : `Desde ${monthLabel(start)}`;
}

// =================== Sueldos ===================

export function Incomes() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const [editing, setEditing] = useState<IncomeSource | 'new' | null>(null);
  const active = data.incomes.filter((i) => isActiveIn(month, i.startMonth, i.endMonth));
  const other = data.incomes.filter((i) => !active.includes(i));

  const card = (i: IncomeSource) => {
    const b = netBreakdown(i);
    return (
      <button key={i.id} className="card item-card" onClick={() => setEditing(i)}>
        <div className="item-card-head">
          <strong>{i.name}</strong>
          <span className="amount">{money(b.net, i.currency)}</span>
        </div>
        <div className="muted small">
          {period(i.startMonth, i.endMonth)} · nominal {money(i.gross, i.currency)}
          {b.overridden ? ' · líquido manual' : ` · descuentos ${money(b.totalDeductions, i.currency)}`}
          {i.aguinaldo ? ' · con aguinaldo' : ''}
        </div>
      </button>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Sueldos"
        subtitle="Se suman solos al presupuesto de cada mes en que estén vigentes"
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      {data.incomes.length === 0 ? (
        <Empty icon="wallet" title="Cargá tu sueldo">
          Poné el nominal y Lifty calcula el líquido con los descuentos de Uruguay (los podés ajustar). En junio y diciembre suma
          el aguinaldo.
        </Empty>
      ) : (
        <>
          {active.length > 0 && <Section title="Vigentes">{active.map(card)}</Section>}
          {other.length > 0 && <Section title="Anteriores o futuros">{other.map(card)}</Section>}
        </>
      )}
      {editing && <IncomeForm income={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// =================== Gastos fijos ===================

export function FixedList() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const { category } = useLookups();
  const [editing, setEditing] = useState<FixedExpense | 'new' | null>(null);
  const active = data.fixed.filter((f) => isActiveIn(month, f.startMonth, f.endMonth));
  const other = data.fixed.filter((f) => !active.includes(f));
  const total = active.reduce((s, f) => s + (f.currency === 'USD' ? f.amount * data.settings.usdRate : f.amount), 0);

  const row = (f: FixedExpense) => {
    const cat = f.categoryId ? category.get(f.categoryId) : undefined;
    return (
      <button key={f.id} className="tx-row" onClick={() => setEditing(f)}>
        <span className="tx-icon" style={{ '--tint': cat?.color ?? 'var(--muted)' } as React.CSSProperties}>
          {cat?.icon ?? '🔁'}
        </span>
        <span className="tx-main">
          <span className="tx-title">{f.name}</span>
          <span className="tx-meta">
            {[f.dayOfMonth ? `día ${f.dayOfMonth}` : null, period(f.startMonth, f.endMonth)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="tx-amount">{money(f.amount, f.currency)}</span>
      </button>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Gastos fijos"
        subtitle={active.length ? `${money(total)} por mes ahora` : 'Lo que pagás todos los meses'}
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      {data.fixed.length === 0 ? (
        <Empty icon="repeat" title="Sin gastos fijos">
          Alquiler, internet, gimnasio, el STM… se descuentan solos del presupuesto y cada mes los vas tildando a medida que los
          pagás.
        </Empty>
      ) : (
        <>
          {active.length > 0 && (
            <Section title="Vigentes">
              <div className="card list">{active.map(row)}</div>
            </Section>
          )}
          {other.length > 0 && (
            <Section title="Terminados o futuros">
              <div className="card list">{other.map(row)}</div>
            </Section>
          )}
        </>
      )}
      {editing && <FixedForm fixed={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
