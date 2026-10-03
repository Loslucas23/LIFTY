import { useState } from 'react';
import { monthLabel, monthOf, addMonths, type MonthBudget, type TxLine } from '@lifty/core';
import { PlannedList } from '../components/Planned';
import { openTxForm } from '../components/TxForm';
import { Empty, Field, MonthPicker, PageHeader, Progress, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { confirmAll } from '../lib/actions';
import { navigate } from '../lib/router';
import { useData, useLookups, useMonth, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

export function Budget({ month: monthParam }: { month?: string }) {
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const b = useMonth(month);
  const data = useData();
  const [closing, setClosing] = useState(false);
  const paid = b.fixed.items.filter((l) => l.confirmed).length;

  return (
    <div className="page">
      <PageHeader title="Presupuesto" subtitle="Lo planificado y lo real de cada mes" />
      <MonthPicker month={month} onChange={(m) => navigate(`/presupuesto/${m}`, { replace: true })} />

      <div className="budget-grid">
        <div>
          <Receipt b={b} onClose={() => setClosing(true)} />
        </div>
        <div>
          <Section
            title="Ingresos"
            action={b.income.pending > 0 && <span className="muted small">Falta cobrar {money(b.income.pending)}</span>}
          >
            {b.income.planned.length > 0 && <PlannedList lines={b.income.planned} month={month} />}
            {b.income.extras.length > 0 && (
              <div className="card list">
                {b.income.extras.map((l) => (
                  <LineRow key={`${l.txId}`} line={l} sign="+" />
                ))}
              </div>
            )}
            {b.income.planned.length === 0 && b.income.extras.length === 0 && (
              <Empty icon="wallet" title="Sin ingresos este mes">
                <a className="btn" href="#/sueldos">
                  Cargar un sueldo
                </a>
              </Empty>
            )}
          </Section>

          <Section
            title="Gastos fijos"
            action={
              b.fixed.items.length > 0 && (
                <span className="muted small">
                  {paid} de {b.fixed.items.length} pagos{b.fixed.pending > 0 && ` · faltan ${money(b.fixed.pending)}`}
                  {b.fixed.pending > 0 && (
                    <>
                      {' · '}
                      <button className="link small" onClick={() => confirmAll(data, b.fixed.items, month)}>
                        Tildar todos
                      </button>
                    </>
                  )}
                </span>
              )
            }
          >
            {b.fixed.items.length ? (
              <PlannedList lines={b.fixed.items} month={month} />
            ) : (
              <Empty icon="repeat" title="Sin gastos fijos">
                <a className="btn" href="#/fijos">
                  Agregar gastos fijos
                </a>
              </Empty>
            )}
          </Section>

          {b.card.items.length > 0 && (
            <Section title="Tarjeta de crédito" action={<span className="muted small">{money(b.card.total)}</span>}>
              <div className="card list">
                {b.card.items.map((l) => (
                  <LineRow key={`${l.txId}-${l.installment?.number ?? 1}`} line={l} sign="−" />
                ))}
              </div>
            </Section>
          )}

          <CategorySpend b={b} />

          {b.variable.items.length > 0 && (
            <Section title="Gastos del día a día" action={<span className="muted small">{money(b.variable.total)}</span>}>
              <div className="card list">
                {b.variable.items.map((l) => (
                  <LineRow key={`${l.txId}-${l.installment?.number ?? 1}`} line={l} sign="−" />
                ))}
              </div>
            </Section>
          )}

          {b.savings.items.length > 0 && (
            <Section title="Ahorro" action={<span className="muted small">{money(b.savings.total)}</span>}>
              <div className="card list">
                {b.savings.items.map((l) => (
                  <LineRow key={l.txId} line={l} sign="" />
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {closing && <CloseMonth b={b} onClose={() => setClosing(false)} />}
    </div>
  );
}

const CARRY_LABEL: Record<MonthBudget['carryover']['source'], string> = {
  real: 'real, mes cerrado',
  projected: 'proyectado',
  start: 'saldo inicial',
  none: '',
};

function Receipt({ b, onClose }: { b: MonthBudget; onClose: () => void }) {
  const data = useData();
  const rows: [string, number, string?][] = [];
  if (b.carryover.source !== 'none')
    rows.push([
      b.carryover.fromMonth ? `Viene de ${monthLabel(b.carryover.fromMonth, false).toLowerCase()}` : 'Saldo inicial',
      b.carryover.amount,
      CARRY_LABEL[b.carryover.source],
    ]);
  rows.push(['Ingresos', b.income.total]);
  rows.push(['Gastos fijos', -b.fixed.total]);
  rows.push(['Día a día', -b.variable.total]);
  rows.push(['Tarjeta', -b.card.total]);
  rows.push(['Ahorro', -b.savings.total]);
  const diff = b.closing ? b.closing.realBalance - b.result : 0;

  return (
    <section className="card receipt">
      <h2>{monthLabel(b.month)}</h2>
      <dl>
        {rows.map(([label, value, note]) => (
          <div key={label} className="receipt-row">
            <dt>
              {label}
              {note && <small> · {note}</small>}
            </dt>
            <dd className={value < 0 ? 'text-expense' : value > 0 ? 'text-income' : 'muted'}>
              {value > 0 ? '+' : value < 0 ? '−' : ''}
              {money(Math.abs(value))}
            </dd>
          </div>
        ))}
        <div className="receipt-row receipt-total">
          <dt>{b.closing ? 'Proyectado' : 'Te queda (proyectado)'}</dt>
          <dd className={b.result < 0 ? 'text-bad' : ''}>{money(b.result)}</dd>
        </div>
        {b.closing && (
          <>
            <div className="receipt-row receipt-total">
              <dt>Real al cierre</dt>
              <dd>{money(b.closing.realBalance)}</dd>
            </div>
            <div className="receipt-row">
              <dt>Diferencia</dt>
              <dd className={diff < 0 ? 'text-expense' : 'text-income'}>
                {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                {money(Math.abs(diff))}
              </dd>
            </div>
          </>
        )}
      </dl>
      {b.closing ? (
        <div className="btn-row">
          <span className="pill pill-ok">Mes cerrado</span>
          <button className="btn btn-ghost" onClick={onClose}>
            Editar cierre
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const prev = b.closing!;
              mutate('closing', 'delete', prev.id);
              toast('Mes reabierto', { action: { label: 'Deshacer', run: () => mutate('closing', 'upsert', prev) } });
            }}
          >
            Reabrir
          </button>
        </div>
      ) : (
        <>
          <p className="muted small">
            Al terminar el mes, cerralo con lo que realmente te quedó: ese saldo pasa a{' '}
            {monthLabel(addMonths(b.month, 1), false).toLowerCase()}.
          </p>
          <button className="btn grow" onClick={onClose}>
            Cerrar mes
          </button>
        </>
      )}
      {data.settings.startMonth === null && b.carryover.source === 'start' && (
        <p className="muted small">
          Lifty arranca a contar en {monthLabel(b.month)}. Podés cambiar el mes y saldo inicial en <a href="#/ajustes">Ajustes</a>
          .
        </p>
      )}
    </section>
  );
}

function CloseMonth({ b, onClose }: { b: MonthBudget; onClose: () => void }) {
  const [text, setText] = useState(String(b.closing?.realBalance ?? Math.round(b.result)).replace('.', ','));
  const [note, setNote] = useState(b.closing?.note ?? '');
  const value = parseAmount(text);
  const save = () => {
    if (value === null) return;
    mutate('closing', 'upsert', { id: b.month, updatedAt: '', realBalance: value, note });
    toast(`${monthLabel(b.month)} cerrado`);
    onClose();
  };
  return (
    <Sheet
      title={`Cerrar ${monthLabel(b.month)}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save} disabled={value === null}>
          Guardar cierre
        </button>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="muted">
          Lifty calculó que te quedaban <strong>{money(b.result)}</strong>. ¿Cuánto te quedó de verdad, sumando cuentas y
          efectivo?
        </p>
        <Field label="Saldo real" error={value === null ? 'Escribí un monto' : null}>
          <input data-autofocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Nota (opcional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej: faltó cargar la feria" />
        </Field>
      </form>
    </Sheet>
  );
}

function CategorySpend({ b }: { b: MonthBudget }) {
  const { category } = useLookups();
  const prevMonth = addMonths(b.month, -1);
  const prev = useMonths(prevMonth, prevMonth)[0];
  const prevSpent = new Map(prev.categories.map((c) => [c.categoryId, c.spent]));
  const prevName = monthLabel(prevMonth, false).toLowerCase();
  const list = b.categories.filter((c) => c.spent > 0 || c.limit);
  if (!list.length) return null;
  const max = Math.max(...list.map((c) => Math.max(c.spent, c.limit ?? 0)));
  return (
    <Section
      title="En qué se fue la plata"
      action={
        <a className="link small" href="#/categorias">
          Topes
        </a>
      }
    >
      <ul className="cat-bars card">
        {list.map((c) => {
          const cat = c.categoryId ? category.get(c.categoryId) : undefined;
          const over = c.limit !== null && c.spent > c.limit;
          return (
            <li key={c.categoryId ?? 'none'}>
              <div className="limit-head">
                <span>
                  {cat?.icon ?? '•'} {cat?.name ?? 'Sin categoría'}
                </span>
                <span className={over ? 'text-bad' : ''}>
                  {money(c.spent)}
                  {c.limit !== null && <span className="muted"> / {money(c.limit)}</span>}
                  {over && ' · pasado'}
                </span>
              </div>
              {c.limit !== null ? (
                <Progress value={c.spent} max={c.limit} label={`${cat?.name ?? 'Sin categoría'}: gastado del tope`} />
              ) : (
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(c.spent / max) * 100}%` }} />
                </div>
              )}
              <Compare now={c.spent} before={prevSpent.get(c.categoryId) ?? 0} label={prevName} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Diferencia con el mes anterior (más gasto = peor, en el color de gasto). */
function Compare({ now, before, label }: { now: number; before: number; label: string }) {
  const diff = Math.round(now - before);
  if (before === 0 || diff === 0) return null;
  return (
    <span className={`compare small ${diff > 0 ? 'text-expense' : 'text-income'}`}>
      {diff > 0 ? '▲' : '▼'} {money(Math.abs(diff))} {diff > 0 ? 'más' : 'menos'} que en {label}
    </span>
  );
}

function LineRow({ line, sign }: { line: TxLine; sign: string }) {
  const data = useData();
  const { category, account, goal } = useLookups();
  const cat = line.categoryId ? category.get(line.categoryId) : undefined;
  const g = line.goalId ? goal.get(line.goalId) : undefined;
  const meta = [
    line.date.split('-').reverse().slice(0, 2).join('/'),
    line.installment ? `cuota ${line.installment.number} de ${line.installment.of}` : null,
    line.accountId ? account.get(line.accountId)?.name : null,
    line.currency === 'USD' ? money(line.original, 'USD') : null,
  ].filter(Boolean);
  return (
    <button
      className="tx-row"
      onClick={() => {
        const tx = data.transactions.find((t) => t.id === line.txId);
        if (tx) openTxForm({ tx });
      }}
    >
      <span className="tx-icon" style={{ '--tint': (g ?? cat)?.color ?? 'var(--muted)' } as React.CSSProperties}>
        {(g ?? cat)?.icon ?? '•'}
      </span>
      <span className="tx-main">
        <span className="tx-title">{line.description || g?.name || cat?.name || 'Sin detalle'}</span>
        <span className="tx-meta">{meta.join(' · ')}</span>
      </span>
      <span className="tx-amount">
        {line.amount < 0 ? (sign === '−' ? '+' : '−') : sign}
        {money(Math.abs(line.amount))}
      </span>
    </button>
  );
}
