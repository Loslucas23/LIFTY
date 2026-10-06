import { useState, useSyncExternalStore } from 'react';
import {
  goalBalances,
  suggestGoalAccount,
  accountBalances,
  convert,
  adjustBalance,
  installmentsOf,
  moneyCheck,
  monthOf,
  round2,
  type Account,
  type LiftyData,
} from '@lifty/core';
import { money, parseAmount } from '../lib/format';
import { local } from '../lib/local';
import { useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { startFromToday } from './MoneyCheck';
import { Chips, Field, Sheet, toast } from './ui';

/**
 * "Poner a punto": decís cuánto tenés HOY en cada cuenta (y cuánto debés de la tarjeta) y Lifty
 * ajusta los saldos y cierra el mes anterior con lo que hace falta para que todo cuadre desde
 * hoy. Lo de antes queda como historia (informes), pero ya no desordena los números de hoy.
 */
let open: { intro?: string } | null = null;
const listeners = new Set<() => void>();
const set = (v: typeof open) => {
  open = v;
  listeners.forEach((fn) => fn());
};
export const openSetup = (intro?: string) => set({ intro });

export function SetupHost() {
  const req = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => open,
  );
  return req ? <SetupSheet intro={req.intro} onClose={() => set(null)} /> : null;
}

/** Lo que se debe de una tarjeta hoy, sin las cuotas de los meses que vienen. */
function cardDebtToday(data: LiftyData, card: Account, balance: number, today: string): number {
  const month = monthOf(today);
  const future = data.transactions
    .filter((t) => t.accountId === card.id && t.kind === 'expense')
    .flatMap((t) =>
      installmentsOf(t)
        .filter((i) => i.month > month)
        .map((i) =>
          convert(i.amount, t.currency, card.currency, t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : data.settings.usdRate),
        ),
    )
    .reduce((s, x) => s + x, 0);
  return round2(-balance - future);
}

function SetupSheet({ intro, onClose }: { intro?: string; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const balances = accountBalances(data, today).filter((x) => !x.account.archived);
  const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      balances.map((x) => [
        x.account.id,
        // Un banco en negativo casi seguro es un saldo que falta: mejor que lo escribas.
        x.account.type === 'credit'
          ? fmt(Math.max(0, cardDebtToday(data, x.account, x.balance, today)))
          : x.balance < 0
            ? ''
            : fmt(x.balance),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  // Metas que no dicen en qué cuenta están: primero eso (así el saldo de cada cuenta incluye su ahorro).
  const gb = goalBalances(data);
  const homeless = data.goals.filter(
    (g) =>
      !g.archived &&
      (!g.accountId || !data.accounts.some((a) => a.id === g.accountId)) &&
      Math.abs(gb.find((x) => x.goalId === g.id)?.balance ?? 0) > 0.004,
  );
  const [goalPlace, setGoalPlace] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(homeless.map((g) => [g.id, suggestGoalAccount(data, g)?.id ?? null])),
  );
  const places = data.accounts.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash'));
  const goalsIn = (accountId: string) =>
    data.goals
      .filter((g) => !g.archived && (g.accountId === accountId || goalPlace[g.id] === accountId))
      .map((g) => {
        const bal = gb.find((x) => x.goalId === g.id)?.balance ?? 0;
        return bal ? `${g.name} ${money(bal, g.currency)}` : null;
      })
      .filter(Boolean)
      .join(' · ');
  const groups: { title: string; hint?: string; list: typeof balances }[] = [
    {
      title: 'Bancos y efectivo',
      list: balances.filter((x) => (x.account.type === 'bank' || x.account.type === 'cash') && !x.account.reserved),
    },
    {
      title: 'Plata guardada',
      hint: 'Todo lo que hay (con lo de tus metas adentro). Lo que no sea de ninguna meta queda "sin destino".',
      list: balances.filter((x) => x.account.reserved && !x.account.investKind),
    },
    {
      title: 'Inversiones',
      hint: 'Lo que vale hoy (sin los intereses que todavía no cobraste).',
      list: balances.filter((x) => x.account.investKind),
    },
    {
      title: 'Tarjetas de crédito',
      hint: 'Lo que debés hoy: lo del resumen que todavía no pagaste (sin las cuotas de los meses que vienen, que Lifty ya conoce).',
      list: balances.filter((x) => x.account.type === 'credit'),
    },
    {
      title: 'Tarjeta de alimentación',
      hint: 'Va aparte: no cuenta como plata.',
      list: balances.filter((x) => x.account.type === 'food'),
    },
  ].filter((g) => g.list.length);

  const save = () => {
    const changed: Account[] = [];
    // Primero las tarjetas (lo que debías se paga desde el banco con el débito) y después los
    // bancos, ya con las tarjetas nuevas: así cada saldo queda exactamente como lo pusiste.
    let current = data;
    // Las metas en su cuenta.
    const goalsBefore: typeof data.goals = [];
    for (const g of homeless) {
      const acc = goalPlace[g.id];
      if (!acc) continue;
      goalsBefore.push(g);
      const updated = { ...g, accountId: acc };
      mutate('goal', 'upsert', updated);
      current = { ...current, goals: current.goals.map((x) => (x.id === g.id ? updated : x)) };
    }
    const ordered = [...balances].sort((a, b) => Number(b.account.type === 'credit') - Number(a.account.type === 'credit'));
    for (const x of ordered) {
      const v = parseAmount(values[x.account.id] ?? '');
      if (v === null) return setError(`Revisá el monto de ${x.account.name}.`);
      const now = accountBalances(current, today).find((y) => y.account.id === x.account.id)!.balance;
      let desired = v;
      if (x.account.type === 'credit') {
        // Lo que debés hoy + las cuotas que vienen = el saldo de la tarjeta (en negativo).
        const future = -x.balance - cardDebtToday(data, x.account, x.balance, today);
        desired = -(Math.abs(v) + future);
      }
      if (Math.abs(desired - now) < 0.005) continue;
      const adjusted = adjustBalance(current, x.account.id, desired, today);
      if (!adjusted) continue;
      changed.push(adjusted);
      current = { ...current, accounts: current.accounts.map((a) => (a.id === adjusted.id ? adjusted : a)) };
    }
    const before = data.accounts.filter((a) => changed.some((c) => c.id === a.id));
    for (const a of changed) mutate('account', 'upsert', a);
    // Con los saldos reales, el mes anterior se cierra con lo que hace falta para que cuadre.
    const next: LiftyData = current;
    const c = moneyCheck(next, today, b);
    if (Math.abs(c.difference) >= 1) startFromToday(next, c, today);
    else toast('Listo: tus cuentas cuadran');
    local.set('lifty-setup-done', today);
    if (before.length)
      setTimeout(
        () =>
          toast(`${before.length} saldo${before.length === 1 ? '' : 's'} ajustado${before.length === 1 ? '' : 's'}`, {
            action: { label: 'Deshacer saldos', run: () => before.forEach((a) => mutate('account', 'upsert', a)) },
          }),
        2500,
      );
    onClose();
  };

  return (
    <Sheet
      title="Poner a punto"
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save}>
          Listo: que cuadre desde hoy
        </button>
      }
    >
      <div className="form">
        <p className="muted">
          {intro ?? 'Decime cuánto tenés hoy en cada lugar (mirá la app del banco y contá el efectivo).'} Lifty ajusta los saldos
          y arranca a cuadrar desde hoy: lo de antes queda como historia, pero ya no desordena tus números.
        </p>
        {error && <p className="field-error">{error}</p>}
        {homeless.length > 0 && (
          <div className="setup-group">
            <strong className="small">¿Dónde está tu ahorro?</strong>
            <p className="muted small">Cada meta vive en una cuenta: así no se cuenta dos veces ni se mezcla con lo de gastar.</p>
            {homeless.map((g) => (
              <Field
                key={g.id}
                label={`${g.icon} ${g.name} (${money(gb.find((x) => x.goalId === g.id)?.balance ?? 0, g.currency)})`}
              >
                <Chips
                  label={`Cuenta de ${g.name}`}
                  value={goalPlace[g.id] ?? null}
                  onChange={(v) => setGoalPlace({ ...goalPlace, [g.id]: v })}
                  options={places.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon }))}
                />
              </Field>
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="setup-group">
            <strong className="small">{g.title}</strong>
            {g.hint && <p className="muted small">{g.hint}</p>}
            {g.list.map((x) => (
              <Field
                key={x.account.id}
                label={`${x.account.icon} ${x.account.name}${x.account.type === 'credit' ? ': ¿cuánto debés?' : ''} (${x.account.currency === 'USD' ? 'US$' : '$'})`}
                hint={`Lifty dice ${money(x.account.type === 'credit' ? Math.max(0, cardDebtToday(data, x.account, x.balance, today)) : x.balance, x.account.currency)}${goalsIn(x.account.id) ? ` · adentro: ${goalsIn(x.account.id)}` : ''}`}
              >
                <input
                  inputMode="decimal"
                  value={values[x.account.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [x.account.id]: e.target.value })}
                  aria-label={`Saldo de ${x.account.name}`}
                />
              </Field>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
