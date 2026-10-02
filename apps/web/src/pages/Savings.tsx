import { useState } from 'react';
import { goalBalances, newId, round2, type Goal } from '@lifty/core';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Chips, Empty, Field, PageHeader, Progress, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData } from '../lib/store';
import { mutate } from '../lib/sync';

export function Savings() {
  const data = useData();
  const balances = goalBalances(data);
  const totalUYU = round2(balances.reduce((s, g) => s + g.balanceUYU, 0));
  const history = data.transactions.filter((t) => t.kind === 'saving').slice(0, 30);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Ahorro"
        subtitle={`Dólar a ${data.settings.usdRate}`}
        actions={
          <button className="btn" onClick={() => setEditing('new')}>
            Nueva meta
          </button>
        }
      />
      <section className="hero hero-calm">
        <p className="hero-label">Ahorrado en total</p>
        <p className="hero-value">{money(totalUYU)}</p>
        <p className="hero-sub">Sumando pesos y dólares (convertidos a la cotización actual)</p>
      </section>

      <div className="goal-grid">
        {balances.map((g) => {
          const goal = data.goals.find((x) => x.id === g.goalId);
          return (
            <article key={g.goalId ?? g.name} className="card goal">
              <div className="goal-head">
                <span className="goal-icon" style={{ '--tint': goal?.color ?? 'var(--muted)' } as React.CSSProperties}>
                  {goal?.icon ?? '🐷'}
                </span>
                <div>
                  <strong>{g.name}</strong>
                  {g.target && <span className="muted small"> · meta {money(g.target, g.currency)}</span>}
                </div>
                {goal && (
                  <button className="link small" onClick={() => setEditing(goal)}>
                    Editar
                  </button>
                )}
              </div>
              <p className="goal-value">{money(g.balance, g.currency)}</p>
              {g.currency === 'USD' && <p className="muted small">≈ {money(g.balanceUYU)}</p>}
              {g.target && <Progress value={g.balance} max={g.target} label={`Avance de ${g.name}`} />}
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  onClick={() => openTxForm({ preset: { kind: 'saving', goalId: g.goalId, currency: g.currency } })}
                >
                  Agregar
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
      </div>

      <Section title="Últimos movimientos de ahorro">
        {history.length ? (
          <div className="card list">
            {history.map((t) => (
              <TxRow key={t.id} tx={t} showDate />
            ))}
          </div>
        ) : (
          <Empty icon="piggy" title="Todavía no ahorraste nada acá">
            Cada ahorro se descuenta del presupuesto del mes, como en la planilla.
          </Empty>
        )}
      </Section>

      {editing && <GoalForm goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? '🎯');
  const [currency, setCurrency] = useState(goal?.currency ?? 'UYU');
  const [target, setTarget] = useState(goal?.target ? String(goal.target) : '');
  const save = () => {
    if (!name.trim()) return;
    mutate('goal', 'upsert', {
      id: goal?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      icon: icon || '🎯',
      color: goal?.color ?? '#0ea5e9',
      currency,
      target: parseAmount(target) || null,
      archived: false,
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
        <Field label="Meta (opcional)">
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Ej: 2000" />
        </Field>
      </div>
    </Sheet>
  );
}
