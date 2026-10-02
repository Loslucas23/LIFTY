import { useState } from 'react';
import {
  aguinaldoFor,
  fixedSchema,
  incomeSchema,
  isActiveIn,
  makeMonth,
  monthLabel,
  monthOf,
  netBreakdown,
  newId,
  parseMonth,
  URUGUAY_DEDUCTIONS,
  type Currency,
  type Deduction,
  type FixedExpense,
  type IncomeSource,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Sheet, Toggle, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useLookups, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

function period(start: string, end: string | null) {
  return end ? `${monthLabel(start)} → ${monthLabel(end)}` : `Desde ${monthLabel(start)}`;
}

// =================== Sueldos ===================

export function Incomes() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const [editing, setEditing] = useState<IncomeSource | 'new' | null>(null);
  const active = data.incomes.filter((i) => isActiveIn(month, i.startMonth, i.endMonth));
  const other = data.incomes.filter((i) => !active.includes(i));

  const card = (i: IncomeSource) => {
    const b = netBreakdown(i);
    return (
      <button key={i.id} className="card item-card" onClick={() => setEditing(i)}>
        <div className="item-card-head">
          <strong>{i.name}</strong>
          <span className="amount">{money(b.net, i.currency)}</span>
        </div>
        <div className="muted small">
          {period(i.startMonth, i.endMonth)} · nominal {money(i.gross, i.currency)}
          {b.overridden ? ' · líquido manual' : ` · descuentos ${money(b.totalDeductions, i.currency)}`}
          {i.aguinaldo ? ' · con aguinaldo' : ''}
        </div>
      </button>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Sueldos"
        subtitle="Se suman solos al presupuesto de cada mes en que estén vigentes"
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      {data.incomes.length === 0 ? (
        <Empty icon="wallet" title="Cargá tu sueldo">
          Poné el nominal y Lifty calcula el líquido con los descuentos de Uruguay (los podés ajustar). En junio y diciembre suma
          el aguinaldo.
        </Empty>
      ) : (
        <>
          {active.length > 0 && <Section title="Vigentes">{active.map(card)}</Section>}
          {other.length > 0 && <Section title="Anteriores o futuros">{other.map(card)}</Section>}
        </>
      )}
      {editing && <IncomeForm income={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function IncomeForm({ income, onClose }: { income: IncomeSource | null; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const [name, setName] = useState(income?.name ?? '');
  const [gross, setGross] = useState(income ? String(income.gross) : '');
  const [currency, setCurrency] = useState<Currency>(income?.currency ?? 'UYU');
  const [deductions, setDeductions] = useState<Deduction[]>(income?.deductions ?? URUGUAY_DEDUCTIONS);
  const [manual, setManual] = useState(income?.netOverride !== null && income?.netOverride !== undefined);
  const [net, setNet] = useState(
    income?.netOverride !== null && income?.netOverride !== undefined ? String(income.netOverride) : '',
  );
  const [startMonth, setStartMonth] = useState(income?.startMonth ?? monthOf(today));
  const [endMonth, setEndMonth] = useState<string | null>(income?.endMonth ?? null);
  const [aguinaldo, setAguinaldo] = useState(income?.aguinaldo ?? true);
  const [payDay, setPayDay] = useState(income?.payDay ? String(income.payDay) : '');
  const [accountId, setAccountId] = useState<string | null>(income?.accountId ?? null);
  const [error, setError] = useState<string | null>(null);

  const draft = {
    gross: parseAmount(gross) ?? 0,
    deductions,
    netOverride: manual ? (parseAmount(net) ?? 0) : null,
  };
  const b = netBreakdown(draft);
  const year = parseMonth(monthOf(today)).year;
  const record = {
    id: income?.id ?? newId(),
    updatedAt: '',
    name: name.trim(),
    gross: draft.gross,
    netOverride: draft.netOverride,
    deductions,
    currency,
    startMonth,
    endMonth,
    aguinaldo,
    payDay: payDay ? Math.min(31, Math.max(1, Number(payDay))) : null,
    categoryId: income?.categoryId ?? 'cat-sueldo',
    accountId,
    archived: false,
  };
  const agJune = incomeSchema.safeParse(record).success ? aguinaldoFor(incomeSchema.parse(record), makeMonth(year, 6)) : null;
  const agDec = incomeSchema.safeParse(record).success ? aguinaldoFor(incomeSchema.parse(record), makeMonth(year, 12)) : null;

  const setDed = (i: number, patch: Partial<Deduction>) =>
    setDeductions(deductions.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = () => {
    const result = incomeSchema.safeParse(record);
    if (!record.name) return setError('Ponele un nombre (ej: Sueldo de la empresa).');
    if (!result.success) return setError(result.error.issues[0]?.message ?? 'Revisá los datos.');
    if (endMonth && endMonth < startMonth) return setError('El mes de fin es anterior al de inicio.');
    mutate('income', 'upsert', result.data);
    toast('Sueldo guardado');
    onClose();
  };

  return (
    <Sheet
      title={income ? 'Editar sueldo' : 'Nuevo sueldo'}
      onClose={onClose}
      footer={
        <>
          {income && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('income', 'delete', income.id);
                toast('Sueldo borrado', { action: { label: 'Deshacer', run: () => mutate('income', 'upsert', income) } });
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <Field label="Nombre">
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sueldo Equim" />
        </Field>
        <div className="row">
          <Field label="Sueldo nominal">
            <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="50400" />
          </Field>
          <Field label="Moneda">
            <Chips
              label="Moneda"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'UYU', label: '$' },
                { value: 'USD', label: 'US$' },
              ]}
            />
          </Field>
        </div>

        <Toggle checked={manual} onChange={setManual} label="Ya sé el líquido (no calcular descuentos)" />
        {manual ? (
          <Field label="Sueldo líquido">
            <input inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
          </Field>
        ) : (
          <div className="deductions">
            <div className="deductions-head">
              <strong>Descuentos</strong>
              <button type="button" className="link small" onClick={() => setDeductions(URUGUAY_DEDUCTIONS)}>
                Plantilla Uruguay
              </button>
            </div>
            {deductions.map((d, i) => (
              <div key={i} className="deduction">
                <input value={d.label} onChange={(e) => setDed(i, { label: e.target.value })} aria-label="Descuento" />
                <label>
                  <input
                    inputMode="decimal"
                    value={d.percent}
                    onChange={(e) => setDed(i, { percent: Number(e.target.value.replace(',', '.')) || 0 })}
                    aria-label={`${d.label}: porcentaje`}
                  />
                  %
                </label>
                <label title="Monto fijo (ej: IRPF)">
                  +$
                  <input
                    inputMode="decimal"
                    value={d.fixed}
                    onChange={(e) => setDed(i, { fixed: parseAmount(e.target.value) ?? 0 })}
                    aria-label={`${d.label}: monto fijo`}
                  />
                </label>
                <span className="deduction-amount">−{money(b.lines[i]?.amount ?? 0, currency)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDeductions(deductions.filter((_, j) => j !== i))}
                  aria-label={`Quitar ${d.label}`}
                >
                  <Icon name="x" size={16} />
                </button>
                {d.extraBase > 0 && (
                  <span className="deduction-note muted small">
                    Se calcula sobre nominal + {money(d.extraBase, currency)}{' '}
                    <button type="button" className="link small" onClick={() => setDed(i, { extraBase: 0 })}>
                      quitar
                    </button>
                  </span>
                )}
              </div>
            ))}
            <button
              type="button"
              className="link small"
              onClick={() => setDeductions([...deductions, { label: 'Otro', percent: 0, extraBase: 0, fixed: 0 }])}
            >
              + Agregar descuento
            </button>
            <p className="muted small">
              Los porcentajes de FONASA e IRPF dependen de tu caso: ajustalos con tu recibo. El IRPF ponelo como monto fijo.
            </p>
          </div>
        )}

        <div className="net-box">
          <span>Líquido por mes</span>
          <strong>{money(b.net, currency)}</strong>
        </div>

        <div className="row">
          <Field label="Desde">
            <input type="month" value={startMonth} onChange={(e) => e.target.value && setStartMonth(e.target.value)} />
          </Field>
          <Field label="Hasta (opcional)">
            <input type="month" value={endMonth ?? ''} onChange={(e) => setEndMonth(e.target.value || null)} />
          </Field>
        </div>
        <Field label="Día de cobro (opcional)">
          <input
            inputMode="numeric"
            value={payDay}
            onChange={(e) => setPayDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="Ej: 5"
          />
        </Field>
        <Field label="¿Dónde lo cobrás?">
          <Chips
            label="Cuenta"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: null, label: 'Sin indicar' },
              ...data.accounts
                .filter((a) => a.type !== 'credit')
                .map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
            ]}
          />
        </Field>
        <Toggle checked={aguinaldo} onChange={setAguinaldo} label="Genera aguinaldo" />
        {aguinaldo && (agJune || agDec) && (
          <p className="muted small">
            Aguinaldo estimado {year}: {agJune ? `junio ${money(agJune.amount, currency)}` : ''}
            {agJune && agDec ? ' · ' : ''}
            {agDec ? `diciembre ${money(agDec.amount, currency)}` : ''}. Si el trabajo termina antes, la parte proporcional se
            suma en el último mes.
          </p>
        )}
      </div>
    </Sheet>
  );
}

// =================== Gastos fijos ===================

export function FixedList() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const { category } = useLookups();
  const [editing, setEditing] = useState<FixedExpense | 'new' | null>(null);
  const active = data.fixed.filter((f) => isActiveIn(month, f.startMonth, f.endMonth));
  const other = data.fixed.filter((f) => !active.includes(f));
  const total = active.reduce((s, f) => s + (f.currency === 'USD' ? f.amount * data.settings.usdRate : f.amount), 0);

  const row = (f: FixedExpense) => {
    const cat = f.categoryId ? category.get(f.categoryId) : undefined;
    return (
      <button key={f.id} className="tx-row" onClick={() => setEditing(f)}>
        <span className="tx-icon" style={{ '--tint': cat?.color ?? 'var(--muted)' } as React.CSSProperties}>
          {cat?.icon ?? '🔁'}
        </span>
        <span className="tx-main">
          <span className="tx-title">{f.name}</span>
          <span className="tx-meta">
            {[f.dayOfMonth ? `día ${f.dayOfMonth}` : null, period(f.startMonth, f.endMonth)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="tx-amount">{money(f.amount, f.currency)}</span>
      </button>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Gastos fijos"
        subtitle={active.length ? `${money(total)} por mes ahora` : 'Lo que pagás todos los meses'}
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      {data.fixed.length === 0 ? (
        <Empty icon="repeat" title="Sin gastos fijos">
          Alquiler, internet, gimnasio, el STM… se descuentan solos del presupuesto y cada mes los vas tildando a medida que los
          pagás.
        </Empty>
      ) : (
        <>
          {active.length > 0 && (
            <Section title="Vigentes">
              <div className="card list">{active.map(row)}</div>
            </Section>
          )}
          {other.length > 0 && (
            <Section title="Terminados o futuros">
              <div className="card list">{other.map(row)}</div>
            </Section>
          )}
        </>
      )}
      {editing && <FixedForm fixed={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FixedForm({ fixed, onClose }: { fixed: FixedExpense | null; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const [name, setName] = useState(fixed?.name ?? '');
  const [amount, setAmount] = useState(fixed ? String(fixed.amount) : '');
  const [currency, setCurrency] = useState<Currency>(fixed?.currency ?? 'UYU');
  const [categoryId, setCategoryId] = useState<string | null>(fixed?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(fixed?.accountId ?? null);
  const [day, setDay] = useState(fixed?.dayOfMonth ? String(fixed.dayOfMonth) : '');
  const [startMonth, setStartMonth] = useState(fixed?.startMonth ?? monthOf(today));
  const [endMonth, setEndMonth] = useState<string | null>(fixed?.endMonth ?? null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) return setError('Ponele un nombre.');
    if (endMonth && endMonth < startMonth) return setError('El mes de fin es anterior al de inicio.');
    const result = fixedSchema.safeParse({
      id: fixed?.id ?? newId(),
      name: name.trim(),
      amount: parseAmount(amount) ?? 0,
      currency,
      categoryId,
      accountId,
      dayOfMonth: day ? Math.min(31, Math.max(1, Number(day))) : null,
      startMonth,
      endMonth,
    });
    if (!result.success) return setError('Escribí un monto mayor a 0.');
    mutate('fixed', 'upsert', result.data);
    toast('Gasto fijo guardado');
    onClose();
  };

  return (
    <Sheet
      title={fixed ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      onClose={onClose}
      footer={
        <>
          {fixed && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('fixed', 'delete', fixed.id);
                toast('Gasto fijo borrado', { action: { label: 'Deshacer', run: () => mutate('fixed', 'upsert', fixed) } });
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <Field label="Nombre">
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Alquiler" />
        </Field>
        <div className="row">
          <Field label="Monto por mes">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="16000" />
          </Field>
          <Field label="Moneda">
            <Chips
              label="Moneda"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'UYU', label: '$' },
                { value: 'USD', label: 'US$' },
              ]}
            />
          </Field>
        </div>
        <Field label="Categoría">
          <Chips
            label="Categoría"
            value={categoryId}
            onChange={setCategoryId}
            options={data.categories
              .filter((c) => c.kind === 'expense' && !c.archived)
              .map((c) => ({ value: c.id as string | null, label: c.name, icon: c.icon, color: c.color }))}
          />
        </Field>
        <Field label="Se paga con">
          <Chips
            label="Cuenta"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: null, label: 'Sin indicar' },
              ...data.accounts
                .filter((a) => !a.archived)
                .map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
            ]}
          />
        </Field>
        <Field label="Día de vencimiento (opcional)">
          <input
            inputMode="numeric"
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
            placeholder="Ej: 10"
          />
        </Field>
        <div className="row">
          <Field label="Desde">
            <input type="month" value={startMonth} onChange={(e) => e.target.value && setStartMonth(e.target.value)} />
          </Field>
          <Field label="Hasta (opcional)">
            <input type="month" value={endMonth ?? ''} onChange={(e) => setEndMonth(e.target.value || null)} />
          </Field>
        </div>
        <p className="muted small">
          Si dejás de pagarlo, poné el mes de fin en vez de borrarlo: así los meses anteriores no cambian.
        </p>
      </div>
    </Sheet>
  );
}
