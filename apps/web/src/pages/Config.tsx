import { useState } from 'react';
import { ACCOUNT_TYPES, monthOf, newId, type Account, type Category } from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Field, PageHeader, Section, Sheet, Toggle, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const COLORS = [
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#f59e0b',
  '#6366f1',
  '#ef4444',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#8b5cf6',
  '#64748b',
  '#16a34a',
];

// =================== Categorías ===================

export function Categories() {
  const data = useData();
  const b = useMonth(monthOf(useToday()));
  const [editing, setEditing] = useState<Category | 'expense' | 'income' | null>(null);
  const spent = new Map(b.categories.map((c) => [c.categoryId, c.spent]));
  const group = (kind: Category['kind']) => data.categories.filter((c) => c.kind === kind && !c.archived);
  const archived = data.categories.filter((c) => c.archived);

  const row = (c: Category) => (
    <button key={c.id} className="tx-row" onClick={() => setEditing(c)}>
      <span className="tx-icon" style={{ '--tint': c.color } as React.CSSProperties}>
        {c.icon}
      </span>
      <span className="tx-main">
        <span className="tx-title">{c.name}</span>
        {c.kind === 'expense' && (
          <span className="tx-meta">
            Este mes {money(spent.get(c.id) ?? 0)}
            {c.monthlyLimit ? ` de ${money(c.monthlyLimit)}` : ' · sin tope'}
          </span>
        )}
      </span>
      <Icon name="edit" size={16} className="muted" />
    </button>
  );

  return (
    <div className="page">
      <PageHeader title="Categorías y topes" subtitle="Ponele un tope mensual a lo que quieras controlar" back="/mas" />
      <Section
        title="Gastos"
        action={
          <button className="link" onClick={() => setEditing('expense')}>
            + Nueva
          </button>
        }
      >
        <div className="card list">{group('expense').map(row)}</div>
      </Section>
      <Section
        title="Ingresos"
        action={
          <button className="link" onClick={() => setEditing('income')}>
            + Nueva
          </button>
        }
      >
        <div className="card list">{group('income').map(row)}</div>
      </Section>
      {archived.length > 0 && (
        <Section title="Archivadas">
          <div className="card list">{archived.map(row)}</div>
        </Section>
      )}
      {editing && (
        <CategoryForm
          category={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryForm({ category, kind, onClose }: { category: Category | null; kind: Category['kind']; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '🏷️');
  const [color, setColor] = useState(category?.color ?? COLORS[0]);
  const [limit, setLimit] = useState(category?.monthlyLimit ? String(category.monthlyLimit) : '');
  const [archived, setArchived] = useState(category?.archived ?? false);
  const save = () => {
    if (!name.trim()) return;
    const max = Math.max(0, ...data.categories.map((c) => c.sort));
    mutate('category', 'upsert', {
      id: category?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      kind,
      icon: icon || '🏷️',
      color,
      monthlyLimit: kind === 'expense' ? parseAmount(limit) || null : null,
      archived,
      sort: category?.sort ?? max + 1,
    });
    toast('Categoría guardada');
    onClose();
  };
  return (
    <Sheet
      title={category ? 'Editar categoría' : kind === 'expense' ? 'Nueva categoría de gasto' : 'Nueva categoría de ingreso'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save} disabled={!name.trim()}>
          Guardar
        </button>
      }
    >
      <div className="form">
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Color">
          <div className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={color === c ? 'on' : ''}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Field>
        {kind === 'expense' && (
          <Field label="Tope por mes (opcional)" hint="Te avisa cuando te acercás o te pasás.">
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Ej: 3000" />
          </Field>
        )}
        {category && <Toggle checked={archived} onChange={setArchived} label="Archivada (no aparece al cargar)" />}
      </div>
    </Sheet>
  );
}

// =================== Cuentas ===================

const TYPE_LABEL: Record<Account['type'], string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  credit: 'Tarjeta de crédito',
  food: 'Tarjeta de alimentación',
};

export function Accounts() {
  const data = useData();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  return (
    <div className="page">
      <PageHeader
        title="Cuentas y medios de pago"
        subtitle="Con qué pagás o dónde entra la plata"
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      <div className="card list">
        {data.accounts.map((a) => (
          <button key={a.id} className="tx-row" onClick={() => setEditing(a)}>
            <span className="tx-icon" style={{ '--tint': a.color } as React.CSSProperties}>
              {a.icon}
            </span>
            <span className="tx-main">
              <span className="tx-title">{a.name}</span>
              <span className="tx-meta">
                {TYPE_LABEL[a.type]}
                {a.archived ? ' · archivada' : ''}
              </span>
            </span>
            <Icon name="edit" size={16} className="muted" />
          </button>
        ))}
      </div>
      <p className="muted small">
        Los gastos con una cuenta de tipo "Tarjeta de crédito" se pueden pagar en cuotas y se suman al mes de cada cuota. No
        cargues el pago del resumen de la tarjeta como gasto: ya está contado en las compras.
      </p>
      {editing && <AccountForm account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountForm({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(account?.name ?? '');
  const [icon, setIcon] = useState(account?.icon ?? '🏦');
  const [type, setType] = useState<Account['type']>(account?.type ?? 'bank');
  const [color, setColor] = useState(account?.color ?? COLORS[4]);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const save = () => {
    if (!name.trim()) return;
    mutate('account', 'upsert', {
      id: account?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      type,
      currency: account?.currency ?? 'UYU',
      icon: icon || '🏦',
      color,
      archived,
      sort: account?.sort ?? data.accounts.length + 1,
    });
    toast('Cuenta guardada');
    onClose();
  };
  return (
    <Sheet
      title={account ? 'Editar cuenta' : 'Nueva cuenta'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save} disabled={!name.trim()}>
          Guardar
        </button>
      }
    >
      <div className="form">
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Santander" />
          </Field>
        </div>
        <Field label="Tipo">
          <Chips
            label="Tipo"
            value={type}
            onChange={setType}
            options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
        </Field>
        <Field label="Color">
          <div className="swatches" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={color === c ? 'on' : ''}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Field>
        {account && <Toggle checked={archived} onChange={setArchived} label="Archivada (no aparece al cargar)" />}
      </div>
    </Sheet>
  );
}

// =================== Ajustes ===================

export function SettingsPage() {
  const data = useData();
  const s = data.settings;
  const [name, setName] = useState(s.ownerName);
  const [rate, setRate] = useState(String(s.usdRate).replace('.', ','));
  const [startMonth, setStartMonth] = useState(s.startMonth ?? '');
  const [startBalance, setStartBalance] = useState(String(s.startBalance).replace('.', ','));
  const save = () => {
    const usdRate = parseAmount(rate);
    if (!usdRate || usdRate <= 0) return toast('La cotización tiene que ser mayor a 0', { tone: 'error' });
    mutate('settings', 'upsert', {
      ...s,
      ownerName: name.trim(),
      usdRate,
      startMonth: startMonth || null,
      startBalance: parseAmount(startBalance) ?? 0,
    });
    toast('Ajustes guardados');
  };
  return (
    <div className="page narrow">
      <PageHeader title="Ajustes" back="/mas" />
      <form
        className="card form pad"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Tu nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Para saludarte en el inicio" />
        </Field>
        <Field
          label="Dólar (pesos por US$)"
          hint="Se usa para convertir gastos y ahorros en dólares. Cada movimiento guarda la cotización del día en que lo cargaste."
        >
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field
          label="Mes en que empezás a usar Lifty"
          hint="Desde ese mes se arrastra el saldo de un mes al siguiente. Vacío = el primer mes con datos."
        >
          <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        </Field>
        <Field label="Saldo con el que arrancaste ese mes">
          <input inputMode="decimal" value={startBalance} onChange={(e) => setStartBalance(e.target.value)} />
        </Field>
        <button className="btn btn-primary" type="submit">
          Guardar
        </button>
      </form>
    </div>
  );
}
