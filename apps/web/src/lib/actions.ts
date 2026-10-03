import {
  addMonths,
  budgetId,
  daysInMonth,
  monthLabel,
  monthOf,
  newId,
  todayISO,
  type LiftyData,
  type PlannedLine,
  type Transaction,
} from '@lifty/core';
import { openPrompt } from '../components/Editors';
import { toast } from '../components/ui';
import { money } from './format';
import { mutate } from './sync';

function plannedDate(line: PlannedLine, month: string): string {
  const today = todayISO();
  if (monthOf(today) === month) return today;
  const day = Math.min(line.day ?? 1, daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

function linkedTx(data: LiftyData, line: PlannedLine, month: string, amountOriginal: number): Transaction {
  return {
    id: newId(),
    updatedAt: new Date().toISOString(),
    date: plannedDate(line, month),
    kind: line.kind === 'fixed' ? 'expense' : 'income',
    amount: amountOriginal,
    currency: line.currency,
    fxRate: line.currency === 'USD' ? data.settings.usdRate : 1,
    categoryId: line.categoryId ?? (line.kind === 'fixed' ? null : 'cat-sueldo'),
    accountId: line.accountId,
    toAccountId: null,
    sharedAmount: 0,
    sharedWith: '',
    tags: [],
    goalId: null,
    description: line.name,
    installments: 1,
    firstInstallmentMonth: null,
    linkKind: line.kind,
    linkId: line.refId,
    linkMonth: month,
  };
}

/** Marca algo planificado (sueldo, aguinaldo, gasto fijo) como cobrado/pagado. */
export function confirmPlanned(data: LiftyData, line: PlannedLine, month: string, amountOriginal = line.plannedOriginal) {
  const tx = linkedTx(data, line, month, amountOriginal);
  mutate('transaction', 'upsert', tx);
  toast(`${line.name}: ${line.kind === 'fixed' ? 'pagado' : 'cobrado'} (${money(amountOriginal, line.currency)})`, {
    action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', tx.id) },
  });
}

export function unconfirmPlanned(data: LiftyData, line: PlannedLine) {
  const removed = data.transactions.filter((t) => line.txIds.includes(t.id));
  for (const t of removed) mutate('transaction', 'delete', t.id);
  toast(`${line.name}: marcado como pendiente`, {
    action: { label: 'Deshacer', run: () => removed.forEach((t) => mutate('transaction', 'upsert', t)) },
  });
}

/** Marca como pagados/cobrados todos los pendientes de una lista (con lo planificado). */
export function confirmAll(data: LiftyData, lines: PlannedLine[], month: string) {
  const pending = lines.filter((l) => !l.confirmed);
  if (!pending.length) return;
  const txs = pending.map((l) => linkedTx(data, l, month, l.plannedOriginal));
  for (const tx of txs) mutate('transaction', 'upsert', tx);
  toast(`${txs.length} marcados como pagados`, {
    action: { label: 'Deshacer', run: () => txs.forEach((t) => mutate('transaction', 'delete', t.id)) },
  });
}

/**
 * Dar de baja un gasto fijo o un sueldo a partir de `fromMonth` (ese mes ya no cuenta).
 * Los meses anteriores no cambian. Si nunca llegó a aplicarse, se borra.
 */
export function stopPlanned(data: LiftyData, kind: 'fixed' | 'income', id: string, fromMonth: string) {
  const list = kind === 'fixed' ? data.fixed : data.incomes;
  const item = list.find((x) => x.id === id);
  if (!item) return;
  const entity = kind === 'fixed' ? 'fixed' : 'income';
  const restore = () => mutate(entity, 'upsert', item as never);
  if (item.startMonth >= fromMonth) {
    mutate(entity, 'delete', item.id);
  } else {
    mutate(entity, 'upsert', { ...item, endMonth: addMonths(fromMonth, -1) } as never);
  }
  toast(`${item.name}: dado de baja desde ${monthLabel(fromMonth).toLowerCase()}`, {
    action: { label: 'Deshacer', run: restore },
  });
}

/** Borrar del todo un gasto fijo o un sueldo (también de los meses anteriores). */
export function deletePlanned(data: LiftyData, kind: 'fixed' | 'income', id: string) {
  const list = kind === 'fixed' ? data.fixed : data.incomes;
  const item = list.find((x) => x.id === id);
  if (!item) return;
  const entity = kind === 'fixed' ? 'fixed' : 'income';
  mutate(entity, 'delete', item.id);
  toast(`${item.name} borrado`, { action: { label: 'Deshacer', run: () => mutate(entity, 'upsert', item as never) } });
}

/**
 * Presupuesto de una categoría. `scope = 'all'` cambia el de todos los meses (y saca el
 * particular de este mes si había); `scope = 'month'` cambia solo este mes.
 * `amount = null` quita el presupuesto.
 */
export function setCategoryBudget(
  data: LiftyData,
  month: string,
  categoryId: string,
  amount: number | null,
  scope: 'all' | 'month',
) {
  const cat = data.categories.find((c) => c.id === categoryId);
  if (!cat) return;
  const override = data.budgets.find((b) => b.month === month && b.categoryId === categoryId);
  if (scope === 'all') {
    mutate('category', 'upsert', { ...cat, monthlyLimit: amount && amount > 0 ? amount : null });
    if (override) mutate('budget', 'delete', override.id);
  } else if (amount === null) {
    if (override) mutate('budget', 'delete', override.id);
  } else {
    mutate('budget', 'upsert', { id: budgetId(month, categoryId), updatedAt: '', month, categoryId, amount });
  }
}

/**
 * Cambiar el monto de un gasto fijo o de un sueldo desde `month` en adelante, sin tocar
 * los meses anteriores (si ya venía de antes, se corta ahí y sigue uno nuevo).
 */
export function changePlannedAmount(data: LiftyData, kind: 'fixed' | 'income', id: string, month: string, amount: number) {
  const entity = kind === 'fixed' ? 'fixed' : 'income';
  const item = (kind === 'fixed' ? data.fixed : data.incomes).find((x) => x.id === id);
  if (!item) return;
  const patch =
    kind === 'fixed'
      ? { amount }
      : { netOverride: amount, ...('deductions' in item && item.deductions.length === 0 ? { gross: amount } : {}) };
  if (item.startMonth < month) {
    mutate(entity, 'upsert', { ...item, endMonth: addMonths(month, -1) } as never);
    mutate(entity, 'upsert', { ...item, ...patch, id: newId(), startMonth: month } as never);
  } else {
    mutate(entity, 'upsert', { ...item, ...patch } as never);
  }
  toast(`${item.name}: ${money(amount)} desde ${monthLabel(month).toLowerCase()}`);
}

/**
 * Gasto dividido: mantiene la deuda "X me debe su parte" en sincronía con el movimiento.
 * Si se deja de dividir y la deuda no tiene pagos, se borra.
 */
export function syncSplitDebt(data: LiftyData, tx: Transaction) {
  const existing = data.debts.find((d) => d.fromTxId === tx.id);
  if (tx.kind === 'expense' && tx.sharedAmount > 0 && tx.sharedWith) {
    mutate('debt', 'upsert', {
      ...(existing ?? { id: newId(), payments: [], settled: false }),
      updatedAt: '',
      person: tx.sharedWith,
      direction: 'lent',
      amount: tx.sharedAmount,
      currency: tx.currency,
      date: tx.date,
      description: tx.description || 'Gasto dividido',
      accountId: tx.accountId,
      fromTxId: tx.id,
    });
  } else if (existing && existing.payments.length === 0) {
    mutate('debt', 'delete', existing.id);
  }
}

/** Cambiar la cotización del dólar (la que se usa por defecto para convertir). */
export function editUsdRate(data: LiftyData) {
  openPrompt({
    title: 'Cotización del dólar',
    label: 'Pesos por dólar',
    initial: String(data.settings.usdRate).replace('.', ','),
    hint: 'Se usa para pasar a pesos lo que está en dólares. Cada movimiento en dólares guarda la cotización de su día.',
    confirm: 'Guardar',
    onSubmit: (v) => {
      if (!v || v <= 0) return 'Escribí un número, ej: 41,5';
      const prev = data.settings;
      mutate('settings', 'upsert', { ...prev, usdRate: v });
      toast(`Dólar a ${v.toLocaleString('es-UY')}`, {
        action: { label: 'Deshacer', run: () => mutate('settings', 'upsert', prev) },
      });
    },
  });
}
