import { useState } from 'react';
import {
  ACCOUNT_TYPES,
  accountBalances,
  debtTotals,
  adjustBalance,
  newId,
  round2,
  type Account,
  type Currency,
} from '@lifty/core';
import { openExplain, openMenu, openPrompt } from '../components/Editors';
import { Icon } from '../components/Icon';
import { WhereIsMyMoney } from '../components/MoneyCheck';
import { CashFlowCard } from './Review';
import { openTxForm } from '../components/TxForm';
import { Chips, Field, PageHeader, Section, Sheet, Toggle, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { navigate } from '../lib/router';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

export const TYPE_LABEL: Record<Account['type'], string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit: 'Tarjeta de crédito',
  food: 'Tarjeta de alimentación',
};

const COLORS = ['#1d4ed8', '#ea580c', '#16a34a', '#7c3aed', '#0d9488', '#dc2626', '#0ea5e9', '#64748b'];

/** Cuentas y saldos: cuánto tenés en cada lado, transferir, ajustar y deudas. */
export function Accounts() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const balances = accountBalances(data, today);
  const visible = balances.filter((b) => !b.account.archived);
  const money_ = visible.filter((b) => (b.account.type === 'bank' || b.account.type === 'cash') && !b.account.reserved);
  const saved = visible.filter((b) => (b.account.type === 'bank' || b.account.type === 'cash') && b.account.reserved);
  const credit = visible.filter((b) => b.account.type === 'credit');
  const food = visible.filter((b) => b.account.type === 'food');
  const totalMoney = round2(money_.reduce((s, b) => s + b.balanceUYU, 0));
  const debts = debtTotals(data);

  const adjust = (b: (typeof balances)[number]) => {
    const credit = b.account.type === 'credit';
    openPrompt({
      title: `Ajustar saldo de ${b.account.name}`,
      label: credit
        ? `¿Cuánto debés hoy en ${b.account.name}? (${b.account.currency === 'USD' ? 'US$' : '$'})`
        : `¿Cuánto hay hoy en ${b.account.name}? (${b.account.currency === 'USD' ? 'US$' : '$'})`,
      hint: credit
        ? 'Todo lo que debés: lo del próximo resumen más las cuotas que faltan. Si no debés nada, 0.'
        : 'Lifty ajusta el saldo inicial para que dé este número. Los movimientos no cambian.',
      initial: String(credit ? Math.max(0, -b.balance) : b.balance),
      onSubmit: (value) => {
        const target = credit ? -Math.abs(value) : value;
        mutate('account', 'upsert', adjustBalance(data, b.account.id, target, today) ?? b.account);
        toast(
          credit
            ? `${b.account.name}: debés ${money(Math.abs(value), b.account.currency)}`
            : `${b.account.name}: saldo ajustado a ${money(value, b.account.currency)}`,
        );
      },
    });
  };

  const accountMenu = (b: (typeof balances)[number]) => {
    const a = b.account;
    openMenu(
      a.name,
      [
        ...(a.type === 'food' ? [{ label: 'Abrir la tarjeta de alimentación', run: () => navigate('/alimentacion') }] : []),
        { label: 'Ver movimientos', run: () => navigate(`/movimientos?cuenta=${a.id}`) },
        { label: 'Ajustar saldo', hint: 'Si el saldo no coincide con el real', run: () => adjust(b) },
        ...(a.type !== 'food'
          ? [
              {
                label: a.type === 'credit' ? 'Pagar la tarjeta' : 'Transferir desde acá',
                hint: a.type === 'credit' ? 'Desde el banco: no cuenta como gasto' : 'Cajero, compra de dólares…',
                run: () =>
                  openTxForm({
                    preset:
                      a.type === 'credit'
                        ? { kind: 'transfer', toAccountId: a.id, description: 'Pago de la tarjeta' }
                        : { kind: 'transfer', accountId: a.id },
                  }),
              },
            ]
          : []),
        { label: 'Editar cuenta', run: () => setEditing(a) },
      ],
      `${TYPE_LABEL[a.type]} · saldo ${money(b.balance, a.currency)}`,
    );
  };

  const row = (b: (typeof balances)[number]) => (
    <button key={b.account.id} className="tx-row" onClick={() => accountMenu(b)}>
      <span className="tx-icon" style={{ '--tint': b.account.color } as React.CSSProperties}>
        {b.account.icon}
      </span>
      <span className="tx-main">
        <span className="tx-title">{b.account.name}</span>
        <span className="tx-meta">
          {TYPE_LABEL[b.account.type]}
          {b.account.currency === 'USD' ? ' · en dólares' : ''}
        </span>
      </span>
      <span className={`tx-amount ${b.balance < 0 ? 'text-expense' : ''}`}>
        {money(b.balance, b.account.currency)}
        {b.account.currency === 'USD' && <small> ≈ {money(b.balanceUYU)}</small>}
      </span>
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Cuentas"
        subtitle="Cuánto tenés en cada lado"
        actions={
          <>
            <button className="btn" onClick={() => openTxForm({ preset: { kind: 'transfer' } })}>
              <Icon name="repeat" /> Transferir
            </button>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" /> Cuenta
            </button>
          </>
        }
      />

      <section
        className="hero hero-calm explainable-hero"
        onClick={() =>
          openExplain({
            title: 'Plata disponible',
            intro:
              'La suma de tus bancos y el efectivo para usar, en pesos (los dólares a la cotización actual). Las cuentas de plata guardada van aparte.',
            rows: money_.map((b) => ({ label: b.account.name, value: b.balanceUYU, op: '+' as const })),
            result: { label: 'Total', value: totalMoney },
            footnote:
              'Cada saldo es: saldo inicial + ingresos − gastos ± transferencias ± préstamos. El ahorro sale de la cuenta solo si la meta está guardada fuera de tus cuentas.',
          })
        }
      >
        <p className="hero-label">Plata disponible</p>
        <p className="hero-value">{money(totalMoney)}</p>
        <div className="hero-stats">
          <div>
            <span>{credit.reduce((s, b) => s + b.balanceUYU, 0) > 0 ? 'Tarjeta (a favor)' : 'Debés en la tarjeta'}</span>
            <strong>{money(Math.round(Math.abs(credit.reduce((s, b) => s + b.balanceUYU, 0))))}</strong>
          </div>
          <a href="#/deudas" onClick={(e) => e.stopPropagation()}>
            <span>Te deben</span>
            <strong>{money(Math.round(debts.owedToMe))}</strong>
          </a>
          <a href="#/deudas" onClick={(e) => e.stopPropagation()}>
            <span>Debés</span>
            <strong>{money(Math.round(debts.iOwe))}</strong>
          </a>
        </div>
      </section>

      <WhereIsMyMoney />
      <CashFlowCard />

      <Section title="Bancos y efectivo">
        <div className="card list">{money_.map(row)}</div>
      </Section>
      {saved.length > 0 && (
        <Section title="Plata guardada (no se usa)">
          <div className="card list">{saved.map(row)}</div>
          <p className="muted small">
            No entra en lo disponible. Pasarle plata (transferir desde el BROU, comprar dólares) cuenta como ahorro; sacarle, como
            retiro.
          </p>
        </Section>
      )}
      {credit.length > 0 && (
        <Section
          title="Tarjetas de crédito"
          action={
            <a className="link small" href="#/tarjeta">
              Cuotas
            </a>
          }
        >
          <div className="card list">{credit.map(row)}</div>
        </Section>
      )}
      {food.length > 0 && (
        <Section
          title="Tarjeta de alimentación (aparte)"
          action={
            <a className="link small" href="#/alimentacion">
              Abrir
            </a>
          }
        >
          <div className="card list">{food.map(row)}</div>
        </Section>
      )}
      <p className="muted small">
        Los saldos son tan exactos como lo que cargues. Si alguno no coincide con el real, tocá la cuenta →{' '}
        <strong>Ajustar saldo</strong>. Pagar la tarjeta o sacar del cajero es una <strong>transferencia</strong>: no cuenta como
        gasto.
      </p>
      {balances.some((b) => b.account.archived) && (
        <Section title="Archivadas">
          <div className="card list">{balances.filter((b) => b.account.archived).map(row)}</div>
        </Section>
      )}
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function AccountForm({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(account?.name ?? '');
  const [icon, setIcon] = useState(account?.icon ?? '🏦');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'bank');
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? 'UYU');
  const [color, setColor] = useState(account?.color ?? COLORS[0]);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [load, setLoad] = useState(account?.monthlyLoad ? String(account.monthlyLoad) : '');
  const [loadDay, setLoadDay] = useState(account?.loadDay ? String(account.loadDay) : '');
  const [reserved, setReserved] = useState(account?.reserved ?? false);
  const [autopay, setAutopay] = useState(account?.autopay ?? true);
  const [payFrom, setPayFrom] = useState<string | null>(account?.payFromAccountId ?? null);
  const [payDay, setPayDay] = useState(account?.payDay ? String(account.payDay) : '');
  const payable = data.accounts.filter((a) => (a.type === 'bank' || a.type === 'cash') && !a.archived && !a.reserved);
  const save = () => {
    if (!name.trim()) return;
    mutate('account', 'upsert', {
      id: account?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      type,
      currency,
      icon: icon || '🏦',
      color,
      archived,
      sort: account?.sort ?? data.accounts.length + 1,
      initialBalance: account?.initialBalance ?? 0,
      initialBalanceDate: account?.initialBalanceDate ?? null,
      monthlyLoad: type === 'food' ? parseAmount(load) || null : null,
      loadDay: type === 'food' && loadDay ? Math.min(31, Math.max(1, Number(loadDay))) : null,
      reserved: (type === 'bank' || type === 'cash') && reserved,
      autopay: type === 'credit' ? autopay : true,
      payFromAccountId: type === 'credit' ? payFrom : null,
      payDay: type === 'credit' && payDay ? Math.min(28, Math.max(1, Number(payDay))) : null,
    });
    toast('Cuenta guardada');
    onClose();
  };
  return (
    <Sheet
      title={account ? 'Editar cuenta' : 'Nueva cuenta'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save} disabled={!name.trim()}>
          Guardar
        </button>
      }
    >
      <div className="form">
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Santander" />
          </Field>
        </div>
        <Field label="Tipo">
          <Chips
            label="Tipo"
            value={type}
            onChange={setType}
            options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
        </Field>
        {type !== 'food' && (
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
        )}
        {type === 'food' && (
          <>
            <p className="note">
              La tarjeta de alimentación no es plata: lo que cargues y gastes con ella <strong>no entra en tu presupuesto</strong>
              . Tiene su propio saldo y su pantalla.
            </p>
            <div className="row">
              <Field label="Carga por mes" hint="Lo que deposita la empresa">
                <input inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} placeholder="Ej: 7000" />
              </Field>
              <Field label="Día de carga">
                <input
                  inputMode="numeric"
                  value={loadDay}
                  onChange={(e) => setLoadDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="Ej: 1"
                />
              </Field>
            </div>
          </>
        )}
        {type === 'credit' && (
          <>
            <Toggle
              checked={autopay}
              onChange={setAutopay}
              label="Pago el resumen entero todos los meses (débito automático o a mano)"
            />
            {autopay ? (
              <>
                <p className="muted small">
                  Cada resumen vencido se da por pagado desde la cuenta que elijas, aunque no lo anotes. Si un mes pagás vos (o
                  una parte), anotalo con "Pagar" y Lifty usa eso.
                </p>
                <Field label="Se paga desde">
                  <Chips
                    label="Se paga desde"
                    value={payFrom}
                    onChange={setPayFrom}
                    options={[
                      { value: null as string | null, label: payable[0] ? `La principal (${payable[0].name})` : 'La principal' },
                      ...payable.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
                    ]}
                  />
                </Field>
                <Field label="Día de pago (del mes siguiente)" hint="Si lo dejás vacío, se toma el último día del mes">
                  <input
                    inputMode="numeric"
                    value={payDay}
                    onChange={(e) => setPayDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="Ej: 10"
                  />
                </Field>
              </>
            ) : (
              <p className="muted small">
                Pagás el mínimo o en partes: anotá cada pago en Tarjeta → Pagar. Lo que no pagues queda como deuda.
              </p>
            )}
          </>
        )}
        {(type === 'bank' || type === 'cash') && (
          <>
            <Toggle checked={reserved} onChange={setReserved} label="Es plata guardada (no se usa para gastar)" />
            {reserved && (
              <p className="muted small">
                Ej: BROU dólares, caja de ahorro. Va aparte de lo disponible y pasarle plata cuenta como ahorro.
              </p>
            )}
          </>
        )}
        <Field label="Color">
          <div className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={color === c ? 'on' : ''}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Field>
        {account && <Toggle checked={archived} onChange={setArchived} label="Archivada (no aparece al cargar)" />}
      </div>
    </Sheet>
  );
}
