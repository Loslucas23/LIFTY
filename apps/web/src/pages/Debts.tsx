import { useMemo, useState } from 'react';
import {
  debtSchema,
  debtStatus,
  debtTotals,
  loanPlan,
  monthLabel,
  newId,
  todayISO,
  type Currency,
  type Debt,
  groupTotals,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Progress, Section, Segmented, Sheet, Toggle, toast } from '../components/ui';
import { dayLabel, money, parseAmount } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { openDebtReminder } from '../components/DebtReminder';

/** Deudas y préstamos con otras personas: no son gastos ni ingresos, pero mueven tus cuentas. */
export function Debts() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const totals = debtTotals(data);
  const statuses = data.debts.map(debtStatus);
  const open = statuses.filter((s) => !s.done);
  const done = statuses.filter((s) => s.done);
  const lent = open.filter((s) => s.debt.direction === 'lent');
  const borrowed = open.filter((s) => s.debt.direction === 'borrowed');
  const viewed = data.debts.find((d) => d.id === viewing);

  const row = (s: (typeof statuses)[number]) => (
    <button key={s.debt.id} className="tx-row" onClick={() => setViewing(s.debt.id)}>
      <span
        className="tx-icon"
        style={{ '--tint': s.debt.direction === 'lent' ? 'var(--income)' : 'var(--expense)' } as React.CSSProperties}
      >
        {s.debt.direction === 'lent' ? '🤝' : '🧾'}
      </span>
      <span className="tx-main">
        <span className="tx-title">{s.debt.person}</span>
        <span className="tx-meta">
          {[
            s.debt.description,
            s.debt.installmentAmount && s.debt.payDay
              ? `cuota ${money(s.debt.installmentAmount, s.debt.currency)} el ${s.debt.payDay}`
              : dayLabel(s.debt.date, today, true),
            s.paid > 0 ? `pagó ${money(s.paid, s.debt.currency)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <span className="tx-amount">{money(s.done ? s.debt.amount : s.remaining, s.debt.currency)}</span>
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Deudas y préstamos"
        subtitle="Lo que te deben y lo que debés"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      <div className="stat-row">
        <div className="card stat">
          <span>Te deben</span>
          <strong className="text-income">{money(totals.owedToMe)}</strong>
        </div>
        <div className="card stat">
          <span>Debés</span>
          <strong className="text-expense">{money(totals.iOwe)}</strong>
        </div>
      </div>
      <GroupsLink />
      {open.length === 0 && (
        <Empty icon="info" title="No hay deudas abiertas">
          Anotá cuando le prestás plata a alguien o te prestan. Si pagás algo por otro, al cargar el gasto usá "Dividir con
          alguien".
        </Empty>
      )}
      {lent.length > 0 && (
        <Section title="Te deben">
          <div className="card list">{lent.map(row)}</div>
        </Section>
      )}
      {borrowed.length > 0 && (
        <Section title="Debés">
          <div className="card list">{borrowed.map(row)}</div>
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Saldadas">
          <button className="btn btn-ghost" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Ocultar' : `Ver ${done.length} saldadas`}
          </button>
          {showDone && <div className="card list">{done.map(row)}</div>}
        </Section>
      )}
      {editing && <DebtForm debt={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewed && !editing && (
        <DebtSheet
          debt={viewed}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewed);
          }}
        />
      )}
    </div>
  );
}

function DebtForm({ debt, onClose }: { debt: Debt | null; onClose: () => void }) {
  const data = useData();
  const [direction, setDirection] = useState<Debt['direction']>(debt?.direction ?? 'lent');
  const [person, setPerson] = useState(debt?.person ?? '');
  const [amount, setAmount] = useState(debt ? String(debt.amount) : '');
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'UYU');
  const [date, setDate] = useState(debt?.date ?? todayISO());
  const [accountId, setAccountId] = useState<string | null>(debt?.accountId ?? null);
  const [description, setDescription] = useState(debt?.description ?? '');
  const [phone, setPhone] = useState(debt?.phone ?? '');
  const [inParts, setInParts] = useState(!!debt?.installmentAmount);
  const [installment, setInstallment] = useState(debt?.installmentAmount ? String(debt.installmentAmount) : '');
  const [payDay, setPayDay] = useState(debt?.payDay ? String(debt.payDay) : '');
  const [count, setCount] = useState(debt?.installments ? String(debt.installments) : '');
  const [error, setError] = useState<string | null>(null);
  const people = useMemo(() => [...new Set(data.debts.map((d) => d.person))].sort(), [data.debts]);
  const save = () => {
    const result = debtSchema.safeParse({
      ...(debt ?? {}),
      id: debt?.id ?? newId(),
      updatedAt: '',
      person: person.trim(),
      direction,
      amount: parseAmount(amount) ?? 0,
      currency,
      date,
      accountId,
      description: description.trim(),
      phone: direction === 'lent' ? phone.trim() : '',
      installmentAmount: inParts ? (parseAmount(installment) ?? null) : null,
      payDay: inParts && payDay ? Math.min(28, Math.max(1, Number(payDay))) : null,
      installments: inParts && count ? Math.max(1, Number(count)) : null,
    });
    if (!result.success) return setError('Poné el nombre y un monto mayor a 0.');
    if (inParts && (!result.data.installmentAmount || !result.data.payDay)) return setError('Poné la cuota y el día de pago.');
    mutate('debt', 'upsert', result.data);
    toast(
      direction === 'lent'
        ? `${result.data.person} te debe ${money(result.data.amount, currency)}`
        : `Le debés ${money(result.data.amount, currency)} a ${result.data.person}`,
    );
    onClose();
  };
  return (
    <Sheet
      title={debt ? 'Editar' : 'Nueva deuda o préstamo'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save}>
          Guardar
        </button>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <Segmented
          label="Tipo"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'lent', label: 'Yo presté (me deben)' },
            { value: 'borrowed', label: 'Me prestaron (debo)' },
          ]}
        />
        <Field label="¿Quién?">
          <input
            data-autofocus
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            list="lifty-people-debts"
            placeholder="Ej: Juan"
          />
          <datalist id="lifty-people-debts">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <div className="row">
          <Field label="Monto">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Moneda">
            <Chips
              label="Moneda"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'UYU', label: '$' },
                { value: 'USD', label: 'US$' },
              ]}
            />
          </Field>
        </div>
        {!debt?.fromTxId && (
          <Field
            label={direction === 'lent' ? '¿De dónde salió la plata?' : '¿Dónde entró la plata?'}
            hint="Para el saldo de la cuenta (opcional)"
          >
            <Chips
              label="Cuenta"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: null, label: 'Sin indicar' },
                ...data.accounts
                  .filter((a) => !a.archived && a.type !== 'food' && a.type !== 'credit')
                  .map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
              ]}
            />
          </Field>
        )}
        <div className="row">
          <Field label="Fecha">
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Detalle">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: para el alquiler"
            maxLength={200}
          />
        </Field>
        {direction === 'lent' && (
          <Field label="Su celular (opcional)" hint="Para recordarle por WhatsApp con un toque">
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej: 099 123 456" />
          </Field>
        )}
        <Toggle
          checked={inParts}
          onChange={setInParts}
          label={
            direction === 'borrowed' ? 'Lo pago en cuotas (préstamo del banco, una financiera…)' : 'Me lo devuelve en cuotas'
          }
        />
        {inParts && (
          <>
            <div className="row">
              <Field label="Cuota por mes">
                <input
                  inputMode="decimal"
                  value={installment}
                  onChange={(e) => setInstallment(e.target.value)}
                  placeholder="Ej: 3500"
                />
              </Field>
              <Field label="Día de pago">
                <input
                  inputMode="numeric"
                  value={payDay}
                  onChange={(e) => setPayDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="Ej: 10"
                />
              </Field>
            </div>
            <Field label="¿Cuántas cuotas son en total? (opcional)" hint="Para saber cuánto pagás de intereses">
              <input
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="Ej: 12"
              />
            </Field>
            <p className="muted small">
              La cuota entra en lo comprometido hasta el cobro (en Tu plata), en el calendario y en «Para hoy» el día de pago.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function DebtSheet({ debt, onClose, onEdit }: { debt: Debt; onClose: () => void; onEdit: () => void }) {
  const data = useData();
  const today = useToday();
  const s = debtStatus(debt);
  const plan = loanPlan(debt, today);
  const [amount, setAmount] = useState(String(plan ? Math.min(plan.installment, s.remaining) : s.remaining));
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState<string | null>(debt.accountId);
  const lent = debt.direction === 'lent';
  const addPayment = () => {
    const v = parseAmount(amount);
    if (!v || v <= 0) return toast('Escribí un monto', { tone: 'error' });
    const payment = { id: newId(), date, amount: Math.min(v, s.remaining || v), accountId };
    mutate('debt', 'upsert', { ...debt, payments: [...debt.payments, payment] });
    toast(
      lent
        ? `${debt.person} te pagó ${money(payment.amount, debt.currency)}`
        : `Le pagaste ${money(payment.amount, debt.currency)} a ${debt.person}`,
      {
        action: { label: 'Deshacer', run: () => mutate('debt', 'upsert', debt) },
      },
    );
    setAmount(String(Math.max(0, s.remaining - payment.amount)));
  };
  return (
    <Sheet
      title={lent ? `${debt.person} te debe` : `Le debés a ${debt.person}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-danger-ghost"
            onClick={() => {
              mutate('debt', 'delete', debt.id);
              toast('Borrada', { action: { label: 'Deshacer', run: () => mutate('debt', 'upsert', debt) } });
              onClose();
            }}
          >
            Borrar
          </button>
          <button className="btn btn-ghost" onClick={onEdit}>
            Editar
          </button>
          <button
            className="btn grow"
            onClick={() => {
              mutate('debt', 'upsert', { ...debt, settled: !debt.settled });
              onClose();
            }}
          >
            {debt.settled ? 'Reabrir' : 'Dar por saldada'}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="net-box">
          <span>{s.done ? 'Saldada' : 'Falta'}</span>
          <strong>{money(s.done ? debt.amount : s.remaining, debt.currency)}</strong>
        </div>
        <Progress value={s.paid} max={debt.amount} label="Pagado" />
        {lent && !s.done && !debt.installmentAmount && (
          <button
            className="btn"
            onClick={() => {
              onClose();
              openDebtReminder(debt.id);
            }}
          >
            💬 Recordarle por WhatsApp
            {debt.remindedAt ? (
              <span className="muted small"> · último: {dayLabel(debt.remindedAt, today, true).toLowerCase()}</span>
            ) : null}
          </button>
        )}
        {plan && !s.done && (
          <p className="small">
            Cuota de <strong>{money(plan.installment, debt.currency)}</strong> el día {plan.payDay} · faltan {plan.left} cuota
            {plan.left === 1 ? '' : 's'} · terminás en <strong>{monthLabel(plan.endMonth).toLowerCase()}</strong>
            {plan.interest !== null && plan.interest > 0
              ? ` · en total pagás ${money(plan.interest, debt.currency)} de intereses (${Math.round((plan.interest / debt.amount) * 100)}% más)`
              : ''}
          </p>
        )}
        <p className="muted small">
          {money(debt.amount, debt.currency)}{' '}
          {debt.date === today ? 'desde hoy' : `desde el ${dayLabel(debt.date, today, true).toLowerCase()}`}
          {debt.description ? ` · ${debt.description}` : ''}
          {debt.fromTxId ? ' · de un gasto dividido' : ''}
        </p>
        {debt.payments.length > 0 && (
          <div className="card list">
            {debt.payments.map((p) => (
              <div key={p.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">{money(p.amount, debt.currency)}</span>
                  <span className="tx-meta">
                    {dayLabel(p.date, today, true)}
                    {p.accountId ? ` · ${data.accounts.find((a) => a.id === p.accountId)?.name ?? ''}` : ''}
                  </span>
                </span>
                <button
                  className="icon-btn"
                  aria-label="Borrar pago"
                  onClick={() => mutate('debt', 'upsert', { ...debt, payments: debt.payments.filter((x) => x.id !== p.id) })}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {!s.done && (
          <div className="split">
            <strong>{lent ? 'Registrar que te pagó' : 'Registrar un pago'}</strong>
            <div className="row">
              <Field label="Monto">
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Fecha">
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </Field>
            </div>
            <Chips
              label="Cuenta"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: null, label: 'Sin indicar' },
                ...data.accounts
                  .filter((a) => !a.archived && a.type !== 'food' && a.type !== 'credit')
                  .map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
              ]}
            />
            <button className="btn btn-primary" onClick={addPayment}>
              {lent ? 'Me pagó' : 'Pagué'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Lo de los grupos va aparte (allá se ve quién le debe a quién). */
function GroupsLink() {
  const data = useData();
  if (!data.groups.some((g) => !g.archived)) return null;
  const t = groupTotals(data).UYU;
  return (
    <a className="card pad tile-link" href="#/grupos">
      <span className="tile-text">
        <strong>👥 Gastos en grupo</strong>
        <span className="muted small">
          {t.owedToMe > 0 || t.iOwe > 0
            ? [t.owedToMe > 0 ? `te deben ${money(t.owedToMe)}` : null, t.iOwe > 0 ? `debés ${money(t.iOwe)}` : null]
                .filter(Boolean)
                .join(' · ')
            : 'Están a mano en todos los grupos'}
        </span>
      </span>
    </a>
  );
}
