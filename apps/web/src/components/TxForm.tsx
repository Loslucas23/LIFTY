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
import { useData, useMonth } from '../lib/store';
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

  // Cuánto queda del presupuesto de la categoría elegida (el mes del gasto).
  const budgetMonth = monthOf(date);
  const mb = useMonth(budgetMonth);
  const catInfo = kind === 'expense' && categoryId ? mb.categories.find((c) => c.categoryId === categoryId) : undefined;
  let budgetHint: { text: string; bad: boolean } | null = null;
  if (catInfo && catInfo.limit !== null && catInfo.remaining !== null) {
    const rate = currency === 'USD' ? data.settings.usdRate : 1;
    const thisMonth = isCredit && preview ? (preview.find((i) => i.month === budgetMonth)?.amount ?? 0) : (total ?? 0);
    const after = tx ? catInfo.remaining : catInfo.remaining - thisMonth * rate;
    const name = categories.find((c) => c.id === categoryId)?.name ?? '';
    budgetHint =
      after < 0
        ? {
            text: `${tx ? 'Te pasaste' : 'Con este gasto te pasás'} ${money(-after)} del presupuesto de ${name.toLowerCase()} (${money(catInfo.limit)})`,
            bad: true,
          }
        : {
            text: `${tx || !total ? 'Te quedan' : 'Con este gasto te quedan'} ${money(after)} de ${money(catInfo.limit)} en ${name.toLowerCase()}`,
            bad: false,
          };
  }

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

  // Sugerencias: lo que más cargaste de este tipo (con su categoría y cuenta).
  const suggestions = useMemo(() => {
    const byText = new Map<string, { text: string; count: number; last: Transaction }>();
    for (const t of data.transactions) {
      if (t.kind !== kind || t.linkKind || t.installments > 1 || !t.description.trim()) continue;
      const key = t.description.trim().toLowerCase();
      const entry = byText.get(key);
      if (entry) entry.count++;
      else byText.set(key, { text: t.description.trim(), count: 1, last: t });
    }
    return [...byText.values()].sort((a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date));
  }, [data.transactions, kind]);

  const pickSuggestion = (text: string, fillAll: boolean) => {
    setDescription(text);
    const match = suggestions.find((x) => x.text.toLowerCase() === text.trim().toLowerCase());
    if (!match) return;
    if (fillAll || categoryId === null) setCategoryId(match.last.categoryId);
    if (fillAll || accountId === null) setAccountId(match.last.accountId);
    if (fillAll && match.last.kind === 'saving') setGoalId(match.last.goalId);
    if (fillAll && !amountText) {
      setAmountText(String(Math.abs(match.last.amount)).replace('.', ','));
      setCurrency(match.last.currency);
    }
  };

  const duplicate = () => {
    if (!tx) return;
    openTxForm({
      preset: {
        kind: tx.kind,
        amount: tx.amount,
        currency: tx.currency,
        categoryId: tx.categoryId,
        accountId: tx.accountId,
        goalId: tx.goalId,
        description: tx.description,
        installments: tx.installments,
        date: todayISO(),
      },
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
          {tx && !linked && (
            <button className="btn btn-ghost" onClick={duplicate} title="Cargar otro igual con fecha de hoy">
              Duplicar
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
        {!tx && !linked && !description && suggestions.length > 0 && (
          <div className="quick">
            <span className="field-label">Lo de siempre</span>
            <div className="chips">
              {suggestions.slice(0, 6).map((x) => (
                <button key={x.text} type="button" className="chip" onClick={() => pickSuggestion(x.text, true)}>
                  {x.text}
                </button>
              ))}
            </div>
          </div>
        )}
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
            {budgetHint && <span className={`budget-hint ${budgetHint.bad ? 'bad' : ''}`}>{budgetHint.text}</span>}
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
            onChange={(e) => pickSuggestion(e.target.value, false)}
            placeholder="Ej: Cabify al centro"
            maxLength={200}
            list="tx-desc-suggestions"
            autoComplete="off"
          />
          <datalist id="tx-desc-suggestions">
            {suggestions.slice(0, 50).map((x) => (
              <option key={x.text} value={x.text} />
            ))}
          </datalist>
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
