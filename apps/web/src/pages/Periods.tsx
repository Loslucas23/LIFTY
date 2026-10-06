import { useState } from 'react';
import {
  addDays,
  monthOf,
  newId,
  periodSchema,
  periodStatus,
  suggestTightCap,
  type Period,
  type PeriodKind,
  type PeriodStatus,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Empty, Field, PageHeader, Section, Segmented, Sheet, Toggle, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const fmtDate = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

/** La época especial que está pasando (para Inicio). */
export function useActivePeriods(): PeriodStatus[] {
  const data = useData();
  const today = useToday();
  return (data.periods ?? [])
    .filter((p) => !p.archived && p.from <= addDays(today, 7) && p.to >= today)
    .map((p) => periodStatus(p, data, today));
}

/** Una línea para Inicio: cuánto llevás del viaje o del tope de hoy. */
export function PeriodLine({ s }: { s: PeriodStatus }) {
  const p = s.period;
  if (s.state === 'upcoming')
    return (
      <>
        {p.kind === 'vacation' ? '🏖️' : '🧮'} <strong>{p.name}</strong> empieza el {fmtDate(p.from)}
        {p.kind === 'vacation' && s.spent > 0 ? ` · ya llevás ${money(Math.round(s.spent))} (pasajes, reservas…)` : ''}
      </>
    );
  if (p.kind === 'vacation')
    return (
      <>
        🏖️ <strong>{p.name}</strong>: llevás {money(Math.round(s.spent))}
        {p.budget !== null && s.remaining !== null
          ? s.remaining >= 0
            ? ` de ${money(p.budget)} · podés gastar ${money(Math.round(s.perDay ?? 0))} por día (${s.daysLeft} días)`
            : ` · te pasaste ${money(Math.round(-s.remaining))} del presupuesto del viaje`
          : ` · quedan ${s.daysLeft} días`}
      </>
    );
  return (
    <>
      🧮 <strong>Mes difícil</strong>: hoy llevás {money(Math.round(s.spentToday))} de {money(p.budget ?? 0)}
      {s.remaining !== null && s.remaining < 0 ? ' (te pasaste)' : ''}
      {s.pastDays > 0 ? ` · cumpliste ${s.underDays} de ${s.pastDays} días` : ''}
    </>
  );
}

/** Vacaciones y meses difíciles: épocas con otras reglas. */
export function Periods() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Period | PeriodKind | null>(null);
  const list = (data.periods ?? []).filter((p) => !p.archived).map((p) => periodStatus(p, data, today));
  const current = list.filter((s) => s.state !== 'done');
  const done = list.filter((s) => s.state === 'done');
  return (
    <div className="page narrow">
      <PageHeader
        title="Vacaciones y meses difíciles"
        subtitle="Épocas con otras reglas: un presupuesto para el viaje o un tope más bajo por día"
        back="/mas"
      />
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setEditing('vacation')}>
          🏖️ Planear unas vacaciones
        </button>
        <button className="btn" onClick={() => setEditing('tight')}>
          🧮 Empezar un mes difícil
        </button>
      </div>
      {current.length === 0 ? (
        <Empty icon="calendar" title="No tenés nada planeado">
          De vacaciones: ponés cuánto querés gastar en el viaje, lo que cargues en esas fechas lleva su etiqueta y Lifty te dice
          cuánto podés gastar por día. Un mes difícil: un tope por día más bajo y cuántos días lo cumpliste.
        </Empty>
      ) : (
        <div className="goal-grid">
          {current.map((s) => (
            <PeriodCard key={s.period.id} s={s} onEdit={() => setEditing(s.period)} />
          ))}
        </div>
      )}
      {done.length > 0 && (
        <Section title="Terminadas">
          <div className="goal-grid">
            {done.slice(0, 8).map((s) => (
              <PeriodCard key={s.period.id} s={s} onEdit={() => setEditing(s.period)} />
            ))}
          </div>
        </Section>
      )}
      {editing && (
        <PeriodForm
          period={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PeriodCard({ s, onEdit }: { s: PeriodStatus; onEdit: () => void }) {
  const p = s.period;
  const progress =
    p.kind === 'vacation' ? (p.budget ? Math.min(1, s.spent / p.budget) : 0) : s.pastDays ? s.underDays / s.pastDays : 0;
  const bad = p.kind === 'vacation' ? s.remaining !== null && s.remaining < 0 : s.remaining !== null && s.remaining < 0;
  return (
    <article className="card goal">
      <div className="goal-head">
        <span className="goal-icon">{p.kind === 'vacation' ? '🏖️' : '🧮'}</span>
        <strong className="grow">{p.name}</strong>
        <span className={`tag ${s.state === 'active' ? 'tag-info' : ''}`}>
          {s.state === 'active' ? 'Ahora' : s.state === 'upcoming' ? `Desde el ${fmtDate(p.from)}` : 'Terminó'}
        </span>
      </div>
      <p className="muted small">
        Del {fmtDate(p.from)} al {fmtDate(p.to)} ({s.days} días){p.tag ? ` · #${p.tag}` : ''}
        {p.pauseRoutines ? ' · rutinas en pausa' : ''}
      </p>
      {(p.budget !== null || p.kind === 'tight') && (
        <span className="score-bar">
          <span
            className={`score-fill score-fill-${bad ? 'bad' : p.kind === 'vacation' && progress > 0.85 ? 'warn' : 'good'}`}
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </span>
      )}
      <p className="small">
        <PeriodLine s={s} />
      </p>
      <div className="btn-row">
        {p.tag && (
          <a className="btn btn-ghost" href={`#/movimientos?etiqueta=${encodeURIComponent(p.tag)}`}>
            Ver gastos
          </a>
        )}
        <button className="btn btn-ghost" onClick={onEdit}>
          <Icon name="edit" size={16} /> Cambiar
        </button>
      </div>
    </article>
  );
}

function PeriodForm({ period, kind: initialKind, onClose }: { period: Period | null; kind: PeriodKind; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const [kind, setKind] = useState<PeriodKind>(initialKind);
  const suggestedCap = suggestTightCap(data, b, today);
  const monthEnd = `${monthOf(today)}-${String(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
  const [name, setName] = useState(period?.name ?? (initialKind === 'tight' ? 'Mes difícil' : ''));
  const [from, setFrom] = useState(period?.from ?? today);
  const [to, setTo] = useState(period?.to ?? (initialKind === 'tight' ? monthEnd : addDays(today, 6)));
  const [budget, setBudget] = useState(
    period?.budget != null ? String(period.budget) : initialKind === 'tight' && suggestedCap ? String(suggestedCap) : '',
  );
  const [tag, setTag] = useState(period?.tag ?? '');
  const [pause, setPause] = useState(period?.pauseRoutines ?? initialKind === 'vacation');
  const [error, setError] = useState<string | null>(null);
  const autoTag = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  const save = () => {
    if (to < from) return setError('La fecha de fin tiene que ser después del comienzo.');
    const r = periodSchema.safeParse({
      id: period?.id ?? newId(),
      updatedAt: '',
      kind,
      name: name.trim() || (kind === 'tight' ? 'Mes difícil' : 'Vacaciones'),
      from,
      to,
      budget: parseAmount(budget) || null,
      tag: kind === 'vacation' ? (tag.trim() || autoTag).replace(/^#/, '') : '',
      pauseRoutines: pause,
      archived: false,
    });
    if (!r.success) return setError('Revisá los datos.');
    if (kind === 'tight' && !r.data.budget) return setError('Poné el tope por día.');
    mutate('period', 'upsert', r.data);
    toast(kind === 'vacation' ? `¡Buen viaje! ${r.data.name}` : 'Modo mes difícil activado');
    onClose();
  };
  return (
    <Sheet
      title={period ? 'Cambiar' : kind === 'vacation' ? 'Unas vacaciones' : 'Un mes difícil'}
      onClose={onClose}
      footer={
        <>
          {period && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('period', 'upsert', { ...period, archived: true });
                toast('Quitado', { action: { label: 'Deshacer', run: () => mutate('period', 'upsert', period) } });
                onClose();
              }}
            >
              Quitar
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
        {!period && (
          <Segmented
            label="Tipo"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPause(k === 'vacation');
              if (k === 'tight' && !budget && suggestedCap) setBudget(String(suggestedCap));
            }}
            options={[
              { value: 'vacation', label: '🏖️ Vacaciones' },
              { value: 'tight', label: '🧮 Mes difícil' },
            ]}
          />
        )}
        <Field label="Nombre">
          <input
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'vacation' ? 'Ej: Floripa, Punta del Este…' : 'Mes difícil'}
          />
        </Field>
        <div className="row">
          <Field label="Desde">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field
          label={kind === 'vacation' ? 'Presupuesto del viaje (todo, opcional)' : 'Tope por día'}
          hint={
            kind === 'tight' && suggestedCap
              ? `Sugerido: ${money(suggestedCap)} (20% menos de lo que podés gastar por día este mes).`
              : kind === 'vacation'
                ? 'Pasajes, alojamiento, comidas… Lifty te dice cuánto podés gastar por día.'
                : undefined
          }
        >
          <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ej: 30000" />
        </Field>
        {kind === 'vacation' && (
          <Field
            label="Etiqueta"
            hint="Lo que cargues en esas fechas la lleva sola. Ponésela también a lo que pagues antes (pasajes, reservas)."
          >
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={autoTag ? `#${autoTag}` : '#viaje'} />
          </Field>
        )}
        <Toggle checked={pause} onChange={setPause} label="Pausar rutinas y estudio mientras dura (no te los pide en Para hoy)" />
      </div>
    </Sheet>
  );
}
