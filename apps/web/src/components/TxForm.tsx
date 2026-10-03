import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  installmentsOf,
  monthLabel,
  monthOf,
  newId,
  todayISO,
  transactionSchema,
  type Currency,
  type Transaction,
  type TxKind,
} from '@lifty/core';
import { money, parseAmount } from '../lib/format';
import { useData } from '../lib/store';
import { mutate } from '../lib/sync';
import { Chips, Field, Segmented, Sheet, toast } from './ui';

// ---- Apertura global (botón +, presupuesto, ahorro...) ----

type Request = { tx?: Transaction; preset?: Partial<Transaction>; withdraw?: boolean } | null;
let request: Request = null;
const listeners = new Set<() => void>();

export function openTxForm(opts: { tx?: Transaction; preset?: Partial<Transaction>; withdraw?: boolean } = {}) {
  request = opts;
  listeners.forEach((fn) => fn());
}

function closeTxForm() {
  request = null;
  listeners.forEach((fn) => fn());
}

export function TxFormHost() {
  const req = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => request,
  );
  if (!req) return null;
  return <TxForm key={req.tx?.id ?? 'new'} tx={req.tx} preset={req.preset} withdraw={req.withdraw} onClose={closeTxForm} />;
}

// ---- Formulario ----

const KIND_LABEL: Record<TxKind, string> = { expense: 'Gasto', income: 'Ingreso', saving: 'Ahorro' };

function TxForm({
  tx,
  preset,
  withdraw: withdrawInit,
  onClose,
}: {
  tx?: Transaction;
  preset?: Partial<Transaction>;
  withdraw?: boolean;
  onClose: () => void;
}) {
  const data = useData();
  const start: Partial<Transaction> = tx ?? preset ?? {};
  const [kind, setKind] = useState<TxKind>(start.kind ?? 'expense');
  const [withdraw, setWithdraw] = useState(withdrawInit ?? (start.kind === 'saving' && (start.amount ?? 0) < 0));
  const [amountText, setAmountText] = useState(
    start.amount !== undefined ? String(start.kind === 'saving' ? Math.abs(start.amount) : start.amount).replace('.', ',') : '',
  );
  const [currency, setCurrency] = useState<Currency>(start.currency ?? 'UYU');
  const [categoryId, setCategoryId] = useState<string | null>(start.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(start.accountId ?? null);
  const [goalId, setGoalId] = useState<string | null>(start.goalId ?? null);
  const [date, setDate] = useState(start.date ?? todayISO());
  const [description, setDescription] = useState(start.description ?? '');
  const [installments, setInstallments] = useState(start.installments ?? 1);
  const [firstMonth, setFirstMonth] = useState<string | null>(start.firstInstallmentMonth ?? null);
  const [perInstallment, setPerInstallment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = !!(tx?.linkKind ?? preset?.linkKind);
  const accounts = data.accounts.filter((a) => !a.archived || a.id === accountId);
  const account = accounts.find((a) => a.id === accountId);
  const isCredit = kind === 'expense' && account?.type === 'credit' && !linked;
  const categories = data.categories.filter(
    (c) => c.kind === (kind === 'income' ? 'income' : 'expense') && (!c.archived || c.id === categoryId),
  );
  const goals = data.goals.filter((g) => !g.archived || g.id === goalId);

  const parsed = parseAmount(amountText);
  const signed = parsed === null ? null : kind === 'saving' && withdraw ? -Math.abs(parsed) : parsed;
  const total = signed === null ? null : isCredit && perInstallment ? signed * installments : signed;
  const preview = useMemo(() => {
    if (!isCredit || installments <= 1 || total === null) return null;
    return installmentsOf({ amount: total, date, installments, firstInstallmentMonth: firstMonth });
  }, [isCredit, installments, total, date, firstMonth]);

  const changeKind = (k: TxKind) => {
    setKind(k);
    if (k !== kind) setCategoryId(null);
    if (k === 'saving' && !goalId) {
      const g = goals.find((x) => x.currency === currency) ?? goals[0];
      if (g) setGoalId(g.id);
    }
  };

  const save = () => {
    if (total === null || total === 0) {
      setError('Escribí un monto (podés usar cuentas: 8000+5600).');
      return;
    }
    const record = {
      ...(tx ?? {}),
      ...(preset?.linkKind ? { linkKind: preset.linkKind, linkId: preset.linkId, linkMonth: preset.linkMonth } : {}),
      id: tx?.id ?? newId(),
      updatedAt: new Date().toISOString(),
      date,
      kind,
      amount: Math.round(total * 100) / 100,
      currency,
      fxRate: currency === 'USD' ? (tx?.currency === 'USD' ? tx.fxRate : data.settings.usdRate) : 1,
      categoryId: kind === 'saving' ? null : categoryId,
      accountId,
      goalId: kind === 'saving' ? goalId : null,
      description: description.trim(),
      installments: isCredit ? installments : 1,
      firstInstallmentMonth: isCredit && firstMonth && firstMonth !== monthOf(date) ? firstMonth : null,
    };
    const result = transactionSchema.safeParse(record);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Revisá los datos.');
      return;
    }
    mutate('transaction', 'upsert', result.data);
    onClose();
    const label = KIND_LABEL[kind];
    if (tx) toast(`${label} actualizado`);
    else
      toast(`${label} de ${money(result.data.amount, currency)} guardado`, {
        action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', result.data.id) },
      });
  };

  const remove = () => {
    if (!tx) return;
    mutate('transaction', 'delete', tx.id);
    onClose();
    toast('Movimiento borrado', { action: { label: 'Deshacer', run: () => mutate('transaction', 'upsert', tx) } });
  };

  return (
    <Sheet
      title={
        tx ? `Editar ${KIND_LABEL[kind].toLowerCase()}` : linked ? `Confirmar ${preset?.description ?? ''}` : 'Nuevo movimiento'
      }
      onClose={onClose}
      footer={
        <>
          {tx && (
            <button className="btn btn-danger-ghost" onClick={remove}>
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!linked && (
          <Segmented
            label="Tipo"
            value={kind}
            onChange={changeKind}
            options={[
              { value: 'expense', label: 'Gasto' },
              { value: 'income', label: 'Ingreso' },
              { value: 'saving', label: 'Ahorro' },
            ]}
          />
        )}

        <div className="amount-input">
          <button
            type="button"
            className="currency-btn"
            onClick={() => setCurrency(currency === 'UYU' ? 'USD' : 'UYU')}
            aria-label="Cambiar moneda"
          >
            {currency === 'UYU' ? '$' : 'US$'}
          </button>
          <input
            data-autofocus
            inputMode="decimal"
            placeholder="0"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setError(null);
            }}
            aria-label="Monto"
            enterKeyHint="done"
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        {parsed !== null && /[+-]/.test(amountText.slice(1)) && <p className="muted small">= {money(parsed, currency)}</p>}
        {kind === 'saving' && (
          <Segmented
            label="Movimiento de ahorro"
            value={withdraw ? 'out' : 'in'}
            onChange={(v) => setWithdraw(v === 'out')}
            options={[
              { value: 'in', label: 'Guardar' },
              { value: 'out', label: 'Retirar' },
            ]}
          />
        )}
        {currency === 'USD' && total !== null && (
          <p className="muted small">
            ≈ {money(total * data.settings.usdRate)} (dólar a {data.settings.usdRate})
          </p>
        )}

        {kind === 'saving' ? (
          <Field label="Meta de ahorro">
            <Chips
              label="Meta de ahorro"
              value={goalId}
              onChange={setGoalId}
              options={goals.map((g) => ({ value: g.id as string | null, label: g.name, icon: g.icon, color: g.color }))}
            />
          </Field>
        ) : (
          <Field label="Categoría">
            <Chips
              label="Categoría"
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id as string | null, label: c.name, icon: c.icon, color: c.color }))}
            />
          </Field>
        )}

        <Field label={kind === 'income' ? '¿Dónde entró?' : kind === 'saving' ? '¿De dónde salió?' : '¿Con qué pagaste?'}>
          <Chips
            label="Cuenta"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: null, label: 'Sin indicar' },
              ...accounts.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon, color: a.color })),
            ]}
          />
        </Field>

        {isCredit && (
          <div className="installments">
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
            {installments > 1 && (
              <>
                <Segmented
                  label="El monto es"
                  value={perInstallment ? 'cuota' : 'total'}
                  onChange={(v) => setPerInstallment(v === 'cuota')}
                  options={[
                    { value: 'total', label: 'Monto total' },
                    { value: 'cuota', label: 'Monto por cuota' },
                  ]}
                />
                <Field label="Primera cuota en">
                  <input
                    type="month"
                    value={firstMonth ?? monthOf(date)}
                    onChange={(e) => setFirstMonth(e.target.value || null)}
                  />
                </Field>
                {preview && (
                  <p className="muted small">
                    {installments} cuotas de {money(preview[0].amount, currency)} · de {monthLabel(preview[0].month)} a{' '}
                    {monthLabel(preview[preview.length - 1].month)}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div className="row">
          <Field label="Fecha">
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Detalle">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Cabify al centro"
            maxLength={200}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
