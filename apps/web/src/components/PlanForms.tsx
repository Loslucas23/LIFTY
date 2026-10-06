import { useState } from 'react';
import {
  aguinaldoFor,
  fixedSchema,
  incomeSchema,
  isActiveIn,
  makeMonth,
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
import { deletePlanned, stopPlanned } from '../lib/actions';
import { money, parseAmount } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';
import { Icon } from './Icon';
import { Chips, Field, Sheet, Toggle, toast } from './ui';

/** Formularios de sueldo y gasto fijo (se abren desde Presupuesto, Sueldos, Gastos fijos y el asistente). */

export function IncomeForm({ income, month, onClose }: { income: IncomeSource | null; month?: string; onClose: () => void }) {
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
  const [startMonth, setStartMonth] = useState(income?.startMonth ?? month ?? monthOf(today));
  const [endMonth, setEndMonth] = useState<string | null>(income?.endMonth ?? null);
  const [freq, setFreq] = useState({
    every: income?.everyMonths ?? 1,
    once: !!income && income.endMonth === income.startMonth,
  });
  const recurringMonthly = freq.every === 1 && !freq.once;
  const [aguinaldo, setAguinaldo] = useState(income?.aguinaldo ?? true);
  const [onExit, setOnExit] = useState(income?.aguinaldoOnExit ?? false);
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
    endMonth: freq.once ? startMonth : endMonth,
    everyMonths: freq.once ? 1 : freq.every,
    aguinaldo: recurringMonthly && aguinaldo,
    aguinaldoOnExit: recurringMonthly && aguinaldo && onExit,
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
          {income && isActiveIn(month ?? monthOf(today), income.startMonth, income.endMonth) && (
            <button
              className="btn btn-danger-ghost"
              title="Deja de contar desde este mes; los meses anteriores no cambian"
              onClick={() => {
                stopPlanned(data, 'income', income.id, month ?? monthOf(today));
                onClose();
              }}
            >
              Ya no lo cobro
            </button>
          )}
          {income && (
            <button
              className="btn btn-danger-ghost"
              title="Borrar de todos los meses"
              onClick={() => {
                deletePlanned(data, 'income', income.id);
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
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Sueldo de la empresa" />
        </Field>
        <div className="row">
          <Field label="Sueldo nominal">
            <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="45000" />
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

        <FrequencyPicker every={freq.every} once={freq.once} onChange={setFreq} />
        <div className="row">
          <Field label={freq.once ? 'Mes' : freq.every === 1 ? 'Desde' : 'Primera vez'}>
            <input type="month" value={startMonth} onChange={(e) => e.target.value && setStartMonth(e.target.value)} />
          </Field>
          {!freq.once && (
            <Field label="Hasta (opcional)">
              <input type="month" value={endMonth ?? ''} onChange={(e) => setEndMonth(e.target.value || null)} />
            </Field>
          )}
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
        {recurringMonthly ? (
          <Toggle checked={aguinaldo} onChange={setAguinaldo} label="Genera aguinaldo (no para seguro de paro)" />
        ) : (
          <p className="muted small">Lo que no se cobra todos los meses (salario vacacional, bonos) no genera aguinaldo.</p>
        )}
        {recurringMonthly && aguinaldo && (agJune || agDec) && (
          <p className="muted small">
            Aguinaldo estimado {year}: {agJune ? `junio ${money(agJune.amount, currency)}` : ''}
            {agJune && agDec ? ' · ' : ''}
            {agDec ? `diciembre ${money(agDec.amount, currency)}` : ''}.
          </p>
        )}
        {recurringMonthly && aguinaldo && endMonth && !freq.once && (
          <Toggle
            checked={onExit}
            onChange={setOnExit}
            label="Al terminar me pagan el aguinaldo proporcional (con la liquidación, el último mes)"
          />
        )}
      </div>
    </Sheet>
  );
}

export function FixedForm({ fixed, month, onClose }: { fixed: FixedExpense | null; month?: string; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const [name, setName] = useState(fixed?.name ?? '');
  const [amount, setAmount] = useState(fixed ? String(fixed.amount) : '');
  const [currency, setCurrency] = useState<Currency>(fixed?.currency ?? 'UYU');
  const [categoryId, setCategoryId] = useState<string | null>(fixed?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(fixed?.accountId ?? null);
  const [day, setDay] = useState(fixed?.dayOfMonth ? String(fixed.dayOfMonth) : '');
  const [startMonth, setStartMonth] = useState(fixed?.startMonth ?? month ?? monthOf(today));
  const [endMonth, setEndMonth] = useState<string | null>(fixed?.endMonth ?? null);
  const [freq, setFreq] = useState({
    every: fixed?.everyMonths ?? 1,
    once: !!fixed && fixed.endMonth === fixed.startMonth,
  });
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
      endMonth: freq.once ? startMonth : endMonth,
      everyMonths: freq.once ? 1 : freq.every,
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
          {fixed && isActiveIn(month ?? monthOf(today), fixed.startMonth, fixed.endMonth) && (
            <button
              className="btn btn-danger-ghost"
              title="Deja de contar desde este mes; los meses anteriores no cambian"
              onClick={() => {
                stopPlanned(data, 'fixed', fixed.id, month ?? monthOf(today));
                onClose();
              }}
            >
              Ya no lo pago
            </button>
          )}
          {fixed && (
            <button
              className="btn btn-danger-ghost"
              title="Borrar de todos los meses"
              onClick={() => {
                deletePlanned(data, 'fixed', fixed.id);
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
        <FrequencyPicker every={freq.every} once={freq.once} onChange={setFreq} />
        <div className="row">
          <Field label={freq.once ? 'Mes' : freq.every === 1 ? 'Desde' : 'Primera vez'}>
            <input type="month" value={startMonth} onChange={(e) => e.target.value && setStartMonth(e.target.value)} />
          </Field>
          {!freq.once && (
            <Field label="Hasta (opcional)">
              <input type="month" value={endMonth ?? ''} onChange={(e) => setEndMonth(e.target.value || null)} />
            </Field>
          )}
        </div>
        {!freq.once && freq.every > 1 && (parseAmount(amount) ?? 0) > 0 && (
          <p className="note">
            Para pagarlo sin sustos, apartá {money((parseAmount(amount) ?? 0) / freq.every, currency)} por mes. Solo cuenta en el
            presupuesto el mes en que vence.
          </p>
        )}
        <p className="muted small">
          Si dejás de pagarlo, usá "Ya no lo pago" en vez de borrarlo: así los meses anteriores no cambian.
        </p>
      </div>
    </Sheet>
  );
}

/** Cada cuánto se repite: todos los meses, cada N meses, una vez al año o una sola vez. */
function FrequencyPicker({
  every,
  once,
  onChange,
}: {
  every: number;
  once: boolean;
  onChange: (v: { every: number; once: boolean }) => void;
}) {
  const value = once ? 'once' : String(every);
  return (
    <Field label="¿Cada cuánto?">
      <Chips
        label="Frecuencia"
        value={value}
        onChange={(v) => onChange(v === 'once' ? { every: 1, once: true } : { every: Number(v), once: false })}
        options={[
          { value: '1', label: 'Todos los meses' },
          { value: '2', label: 'Cada 2 meses' },
          { value: '3', label: 'Cada 3 meses' },
          { value: '6', label: 'Cada 6 meses' },
          { value: '12', label: 'Una vez al año' },
          { value: 'once', label: 'Una sola vez' },
        ]}
      />
    </Field>
  );
}
