import { useState } from 'react';
import {
  accountBalances,
  activeInstallmentPlans,
  addMonths,
  cardPayFrom,
  cardStatements,
  monthLabel,
  monthOf,
  round2,
  type CardStatement,
  type Currency,
} from '@lifty/core';
import { openExplain } from '../components/Editors';
import { Icon } from '../components/Icon';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Empty, MonthPicker, PageHeader, Section } from '../components/ui';
import { money } from '../lib/format';
import { useData, useLookups, useMonth, useMonths, useToday } from '../lib/store';

const STATUS: Record<CardStatement['status'], { label: string; tone: string }> = {
  empty: { label: 'Sin consumos', tone: '' },
  pending: { label: 'Sin pagar', tone: 'tag-bad' },
  partial: { label: 'Pagado en parte', tone: '' },
  paid: { label: 'Pagado', tone: 'tag-good' },
};

export function Card() {
  const data = useData();
  const today = useToday();
  const current = monthOf(today);
  const [month, setMonth] = useState(current);
  const b = useMonth(month);
  const next = useMonths(current, addMonths(current, 5));
  const plans = activeInstallmentPlans(data, current);
  const max = Math.max(1, ...next.map((m) => m.card.total));
  const remaining = round2(plans.reduce((s, p) => s + p.remaining, 0));
  const cards = data.accounts.filter((a) => a.type === 'credit' && !a.archived);
  const statements = cardStatements(data, b, today);
  const owed = round2(
    accountBalances(data, today)
      .filter((x) => x.account.type === 'credit')
      .reduce((s, x) => s - x.balanceUYU, 0),
  );

  return (
    <div className="page">
      <PageHeader
        title="Tarjeta de crédito"
        subtitle="Resumen del mes, cuotas y lo que viene"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => openTxForm({ preset: { kind: 'expense', accountId: cards[0]?.id ?? null, installments: 3 } })}
          >
            <Icon name="plus" /> Compra en cuotas
          </button>
        }
      />

      <div className="stat-row">
        <button
          className="card stat"
          onClick={() =>
            openExplain({
              title: 'Lo que debés con la tarjeta',
              intro:
                'Todo lo que compraste con la tarjeta (incluidas las cuotas que todavía no vencieron) menos lo que ya pagaste de los resúmenes. Con "pago el resumen entero" (débito automático), los resúmenes vencidos se dan por pagados aunque no los anotes.',
              rows: accountBalances(data, today)
                .filter((x) => x.account.type === 'credit')
                .map((x) => ({ label: x.account.name, value: -x.balanceUYU })),
              result: { label: 'Total', value: owed },
              footnote:
                'Si no coincide con el estado de cuenta, ajustá el saldo de la tarjeta en Cuentas (por ejemplo, si empezaste a usar Lifty con cuotas ya en curso).',
            })
          }
        >
          <span>Debés en total</span>
          <strong className={owed > 0 ? 'text-expense' : ''}>{money(Math.round(Math.max(0, owed)))}</strong>
        </button>
        <div className="card stat">
          <span>Cuotas que faltan</span>
          <strong>{money(Math.round(remaining))}</strong>
        </div>
      </div>

      <MonthPicker month={month} onChange={setMonth} />

      {statements.length === 0 ? (
        <Empty icon="card" title="No tenés una tarjeta de crédito cargada">
          Agregala en Cuentas para separar sus compras y ver el resumen de cada mes.
          <a className="btn" href="#/cuentas">
            Ir a cuentas
          </a>
        </Empty>
      ) : (
        statements.map((s) => <Statement key={s.account.id} statement={s} />)
      )}

      <Section title="Próximos 6 meses">
        <ul className="card month-bars">
          {next.map((m) => (
            <li key={m.month}>
              <button className="link" onClick={() => setMonth(m.month)}>
                {monthLabel(m.month)}
              </button>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(m.card.total / max) * 100}%` }} />
              </div>
              <strong>{money(Math.round(m.card.total))}</strong>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Compras en cuotas activas"
        action={remaining > 0 && <span className="muted small">Te falta pagar {money(Math.round(remaining))}</span>}
      >
        {plans.length === 0 ? (
          <Empty icon="card" title="No tenés cuotas pendientes">
            Cuando cargues un gasto con la tarjeta de crédito podés elegir en cuántas cuotas.
          </Empty>
        ) : (
          <ul className="plans">
            {plans.map((p) => {
              const paid = p.installments.filter((i) => i.month < current).length;
              return (
                <li key={p.tx.id} className="card">
                  <button className="plan" onClick={() => openTxForm({ tx: p.tx })}>
                    <div className="plan-head">
                      <strong>{p.tx.description || 'Compra'}</strong>
                      <span>{money(p.installments[0].amount, p.tx.currency)} / mes</span>
                    </div>
                    <div className="dots" aria-label={`${paid} de ${p.tx.installments} cuotas pagas`}>
                      {p.installments.map((i) => (
                        <span key={i.number} className={i.month < current ? 'paid' : i.month === current ? 'now' : ''} />
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

function Statement({ statement: s }: { statement: CardStatement }) {
  const data = useData();
  const { category } = useLookups();
  const name = monthLabel(s.month, false).toLowerCase();
  const bank = (currency: Currency) =>
    data.accounts.find((a) => a.type === 'bank' && a.currency === currency && !a.archived) ??
    data.accounts.find((a) => a.type === 'bank' && !a.archived);
  const pay = (currency: Currency, amount: number) =>
    openTxForm({
      preset: {
        kind: 'transfer',
        amount,
        currency,
        accountId: bank(currency)?.id ?? null,
        toAccountId: s.account.id,
        description: `Resumen de ${name}`,
        linkKind: 'cardbill',
        linkId: s.account.id,
        linkMonth: s.month,
      },
    });
  const st = STATUS[s.status];
  const explain = () =>
    openExplain({
      title: `${s.account.name}: resumen de ${name}`,
      intro: 'Las cuotas y compras que caen este mes. Ya cuentan como gasto del mes: pagar el resumen no suma de nuevo.',
      rows: [
        ...s.items.map((l) => ({
          label: `${l.description || category.get(l.categoryId ?? '')?.name || 'Compra'}${l.installment ? ` (cuota ${l.installment.number}/${l.installment.of})` : ''}`,
          value: l.amount,
          op: '+' as const,
          note: l.currency === 'USD' ? money(l.original, 'USD') : undefined,
        })),
        ...(s.opening > 0 ? [{ label: 'Lo que debías al poner el saldo', value: s.opening, op: '+' as const }] : []),
      ],
      result: { label: 'Total en pesos', value: s.totalUYU },
      footnote:
        s.usd > 0
          ? `En el estado de cuenta viene separado: ${money(s.uyu)} en pesos y ${money(s.usd, 'USD')} en dólares.`
          : undefined,
    });

  return (
    <section className="card pad statement">
      <div className="limit-head">
        <strong>
          {s.account.icon} {s.account.name} · {name}
        </strong>
        <span className={`tag ${st.tone}`}>{st.label}</span>
      </div>
      <button className="statement-total" onClick={explain} disabled={s.items.length === 0 && !s.opening}>
        <span className="statement-value">{money(Math.round(s.totalUYU))}</span>
        <span className="muted small">
          {s.usd > 0
            ? `${money(s.uyu)} + ${money(s.usd, 'USD')}`
            : `${s.items.length} cuota${s.items.length === 1 ? '' : 's'} o compra${s.items.length === 1 ? '' : 's'}`}
          {s.items.length > 0 ? ' · tocá para ver el detalle' : ''}
        </span>
      </button>
      {s.opening > 0 && (
        <p className="small muted">
          Incluye {money(s.opening, s.account.currency)} que debías cuando pusiste el saldo de la tarjeta.
        </p>
      )}
      {s.autopay && s.status !== 'paid' && s.status !== 'empty' && (
        <p className="small">
          🔁 Se paga solo el {s.payDate.split('-').reverse().join('/')} desde{' '}
          {cardPayFrom(data, s.account)?.name ?? 'tu cuenta principal'}. Si lo pagás antes o una parte, anotalo con "Pagar".
        </p>
      )}
      {(s.paidUYU > 0 || s.paidUSD > 0) && (
        <p className="small">
          Pagaste{' '}
          {[s.paidUYU > 0 ? money(s.paidUYU) : null, s.paidUSD > 0 ? money(s.paidUSD, 'USD') : null].filter(Boolean).join(' y ')}
          {s.status !== 'paid' &&
            ` · falta ${[s.pendingUYU > 0 ? money(s.pendingUYU) : null, s.pendingUSD > 0 ? money(s.pendingUSD, 'USD') : null]
              .filter(Boolean)
              .join(' y ')}`}
        </p>
      )}
      {s.status !== 'paid' && s.status !== 'empty' && (
        <div className="btn-row">
          {s.pendingUYU > 0 && (
            <button className="btn btn-primary" onClick={() => pay('UYU', s.pendingUYU)}>
              Pagar {money(s.pendingUYU)}
            </button>
          )}
          {s.pendingUSD > 0 && (
            <button className="btn btn-primary" onClick={() => pay('USD', s.pendingUSD)}>
              Pagar {money(s.pendingUSD, 'USD')}
            </button>
          )}
        </div>
      )}
      <p className="muted small">
        Pagar el resumen <strong>no es un gasto</strong>: es pasar plata del banco a la tarjeta. Lo que compraste ya se contó en
        el mes de cada cuota.
      </p>
      {s.payments.length > 0 && (
        <div className="card list">
          {s.payments.map((t) =>
            t.id.startsWith('auto-') ? (
              <div key={t.id} className="tx-row static">
                <span className="tx-icon">🔁</span>
                <span className="tx-main">
                  <span className="tx-title">{t.description}</span>
                  <span className="tx-meta">
                    {t.date.split('-').reverse().join('/')} · {cardPayFrom(data, s.account)?.name ?? 'Sin cuenta'} · no hace falta
                    anotarlo
                  </span>
                </span>
                <span className="tx-amount">{money(t.amount, t.currency)}</span>
              </div>
            ) : (
              <TxRow key={t.id} tx={t} showDate />
            ),
          )}
        </div>
      )}
    </section>
  );
}
