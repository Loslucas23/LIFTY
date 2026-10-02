import type { Transaction } from '@lifty/core';
import { money } from '../lib/format';
import { useLookups } from '../lib/store';
import { openTxForm } from './TxForm';

export function TxRow({ tx, showDate = false }: { tx: Transaction; showDate?: boolean }) {
  const { category, account, goal } = useLookups();
  const cat = tx.categoryId ? category.get(tx.categoryId) : undefined;
  const acc = tx.accountId ? account.get(tx.accountId) : undefined;
  const g = tx.goalId ? goal.get(tx.goalId) : undefined;
  const icon = tx.kind === 'saving' ? (g?.icon ?? '🐷') : (cat?.icon ?? (tx.kind === 'income' ? '💰' : '•'));
  const color = tx.kind === 'saving' ? g?.color : cat?.color;
  const title = tx.description || (tx.kind === 'saving' ? (g?.name ?? 'Ahorro') : (cat?.name ?? 'Sin categoría'));
  const meta = [
    tx.description ? (tx.kind === 'saving' ? g?.name : cat?.name) : null,
    acc?.name,
    tx.installments > 1 ? `${tx.installments} cuotas` : null,
    tx.linkKind ? 'Confirmado del presupuesto' : null,
    showDate ? tx.date.split('-').reverse().join('/') : null,
  ].filter(Boolean);
  // Un gasto negativo es un reintegro (suma); un ahorro negativo es un retiro.
  const positive = tx.amount > 0;
  const sign =
    tx.kind === 'income' ? (positive ? '+' : '−') : tx.kind === 'expense' ? (positive ? '−' : '+') : positive ? '' : '−';
  return (
    <button className="tx-row" onClick={() => openTxForm({ tx })}>
      <span className="tx-icon" style={{ '--tint': color ?? 'var(--muted)' } as React.CSSProperties}>
        {icon}
      </span>
      <span className="tx-main">
        <span className="tx-title">{title}</span>
        {meta.length > 0 && <span className="tx-meta">{meta.join(' · ')}</span>}
      </span>
      <span className={`tx-amount ${sign === '+' ? 'tx-income' : ''}`}>
        {sign}
        {money(Math.abs(tx.amount), tx.currency).replace('-', '')}
        {tx.amount < 0 && <small> ({tx.kind === 'saving' ? 'retiro' : 'reintegro'})</small>}
      </span>
    </button>
  );
}
