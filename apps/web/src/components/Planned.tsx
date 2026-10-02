import type { PlannedLine } from '@lifty/core';
import { confirmPlanned, unconfirmPlanned } from '../lib/actions';
import { money } from '../lib/format';
import { useData, useLookups } from '../lib/store';
import { Icon } from './Icon';
import { openTxForm } from './TxForm';

/** Lista "checklist" de cosas planificadas del mes: tocás el círculo y queda pagado/cobrado. */
export function PlannedList({ lines, month }: { lines: PlannedLine[]; month: string }) {
  const data = useData();
  const { category } = useLookups();
  return (
    <ul className="planned">
      {lines.map((line) => {
        const cat = line.categoryId ? category.get(line.categoryId) : undefined;
        const verb = line.kind === 'fixed' ? 'pagado' : 'cobrado';
        const diff = line.actual !== null && line.planned !== 0 ? line.actual - line.planned : 0;
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
                {line.confirmed ? `${verb[0].toUpperCase()}${verb.slice(1)}` : line.day ? `Vence el ${line.day}` : 'Pendiente'}
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
