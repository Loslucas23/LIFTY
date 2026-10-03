import { initialBalanceFor, moneyCheck, newId, type LiftyData, type MoneyCheck as Check } from '@lifty/core';
import { money } from '../lib/format';
import { navigate } from '../lib/router';
import { useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { openExplain, openMenu, openPrompt } from './Editors';
import { toast } from './ui';

export function useMoneyCheck(): Check {
  const data = useData();
  const today = useToday();
  const b = useMonth(today.slice(0, 7));
  return moneyCheck(data, today, b);
}

const SOURCE: Record<Check['budget']['carryoverSource'], string> = {
  real: 'real, del cierre',
  projected: 'proyectado',
  start: 'saldo inicial de Ajustes',
  none: '',
};

/** La cuenta del lado del presupuesto, paso a paso. */
function explainBudget(c: Check) {
  openExplain({
    title: 'Lo que dice tu presupuesto',
    intro: 'Lo que deberías tener hoy según lo que cargaste en Lifty (solo lo que ya pasó: lo pendiente no cuenta).',
    rows: [
      { label: 'Viene del mes anterior', value: c.budget.carryover, note: SOURCE[c.budget.carryoverSource] },
      { label: 'Lo que ya entró este mes', value: c.budget.income, op: '+' },
      { label: 'Gastos fijos ya pagados', value: c.budget.fixed, op: '−' },
      { label: 'Gastos del día a día y tarjeta', value: c.budget.spent, op: '−' },
      { label: 'Ahorrado este mes', value: c.budget.saved, op: '−' },
    ],
    result: { label: 'Deberías tener', value: c.budget.value },
  });
}

/** Pide el saldo real de cada banco y del efectivo, uno por uno. */
export function askRealBalances(data: LiftyData, c: Check, today: string, i = 0) {
  const item = c.accounts[i];
  if (!item) return toast('Saldos actualizados');
  const a = item.account;
  const current = data.accounts.find((x) => x.id === a.id) ?? a;
  openPrompt({
    title: `Saldo real (${i + 1} de ${c.accounts.length})`,
    label: `¿Cuánto hay hoy en ${a.name}? (${a.currency === 'USD' ? 'US$' : '$'})`,
    hint: 'Mirá la app del banco o contá el efectivo. Lifty ajusta el saldo inicial; los movimientos no cambian.',
    confirm: i + 1 < c.accounts.length ? 'Siguiente' : 'Listo',
    onSubmit: (value) => {
      mutate('account', 'upsert', { ...current, initialBalance: initialBalanceFor(data, a.id, value, today) });
      setTimeout(() => askRealBalances(data, c, today, i + 1), 50);
    },
  });
}

function fixDifference(data: LiftyData, c: Check, today: string) {
  const d = c.difference;
  const amount = Math.abs(d);
  const record = (kind: 'expense' | 'income') => {
    const id = newId();
    mutate('transaction', 'upsert', {
      id,
      updatedAt: '',
      date: today,
      kind,
      amount,
      currency: 'UYU',
      fxRate: 1,
      categoryId: kind === 'expense' ? 'cat-otros' : 'cat-extras',
      // Sin cuenta: la plata ya no está (o ya está) en tus cuentas; solo se corrige el presupuesto.
      accountId: null,
      toAccountId: null,
      goalId: null,
      description: kind === 'expense' ? 'Gastos sin anotar (cuadre)' : 'Plata sin anotar (cuadre)',
      installments: 1,
      firstInstallmentMonth: null,
      linkKind: null,
      linkId: null,
      linkMonth: null,
      sharedAmount: 0,
      sharedWith: '',
      tags: ['cuadre'],
    });
    toast('Listo: ahora cuadra', { action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', id) } });
  };
  openMenu(
    `No cuadra por ${money(amount)}`,
    [
      {
        label: '1. Poner el saldo real de cada cuenta',
        hint: 'Primero esto: que BROU, Itaú y el efectivo den lo mismo que en la realidad',
        run: () => askRealBalances(data, c, today),
      },
      d < 0
        ? {
            label: `2. Anotar ${money(amount)} como gastos sin detallar`,
            hint: 'Si gastaste y no lo cargaste (efectivo, débitos del banco…)',
            run: () => record('expense'),
          }
        : {
            label: `2. Anotar ${money(amount)} como ingreso sin detallar`,
            hint: 'Si te entró plata que no cargaste',
            run: () => record('income'),
          },
      ...(c.withoutAccount > 0
        ? [
            {
              label: `Ver los ${c.withoutAccount} movimientos de este mes sin cuenta`,
              hint: 'No mueven ningún saldo: asignales de dónde salió la plata',
              run: () => navigate('/movimientos'),
            },
          ]
        : []),
      { label: 'Ver lo que dice el presupuesto', run: () => explainBudget(c) },
    ],
    d < 0 ? 'En tus cuentas hay menos plata de la que Lifty calcula' : 'En tus cuentas hay más plata de la que Lifty calcula',
  );
}

/** "¿Dónde está tu plata?": tus cuentas repartidas en ahorro, tarjeta, fijos y lo libre. */
export function WhereIsMyMoney() {
  const data = useData();
  const c = useMoneyCheck();
  const today = useToday();
  const ok = Math.abs(c.difference) < 1;
  const debtNet = c.owedToMe - c.iOwe;
  const parts = [
    { label: 'Ahorro', value: c.savingsInAccounts, color: '#0ea5e9' },
    { label: 'Tarjeta', value: c.cardOwed, color: 'var(--series-2)' },
    { label: 'Fijos que faltan', value: c.pendingFixed, color: 'var(--warn)' },
    { label: 'Meta de ahorro', value: c.pendingSavings, color: '#7c3aed' },
  ].filter((p) => p.value > 0);
  const free = Math.max(0, c.untilMonthEnd - c.pendingIncome);
  const total = Math.max(1, parts.reduce((s, p) => s + p.value, 0) + free);
  return (
    <section className="card pad where">
      <div className="limit-head">
        <strong>¿Dónde está tu plata?</strong>
        <span className={`tag ${ok ? 'tag-good' : 'tag-bad'}`}>
          {ok ? 'Cuadra' : `No cuadra por ${money(Math.round(Math.abs(c.difference)))}`}
        </span>
      </div>
      <div className="where-bar" aria-hidden="true" hidden={c.cash <= 0}>
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
        {free > 0 && <span style={{ width: `${(free / total) * 100}%`, background: 'var(--accent)' }} />}
      </div>
      <dl className="receipt">
        <Row label="Bancos y efectivo" value={c.cash} />
        {c.savingsInAccounts > 0 && <Row label="Ahorro guardado en tus cuentas" value={-c.savingsInAccounts} dot="#0ea5e9" />}
        {c.cardOwed !== 0 && <Row label="Tarjeta: ya gastado, falta pagar" value={-c.cardOwed} dot="var(--series-2)" />}
        {debtNet !== 0 && <Row label={debtNet > 0 ? 'Te deben' : 'Debés'} value={debtNet} />}
        <Row label="Disponible hoy" value={c.available} total />
        {c.pendingFixed > 0 && <Row label="Gastos fijos que faltan pagar" value={-c.pendingFixed} dot="var(--warn)" />}
        {c.pendingSavings > 0 && <Row label="Falta para tu meta de ahorro" value={-c.pendingSavings} dot="#7c3aed" />}
        {c.pendingIncome > 0 && <Row label="Lo que falta cobrar" value={c.pendingIncome} />}
        <Row label="Para gastar hasta fin de mes" value={c.untilMonthEnd} total dot="var(--accent)" />
      </dl>
      {ok ? (
        <p className="muted small">
          ✅ Lo que hay en tus cuentas coincide con tu presupuesto: cada peso está en algún lado.{' '}
          <button className="link" onClick={() => explainBudget(c)}>
            ¿Cómo se compara?
          </button>
        </p>
      ) : (
        <div className={`note ${Math.abs(c.difference) >= 100 ? 'note-bad' : ''}`}>
          Según tus cuentas tenés <strong>{money(Math.round(c.available))}</strong> disponibles, pero según tu presupuesto
          deberías tener <strong>{money(Math.round(c.budget.value))}</strong>. Puede ser un gasto o ingreso sin anotar, un saldo
          que no coincide con el banco, algo de un mes anterior sin tildar o movimientos sin cuenta.{' '}
          {c.accounts.some((x) => x.balanceUYU < 0) && (
            <>
              <br />
              Ojo: tenés cuentas en negativo, seguramente falta poner su saldo real.{' '}
            </>
          )}
          <button className="link" onClick={() => fixDifference(data, c, today)}>
            Arreglarlo
          </button>
        </div>
      )}
      {c.cardFuture > 0 && (
        <p className="muted small">Además tenés {money(Math.round(c.cardFuture))} en cuotas de los meses que vienen.</p>
      )}
      {c.savingsOutside > 0 && (
        <p className="muted small">
          Y {money(Math.round(c.savingsOutside))} ahorrados fuera de tus cuentas.{' '}
          <a className="link" href="#/ahorro">
            Decí dónde los tenés
          </a>
        </p>
      )}
    </section>
  );
}

function Row({ label, value, total, dot }: { label: string; value: number; total?: boolean; dot?: string }) {
  return (
    <div className={`receipt-row ${total ? 'receipt-total' : ''}`}>
      <dt>
        {dot && <i className="where-dot" style={{ background: dot }} />}
        {label}
      </dt>
      <dd className={value < 0 ? 'text-expense' : ''}>
        {value < 0 ? '−' : ''}
        {money(Math.round(Math.abs(value)))}
      </dd>
    </div>
  );
}
