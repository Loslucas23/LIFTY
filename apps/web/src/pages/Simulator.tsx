import { useState } from 'react';
import { affordability, monthLabel, monthOf, workTime } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { openTxForm } from '../components/TxForm';
import { Field, PageHeader, Section } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useToday } from '../lib/store';

/** "¿Me lo puedo comprar?": cómo queda cada mes si lo comprás (al contado o en cuotas). */
export function Simulator() {
  const data = useData();
  const today = useToday();
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [usd, setUsd] = useState(false);
  const [installments, setInstallments] = useState(1);
  const raw = parseAmount(amountText) ?? 0;
  const amount = usd ? raw * data.settings.usdRate : raw;
  const r = amount > 0 ? affordability(data, today, { amount, installments }) : null;
  const b = useMonth(monthOf(today));
  const card = data.accounts.find((a) => a.type === 'credit' && !a.archived);
  const max = r ? Math.max(1, ...r.months.map((m) => Math.max(Math.abs(m.before), Math.abs(m.after)))) : 1;

  return (
    <div className="page narrow">
      <PageHeader title="¿Me lo puedo comprar?" subtitle="Cómo quedaría tu plata cada mes si lo comprás" />
      <p className="muted small">
        ¿Te ofrecen descuento por pagar contado? <a href="#/dia-a-dia">Compará contado contra cuotas</a> (con la inflación).
      </p>
      <div className="card pad form">
        <Field label="¿Qué?">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Heladera" maxLength={60} />
        </Field>
        <div className="row">
          <Field label={`Precio total (${usd ? 'US$' : '$'})`}>
            <input
              data-autofocus
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="Ej: 36000"
            />
          </Field>
          <Field label="Moneda">
            <button type="button" className="btn" onClick={() => setUsd(!usd)}>
              {usd ? 'Dólares' : 'Pesos'}
            </button>
          </Field>
        </div>
        <Field label="Cuotas">
          <div className="stepper">
            <button type="button" onClick={() => setInstallments(Math.max(1, installments - 1))} aria-label="Menos cuotas">
              −
            </button>
            <input
              inputMode="numeric"
              value={installments}
              onChange={(e) => setInstallments(Math.min(60, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))}
              aria-label="Cantidad de cuotas"
            />
            <button type="button" onClick={() => setInstallments(Math.min(60, installments + 1))} aria-label="Más cuotas">
              +
            </button>
          </div>
        </Field>
      </div>

      {r && (
        <>
          <div className={`note ${r.ok ? 'note-good' : 'note-bad'} sim-verdict`}>
            {r.ok ? (
              <>
                ✅ <strong>Te alcanza.</strong>{' '}
                {installments > 1 ? `${installments} cuotas de ${money(Math.round(amount / installments))}` : 'Al contado'}: todos
                los meses te sigue quedando plata libre.
              </>
            ) : (
              <>
                ⚠️ <strong>No te alcanza:</strong> en {monthLabel(r.firstShort!.month, false).toLowerCase()} te faltarían{' '}
                {money(Math.round(-r.firstShort!.after))}.{installments < 12 ? ' Probá con más cuotas o esperá a juntarlo.' : ''}
              </>
            )}
            {workTime(amount, b, data.settings.weeklyHours) && (
              <>
                <br />
                ⏱️ Son {workTime(amount, b, data.settings.weeklyHours)}.
              </>
            )}
            {r.monthsToSave !== null && (
              <>
                <br />
                Si lo juntás con lo que te sobra por mes, lo tenés en ~{r.monthsToSave} {r.monthsToSave === 1 ? 'mes' : 'meses'}.
              </>
            )}
          </div>
          <Section title="Mes a mes">
            <ul className="card month-bars sim-months">
              {r.months.map((m) => (
                <li key={m.month}>
                  <span>{monthLabel(m.month, false)}</span>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${m.after < 0 ? 'bar-bad' : 'bar-good'}`}
                      style={{ width: `${(Math.max(0, m.after) / max) * 100}%` }}
                    />
                  </div>
                  <strong className={m.after < 0 ? 'text-expense' : ''}>
                    {money(Math.round(m.after))}
                    {m.installment > 0 && <small className="muted"> (−{money(Math.round(m.installment))})</small>}
                  </strong>
                </li>
              ))}
            </ul>
            <button
              className="link small"
              onClick={() =>
                openExplain({
                  title: 'Cómo se calcula',
                  intro: `Para cada mes: ingresos planificados − gastos fijos − cuotas que ya tenés − tu meta de ahorro − tu gasto del día a día promedio (${money(Math.round(r.avgSpending))}, de los últimos 3 meses). Eso es lo libre; después se resta la cuota.`,
                  rows: r.months.map((m) => ({
                    label: `${monthLabel(m.month, false)}: libre ${money(Math.round(m.before))}${m.installment ? ` − cuota ${money(Math.round(m.installment))}` : ''}`,
                    value: m.after,
                  })),
                })
              }
            >
              ¿De dónde sale?
            </button>
          </Section>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() =>
                openTxForm({
                  preset: {
                    kind: 'expense',
                    amount: raw,
                    currency: usd ? 'USD' : 'UYU',
                    description: name,
                    installments,
                    accountId: installments > 1 ? (card?.id ?? null) : null,
                  },
                })
              }
            >
              Lo compré: cargarlo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
