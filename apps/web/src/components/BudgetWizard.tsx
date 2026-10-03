import { useMemo, useState } from 'react';
import { addMonths, isActiveIn, monthLabel, netSalary, newId, round2, type FixedExpense, type IncomeSource } from '@lifty/core';
import { changePlannedAmount, setCategoryBudget, stopPlanned } from '../lib/actions';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useMonths } from '../lib/store';
import { mutate } from '../lib/sync';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';

const STEPS = ['Ingresos', 'Gastos fijos', 'Por categoría', 'Listo'] as const;

/**
 * Asistente para armar el presupuesto del mes en 3 pasos:
 * cuánto entra → qué pagás sí o sí → cuánto querés gastar en cada cosa.
 */
export function BudgetWizard({ month, onClose }: { month: string; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const data = useData();
  const b = useMonth(month);
  const monthName = monthLabel(month, false).toLowerCase();

  // Paso 3: montos por categoría (texto de cada input).
  const categories = data.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      categories.map((c) => {
        const limit = b.categories.find((x) => x.categoryId === c.id)?.limit ?? null;
        return [c.id, limit !== null ? String(limit) : ''];
      }),
    ),
  );
  const history = useMonths(addMonths(month, -3), addMonths(month, -1));
  const suggestion = (categoryId: string) => {
    const vals = history.map((m) => m.categories.find((c) => c.categoryId === categoryId)?.spent ?? 0).filter((v) => v > 0);
    return vals.length ? Math.ceil(vals.reduce((s, v) => s + v, 0) / vals.length / 100) * 100 : null;
  };

  const assigned = round2(Object.values(amounts).reduce((s, v) => s + (parseAmount(v) ?? 0), 0));
  const unbudgetedSpent = round2(
    b.categories.filter((c) => !c.categoryId || !parseAmount(amounts[c.categoryId] ?? '')).reduce((s, c) => s + c.spent, 0),
  );
  const available = round2(b.carryover.amount + b.income.total - b.fixed.total - b.savings.total);
  const unassigned = round2(available - assigned - unbudgetedSpent);

  const saveCategories = () => {
    for (const c of categories) {
      const value = parseAmount(amounts[c.id] ?? '');
      const current = b.categories.find((x) => x.categoryId === c.id)?.limit ?? null;
      const next = value && value > 0 ? value : null;
      if (next !== current) setCategoryBudget(data, month, c.id, next, 'all');
    }
  };

  const next = () => {
    if (step === 2) saveCategories();
    if (step === STEPS.length - 1) return onClose();
    setStep(step + 1);
  };

  return (
    <Sheet
      title={`Presupuesto de ${monthName}`}
      onClose={onClose}
      wide
      footer={
        <>
          {step > 0 && step < STEPS.length - 1 && (
            <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              Atrás
            </button>
          )}
          <button className="btn btn-primary grow" onClick={next}>
            {step === 2 ? 'Guardar presupuesto' : step === STEPS.length - 1 ? 'Listo' : 'Siguiente'}
          </button>
        </>
      }
    >
      <ol className="wizard-steps" aria-label="Pasos">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <span>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && <IncomesStep month={month} />}
      {step === 1 && <FixedStep month={month} />}
      {step === 2 && (
        <div className="form">
          <div className={`plan-bar ${unassigned < 0 ? 'neg' : ''}`}>
            <div>
              <span>Para repartir</span>
              <strong>{money(available)}</strong>
            </div>
            <div>
              <span>Repartido</span>
              <strong>{money(assigned + unbudgetedSpent)}</strong>
            </div>
            <div>
              <span>{unassigned < 0 ? 'Te pasaste' : 'Sin asignar'}</span>
              <strong>{money(Math.abs(unassigned))}</strong>
            </div>
          </div>
          <p className="muted small">
            ¿Cuánto querés gastar por mes en cada cosa (aparte de los gastos fijos)? Dejá vacío lo que no quieras controlar. Vale
            para todos los meses; después podés cambiar un mes puntual.
          </p>
          <div className="budget-inputs">
            {categories.map((c) => {
              const sug = suggestion(c.id);
              const spent = b.categories.find((x) => x.categoryId === c.id)?.spent ?? 0;
              return (
                <label key={c.id} className="budget-input">
                  <span className="tx-icon" style={{ '--tint': c.color } as React.CSSProperties}>
                    {c.icon}
                  </span>
                  <span className="budget-input-name">
                    <strong>{c.name}</strong>
                    <small className="muted">
                      {spent > 0 ? `Gastado en ${monthName}: ${money(spent)}` : sug ? `Promedio: ${money(sug)}` : ' '}
                    </small>
                  </span>
                  <span className="budget-input-field">
                    $
                    <input
                      inputMode="decimal"
                      value={amounts[c.id] ?? ''}
                      placeholder={sug ? String(sug) : '0'}
                      onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                      aria-label={`Presupuesto para ${c.name}`}
                    />
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {step === 3 && <Summary month={month} />}
    </Sheet>
  );
}

function IncomesStep({ month }: { month: string }) {
  const data = useData();
  const active = data.incomes.filter((i) => isActiveIn(month, i.startMonth, i.endMonth));
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const add = () => {
    const value = parseAmount(amount);
    if (!name.trim() || !value || value <= 0) return toast('Poné un nombre y cuánto cobrás (líquido)', { tone: 'error' });
    const income: IncomeSource = {
      id: newId(),
      updatedAt: '',
      name: name.trim(),
      gross: value,
      netOverride: value,
      deductions: [],
      currency: 'UYU',
      startMonth: month,
      endMonth: null,
      aguinaldo: true,
      payDay: null,
      categoryId: 'cat-sueldo',
      accountId: null,
      archived: false,
    };
    mutate('income', 'upsert', income);
    setName('');
    setAmount('');
  };
  return (
    <div className="form">
      <p className="muted">
        ¿Cuánto cobrás por mes? Poné el sueldo líquido (lo que te llega). Se repite todos los meses hasta que lo des de baja.
      </p>
      <PlanRows kind="income" items={active} month={month} amountOf={(i) => netSalary(i as IncomeSource)} />
      <div className="add-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sueldo" aria-label="Nombre del ingreso" />
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Líquido"
          aria-label="Monto líquido"
        />
        <button type="button" className="btn" onClick={add}>
          <Icon name="plus" size={18} /> Agregar
        </button>
      </div>
      <p className="muted small">
        ¿Querés calcular el líquido desde el nominal (BPS, FONASA, IRPF)? Después tocá el sueldo en Presupuesto → Editar.
      </p>
    </div>
  );
}

function FixedStep({ month }: { month: string }) {
  const data = useData();
  const active = data.fixed.filter((f) => isActiveIn(month, f.startMonth, f.endMonth));
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const add = () => {
    const value = parseAmount(amount);
    if (!name.trim() || !value || value <= 0) return toast('Poné un nombre y un monto', { tone: 'error' });
    const fixed: FixedExpense = {
      id: newId(),
      updatedAt: '',
      name: name.trim(),
      amount: value,
      currency: 'UYU',
      categoryId: categoryId || null,
      accountId: null,
      dayOfMonth: day ? Math.min(31, Math.max(1, Number(day))) : null,
      startMonth: month,
      endMonth: null,
      archived: false,
    };
    mutate('fixed', 'upsert', fixed);
    setName('');
    setAmount('');
    setDay('');
  };
  return (
    <div className="form">
      <p className="muted">
        Lo que pagás todos los meses sí o sí: alquiler, internet, celular, gimnasio… Si algo ya no lo pagás, tocá{' '}
        <strong>Ya no lo pago</strong>.
      </p>
      <PlanRows kind="fixed" items={active} month={month} amountOf={(f) => (f as FixedExpense).amount} />
      <div className="add-row add-row-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Alquiler"
          aria-label="Nombre del gasto fijo"
        />
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Monto"
          aria-label="Monto"
        />
        <input
          inputMode="numeric"
          value={day}
          onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
          placeholder="Día"
          aria-label="Día de vencimiento"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoría">
          <option value="">Categoría…</option>
          {data.categories
            .filter((c) => c.kind === 'expense' && !c.archived)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
        </select>
        <button type="button" className="btn" onClick={add}>
          <Icon name="plus" size={18} /> Agregar
        </button>
      </div>
    </div>
  );
}

/** Filas editables (monto) con "Ya no lo pago / cobro". */
function PlanRows({
  kind,
  items,
  month,
  amountOf,
}: {
  kind: 'income' | 'fixed';
  items: (IncomeSource | FixedExpense)[];
  month: string;
  amountOf: (x: IncomeSource | FixedExpense) => number;
}) {
  const data = useData();
  const total = items.reduce((s, x) => s + amountOf(x), 0);
  if (!items.length)
    return <p className="empty-inline">{kind === 'income' ? 'Todavía no cargaste ingresos.' : 'No tenés gastos fijos.'}</p>;
  return (
    <div className="plan-rows">
      {items.map((x) => (
        <PlanRow key={x.id} item={x} kind={kind} amount={amountOf(x)} month={month} data={data} />
      ))}
      <div className="plan-rows-total">
        <span>Total por mes</span>
        <strong>{money(total)}</strong>
      </div>
    </div>
  );
}

function PlanRow({
  item,
  kind,
  amount,
  month,
  data,
}: {
  item: IncomeSource | FixedExpense;
  kind: 'income' | 'fixed';
  amount: number;
  month: string;
  data: ReturnType<typeof useData>;
}) {
  const [text, setText] = useState(String(round2(amount)));
  const commit = () => {
    const v = parseAmount(text);
    if (v === null || v <= 0) {
      setText(String(round2(amount)));
      return;
    }
    if (Math.abs(v - amount) > 0.001) changePlannedAmount(data, kind, item.id, month, v);
  };
  return (
    <div className="plan-row">
      <span className="plan-row-name">{item.name}</span>
      <span className="budget-input-field">
        $
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label={`Monto de ${item.name}`}
        />
      </span>
      <button type="button" className="btn btn-ghost small-btn" onClick={() => stopPlanned(data, kind, item.id, month)}>
        {kind === 'income' ? 'Ya no lo cobro' : 'Ya no lo pago'}
      </button>
    </div>
  );
}

function Summary({ month }: { month: string }) {
  const b = useMonth(month);
  const lines = useMemo(
    () => [
      ['Viene del mes anterior', b.carryover.amount],
      ['Ingresos', b.income.total],
      ['Gastos fijos', -b.fixed.total],
      ['Presupuesto por categoría', -b.plan.assigned],
      ['Gastos sin presupuesto', -b.plan.unbudgeted],
      ['Ahorro', -b.savings.total],
    ],
    [b],
  ) as [string, number][];
  return (
    <div className="form">
      <dl className="receipt">
        {lines
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="receipt-row">
              <dt>{label}</dt>
              <dd className={v < 0 ? 'text-expense' : 'text-income'}>
                {v > 0 ? '+' : '−'}
                {money(Math.abs(v))}
              </dd>
            </div>
          ))}
        <div className="receipt-row receipt-total">
          <dt>{b.plan.unassigned < 0 ? 'Te pasaste' : 'Te sobra (sin asignar)'}</dt>
          <dd className={b.plan.unassigned < 0 ? 'text-bad' : ''}>{money(Math.abs(b.plan.unassigned))}</dd>
        </div>
      </dl>
      {b.plan.unassigned < 0 ? (
        <p className="muted">Estás planeando gastar más de lo que entra. Bajá algún presupuesto o algún gasto fijo.</p>
      ) : (
        <p className="muted">
          Listo. A medida que cargues gastos vas a ver cuánto te queda en cada categoría
          {b.daily ? ` y cuánto podés gastar por día (${money(b.daily.perDay)} hoy)` : ''}.
        </p>
      )}
    </div>
  );
}
