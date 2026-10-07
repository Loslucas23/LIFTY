import { addMonths, monthLabel, type PlannedLine } from '@lifty/core';
import { changePlannedAmount, confirmPlanned, deletePlanned, stopPlanned, unconfirmPlanned } from '../lib/actions';
import { mutate } from '../lib/sync';
import { openFixedForm, openIncomeForm, openMenu, openPrompt, type MenuAction } from './Editors';
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
    // Un mes que ya pasó: no está "pendiente", falta tildarlo (cuenta como si se hubiera hecho).
    if (month < today.slice(0, 7)) return { text: fixed ? 'Sin tildar: ¿lo pagaste?' : 'Sin tildar: ¿lo cobraste?', tone: '' };
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
  const lineActions = (line: PlannedLine): MenuAction[] => {
    const fixed = line.kind === 'fixed';
    const verb = fixed ? 'pagado' : 'cobrado';
    const tx = data.transactions.find((t) => t.id === line.txIds[0]);
    const editTx = () =>
      tx
        ? openTxForm({ tx })
        : openTxForm({
            preset: {
              kind: fixed ? 'expense' : 'income',
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
    const actions: MenuAction[] = line.confirmed
      ? [
          { label: `Ver o cambiar lo ${verb}`, run: editTx },
          { label: 'Marcar como pendiente', run: () => unconfirmPlanned(data, line) },
        ]
      : [
          { label: `Marcar como ${verb}`, hint: money(line.amount), run: () => confirmPlanned(data, line, month) },
          { label: `${verb[0].toUpperCase()}${verb.slice(1)}, pero con otro monto…`, run: editTx },
        ];
    const next = addMonths(month, 1);
    const changeFrom = (kind: 'fixed' | 'income') => ({
      label: 'Cambiar el monto desde este mes',
      hint: 'Los meses anteriores quedan como estaban',
      run: () =>
        openPrompt({
          title: `${line.name}: nuevo monto`,
          label: `Monto desde ${monthLabel(month).toLowerCase()} (${line.currency === 'USD' ? 'US$' : '$'})`,
          initial: String(line.plannedOriginal),
          onSubmit: (v) => {
            if (v <= 0) return 'Tiene que ser mayor a 0';
            changePlannedAmount(data, kind, line.refId, month, v);
          },
        }),
    });
    if (line.kind === 'fixed' && data.fixed.some((f) => f.id === line.refId)) {
      actions.push(
        changeFrom('fixed'),
        { label: 'Editar gasto fijo', hint: 'Monto, día, categoría, frecuencia', run: () => openFixedForm(line.refId, month) },
        {
          label: 'Ya no lo pago',
          hint: `Sale del presupuesto desde ${monthLabel(month).toLowerCase()}`,
          run: () => stopPlanned(data, 'fixed', line.refId, month),
        },
        {
          label: `Lo pago este mes y después no`,
          hint: `Sale desde ${monthLabel(next).toLowerCase()}`,
          run: () => stopPlanned(data, 'fixed', line.refId, next),
        },
        { label: 'Borrar de todos los meses', tone: 'danger', run: () => deletePlanned(data, 'fixed', line.refId) },
      );
    }
    const income = data.incomes.find((i) => i.id === line.refId);
    if (line.kind === 'salary' && income) {
      actions.push(
        changeFrom('income'),
        { label: 'Editar sueldo', hint: 'Nominal, descuentos, desde/hasta', run: () => openIncomeForm(line.refId, month) },
        {
          label: 'Ya no lo cobro',
          hint: `Sale desde ${monthLabel(month).toLowerCase()}`,
          run: () => stopPlanned(data, 'income', line.refId, month),
        },
        {
          label: `Lo cobro este mes y después no`,
          hint: `Sale desde ${monthLabel(next).toLowerCase()}`,
          run: () => stopPlanned(data, 'income', line.refId, next),
        },
        { label: 'Borrar de todos los meses', tone: 'danger', run: () => deletePlanned(data, 'income', line.refId) },
      );
    }
    if (line.kind === 'aguinaldo' && income) {
      actions.push(
        { label: 'Editar sueldo', run: () => openIncomeForm(line.refId, month) },
        { label: 'Este trabajo no genera aguinaldo', run: () => mutate('income', 'upsert', { ...income, aguinaldo: false }) },
      );
    }
    return actions;
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
              onClick={() => openMenu(line.name, lineActions(line), `${money(line.amount)} · ${monthLabel(month)}`)}
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
            <button
              className="icon-btn planned-more"
              aria-label={`Más opciones de ${line.name}`}
              onClick={() => openMenu(line.name, lineActions(line), `${money(line.amount)} · ${monthLabel(month)}`)}
            >
              <Icon name="more" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
