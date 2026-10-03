import { useState, useSyncExternalStore } from 'react';
import { addMonths, monthLabel, type Category } from '@lifty/core';
import { setCategoryBudget } from '../lib/actions';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useMonths } from '../lib/store';
import { BudgetWizard } from './BudgetWizard';
import { FixedForm, IncomeForm } from './PlanForms';
import { Field, Segmented, Sheet, toast } from './ui';

/**
 * Editores que se pueden abrir desde cualquier pantalla (presupuesto, inicio, listas):
 * menú de opciones, sueldo, gasto fijo, presupuesto de una categoría y el asistente.
 */

export interface MenuAction {
  label: string;
  hint?: string;
  tone?: 'danger';
  run: () => void;
}

type Editor =
  | { type: 'menu'; title: string; subtitle?: string; actions: MenuAction[] }
  | { type: 'fixed'; id: string | null; month?: string }
  | { type: 'income'; id: string | null; month?: string }
  | { type: 'budget'; month: string; categoryId: string }
  | { type: 'wizard'; month: string };

let current: Editor | null = null;
const listeners = new Set<() => void>();

function set(e: Editor | null) {
  current = e;
  listeners.forEach((fn) => fn());
}

export const openMenu = (title: string, actions: MenuAction[], subtitle?: string) =>
  set({ type: 'menu', title, subtitle, actions });
export const openFixedForm = (id: string | null, month?: string) => set({ type: 'fixed', id, month });
export const openIncomeForm = (id: string | null, month?: string) => set({ type: 'income', id, month });
export const openBudgetEditor = (month: string, categoryId: string) => set({ type: 'budget', month, categoryId });
export const openBudgetWizard = (month: string) => set({ type: 'wizard', month });

export function EditorsHost() {
  const editor = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
  );
  const data = useData();
  const close = () => set(null);
  if (!editor) return null;
  switch (editor.type) {
    case 'menu':
      return <MenuSheet title={editor.title} subtitle={editor.subtitle} actions={editor.actions} onClose={close} />;
    case 'fixed':
      return <FixedForm fixed={data.fixed.find((f) => f.id === editor.id) ?? null} month={editor.month} onClose={close} />;
    case 'income':
      return <IncomeForm income={data.incomes.find((i) => i.id === editor.id) ?? null} month={editor.month} onClose={close} />;
    case 'budget': {
      const cat = data.categories.find((c) => c.id === editor.categoryId);
      return cat ? <BudgetEditor key={cat.id} category={cat} month={editor.month} onClose={close} /> : null;
    }
    case 'wizard':
      return <BudgetWizard month={editor.month} onClose={close} />;
  }
}

function MenuSheet({
  title,
  subtitle,
  actions,
  onClose,
}: {
  title: string;
  subtitle?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {subtitle && <p className="muted small menu-subtitle">{subtitle}</p>}
      <div className="action-list">
        {actions.map((a) => (
          <button
            key={a.label}
            className={`action ${a.tone === 'danger' ? 'action-danger' : ''}`}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            <span>{a.label}</span>
            {a.hint && <small className="muted">{a.hint}</small>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Cuánto querés gastar en una categoría: este mes o todos los meses. */
function BudgetEditor({ category, month, onClose }: { category: Category; month: string; onClose: () => void }) {
  const data = useData();
  const b = useMonth(month);
  const info = b.categories.find((c) => c.categoryId === category.id);
  const override = data.budgets.find((x) => x.month === month && x.categoryId === category.id);
  const [scope, setScope] = useState<'all' | 'month'>(override ? 'month' : 'all');
  const initial = info?.limit ?? null;
  const [text, setText] = useState(initial !== null ? String(initial) : '');
  // Sugerencia: el promedio de los últimos 3 meses (redondeado a 100).
  const prev = [1, 2, 3].map((n) => addMonths(month, -n));
  const history = useMonthsSpent(prev, category.id);
  const suggestion = history.length ? Math.ceil(history.reduce((s, x) => s + x, 0) / history.length / 100) * 100 : null;
  const monthName = monthLabel(month, false).toLowerCase();

  const save = (value: number | null) => {
    setCategoryBudget(data, month, category.id, value, scope);
    toast(
      value === null
        ? `${category.name}: sin presupuesto`
        : `${category.name}: ${money(value)} ${scope === 'all' ? 'por mes' : `en ${monthName}`}`,
    );
    onClose();
  };

  return (
    <Sheet
      title={`${category.icon} ${category.name}`}
      onClose={onClose}
      footer={
        <>
          {initial !== null && (
            <button className="btn btn-danger-ghost" onClick={() => save(null)}>
              Sin presupuesto
            </button>
          )}
          <button
            className="btn btn-primary grow"
            onClick={() => {
              const v = parseAmount(text);
              if (v === null || v < 0) return toast('Escribí un monto', { tone: 'error' });
              save(v);
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = parseAmount(text);
          if (v !== null && v >= 0) save(v);
        }}
      >
        <p className="muted">
          ¿Cuánto querés gastar en {category.name.toLowerCase()}? Gastaste <strong>{money(info?.spent ?? 0)}</strong> en{' '}
          {monthName}
          {info?.fixed ? ` (más ${money(info.fixed)} de gastos fijos, que van aparte)` : ''}.
        </p>
        <div className="amount-input">
          <span className="currency-btn">$</span>
          <input
            data-autofocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="0"
            aria-label="Presupuesto"
          />
        </div>
        {suggestion !== null && suggestion > 0 && (
          <button type="button" className="link small left" onClick={() => setText(String(suggestion))}>
            Usar {money(suggestion)} (lo que gastaste en promedio los últimos meses)
          </button>
        )}
        <Field label="¿Para qué meses?">
          <Segmented
            label="Para qué meses"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Todos los meses' },
              { value: 'month', label: `Solo ${monthName}` },
            ]}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function useMonthsSpent(months: string[], categoryId: string): number[] {
  const sorted = [...months].sort();
  const all = useMonths(sorted[0], sorted[sorted.length - 1]);
  return all.map((m) => m.categories.find((c) => c.categoryId === categoryId)?.spent ?? 0).filter((v) => v > 0);
}
