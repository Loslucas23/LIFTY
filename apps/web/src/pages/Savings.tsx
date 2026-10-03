import { useState } from 'react';
import {
  addMonths,
  goalBalances,
  goalPlans,
  monthDiff,
  monthLabel,
  monthOf,
  newId,
  round2,
  type Currency,
  type Goal,
  type GoalPlan,
  type Settings,
} from '@lifty/core';
import { openExplain } from '../components/Editors';
import { editUsdRate } from '../lib/actions';
import { Icon } from '../components/Icon';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Chips, Empty, Field, PageHeader, Progress, Section, Segmented, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const STATUS: Record<GoalPlan['status'], { label: string; tone: string }> = {
  done: { label: '¡Lograda!', tone: 'tag-good' },
  ahead: { label: 'Vas adelantado', tone: 'tag-good' },
  'on-track': { label: 'Vas al día', tone: '' },
  behind: { label: 'Vas atrasado', tone: 'tag-bad' },
  late: { label: 'Se pasó la fecha', tone: 'tag-bad' },
};

export function Savings() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const balances = goalBalances(data);
  const plans = new Map(goalPlans(data, today).map((p) => [p.goal.id, p]));
  const totalUYU = round2(balances.reduce((s, g) => s + g.balanceUYU, 0));
  const history = data.transactions.filter((t) => t.kind === 'saving').slice(0, 30);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [goalSheet, setGoalSheet] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const visible = balances.filter((g) => {
    const goal = data.goals.find((x) => x.id === g.goalId);
    return !goal?.archived || g.balance !== 0;
  });
  const archived = data.goals.filter((g) => g.archived);

  return (
    <div className="page">
      <PageHeader
        title="Ahorro"
        subtitle={
          <button className="link" onClick={() => editUsdRate(data)}>
            Dólar a {data.settings.usdRate.toLocaleString('es-UY')} · cambiar
          </button>
        }
        actions={
          <button className="btn" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Nueva meta
          </button>
        }
      />
      <section
        className="hero hero-calm explainable-hero"
        role="button"
        tabIndex={0}
        onClick={() =>
          openExplain({
            title: 'Ahorrado en total',
            intro: 'La suma de lo que tenés en cada meta. Los dólares se pasan a pesos con la cotización de Ajustes.',
            rows: balances.map((g) => ({
              label: g.name,
              value: g.balanceUYU,
              op: '+' as const,
              note: g.currency === 'USD' ? `${money(g.balance, 'USD')} × ${data.settings.usdRate}` : undefined,
            })),
            result: { label: 'Total', value: totalUYU },
          })
        }
      >
        <p className="hero-label">Ahorrado en total</p>
        <p className="hero-value">{money(Math.round(totalUYU))}</p>
        <p className="hero-sub">Pesos y dólares juntos (convertidos a la cotización de hoy) · tocá para ver el detalle</p>
      </section>

      <MonthlyGoal month={month} onEdit={() => setGoalSheet(true)} />

      <Section title="Metas">
        <div className="goal-grid">
          {visible.map((g) => {
            const goal = data.goals.find((x) => x.id === g.goalId);
            const plan = goal ? plans.get(goal.id) : undefined;
            return (
              <article key={g.goalId ?? g.name} className="card goal">
                <div className="goal-head">
                  <span className="goal-icon" style={{ '--tint': goal?.color ?? 'var(--muted)' } as React.CSSProperties}>
                    {goal?.icon ?? '🐷'}
                  </span>
                  <div>
                    <strong>{g.name}</strong>
                    {g.target && (
                      <span className="muted small">
                        {' '}
                        · meta {money(g.target, g.currency)}
                        {goal?.targetMonth ? ` para ${monthLabel(goal.targetMonth).toLowerCase()}` : ''}
                      </span>
                    )}
                  </div>
                  {goal && (
                    <button className="link small" onClick={() => setEditing(goal)}>
                      Editar
                    </button>
                  )}
                </div>
                <p className="goal-value">{money(g.balance, g.currency)}</p>
                {goal && (
                  <p className="muted small">
                    {goal.accountId
                      ? `Guardado en ${data.accounts.find((a) => a.id === goal.accountId)?.name ?? 'una cuenta'}`
                      : 'Guardado fuera de tus cuentas'}
                  </p>
                )}
                {g.currency === 'USD' && <p className="muted small">≈ {money(Math.round(g.balanceUYU))}</p>}
                {g.target && <Progress value={g.balance} max={g.target} label={`Avance de ${g.name}`} />}
                {plan && <PlanLine plan={plan} />}
                <div className="btn-row">
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      openTxForm({
                        preset: {
                          kind: 'saving',
                          goalId: g.goalId,
                          currency: g.currency,
                          ...(plan && plan.status !== 'done' ? { amount: Math.ceil(plan.perMonth) } : {}),
                        },
                      })
                    }
                  >
                    Depositar
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      openTxForm({ preset: { kind: 'saving', goalId: g.goalId, currency: g.currency }, withdraw: true })
                    }
                  >
                    Retirar
                  </button>
                </div>
              </article>
            );
          })}
          {visible.length === 0 && (
            <Empty icon="piggy" title="Todavía no tenés metas">
              <p>Ej: "Viaje a Brasil, US$ 2.000 para diciembre". Lifty te dice cuánto separar por mes y si vas atrasado.</p>
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                Crear una meta
              </button>
            </Empty>
          )}
        </div>
        {archived.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Ocultar archivadas' : `Ver ${archived.length} archivada${archived.length > 1 ? 's' : ''}`}
          </button>
        )}
        {showArchived && (
          <div className="card list">
            {archived.map((g) => (
              <button key={g.id} className="tx-row" onClick={() => setEditing(g)}>
                <span className="tx-icon">{g.icon}</span>
                <span className="tx-main">
                  <span className="tx-title">{g.name}</span>
                  <span className="tx-meta">Archivada · tocá para editar o reactivar</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Últimos movimientos de ahorro">
        {history.length ? (
          <div className="card list">
            {history.map((t) => (
              <TxRow key={t.id} tx={t} showDate />
            ))}
          </div>
        ) : (
          <Empty icon="piggy" title="Todavía no ahorraste nada acá">
            Cada ahorro sale del presupuesto del mes: se aparta antes de calcular cuánto podés gastar por día.
          </Empty>
        )}
      </Section>

      {editing && <GoalForm goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {goalSheet && <SavingsGoalForm month={month} onClose={() => setGoalSheet(false)} />}
    </div>
  );
}

function PlanLine({ plan }: { plan: GoalPlan }) {
  const cur = plan.goal.currency;
  const s = STATUS[plan.status];
  const explain = () =>
    openExplain({
      title: `${plan.goal.name}: cuánto separar`,
      intro: `Para llegar a ${money(plan.target, cur)} en ${monthLabel(plan.goal.targetMonth!).toLowerCase()}, lo que falta se reparte en los meses que quedan (contando este).`,
      rows: [
        { label: 'Meta', value: plan.target },
        { label: 'Ya tenés', value: plan.balance, op: '−' },
        { label: 'Meses que quedan', value: plan.monthsLeft, op: '÷', raw: String(plan.monthsLeft) },
      ],
      result: { label: `Por mes${cur === 'USD' ? ' (US$)' : ''}`, value: plan.perMonth },
      footnote: `${
        cur === 'USD' ? `En pesos: ${money(plan.perMonthUYU)} por mes. ` : ''
      }Si ahorrás parejo${plan.goal.startMonth ? ` desde ${monthLabel(plan.goal.startMonth).toLowerCase()}` : ''}, a esta altura deberías tener ${money(plan.expected, cur)}; tenés ${money(plan.balance, cur)} (${plan.diff >= 0 ? '+' : '−'}${money(Math.abs(plan.diff), cur)}).`,
    });
  return (
    <button className="goal-plan" onClick={explain}>
      <span className={`tag ${s.tone}`}>{s.label}</span>
      <span className="small">
        {plan.status === 'done' ? (
          'Llegaste a la meta 🎉'
        ) : plan.status === 'late' ? (
          <>Te faltan {money(plan.target - plan.balance, cur)}</>
        ) : (
          <>
            Separá <strong>{money(Math.ceil(plan.perMonth), cur)}</strong> por mes
            {plan.monthsLeft > 1 ? ` · ${plan.monthsLeft} meses` : ' · último mes'}
            {plan.status === 'ahead' || plan.status === 'behind'
              ? ` (${plan.diff > 0 ? '+' : '−'}${money(Math.abs(Math.round(plan.diff)), cur)})`
              : ''}
          </>
        )}
      </span>
    </button>
  );
}

/** Meta mensual: se aparta primero, antes de calcular cuánto podés gastar por día. */
function MonthlyGoal({ month, onEdit }: { month: string; onEdit: () => void }) {
  const data = useData();
  const b = useMonth(month);
  const past = useMonths(addMonths(month, -5), month);
  const st = data.settings;
  const g = b.savingsGoal;
  if (st.savingsMode === 'none') {
    return (
      <button className="card tile-link cta-tile" onClick={onEdit}>
        <Icon name="piggy" />
        <span className="tile-text">
          <strong>Ponete una meta de ahorro mensual</strong>
          <span className="muted small">
            Un monto o un % de lo que entra. Se aparta primero: "Hoy podés gastar" ya lo descuenta.
          </span>
        </span>
        <Icon name="right" size={18} />
      </button>
    );
  }
  const max = Math.max(1, ...past.map((m) => Math.max(m.savings.total, m.savingsGoal.target)));
  return (
    <section className="card pad monthly-goal">
      <div className="limit-head">
        <strong>
          Meta de ahorro de {monthLabel(month, false).toLowerCase()}
          {st.savingsMode === 'percent' ? ` (${st.savingsValue}% de lo que entra)` : ''}
        </strong>
        <button className="link small" onClick={onEdit}>
          Cambiar
        </button>
      </div>
      <p>
        {g.pending > 0 ? (
          <>
            Llevás <strong>{money(Math.round(g.saved))}</strong> de {money(Math.round(g.target))}: te faltan{' '}
            <strong>{money(Math.round(g.pending))}</strong>.
          </>
        ) : (
          <>
            ¡Cumpliste! Ahorraste <strong>{money(Math.round(g.saved))}</strong> de {money(Math.round(g.target))}.
          </>
        )}
      </p>
      <Progress value={g.saved} max={g.target || 1} label="Meta de ahorro del mes" />
      {g.pending > 0 && (
        <div className="btn-row">
          <button
            className="btn btn-primary"
            onClick={() => openTxForm({ preset: { kind: 'saving', amount: Math.ceil(g.pending) } })}
          >
            Ahorrar {money(Math.ceil(g.pending))} ahora
          </button>
        </div>
      )}
      <div className="mini-bars" aria-label="Ahorro de los últimos 6 meses">
        {past.map((m) => {
          const hit = m.savingsGoal.target > 0 && m.savings.total >= m.savingsGoal.target;
          return (
            <div key={m.month} className="mini-bar" title={`${monthLabel(m.month)}: ${money(Math.round(m.savings.total))}`}>
              <span className="mini-bar-track">
                <span
                  className={`mini-bar-fill ${hit ? 'good' : ''}`}
                  style={{ height: `${Math.max(2, (Math.max(0, m.savings.total) / max) * 100)}%` }}
                />
                {m.savingsGoal.target > 0 && (
                  <span className="mini-bar-goal" style={{ bottom: `${(m.savingsGoal.target / max) * 100}%` }} />
                )}
              </span>
              <span className="mini-bar-label">{monthLabel(m.month, false).slice(0, 3)}</span>
            </div>
          );
        })}
      </div>
      <p className="muted small">Lo ahorrado en cada mes; la rayita es la meta.</p>
    </section>
  );
}

function SavingsGoalForm({ month, onClose }: { month: string; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const b = useMonth(month);
  const st = data.settings;
  const [mode, setMode] = useState<Settings['savingsMode']>(st.savingsMode === 'none' ? 'amount' : st.savingsMode);
  const [value, setValue] = useState(st.savingsMode === 'none' ? '' : String(st.savingsValue));
  const v = parseAmount(value) ?? 0;
  const income = b.income.total;
  const thisMonth = mode === 'percent' ? round2((Math.max(0, income) * v) / 100) : v;
  const needed = round2(
    goalPlans(data, today)
      .filter((p) => p.status !== 'done' && p.status !== 'late')
      .reduce((s, p) => s + p.perMonthUYU, 0),
  );
  const save = (m: Settings['savingsMode'], val: number) => {
    const prev = st;
    mutate('settings', 'upsert', { ...st, savingsMode: m, savingsValue: val });
    toast(m === 'none' ? 'Sin meta de ahorro mensual' : 'Meta de ahorro guardada', {
      action: { label: 'Deshacer', run: () => mutate('settings', 'upsert', prev) },
    });
    onClose();
  };
  return (
    <Sheet
      title="Meta de ahorro mensual"
      onClose={onClose}
      footer={
        <>
          {st.savingsMode !== 'none' && (
            <button className="btn btn-danger-ghost" onClick={() => save('none', 0)}>
              Sacar la meta
            </button>
          )}
          <button
            className="btn btn-primary grow"
            disabled={v <= 0 || (mode === 'percent' && v > 100)}
            onClick={() => save(mode, v)}
          >
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        <p className="muted small">
          Lo que querés ahorrar cada mes se aparta primero: "Hoy podés gastar" lo descuenta desde el día 1, aunque todavía no lo
          hayas pasado al ahorro.
        </p>
        <Segmented
          label="Cómo"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'amount', label: 'Un monto fijo' },
            { value: 'percent', label: '% de lo que entra' },
          ]}
        />
        <Field
          label={mode === 'percent' ? 'Porcentaje' : 'Monto por mes ($)'}
          hint={
            mode === 'percent'
              ? `Este mes entran ${money(Math.round(income))} → ${money(Math.round(thisMonth))}`
              : income > 0 && v > 0
                ? `Es el ${Math.round((v / income) * 100)}% de lo que entra este mes`
                : undefined
          }
        >
          <input
            data-autofocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'percent' ? 'Ej: 10' : 'Ej: 5000'}
          />
        </Field>
        {mode === 'percent' && (
          <Chips
            label="Porcentajes comunes"
            value={null as string | null}
            onChange={(x) => x && setValue(x)}
            options={['5', '10', '15', '20'].map((x) => ({ value: x as string | null, label: `${x}%` }))}
          />
        )}
        {needed > 0 && (
          <div className="note">
            Para llegar a tus metas con fecha necesitás separar <strong>{money(Math.ceil(needed))}</strong> por mes.{' '}
            <button
              className="link"
              onClick={() => {
                setMode('amount');
                setValue(String(Math.ceil(needed)));
              }}
            >
              Usar ese monto
            </button>
          </div>
        )}
        {b.daily && v > 0 && (
          <p className="muted small">
            Con esta meta, hoy podrías gastar{' '}
            <strong>
              {money(
                Math.max(
                  0,
                  Math.round(
                    b.daily.todayLeft -
                      (Math.max(thisMonth, b.savingsGoal.saved) - Math.max(b.savingsGoal.target, b.savingsGoal.saved)) /
                        b.daily.daysLeft,
                  ),
                ),
              )}
            </strong>{' '}
            (ahora: {money(Math.max(0, Math.round(b.daily.todayLeft)))}).
          </p>
        )}
      </div>
    </Sheet>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const [name, setName] = useState(goal?.name ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? '🎯');
  const [currency, setCurrency] = useState<Currency>(goal?.currency ?? 'UYU');
  const [target, setTarget] = useState(goal?.target ? String(goal.target) : '');
  const [targetMonth, setTargetMonth] = useState(goal?.targetMonth ?? '');
  const [accountId, setAccountId] = useState<string | null>(goal?.accountId ?? null);
  const places = data.accounts.filter((a) => (a.type === 'bank' || a.type === 'cash') && (!a.archived || a.id === accountId));
  const t = parseAmount(target) ?? 0;
  const balance = goal ? (goalBalances(data).find((g) => g.goalId === goal.id)?.balance ?? 0) : 0;
  const monthsLeft = targetMonth ? Math.max(1, monthDiff(month, targetMonth) + 1) : 0;
  const perMonth = t > 0 && monthsLeft ? Math.max(0, t - balance) / monthsLeft : 0;
  const save = () => {
    if (!name.trim()) return;
    mutate('goal', 'upsert', {
      id: goal?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      icon: icon || '🎯',
      color: goal?.color ?? '#0ea5e9',
      currency,
      target: t > 0 ? t : null,
      targetMonth: targetMonth || null,
      // Desde cuándo se ahorra: para saber si vas adelantado o atrasado.
      startMonth: targetMonth ? (goal?.startMonth ?? month) : null,
      accountId,
      archived: goal?.archived ?? false,
    });
    toast('Meta guardada');
    onClose();
  };
  return (
    <Sheet
      title={goal ? 'Editar meta' : 'Nueva meta de ahorro'}
      onClose={onClose}
      footer={
        <>
          {goal && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('goal', 'delete', goal.id);
                toast('Meta borrada (los movimientos quedan como "ahorro sin meta")', {
                  action: { label: 'Deshacer', run: () => mutate('goal', 'upsert', goal) },
                });
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          {goal && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                mutate('goal', 'upsert', { ...goal, archived: !goal.archived });
                toast(goal.archived ? 'Meta reactivada' : 'Meta archivada');
                onClose();
              }}
            >
              {goal.archived ? 'Reactivar' : 'Archivar'}
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save} disabled={!name.trim()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Viaje a Brasil" />
          </Field>
        </div>
        <Field label="Moneda">
          <Chips
            label="Moneda"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'UYU', label: 'Pesos' },
              { value: 'USD', label: 'Dólares' },
            ]}
          />
        </Field>
        <Field
          label="¿Dónde la tenés guardada?"
          hint={
            accountId
              ? 'Ahorrar no saca la plata de esa cuenta: queda ahí, apartada, y no cuenta para gastar.'
              : 'Fuera de tus cuentas (alcancía, otro banco…): ahorrar la saca de la cuenta de donde sale.'
          }
        >
          <Chips
            label="Dónde está guardada"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: null, label: 'Fuera de mis cuentas' },
              ...places.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
            ]}
          />
        </Field>
        <div className="row">
          <Field label="¿Cuánto? (opcional)">
            <input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={currency === 'USD' ? 'Ej: 2000' : 'Ej: 60000'}
            />
          </Field>
          <Field label="¿Para cuándo? (opcional)">
            <input
              type="month"
              value={targetMonth}
              min={month}
              onChange={(e) => setTargetMonth(e.target.value)}
              aria-label="Mes de la meta"
            />
          </Field>
        </div>
        {targetMonth && (
          <Chips
            label="Atajos"
            value={null as string | null}
            onChange={(x) => x && setTargetMonth(x)}
            options={[
              { value: `${month.slice(0, 4)}-12`, label: 'Diciembre' },
              { value: addMonths(month, 5), label: 'En 6 meses' },
              { value: addMonths(month, 11), label: 'En un año' },
            ].filter((o) => o.value >= month)}
          />
        )}
        {!targetMonth && (
          <button className="link small" onClick={() => setTargetMonth(`${month.slice(0, 4)}-12`)}>
            + Ponerle fecha (ej: para diciembre)
          </button>
        )}
        {perMonth > 0 && (
          <div className="note note-good">
            Vas a tener que separar <strong>{money(Math.ceil(perMonth), currency)}</strong> por mes durante {monthsLeft}{' '}
            {monthsLeft === 1 ? 'mes' : 'meses'}
            {balance > 0 ? ` (ya tenés ${money(balance, currency)})` : ''}.
            {currency === 'USD' && ` Son unos ${money(Math.round(perMonth * data.settings.usdRate))}.`}
          </div>
        )}
      </div>
    </Sheet>
  );
}
