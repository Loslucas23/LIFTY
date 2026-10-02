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

/** Marca algo planificado (sueldo, aguinaldo, gasto fijo) como cobrado/pagado. */
export function confirmPlanned(data: LiftyData, line: PlannedLine, month: string, amountOriginal = line.plannedOriginal) {
  const tx: Transaction = {
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
