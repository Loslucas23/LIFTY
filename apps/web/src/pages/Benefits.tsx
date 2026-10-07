import { useState } from 'react';
import { benefitActive, benefitSavings, benefitSchema, fold, newId, type Benefit } from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const daysText = (d: number[]) =>
  !d.length
    ? 'Todos los días'
    : d.length === 7
      ? 'Todos los días'
      : [...d]
          .sort()
          .map((x) => DAYS[x])
          .join(', ');

/** Tus beneficios y descuentos: cuáles valen hoy, con qué pagar y cuánto te ahorraste. */
export function Benefits() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Benefit | 'new' | null>(null);
  const list = (data.benefits ?? []).filter((b) => !b.archived);
  const todayList = list.filter((b) => benefitActive(b, today));
  const others = list.filter((b) => !benefitActive(b, today));
  const savings = benefitSavings(data, today);
  const total = savings.reduce((s, x) => s + x.saved, 0);
  const accName = (id: string | null) => (id ? data.accounts.find((a) => a.id === id)?.name : null);
  const row = (b: Benefit) => (
    <button key={b.id} className="tx-row wrap-text" onClick={() => setEditing(b)}>
      <span className="tx-icon">🏷️</span>
      <span className="tx-main">
        <span className="tx-title">{b.name}</span>
        <span className="tx-meta">
          {[
            daysText(b.days),
            b.store && !fold(b.name).includes(fold(b.store)) ? `en ${b.store}` : null,
            accName(b.accountId) ? `con ${accName(b.accountId)}` : null,
            b.cap ? `tope ${money(b.cap)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      {b.percent ? <span className="tx-amount">{b.percent}%</span> : null}
    </button>
  );
  return (
    <div className="page narrow">
      <PageHeader
        title="Beneficios y descuentos"
        subtitle="Los tuyos: te avisa el día que tocan y con qué conviene pagar"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Beneficio
          </button>
        }
      />
      {total > 0 && (
        <div className="card pad">
          <p>
            Este mes te ahorraste unos <strong>{money(Math.round(total))}</strong> con tus beneficios.
          </p>
          <p className="muted small">
            {savings
              .map((s) => `${s.benefit.name}: ${money(Math.round(s.saved))} (${s.count} compra${s.count === 1 ? '' : 's'})`)
              .join(' · ')}
          </p>
        </div>
      )}
      {list.length === 0 ? (
        <Empty icon="tag" title="Cargá tus beneficios">
          Por ejemplo «martes 25% en el súper con BROU» o «jueves 20% en farmacias con OCA»: Lifty te avisa el día que toca, te
          sugiere dónde comprar y con qué tarjeta pagar, y cuenta cuánto te ahorraste.
        </Empty>
      ) : (
        <>
          {todayList.length > 0 && (
            <Section title="Hoy valen">
              <div className="card list">{todayList.map(row)}</div>
            </Section>
          )}
          {others.length > 0 && (
            <Section title="Otros días">
              <div className="card list">{others.map(row)}</div>
            </Section>
          )}
        </>
      )}
      {editing && <BenefitForm benefit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BenefitForm({ benefit, onClose }: { benefit: Benefit | null; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(benefit?.name ?? '');
  const [store, setStore] = useState(benefit?.store ?? '');
  const [days, setDays] = useState<number[]>(benefit?.days ?? []);
  const [accountId, setAccountId] = useState<string | null>(benefit?.accountId ?? null);
  const [percent, setPercent] = useState(benefit?.percent != null ? String(benefit.percent) : '');
  const [cap, setCap] = useState(benefit?.cap != null ? String(benefit.cap) : '');
  const [until, setUntil] = useState(benefit?.until ?? '');
  const accounts = data.accounts.filter((a) => !a.archived && a.type !== 'food');
  const save = () => {
    const pct = parseAmount(percent);
    const auto = `${pct ? `${pct}% ` : ''}${store ? `en ${store}` : 'de descuento'}`.trim();
    const r = benefitSchema.safeParse({
      ...(benefit ?? {}),
      id: benefit?.id ?? newId(),
      updatedAt: '',
      name: name.trim() || auto,
      store: store.trim(),
      days,
      accountId,
      percent: pct,
      cap: parseAmount(cap),
      categoryId:
        benefit?.categoryId ?? (/super|tienda|disco|devoto|ta-ta|tata|macro|geant|kinko/i.test(store) ? 'cat-super' : null),
      until: until || null,
    });
    if (!r.success) return toast('Revisá los datos', { tone: 'error' });
    mutate('benefit', 'upsert', r.data);
    toast('Beneficio guardado');
    onClose();
  };
  return (
    <Sheet
      title={benefit ? 'Editar beneficio' : 'Nuevo beneficio'}
      onClose={onClose}
      footer={
        <>
          {benefit && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('benefit', 'delete', benefit.id);
                toast('Borrado', { action: { label: 'Deshacer', run: () => mutate('benefit', 'upsert', benefit) } });
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
        <div className="row">
          <Field label="Dónde" hint="Vacío: en cualquier lado">
            <input value={store} onChange={(e) => setStore(e.target.value)} placeholder="Ej: Tienda Inglesa" maxLength={60} />
          </Field>
          <Field label="Descuento (%)">
            <input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ej: 25" />
          </Field>
        </div>
        <Field label="Qué días">
          <div className="chips">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                role="checkbox"
                aria-checked={days.includes(i)}
                className={`chip ${days.includes(i) ? 'on' : ''}`}
                onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Pagando con">
          <Chips
            label="Cuenta"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: null as string | null, label: 'Cualquiera' },
              ...accounts.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon })),
            ]}
          />
        </Field>
        <div className="row">
          <Field label="Tope por mes (opcional)">
            <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Ej: 500" />
          </Field>
          <Field label="Vale hasta (opcional)">
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        <Field label="Nombre (opcional)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Martes BROU en el súper"
            maxLength={80}
          />
        </Field>
      </div>
    </Sheet>
  );
}
