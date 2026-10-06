import type { Transaction } from '@lifty/core';
import { money } from '../lib/format';
import { useLookups } from '../lib/store';
import { openTxForm } from './TxForm';

export function TxRow({ tx, showDate = false }: { tx: Transaction; showDate?: boolean }) {
  const { category, account, goal } = useLookups();
  const cat = tx.categoryId ? category.get(tx.categoryId) : undefined;
  // "Comida afuera › Delivery" si es una subcategoría.
  const parent = cat?.parentId ? category.get(cat.parentId) : undefined;
  const catName = cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : undefined;
  const acc = tx.accountId ? account.get(tx.accountId) : undefined;
  const to = tx.toAccountId ? account.get(tx.toAccountId) : undefined;
  const g = tx.goalId ? goal.get(tx.goalId) : undefined;
  const food = acc?.type === 'food';
  const transfer = tx.kind === 'transfer';
  const icon = transfer ? '🔁' : tx.kind === 'saving' ? (g?.icon ?? '🐷') : (cat?.icon ?? (tx.kind === 'income' ? '💰' : '•'));
  const color = transfer ? 'var(--series-1)' : tx.kind === 'saving' ? g?.color : cat?.color;
  const title =
    tx.description || (transfer ? 'Transferencia' : tx.kind === 'saving' ? (g?.name ?? 'Ahorro') : (catName ?? 'Sin categoría'));
  const meta = [
    transfer ? `${acc?.name ?? '?'} → ${to?.name ?? '?'}` : null,
    !transfer && tx.description ? (tx.kind === 'saving' ? g?.name : catName) : null,
    !transfer ? acc?.name : null,
    food ? 'aparte del presupuesto' : null,
    tx.installments > 1 ? `${tx.installments} cuotas` : null,
    tx.sharedAmount > 0 ? `dividido con ${tx.sharedWith || 'alguien'}` : null,
    tx.tags?.length ? tx.tags.map((t) => `#${t}`).join(' ') : null,
    tx.linkKind && !transfer && tx.linkKind !== 'load' ? 'Confirmado del presupuesto' : null,
    showDate ? tx.date.split('-').reverse().join('/') : null,
  ].filter(Boolean);
  // Un gasto negativo es un reintegro (suma); un ahorro negativo es un retiro.
  const positive = tx.amount > 0;
  const sign = transfer
    ? ''
    : tx.kind === 'income'
      ? positive
        ? '+'
        : '−'
      : tx.kind === 'expense'
        ? positive
          ? '−'
          : '+'
        : positive
          ? ''
          : '−';
  return (
    <button className={`tx-row ${food ? 'tx-food' : ''}`} onClick={() => openTxForm({ tx })}>
      <span className="tx-icon" style={{ '--tint': color ?? 'var(--muted)' } as React.CSSProperties}>
        {icon}
      </span>
      <span className="tx-main">
        <span className="tx-title">{title}</span>
        {meta.length > 0 && <span className="tx-meta">{meta.join(' · ')}</span>}
      </span>
      <span className={`tx-amount ${sign === '+' ? 'tx-income' : ''} ${transfer ? 'muted' : ''}`}>
        {sign}
        {money(Math.abs(tx.amount), tx.currency).replace('-', '')}
        {tx.amount < 0 && <small> ({tx.kind === 'saving' ? 'retiro' : 'reintegro'})</small>}
        {tx.sharedAmount > 0 && <small>tu parte {money(tx.amount - tx.sharedAmount, tx.currency)}</small>}
      </span>
    </button>
  );
}
