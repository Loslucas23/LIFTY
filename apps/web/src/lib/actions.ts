import { daysInMonth, monthOf, newId, todayISO, type LiftyData, type PlannedLine, type Transaction } from '@lifty/core';
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
