import { useState } from 'react';
import {
  accountBalances,
  addMonths,
  budgetId,
  budgetReview,
  monthPlanProposal,
  daysInMonth,
  moneyCheck,
  monthLabel,
  monthOf,
  type MonthBudget,
  type TxLine,
} from '@lifty/core';
import { openBudgetEditor, openBudgetWizard, openExplain, openFixedForm, openIncomeForm } from '../components/Editors';
import { Icon } from '../components/Icon';
import { PlannedList } from '../components/Planned';
import { openSetup } from '../components/Setup';
import { openTxForm } from '../components/TxForm';
import { Empty, Field, MonthPicker, PageHeader, Progress, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { confirmAll, setCategoryBudget } from '../lib/actions';
import { navigate } from '../lib/router';
import { useData, useLookups, useMonth, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { local } from '../lib/local';

export function Budget({ month: monthParam }: { month?: string }) {
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const b = useMonth(month);
  const data = useData();
  const [closing, setClosing] = useState(false);
  const paid = b.fixed.items.filter((l) => l.confirmed).length;
  const monthName = monthLabel(month, false).toLowerCase();
  const empty =
    b.income.planned.length === 0 && b.income.extras.length === 0 && b.fixed.items.length === 0 && b.plan.assigned === 0;
  const add = (label: string, run: () => void) => (
    <button className="chip chip-add" onClick={run}>
      <Icon name="plus" size={16} /> {label}
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Presupuesto"
        subtitle="Armalo una vez y ajustalo cuando quieras: todo se edita acá"
        actions={
          <button className="btn btn-primary" onClick={() => openBudgetWizard(month)}>
            <Icon name="edit" /> Armar presupuesto
          </button>
        }
      />
      <MonthPicker month={month} onChange={(m) => navigate(`/presupuesto/${m}`, { replace: true })} />

      {empty && (
        <section className="card pad cta">
          <h2>Armá el presupuesto de {monthName}</h2>
          <p className="muted">
            En 3 pasos: cuánto cobrás, qué pagás todos los meses y cuánto querés gastar en cada cosa. Después Lifty te va diciendo
            cuánto te queda.
          </p>
          <button className="btn btn-primary" onClick={() => openBudgetWizard(month)}>
            Empezar
          </button>
        </section>
      )}

      <div className="budget-grid">
        <div>
          <PlanCard b={b} />
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
            <div className="chips">
              {add('Sueldo', () => openIncomeForm(null, month))}
              {add('Otro ingreso este mes', () => openTxForm({ preset: { kind: 'income', date: dateIn(month, today) } }))}
            </div>
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
            {b.fixed.items.length > 0 ? (
              <>
                <PlannedList lines={b.fixed.items} month={month} />
                <p className="muted small">Tocá un gasto para editarlo o darlo de baja ("Ya no lo pago").</p>
              </>
            ) : (
              <p className="muted small">Alquiler, internet, celular, gimnasio… lo que pagás todos los meses.</p>
            )}
            <div className="chips">{add('Gasto fijo', () => openFixedForm(null, month))}</div>
          </Section>

          <PlanProposalCard month={month} />
          <CategoryBudgets b={b} month={month} />
          {month === monthOf(today) && <BudgetReview month={month} />}

          {b.card.items.length > 0 && (
            <Section title="Tarjeta de crédito" action={<span className="muted small">{money(b.card.total)}</span>}>
              <div className="card list">
                {b.card.items.map((l) => (
                  <LineRow key={`${l.txId}-${l.installment?.number ?? 1}`} line={l} sign="−" />
                ))}
              </div>
            </Section>
          )}

          <Section title="Gastos del día a día" action={<span className="muted small">{money(b.variable.total)}</span>}>
            {b.variable.items.length > 0 && (
              <div className="card list">
                {b.variable.items.map((l) => (
                  <LineRow key={`${l.txId}-${l.installment?.number ?? 1}`} line={l} sign="−" />
                ))}
              </div>
            )}
            <div className="chips">
              {add('Gasto', () => openTxForm({ preset: { kind: 'expense', date: dateIn(month, today) } }))}
            </div>
          </Section>

          <Section title="Ahorro" action={<span className="muted small">{money(b.savings.total)}</span>}>
            {b.savings.items.length > 0 && (
              <div className="card list">
                {b.savings.items.map((l) => (
                  <LineRow key={l.txId} line={l} sign="" />
                ))}
              </div>
            )}
            <div className="chips">
              {add('Ahorro', () => openTxForm({ preset: { kind: 'saving', date: dateIn(month, today) } }))}
            </div>
          </Section>
        </div>
      </div>

      {closing && <CloseMonth b={b} onClose={() => setClosing(false)} />}
    </div>
  );
}

/** Fecha para cargar algo en `month`: hoy si es el mes en curso, si no el día 1. */
function dateIn(month: string, today: string): string {
  return monthOf(today) === month ? today : `${month}-01`;
}

/** El plan: lo que entra, lo comprometido, lo repartido y lo que queda sin asignar. */
function PlanCard({ b }: { b: MonthBudget }) {
  const reserve = b.savingsGoal.reserve;
  const available = b.carryover.amount + b.income.total - b.fixed.total - reserve;
  const spentBudgeted = b.categories.filter((c) => c.limit !== null).reduce((s, c) => s + c.spent, 0);
  const explain = () =>
    openExplain({
      title: '¿De dónde sale "sin asignar"?',
      intro: 'Es lo que te queda libre después de los gastos fijos, el ahorro y lo que repartiste en las categorías.',
      rows: [
        ...(b.carryover.amount ? [{ label: 'Viene del mes anterior', value: b.carryover.amount }] : []),
        { label: 'Ingresos del mes', value: b.income.total, op: '+' as const },
        { label: 'Gastos fijos', value: b.fixed.total, op: '−' as const },
        {
          label: 'Ahorro',
          value: reserve,
          op: '−' as const,
          note:
            b.savingsGoal.target > 0
              ? `meta ${money(b.savingsGoal.target)}, ahorrado ${money(b.savingsGoal.saved)}`
              : 'lo ahorrado',
        },
        { label: 'Presupuesto por categoría', value: b.plan.assigned, op: '−' as const },
        { label: 'Gastado sin presupuesto', value: b.plan.unbudgeted, op: '−' as const },
      ],
      result: { label: b.plan.unassigned < 0 ? 'Te pasaste' : 'Sin asignar', value: b.plan.unassigned },
      footnote: `Si cumplís el presupuesto terminás el mes con ${money(b.plan.projected)} (lo de arriba menos lo que te falta gastar de cada categoría y lo que falta ahorrar).`,
    });
  return (
    <section className="card plan-card">
      <h2>Plan del mes</h2>
      <dl className="explainable-list" onClick={explain}>
        <div className="receipt-row">
          <dt>
            Para gastar <small>· ingresos − fijos − ahorro</small>
          </dt>
          <dd>{money(available)}</dd>
        </div>
        {b.savingsGoal.target > 0 && (
          <div className="receipt-row">
            <dt>
              Meta de ahorro <small>· {b.savingsGoal.pending > 0 ? `faltan ${money(b.savingsGoal.pending)}` : 'cumplida'}</small>
            </dt>
            <dd>{money(b.savingsGoal.target)}</dd>
          </div>
        )}
        <div className="receipt-row">
          <dt>Presupuesto por categoría</dt>
          <dd>{money(b.plan.assigned)}</dd>
        </div>
        {b.plan.unbudgeted > 0 && (
          <div className="receipt-row">
            <dt>Gastado sin presupuesto</dt>
            <dd>{money(b.plan.unbudgeted)}</dd>
          </div>
        )}
        <div className="receipt-row receipt-total">
          <dt className="explainable">{b.plan.unassigned < 0 ? 'Te pasaste' : 'Sin asignar'}</dt>
          <dd className={b.plan.unassigned < 0 ? 'text-bad' : 'text-income'}>{money(Math.abs(b.plan.unassigned))}</dd>
        </div>
      </dl>
      {b.plan.assigned > 0 && (
        <>
          <Progress value={spentBudgeted} max={b.plan.assigned} label="Gastado del presupuesto" />
          <p className="muted small">
            Gastaste {money(spentBudgeted)} de {money(b.plan.assigned)}. Si cumplís el presupuesto terminás el mes con{' '}
            <strong>{money(b.plan.projected)}</strong>.
          </p>
        </>
      )}
      {b.plan.unassigned < 0 && (
        <p className="text-bad small">Estás planeando gastar más de lo que entra: bajá algún presupuesto.</p>
      )}
      <p className="muted small">Tocá los números para ver de dónde salen.</p>
    </section>
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
  const today = useToday();
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
        <div
          className="receipt-row receipt-total"
          onClick={() =>
            openExplain({
              title: '¿De dónde sale lo proyectado?',
              rows: rows.map(([label, value]) => ({
                label,
                value: Math.abs(value),
                op: value < 0 ? ('−' as const) : ('+' as const),
              })),
              result: { label: 'Te queda al final del mes', value: b.result },
              footnote:
                'Los sueldos y gastos fijos que no tildaste cuentan con lo planificado. Al cerrar el mes con el saldo real, ese número reemplaza al proyectado.',
            })
          }
        >
          <dt className="explainable">{b.closing ? 'Proyectado' : 'Te queda (proyectado)'}</dt>
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
      {b.carryover.source === 'projected' && b.month === monthOf(today) && (
        <p className="note small">
          Lo que viene de {monthLabel(b.carryover.fromMonth ?? addMonths(b.month, -1), false).toLowerCase()} es una{' '}
          <strong>estimación</strong> (ese mes no está cerrado): suma lo planificado aunque no lo hayas tildado. Para que sea
          real,{' '}
          <button className="link" onClick={() => openSetup()}>
            poné a punto tus saldos de hoy
          </button>
          .
        </p>
      )}
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
  const data = useData();
  const today = useToday();
  const monthEnd = `${b.month}-${String(daysInMonth(b.month)).padStart(2, '0')}`;
  const balances = accountBalances(data, monthEnd < today ? monthEnd : today).filter(
    (x) => (x.account.type === 'bank' || x.account.type === 'cash') && !x.account.archived,
  );
  // Lo disponible según tus cuentas al terminar el mes: sin el ahorro apartado ni lo que debés de la tarjeta.
  const fromAccounts = Math.round(moneyCheck(data, monthEnd < today ? monthEnd : today, b).available);
  const accountsSet = balances.some((x) => x.balance !== 0);
  const [text, setText] = useState(String(b.closing?.realBalance ?? Math.round(b.result)).replace('.', ','));
  const [note, setNote] = useState(b.closing?.note ?? '');
  const value = parseAmount(text);
  const pending = [...b.fixed.items, ...b.income.planned].filter((l) => !l.confirmed);
  const diff = value === null ? 0 : value - b.result;
  const save = () => {
    if (value === null) return;
    mutate('closing', 'upsert', { id: b.month, updatedAt: '', realBalance: value, note });
    toast(`${monthLabel(b.month)} cerrado: pasan ${money(value)} a ${monthLabel(addMonths(b.month, 1), false).toLowerCase()}`);
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
        {pending.length > 0 && (
          <div className="note">
            <p>
              <strong>1.</strong> Quedaron {pending.length} cosas sin tildar (
              {pending
                .map((l) => l.name)
                .slice(0, 3)
                .join(', ')}
              {pending.length > 3 ? '…' : ''}).
            </p>
            <button type="button" className="link small" onClick={() => confirmAll(data, pending, b.month)}>
              Tildar todas como pagadas/cobradas
            </button>
          </div>
        )}
        <p className="muted">
          <strong>{pending.length > 0 ? '2. ' : ''}</strong>Lifty calculó que te quedaban <strong>{money(b.result)}</strong>.
          ¿Cuánto te quedó de verdad, sumando cuentas y efectivo?
        </p>
        {accountsSet && (
          <button type="button" className="chip chip-add" onClick={() => setText(String(fromAccounts))}>
            Usar lo que dicen tus cuentas: {money(fromAccounts)}
          </button>
        )}
        <Field label="Saldo real" error={value === null ? 'Escribí un monto' : null}>
          <input data-autofocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {value !== null && Math.abs(diff) >= 1 && (
          <p className={`note ${diff < 0 ? 'note-bad' : 'note-good'}`}>
            {diff < 0
              ? `Te quedó ${money(-diff)} menos de lo calculado: puede haber gastos sin cargar.`
              : `Te quedó ${money(diff)} más de lo calculado.`}{' '}
            El mes que viene arranca con {money(value)}.
          </p>
        )}
        <Field label="Nota (opcional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej: faltó cargar la feria" />
        </Field>
      </form>
    </Sheet>
  );
}

/** Presupuesto por categoría: cuánto te queda en cada cosa. Tocá una para cambiarlo. */
function CategoryBudgets({ b, month }: { b: MonthBudget; month: string }) {
  const data = useData();
  const [showAll, setShowAll] = useState(false);
  const prevMonth = addMonths(month, -1);
  const prev = useMonths(prevMonth, prevMonth)[0];
  const prevSpent = new Map(prev.categories.map((c) => [c.categoryId, c.spent]));
  const prevName = monthLabel(prevMonth, false).toLowerCase();
  const info = new Map(b.categories.map((c) => [c.categoryId, c]));
  // Solo las de arriba: lo de cada subcategoría suma a su categoría (y se ve el detalle abajo).
  const catIds = new Set(data.categories.map((c) => c.id));
  const cats = data.categories.filter((c) => c.kind === 'expense' && !c.archived && !(c.parentId && catIds.has(c.parentId)));
  const subName = new Map(data.categories.map((c) => [c.id, `${c.icon} ${c.name}`]));
  const budgeted = cats.filter((c) => info.get(c.id)?.limit != null);
  const spentOnly = cats.filter((c) => info.get(c.id)?.limit == null && (info.get(c.id)?.spent ?? 0) !== 0);
  const rest = cats.filter((c) => !budgeted.includes(c) && !spentOnly.includes(c));
  const uncategorized = info.get(null);

  const row = (c: (typeof cats)[number]) => {
    const x = info.get(c.id);
    const spent = x?.spent ?? 0;
    const limit = x?.limit ?? null;
    const remaining = x?.remaining ?? null;
    return (
      <li key={c.id}>
        <button className="cat-row" onClick={() => openBudgetEditor(month, c.id)}>
          <div className="limit-head">
            <span>
              {c.icon} {c.name}
              {x?.limitSource === 'month' && <span className="tag">solo este mes</span>}
            </span>
            {limit === null ? (
              <span className="muted">{spent ? `${money(spent)} · sin presupuesto` : 'Asignar'}</span>
            ) : remaining !== null && remaining < 0 ? (
              <span className="text-bad">
                Te pasaste {money(-remaining)} <span className="muted">de {money(limit)}</span>
              </span>
            ) : (
              <span>
                Te quedan <strong>{money(remaining ?? 0)}</strong> <span className="muted">de {money(limit)}</span>
              </span>
            )}
          </div>
          {limit !== null && <Progress value={spent} max={limit} label={`${c.name}: gastado del presupuesto`} />}
          <Compare now={spent} before={prevSpent.get(c.id) ?? 0} label={prevName} />
          {x?.fixed ? <span className="compare small muted">+ {money(x.fixed)} en gastos fijos</span> : null}
          {x?.carry ? (
            <span className="compare small muted">Incluye {money(x.carry)} que no gastaste antes (se acumula)</span>
          ) : null}
          {x?.subs && x.subs.length > 0 && (
            <span className="cat-subs small muted">
              {x.subs.map((s) => (
                <span key={s.categoryId}>
                  {subName.get(s.categoryId) ?? '?'} {money(s.spent)}
                </span>
              ))}
              {spent - x.subs.reduce((t, s) => t + s.spent, 0) > 0.5 && (
                <span>General {money(spent - x.subs.reduce((t, s) => t + s.spent, 0))}</span>
              )}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <Section
      title="Presupuesto por categoría"
      action={
        <button className="link small" onClick={() => openBudgetWizard(month)}>
          Repartir todo
        </button>
      }
    >
      <ul className="cat-bars card">
        {budgeted.map(row)}
        {spentOnly.map(row)}
        {uncategorized && uncategorized.spent !== 0 && (
          <li>
            <div className="limit-head">
              <span>• Sin categoría</span>
              <span className="muted">{money(uncategorized.spent)}</span>
            </div>
          </li>
        )}
        {showAll && rest.map(row)}
        {budgeted.length === 0 && spentOnly.length === 0 && !showAll && (
          <li className="muted small">
            Todavía no pusiste presupuestos. Tocá una categoría para decir cuánto querés gastar por mes.
          </li>
        )}
      </ul>
      {rest.length > 0 && (
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Ver menos' : `Ver todas las categorías (${rest.length} más)`}
          </button>
          <a className="btn btn-ghost" href="#/categorias">
            Nueva categoría
          </a>
        </div>
      )}
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

/**
 * Revisión del presupuesto: mira los últimos 3 meses. Si en una categoría te pasás siempre, el
 * número no es realista; si siempre sobra mucho, esa plata podría ir al ahorro.
 */
function BudgetReview({ month }: { month: string }) {
  const data = useData();
  const months = useMonths(addMonths(month, -3), month);
  const { category } = useLookups();
  const advice = budgetReview(data, months);
  if (!advice.length) return null;
  const freed = advice.filter((a) => a.kind === 'lower').reduce((s, a) => s + a.current - a.suggested, 0);
  return (
    <Section title="Revisión del presupuesto">
      <p className="muted small">
        Según los últimos 3 meses.
        {freed > 0 && ` Ajustando lo que sobra liberás ${money(freed)} por mes para ahorrar.`}
      </p>
      <ul className="insights">
        {advice.map((a) => {
          const cat = category.get(a.categoryId);
          const name = cat?.name ?? 'Categoría';
          return (
            <li key={a.categoryId}>
              <div className={`insight insight-${a.kind === 'raise' ? 'warn' : 'good'}`}>
                <span aria-hidden="true">{cat?.icon ?? '📊'}</span>
                <button
                  className="grow link-plain"
                  onClick={() =>
                    openExplain({
                      title: `${name}: últimos 3 meses`,
                      intro:
                        a.kind === 'raise'
                          ? 'Te pasaste los 3 meses: se sugiere lo que gastás normalmente (la mediana, redondeada a 100).'
                          : 'Los 3 meses usaste menos del 70%: se sugiere lo máximo que gastaste + 10%, redondeado a 100.',
                      rows: a.months.map((m) => ({
                        label: `${monthLabel(m.month, false)} (presupuesto ${money(m.limit)})`,
                        value: m.spent,
                      })),
                      result: { label: 'Sugerido', value: a.suggested },
                    })
                  }
                >
                  {a.kind === 'raise'
                    ? `${name}: te pasás todos los meses. ¿Lo subís de ${money(a.current)} a ${money(a.suggested)}?`
                    : `${name}: siempre te sobra. ¿Lo bajás de ${money(a.current)} a ${money(a.suggested)}?`}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setCategoryBudget(data, month, a.categoryId, a.suggested, 'all');
                    toast(`${name}: ${money(a.suggested)} por mes`, {
                      action: { label: 'Deshacer', run: () => setCategoryBudget(data, month, a.categoryId, a.current, 'all') },
                    });
                  }}
                >
                  Aplicar
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/**
 * Plan del mes con un toque: propone el presupuesto de cada categoría según lo que gastás
 * normalmente. Aparece al empezar el mes (o si todavía no tenés presupuesto), para este mes o el
 * que viene.
 */
function PlanProposalCard({ month }: { month: string }) {
  const data = useData();
  const today = useToday();
  const { category } = useLookups();
  const months = useMonths(addMonths(month, -3), month);
  const key = `lifty-plan-${month}`;
  const [dismissed, setDismissed] = useState(local.get(key) === '1');
  const current = monthOf(today);
  const day = Number(today.slice(8));
  const relevant = (month === current && day <= 10) || (month === addMonths(current, 1) && day >= 20);
  const p = monthPlanProposal(data, months.slice(0, -1), months[months.length - 1]);
  const noBudget = !data.categories.some((c) => c.monthlyLimit) && !data.budgets.some((x) => x.month === month);
  if (dismissed || !p || !(relevant || noBudget)) return null;
  // Si ya es lo que tenés, no hace falta proponerlo.
  if (p.lines.every((l) => l.current === l.suggested)) return null;
  const name = monthLabel(month, false).toLowerCase();
  const apply = () => {
    const before = p.lines.map((l) => ({
      id: l.categoryId,
      budget: data.budgets.find((x) => x.month === month && x.categoryId === l.categoryId),
    }));
    for (const l of p.lines) setCategoryBudget(data, month, l.categoryId, l.suggested, 'month');
    local.set(key, '1');
    setDismissed(true);
    toast(`Plan de ${name} aplicado`, {
      action: {
        label: 'Deshacer',
        run: () =>
          before.forEach((x) =>
            x.budget ? mutate('budget', 'upsert', x.budget) : mutate('budget', 'delete', budgetId(month, x.id)),
          ),
      },
    });
  };
  return (
    <section className="card pad plan-proposal">
      <div className="limit-head">
        <strong>✨ Plan de {name}, listo para aplicar</strong>
        <button
          className="link small"
          onClick={() => {
            local.set(key, '1');
            setDismissed(true);
          }}
        >
          Ahora no
        </button>
      </div>
      <p className="muted small">
        Lo que gastás normalmente en cada categoría (la mediana de los últimos 3 meses)
        {p.scaled ? ', achicado para que entre con tus ingresos, fijos y ahorro' : ''}.
      </p>
      <ul className="review-list">
        {p.lines.map((l) => {
          const c = category.get(l.categoryId);
          return (
            <li key={l.categoryId}>
              <span>
                {c?.icon} {c?.name}
                {l.current !== null && l.current !== l.suggested && <small className="muted"> (hoy {money(l.current)})</small>}
              </span>
              <strong>{money(l.suggested)}</strong>
            </li>
          );
        })}
      </ul>
      <p className={`small ${p.free < 0 ? 'text-bad' : 'muted'}`}>
        {p.free >= 0
          ? `Te quedan ${money(Math.round(p.free))} sin asignar (después de fijos, cuotas y ahorro).`
          : `Ojo: no alcanza por ${money(Math.round(-p.free))}.`}
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={apply}>
          Aplicar el plan
        </button>
        <button
          className="btn btn-ghost"
          onClick={() =>
            openExplain({
              title: `Plan de ${name}: de dónde sale`,
              intro:
                'Para cada categoría, lo que gastaste en cada uno de los últimos 3 meses; se toma la mediana (el del medio), redondeada a 100.',
              rows: p.lines.map((l) => ({
                label: `${category.get(l.categoryId)?.name ?? ''}: ${l.history.map((h) => money(Math.round(h))).join(' · ')}`,
                value: l.suggested,
              })),
              result: { label: 'Total asignado', value: p.assigned },
              footnote: `Ingresos ${money(p.income)} − fijos ${money(p.fixed)} − cuotas ${money(p.committed)} − ahorro ${money(p.savings)} − asignado ${money(p.assigned)} = ${money(p.free)}.`,
            })
          }
        >
          ¿De dónde sale?
        </button>
      </div>
    </section>
  );
}
