import { activeInstallmentPlans, addMonths, monthLabel, monthOf, round2 } from '@lifty/core';
import { openTxForm } from '../components/TxForm';
import { Empty, PageHeader, Section } from '../components/ui';
import { money } from '../lib/format';
import { useData, useMonths, useToday } from '../lib/store';

export function Card() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const next = useMonths(month, addMonths(month, 5));
  const plans = activeInstallmentPlans(data, month);
  const max = Math.max(1, ...next.map((m) => m.card.total));
  const remaining = round2(plans.reduce((s, p) => s + p.remaining, 0));
  const credit = data.accounts.find((a) => a.type === 'credit');

  return (
    <div className="page">
      <PageHeader
        title="Tarjeta de crédito"
        subtitle="Cuánto vas a pagar en los próximos meses"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => openTxForm({ preset: { kind: 'expense', accountId: credit?.id ?? null, installments: 3 } })}
          >
            Compra en cuotas
          </button>
        }
      />

      <Section title="Próximos 6 meses">
        <ul className="card month-bars">
          {next.map((m) => (
            <li key={m.month}>
              <a href={`#/presupuesto/${m.month}`}>{monthLabel(m.month)}</a>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(m.card.total / max) * 100}%` }} />
              </div>
              <strong>{money(m.card.total)}</strong>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Compras en cuotas activas"
        action={remaining > 0 && <span className="muted small">Te falta pagar {money(remaining)}</span>}
      >
        {plans.length === 0 ? (
          <Empty icon="card" title="No tenés cuotas pendientes">
            Cuando cargues un gasto con la tarjeta de crédito podés elegir en cuántas cuotas.
          </Empty>
        ) : (
          <ul className="plans">
            {plans.map((p) => {
              const paid = p.installments.filter((i) => i.month < month).length;
              return (
                <li key={p.tx.id} className="card">
                  <button className="plan" onClick={() => openTxForm({ tx: p.tx })}>
                    <div className="plan-head">
                      <strong>{p.tx.description || 'Compra'}</strong>
                      <span>{money(p.installments[0].amount, p.tx.currency)} / mes</span>
                    </div>
                    <div className="dots" aria-label={`${paid} de ${p.tx.installments} cuotas pagas`}>
                      {p.installments.map((i) => (
                        <span key={i.number} className={i.month < month ? 'paid' : i.month === month ? 'now' : ''} />
                      ))}
                    </div>
                    <div className="plan-foot muted small">
                      <span>
                        {p.current
                          ? `Cuota ${p.current} de ${p.tx.installments}`
                          : `Empieza en ${monthLabel(p.installments[0].month)}`}
                      </span>
                      <span>
                        Termina en {monthLabel(p.lastMonth)} · faltan {money(p.remainingOriginal, p.tx.currency)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
