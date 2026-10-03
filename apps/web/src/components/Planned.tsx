import type { PlannedLine } from '@lifty/core';
import { confirmPlanned, unconfirmPlanned } from '../lib/actions';
import { money } from '../lib/format';
import { useData, useLookups, useToday } from '../lib/store';
import { Icon } from './Icon';
import { openTxForm } from './TxForm';

/** Lista "checklist" de cosas planificadas del mes: tocás el círculo y queda pagado/cobrado. */
export function PlannedList({ lines, month }: { lines: PlannedLine[]; month: string }) {
  const data = useData();
  const today = useToday();
  const { category } = useLookups();
  const isCurrent = today.slice(0, 7) === month;
  const todayDay = Number(today.slice(8, 10));
  /** Estado del vencimiento para lo que todavía no se pagó / cobró. */
  const due = (line: PlannedLine): { text: string; tone: '' | 'warn' | 'bad' } => {
    const fixed = line.kind === 'fixed';
    if (!line.day) return { text: 'Pendiente', tone: '' };
    if (isCurrent) {
      const diff = line.day - todayDay;
      if (diff < 0) return { text: fixed ? `Venció el ${line.day}` : `Se cobraba el ${line.day}`, tone: fixed ? 'bad' : 'warn' };
      if (diff === 0) return { text: fixed ? 'Vence hoy' : 'Se cobra hoy', tone: 'warn' };
      if (diff <= 3)
        return {
          text: fixed ? `Vence en ${diff} día${diff > 1 ? 's' : ''}` : `Se cobra en ${diff} día${diff > 1 ? 's' : ''}`,
          tone: 'warn',
        };
    }
    return { text: fixed ? `Vence el ${line.day}` : `Se cobra el ${line.day}`, tone: '' };
  };
  return (
    <ul className="planned">
      {lines.map((line) => {
        const cat = line.categoryId ? category.get(line.categoryId) : undefined;
        const verb = line.kind === 'fixed' ? 'pagado' : 'cobrado';
        const diff = line.actual !== null && line.planned !== 0 ? line.actual - line.planned : 0;
        const state = due(line);
        return (
          <li key={line.key} className={line.confirmed ? 'done' : ''}>
            <button
              className="check"
              aria-pressed={line.confirmed}
              aria-label={line.confirmed ? `Marcar ${line.name} como pendiente` : `Marcar ${line.name} como ${verb}`}
              onClick={() => (line.confirmed ? unconfirmPlanned(data, line) : confirmPlanned(data, line, month))}
            >
              <Icon name="check" size={16} />
            </button>
            <button
              className="planned-main"
              onClick={() => {
                const tx = data.transactions.find((t) => t.id === line.txIds[0]);
                if (tx) openTxForm({ tx });
                else
                  openTxForm({
                    preset: {
                      kind: line.kind === 'fixed' ? 'expense' : 'income',
                      amount: line.plannedOriginal,
                      currency: line.currency,
                      categoryId: line.categoryId,
                      accountId: line.accountId,
                      description: line.name,
                      linkKind: line.kind,
                      linkId: line.refId,
                      linkMonth: month,
                    },
                  });
              }}
            >
              <span className="planned-name">
                {cat?.icon && <span aria-hidden="true">{cat.icon} </span>}
                {line.name}
              </span>
              <span className="planned-meta">
                {line.confirmed ? (
                  `${verb[0].toUpperCase()}${verb.slice(1)}`
                ) : (
                  <span className={state.tone ? `due-${state.tone}` : ''}>{state.text}</span>
                )}
                {line.detail && ` · ${line.detail}`}
                {diff !== 0 && ` · ${diff > 0 ? '+' : ''}${money(diff)} vs. lo planificado`}
              </span>
            </button>
            <span className="planned-amount">
              {money(line.amount)}
              {line.currency === 'USD' && <small>{money(line.plannedOriginal, 'USD')}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
