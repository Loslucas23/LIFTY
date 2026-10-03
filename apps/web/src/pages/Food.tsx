import { useState } from 'react';
import { daysInMonth, foodCardMonth, monthLabel, monthOf, newId, type Account } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { Icon } from '../components/Icon';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Empty, MonthPicker, PageHeader, Section, toast } from '../components/ui';
import { money } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { AccountForm } from './Accounts';

/**
 * Tarjeta de alimentación: NO es plata, así que vive aparte del presupuesto. Tiene su saldo,
 * la carga mensual de la empresa y cuánto te queda por día para el súper.
 */
export function Food() {
  const data = useData();
  const today = useToday();
  const [month, setMonth] = useState(monthOf(today));
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const cards = data.accounts.filter((a) => a.type === 'food' && !a.archived);

  return (
    <div className="page">
      <PageHeader
        title="Tarjeta de alimentación"
        subtitle="Va aparte: no es plata, no entra en tus ingresos ni en tus gastos"
        actions={
          cards.length === 0 ? (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> Agregar tarjeta
            </button>
          ) : undefined
        }
      />
      {cards.length === 0 ? (
        <Empty icon="card" title="No tenés una tarjeta de alimentación cargada">
          Agregala con lo que te carga la empresa por mes y Lifty te dice cuánto te queda por día.
        </Empty>
      ) : (
        <>
          <MonthPicker month={month} onChange={setMonth} />
          {cards.map((a) => (
            <FoodCard key={a.id} account={a} month={month} today={today} onEdit={() => setEditing(a)} />
          ))}
        </>
      )}
      {editing && (
        <AccountForm
          account={
            editing === 'new'
              ? {
                  id: newId(),
                  updatedAt: '',
                  name: 'Tarjeta alimentación',
                  type: 'food',
                  currency: 'UYU',
                  icon: '🍽️',
                  color: '#0d9488',
                  archived: false,
                  sort: data.accounts.length + 1,
                  initialBalance: 0,
                  monthlyLoad: null,
                  loadDay: null,
                }
              : editing
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FoodCard({ account, month, today, onEdit }: { account: Account; month: string; today: string; onEdit: () => void }) {
  const data = useData();
  const f = foodCardMonth(data, account.id, month, today);
  if (!f) return null;
  const current = month === monthOf(today);
  const loadDate = account.loadDay ? `${month}-${String(Math.min(account.loadDay, daysInMonth(month))).padStart(2, '0')}` : null;

  const confirmLoad = () => {
    if (!account.monthlyLoad) return;
    const tx = {
      id: newId(),
      updatedAt: '',
      date: current ? today : (loadDate ?? `${month}-01`),
      kind: 'income' as const,
      amount: account.monthlyLoad,
      currency: account.currency,
      fxRate: 1,
      categoryId: null,
      accountId: account.id,
      toAccountId: null,
      goalId: null,
      description: `Carga de ${monthLabel(month, false).toLowerCase()}`,
      installments: 1,
      firstInstallmentMonth: null,
      linkKind: 'load' as const,
      linkId: account.id,
      linkMonth: month,
      sharedAmount: 0,
      sharedWith: '',
    };
    mutate('transaction', 'upsert', tx);
    toast(`Carga de ${money(account.monthlyLoad)} acreditada`, {
      action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', tx.id) },
    });
  };

  return (
    <>
      <section
        className="hero hero-food"
        onClick={() =>
          openExplain({
            title: 'Lo que te queda en la tarjeta',
            rows: [
              { label: 'Saldo actual de la tarjeta', value: f.balance },
              ...(f.plannedLoad && !f.loadConfirmed
                ? [{ label: 'Carga del mes que falta acreditar', value: f.plannedLoad, op: '+' as const }]
                : []),
            ],
            result: { label: 'Para gastar', value: f.available },
            footnote:
              f.perDay !== null
                ? `${money(f.available)} ÷ ${f.daysLeft} días que quedan = ${money(f.perDay)} por día.`
                : undefined,
          })
        }
      >
        <p className="hero-label">
          {account.icon} {account.name}
        </p>
        <p className="hero-value">{money(f.available)}</p>
        {f.perDay !== null && (
          <p className="hero-sub">
            Podés gastar <strong>{money(f.perDay)}</strong> por día · quedan {f.daysLeft} días
          </p>
        )}
        <div className="hero-stats">
          <div>
            <span>Cargado</span>
            <strong>{money(f.loaded)}</strong>
          </div>
          <div>
            <span>Gastado</span>
            <strong>{money(f.spent)}</strong>
          </div>
          <div>
            <span>Saldo hoy</span>
            <strong>{money(f.balance)}</strong>
          </div>
        </div>
      </section>

      {f.plannedLoad ? (
        <ul className="planned">
          <li className={f.loadConfirmed ? 'done' : ''}>
            <button
              className="check"
              aria-pressed={f.loadConfirmed}
              aria-label={f.loadConfirmed ? 'Carga acreditada' : 'Marcar la carga como acreditada'}
              onClick={() => !f.loadConfirmed && confirmLoad()}
            >
              <Icon name="check" size={16} />
            </button>
            <span className="planned-main">
              <span className="planned-name">Carga de {monthLabel(month, false).toLowerCase()}</span>
              <span className="planned-meta">
                {f.loadConfirmed ? 'Acreditada' : account.loadDay ? `Se acredita el día ${account.loadDay}` : 'Pendiente'}
              </span>
            </span>
            <span className="planned-amount">{money(f.plannedLoad)}</span>
          </li>
        </ul>
      ) : (
        <button className="card tile-link cta-tile" onClick={onEdit}>
          <Icon name="settings" />
          <span className="tile-text">
            <strong>¿Cuánto te carga la empresa por mes?</strong>
            <span className="muted small">Configuralo y Lifty lo suma solo cada mes.</span>
          </span>
          <Icon name="right" size={18} />
        </button>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => openTxForm({ preset: { kind: 'expense', accountId: account.id, categoryId: 'cat-super' } })}
        >
          <Icon name="plus" /> Gasto con la tarjeta
        </button>
        <button
          className="btn"
          onClick={() => openTxForm({ preset: { kind: 'income', accountId: account.id, description: 'Carga' } })}
        >
          Otra carga
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          Configurar
        </button>
      </div>

      <Section title={`Movimientos de ${monthLabel(month).toLowerCase()}`}>
        {f.transactions.length ? (
          <div className="card list">
            {f.transactions.map((t) => (
              <TxRow key={t.id} tx={t} showDate />
            ))}
          </div>
        ) : (
          <p className="muted small">Sin movimientos este mes.</p>
        )}
      </Section>
    </>
  );
}
