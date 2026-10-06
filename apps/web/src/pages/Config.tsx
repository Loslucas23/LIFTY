import { useState } from 'react';
import {
  ACCOUNT_TYPES,
  fold,
  monthOf,
  newId,
  todayISO,
  sortedCategories,
  SUBCATEGORY_IDEAS,
  type Account,
  type Category,
  type RolloverMode,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Field, PageHeader, Section, Segmented, Sheet, Toggle, toast } from '../components/ui';
import { getTheme, setTheme, type Theme } from '../lib/theme';
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
  const subSpent = new Map(b.categories.flatMap((c) => (c.subs ?? []).map((s) => [s.categoryId, s.spent] as const)));
  const active = data.categories.filter((c) => !c.archived);
  const activeIds = new Set(active.map((c) => c.id));
  const group = (kind: Category['kind']) => sortedCategories(active.filter((c) => c.kind === kind));
  const archived = data.categories.filter((c) => c.archived);
  const childCount = (id: string) => active.filter((c) => c.parentId === id).length;

  const row = (c: Category) => {
    const isSub = !!c.parentId && activeIds.has(c.parentId);
    const subs = childCount(c.id);
    return (
      <button key={c.id} className={`tx-row ${isSub ? 'sub-row' : ''}`} onClick={() => setEditing(c)}>
        <span className="tx-icon" style={{ '--tint': c.color } as React.CSSProperties}>
          {c.icon}
        </span>
        <span className="tx-main">
          <span className="tx-title">{c.name}</span>
          {c.kind === 'expense' && (
            <span className="tx-meta">
              {isSub ? (
                <>Este mes {money(subSpent.get(c.id) ?? 0)} · suma a la de arriba</>
              ) : (
                <>
                  Este mes {money(spent.get(c.id) ?? 0)}
                  {c.monthlyLimit ? ` de ${money(c.monthlyLimit)}` : ' · sin presupuesto'}
                  {subs > 0 && ` · ${subs} subcategoría${subs === 1 ? '' : 's'}`}
                </>
              )}
            </span>
          )}
        </span>
        <Icon name="edit" size={16} className="muted" />
      </button>
    );
  };

  return (
    <div className="page">
      <PageHeader title="Categorías" subtitle="Y cuánto querés gastar por mes en cada una" back="/mas" />
      <p className="muted small">
        Tocá una categoría para agregarle subcategorías (Comida afuera › Delivery, Transporte › Uber…). Lo de una subcategoría
        suma a la de arriba y a su presupuesto.
      </p>
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
          key={typeof editing === 'string' ? editing : editing.id}
          category={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
          onOpen={(c) => setEditing(c)}
        />
      )}
    </div>
  );
}

function CategoryForm({
  category,
  kind,
  onClose,
  onOpen,
}: {
  category: Category | null;
  kind: Category['kind'];
  onClose: () => void;
  onOpen: (c: Category) => void;
}) {
  const data = useData();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '🏷️');
  const [color, setColor] = useState(category?.color ?? COLORS[0]);
  const [limit, setLimit] = useState(category?.monthlyLimit ? String(category.monthlyLimit) : '');
  const [rollover, setRollover] = useState<RolloverMode>(category?.rollover || 'none');
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [parentId, setParentId] = useState<string | null>(category?.parentId ?? null);
  const [subName, setSubName] = useState('');
  const children = category ? data.categories.filter((c) => c.parentId === category.id && !c.archived) : [];
  // Un solo nivel: una categoría con subcategorías no puede ir adentro de otra.
  const parents = data.categories.filter((c) => c.kind === kind && !c.archived && !c.parentId && c.id !== category?.id);
  const parent = parents.find((c) => c.id === parentId);
  const maxSort = () => Math.max(0, ...data.categories.map((c) => c.sort));
  const save = () => {
    if (!name.trim()) return;
    mutate('category', 'upsert', {
      id: category?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      kind,
      icon: icon || '🏷️',
      color,
      parentId: parent ? parent.id : null,
      // El presupuesto es de la categoría de arriba.
      monthlyLimit: kind === 'expense' && !parent ? parseAmount(limit) || null : null,
      rollover: kind === 'expense' && !parent && parseAmount(limit) ? rollover : 'none',
      // Se acumula desde el mes en que lo activás (no se arrastra todo el historial).
      rolloverFrom:
        rollover === 'carry'
          ? category?.rollover === 'carry' && category.rolloverFrom
            ? category.rolloverFrom
            : monthOf(todayISO())
          : null,
      archived,
      sort: category?.sort ?? maxSort() + 1,
    });
    toast(parent ? `Subcategoría guardada (dentro de ${parent.name})` : 'Categoría guardada');
    onClose();
  };
  const addSub = (subNameRaw: string, subIcon?: string) => {
    if (!category) return;
    const n = subNameRaw.trim();
    if (!n) return;
    const exists = data.categories.find((c) => c.parentId === category.id && fold(c.name) === fold(n));
    if (exists) {
      if (exists.archived) mutate('category', 'upsert', { ...exists, archived: false });
      return setSubName('');
    }
    const rec: Category = {
      id: newId(),
      updatedAt: '',
      name: n,
      kind: category.kind,
      icon: subIcon ?? category.icon,
      color: category.color,
      parentId: category.id,
      monthlyLimit: null,
      rollover: 'none',
      rolloverFrom: null,
      archived: false,
      sort: maxSort() + 1,
    };
    mutate('category', 'upsert', rec);
    toast(`Subcategoría: ${category.name} › ${n}`, {
      action: { label: 'Deshacer', run: () => mutate('category', 'delete', rec.id) },
    });
    setSubName('');
  };
  const have = new Set(children.map((c) => fold(c.name)));
  const ideas = category ? (SUBCATEGORY_IDEAS[category.id] ?? []).filter((i) => !have.has(fold(i.name))) : [];
  return (
    <Sheet
      title={
        category
          ? category.parentId
            ? 'Editar subcategoría'
            : 'Editar categoría'
          : kind === 'expense'
            ? 'Nueva categoría de gasto'
            : 'Nueva categoría de ingreso'
      }
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
        {children.length === 0 && parents.length > 0 && (
          <Field
            label="¿Es una subcategoría?"
            hint={
              parent ? `Lo que gastes acá suma a ${parent.name} (y a su presupuesto).` : 'Ninguna = es una categoría principal.'
            }
          >
            <Chips
              label="Subcategoría de"
              value={parentId}
              onChange={(v) => {
                setParentId(v);
                const p = parents.find((c) => c.id === v);
                if (p && !category) setColor(p.color);
              }}
              options={[
                { value: null as string | null, label: 'Ninguna' },
                ...parents.map((c) => ({ value: c.id as string | null, label: c.name, icon: c.icon, color: c.color })),
              ]}
            />
          </Field>
        )}
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
        {kind === 'expense' && !parent && (
          <Field
            label="Presupuesto por mes (opcional)"
            hint="Vale para todos los meses. Un mes puntual se cambia desde Presupuesto."
          >
            <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Ej: 3000" />
          </Field>
        )}
        {kind === 'expense' && !parent && parseAmount(limit) ? (
          <Field
            label="Lo que sobra a fin de mes"
            hint={
              rollover === 'carry'
                ? 'Se suma al presupuesto del mes siguiente de esta categoría (ideal para ropa, regalos, arreglos).'
                : rollover === 'save'
                  ? 'Al empezar el mes, Lifty te propone pasarlo al ahorro con un toque.'
                  : 'Queda libre para cualquier cosa (como hasta ahora).'
            }
          >
            <Chips
              label="Lo que sobra a fin de mes"
              value={rollover}
              onChange={setRollover}
              options={[
                { value: 'none' as RolloverMode, label: 'Queda libre' },
                { value: 'carry' as RolloverMode, label: 'Se acumula acá' },
                { value: 'save' as RolloverMode, label: 'Va al ahorro' },
              ]}
            />
          </Field>
        ) : null}
        {category && !category.parentId && (
          <Field
            label="Subcategorías"
            hint="Para ver el detalle (en qué se te va la comida afuera: delivery, cafés…). Suman a esta categoría."
          >
            {children.length > 0 && (
              <div className="chips">
                {children.map((c) => (
                  <button key={c.id} type="button" className="chip" onClick={() => onOpen(c)}>
                    <span className="chip-icon">{c.icon}</span>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {ideas.length > 0 && (
              <div className="chips">
                {ideas.map((i) => (
                  <button key={i.name} type="button" className="chip chip-add" onClick={() => addSub(i.name, i.icon)}>
                    <Icon name="plus" size={14} /> {i.icon} {i.name}
                  </button>
                ))}
              </div>
            )}
            <div className="row">
              <input
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSub(subName);
                  }
                }}
                placeholder="Nueva subcategoría"
                aria-label="Nueva subcategoría"
                maxLength={40}
              />
              <button type="button" className="btn" onClick={() => addSub(subName)} disabled={!subName.trim()}>
                Agregar
              </button>
            </div>
          </Field>
        )}
        {category && <Toggle checked={archived} onChange={setArchived} label="Archivada (no aparece al cargar)" />}
      </div>
    </Sheet>
  );
}

// =================== Ajustes ===================

export function SettingsPage() {
  const data = useData();
  // Si llegan ajustes nuevos (de otro dispositivo), el formulario se recarga.
  return <SettingsForm key={data.settings.updatedAt} />;
}

function SettingsForm() {
  const data = useData();
  const s = data.settings;
  const [name, setName] = useState(s.ownerName);
  const [rate, setRate] = useState(String(s.usdRate).replace('.', ','));
  const [startMonth, setStartMonth] = useState(s.startMonth ?? '');
  const [startBalance, setStartBalance] = useState(String(s.startBalance).replace('.', ','));
  const [hours, setHours] = useState(String(s.weeklyHours ?? 40));
  const [inflation, setInflation] = useState(String(s.inflation ?? 5).replace('.', ','));
  const save = () => {
    const usdRate = parseAmount(rate);
    if (!usdRate || usdRate <= 0) return toast('La cotización tiene que ser mayor a 0', { tone: 'error' });
    mutate('settings', 'upsert', {
      ...s,
      ownerName: name.trim(),
      usdRate,
      startMonth: startMonth || null,
      startBalance: parseAmount(startBalance) ?? 0,
      weeklyHours: Math.min(100, Math.max(1, parseAmount(hours) ?? 40)),
      inflation: Math.max(0, parseAmount(inflation) ?? 5),
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
        <div className="row">
          <Field label="Horas de trabajo por semana" hint="Para decir cuántas horas de tu trabajo cuesta un gasto">
            <input inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Inflación por año (%)" hint="Para comparar contado contra cuotas">
            <input inputMode="decimal" value={inflation} onChange={(e) => setInflation(e.target.value)} />
          </Field>
        </div>
        <button className="btn btn-primary" type="submit">
          Guardar
        </button>
      </form>
      <ThemePicker />
    </div>
  );
}

function ThemePicker() {
  const [theme, set] = useState<Theme>(getTheme());
  return (
    <Section title="Apariencia">
      <div className="card pad form">
        <Segmented
          label="Tema"
          value={theme}
          onChange={(t) => {
            set(t);
            setTheme(t);
          }}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Oscuro' },
          ]}
        />
        <p className="muted small">Se guarda en este dispositivo. "Automático" sigue el modo del sistema.</p>
      </div>
    </Section>
  );
}
