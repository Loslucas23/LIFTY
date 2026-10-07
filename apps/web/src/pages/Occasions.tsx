import { useState } from 'react';
import { newId, OCCASION_IDEAS, occasionSchema, upcomingOccasions, type Occasion, type OccasionKind } from '@lifty/core';
import { Icon } from '../components/Icon';
import { openTxForm } from '../components/TxForm';
import { Empty, Field, PageHeader, Progress, Section, Segmented, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const ORD = ['', '1.er', '2.º', '3.er', '4.º', '5.º'];
const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const whenText = (o: Pick<Occasion, 'monthDay' | 'rule'>) => {
  if (o.monthDay) {
    const [m, d] = o.monthDay.split('-').map(Number);
    return `${d} de ${MONTHS[m - 1]}`;
  }
  if (o.rule) {
    const [m, n, d] = o.rule.split(':').map(Number);
    return `${ORD[n]} ${DOW[d]} de ${MONTHS[m - 1]}`;
  }
  return '';
};
const ddmm = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** Fechas caras del año y cumpleaños: cuánto apartar por mes, ideas de regalo y aviso con tiempo. */
export function Occasions() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Occasion | { kind: OccasionKind } | null>(null);
  const list = upcomingOccasions(data, today);
  const have = new Set(data.occasions.map((o) => o.name));
  const ideas = OCCASION_IDEAS.filter((i) => !have.has(i.name));
  const perMonth = list.filter((s) => s.daysLeft <= 365).reduce((s, x) => s + (x.perMonth ?? 0), 0);
  return (
    <div className="page narrow">
      <PageHeader
        title="Fechas y regalos"
        subtitle="Fechas caras del año y cumpleaños, para no llegar justo"
        actions={
          <>
            <button className="btn" onClick={() => setEditing({ kind: 'cumple' })}>
              <Icon name="plus" /> Cumpleaños
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'fecha' })}>
              <Icon name="plus" /> Fecha
            </button>
          </>
        }
      />
      {perMonth > 0 && (
        <div className="card pad">
          <p>
            Para llegar a todas con la plata juntada, apartá <strong>{money(Math.ceil(perMonth))} por mes</strong>.
          </p>
          <p className="muted small">Lo que falta de cada presupuesto ÷ los meses que quedan hasta cada fecha (contando este).</p>
        </div>
      )}
      {list.length === 0 ? (
        <Empty icon="calendar" title="Agregá las fechas que te cuestan">
          Navidad, el Día de la Madre, el inicio de clases o el cumpleaños de alguien: Lifty te avisa con tiempo y te dice cuánto
          apartar por mes.
        </Empty>
      ) : (
        <div className="goal-grid">
          {list.map((s) => {
            const o = s.occasion;
            return (
              <article key={o.id} className="card goal">
                <div className="goal-head">
                  <span className="goal-icon">{o.icon}</span>
                  <strong className="grow">{o.kind === 'cumple' ? `Cumple de ${o.name}` : o.name}</strong>
                  <button className="link small" onClick={() => setEditing(o)}>
                    Editar
                  </button>
                </div>
                <p className="small">
                  {s.daysLeft === 0 ? '¡Es hoy!' : s.daysLeft === 1 ? 'Mañana' : `En ${s.daysLeft} días`} · {ddmm(s.date)} (
                  {whenText(o)})
                </p>
                {o.budget !== null && (
                  <>
                    <Progress value={s.spent} max={o.budget} label="Gastado del presupuesto" />
                    <p className="muted small">
                      Llevás {money(Math.round(s.spent))} de {money(o.budget)}
                      {s.perMonth !== null && s.perMonth > 0 ? ` · apartá ${money(Math.ceil(s.perMonth))} por mes` : ''}
                    </p>
                  </>
                )}
                {o.ideas.length > 0 && <p className="small">💡 {o.ideas.join(' · ')}</p>}
                <div className="btn-row">
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      openTxForm({
                        preset: {
                          kind: 'expense',
                          description: o.kind === 'cumple' ? `Regalo ${o.name}` : o.name,
                          tags: o.tag ? [o.tag] : [],
                          categoryId: data.categories.find((c) => /regalo/i.test(c.name))?.id ?? 'cat-personal',
                        },
                      })
                    }
                  >
                    <Icon name="plus" size={16} /> Anotar {o.kind === 'cumple' ? 'el regalo' : 'un gasto'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {ideas.length > 0 && (
        <Section title="Fechas caras que se suelen olvidar">
          <div className="chips">
            {ideas.map((i) => (
              <button
                key={i.name}
                className="chip"
                onClick={() => {
                  const rec = occasionSchema.parse({ ...i, id: newId(), kind: 'fecha' });
                  mutate('occasion', 'upsert', rec);
                  toast(`${i.name}: agregada. Poné cuánto pensás gastar.`);
                  setEditing(rec);
                }}
              >
                <span className="chip-icon">{i.icon}</span>
                {i.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      {editing && (
        <OccasionForm
          occasion={'id' in editing ? editing : null}
          kind={'id' in editing ? editing.kind : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function OccasionForm({
  occasion,
  kind: kind0,
  onClose,
}: {
  occasion: Occasion | null;
  kind: OccasionKind;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<OccasionKind>(occasion?.kind ?? kind0);
  const [name, setName] = useState(occasion?.name ?? '');
  const [icon, setIcon] = useState(occasion?.icon ?? (kind0 === 'cumple' ? '🎂' : '📅'));
  const [md, setMd] = useState(occasion?.monthDay ? `2000-${occasion.monthDay}` : '');
  const [budget, setBudget] = useState(occasion?.budget != null ? String(occasion.budget) : '');
  const [ideas, setIdeas] = useState((occasion?.ideas ?? []).join('\n'));
  const [notice, setNotice] = useState(String(occasion?.notice ?? (kind0 === 'cumple' ? 21 : 60)));
  const save = () => {
    if (!name.trim()) return toast(kind === 'cumple' ? 'Poné de quién es' : 'Ponele un nombre', { tone: 'error' });
    const monthDay = md ? md.slice(5) : (occasion?.monthDay ?? null);
    const rule = md ? null : (occasion?.rule ?? null);
    if (!monthDay && !rule) return toast('Elegí la fecha', { tone: 'error' });
    const r = occasionSchema.safeParse({
      ...(occasion ?? {}),
      id: occasion?.id ?? newId(),
      updatedAt: '',
      kind,
      name: name.trim(),
      icon: icon || '📅',
      monthDay,
      rule,
      budget: parseAmount(budget),
      ideas: ideas
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20),
      notice: Math.min(180, Math.max(0, Number(notice) || 0)),
      tag: occasion?.tag || (kind === 'cumple' ? `cumple ${name.trim().toLowerCase()}` : name.trim().toLowerCase()).slice(0, 30),
    });
    if (!r.success) return toast('Revisá los datos', { tone: 'error' });
    mutate('occasion', 'upsert', r.data);
    toast('Guardado');
    onClose();
  };
  return (
    <Sheet
      title={occasion ? 'Editar' : kind === 'cumple' ? 'Nuevo cumpleaños' : 'Nueva fecha'}
      onClose={onClose}
      footer={
        <>
          {occasion && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('occasion', 'delete', occasion.id);
                toast('Borrado', { action: { label: 'Deshacer', run: () => mutate('occasion', 'upsert', occasion) } });
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
        <Segmented
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'fecha', label: 'Fecha cara' },
            { value: 'cumple', label: 'Cumpleaños' },
          ]}
        />
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label={kind === 'cumple' ? '¿De quién?' : 'Nombre'}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'cumple' ? 'Ej: Mamá' : 'Ej: Fiestas'}
              maxLength={60}
            />
          </Field>
        </div>
        <Field label="Fecha" hint={occasion?.rule && !md ? `Cambia cada año: ${whenText(occasion)}` : 'Se repite todos los años'}>
          <input type="date" value={md} onChange={(e) => setMd(e.target.value)} />
        </Field>
        <div className="row">
          <Field label="Pensás gastar" hint="Regalos, la cena, los útiles…">
            <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ej: 3000" />
          </Field>
          <Field label="Avisar (días antes)">
            <input inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field label="Ideas de regalo (una por línea)">
          <textarea rows={3} value={ideas} onChange={(e) => setIdeas(e.target.value)} placeholder="Ej: un libro de cocina" />
        </Field>
      </div>
    </Sheet>
  );
}
