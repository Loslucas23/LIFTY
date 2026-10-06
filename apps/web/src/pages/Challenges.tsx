import { useState } from 'react';
import {
  addDays,
  addMonths,
  challengeSchema,
  challengeStatus,
  monthOf,
  newId,
  sortedCategories,
  suggestChallenges,
  type ChallengeIdea,
  type ChallengeStatus,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Sheet, toast } from '../components/ui';
import { parseAmount } from '../lib/format';
import { useData, useMonth, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const STATUS_TAG: Record<ChallengeStatus['status'], [string, string]> = {
  upcoming: ['Empieza pronto', 'tag-info'],
  active: ['En curso', 'tag-info'],
  won: ['¡Logrado! 🎉', 'tag-good'],
  lost: ['No salió', 'tag-bad'],
};

/** Los desafíos activos (para Inicio). */
export function useActiveChallenges(): ChallengeStatus[] {
  const data = useData();
  const today = useToday();
  return data.challenges
    .filter((c) => !c.archived && c.to >= addDays(today, -1))
    .map((c) => challengeStatus(c, data, today))
    .filter((s) => s.status === 'active' || s.status === 'upcoming');
}

/** Desafíos: metas cortas que se siguen solas, con sugerencias que salen de tus números. */
export function Challenges() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const past = useMonths(addMonths(month, -3), addMonths(month, -1));
  const b = useMonth(month);
  const [creating, setCreating] = useState(false);
  const all = data.challenges.filter((c) => !c.archived).map((c) => challengeStatus(c, data, today));
  const current = all.filter((s) => s.status === 'active' || s.status === 'upcoming');
  const done = all.filter((s) => s.status === 'won' || s.status === 'lost').slice(0, 12);
  const won = all.filter((s) => s.status === 'won').length;
  const ideas = suggestChallenges(data, past, b, today);
  const accept = (idea: ChallengeIdea) => {
    const c = challengeSchema.parse({ ...idea.challenge, id: newId(), updatedAt: '' });
    mutate('challenge', 'upsert', c);
    toast(`¡Desafío aceptado! ${c.name}`);
  };
  return (
    <div className="page narrow">
      <PageHeader
        title="Desafíos"
        subtitle={won ? `Llevás ${won} logrado${won === 1 ? '' : 's'} 🏆` : 'Metas cortas que se siguen solas con lo que cargás'}
        back="/mas"
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Desafío
          </button>
        }
      />
      {current.length === 0 ? (
        <Empty icon="check" title="No tenés desafíos en curso">
          Aceptá uno de los sugeridos o armá el tuyo.
        </Empty>
      ) : (
        <div className="goal-grid">
          {current.map((s) => (
            <ChallengeCard key={s.challenge.id} s={s} />
          ))}
        </div>
      )}
      {ideas.length > 0 && (
        <Section title="Sugeridos para vos">
          <ul className="insights">
            {ideas.map((i) => (
              <li key={i.key}>
                <div className="insight insight-info">
                  <span aria-hidden="true">{i.challenge.icon}</span>
                  <span className="grow">
                    <strong>{i.challenge.name}</strong>
                    <br />
                    <span className="muted small">{i.why}</span>
                  </span>
                  <button className="btn" onClick={() => accept(i)}>
                    Acepto
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Terminados">
          <div className="goal-grid">
            {done.map((s) => (
              <ChallengeCard key={s.challenge.id} s={s} />
            ))}
          </div>
        </Section>
      )}
      {creating && <ChallengeForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function ChallengeCard({ s }: { s: ChallengeStatus }) {
  const [label, tone] = STATUS_TAG[s.status];
  const c = s.challenge;
  return (
    <article className={`card goal challenge challenge-${s.status}`}>
      <div className="goal-head">
        <span className="goal-icon">{c.icon}</span>
        <strong className="grow">{c.name}</strong>
        <span className={`tag ${tone}`}>{label}</span>
      </div>
      <span className="score-bar">
        <span
          className={`score-fill score-fill-${s.status === 'lost' ? 'bad' : c.kind === 'spend-under' && s.progress > 0.85 ? 'warn' : 'good'}`}
          style={{ width: `${Math.max(2, s.progress * 100)}%` }}
        />
      </span>
      <p className="small">
        {s.text}
        {s.status === 'active' && <span className="muted"> · quedan {s.daysLeft} días</span>}
      </p>
      <div className="btn-row">
        <button
          className="btn btn-ghost"
          onClick={() => {
            mutate('challenge', 'upsert', { ...c, archived: true });
            toast('Desafío quitado', { action: { label: 'Deshacer', run: () => mutate('challenge', 'upsert', c) } });
          }}
        >
          Quitar
        </button>
      </div>
    </article>
  );
}

type Kind = 'no-spend-category' | 'spend-under' | 'no-spend-days' | 'habit-days' | 'save';
const KIND_LABEL: Record<Kind, string> = {
  'no-spend-category': 'Sin gastar en algo',
  'spend-under': 'No pasar de un tope',
  'no-spend-days': 'Días sin gastar',
  'habit-days': 'Cumplir una rutina',
  save: 'Ahorrar',
};

function ChallengeForm({ onClose }: { onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const [kind, setKind] = useState<Kind>('no-spend-category');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [habitId, setHabitId] = useState<string | null>(null);
  const [days, setDays] = useState('7');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cats = sortedCategories(data.categories.filter((c) => c.kind === 'expense' && !c.archived));
  const habits = data.habits.filter((h) => !h.archived);
  const save = () => {
    const n = Math.max(1, Math.min(90, Number(days) || 7));
    const to = addDays(today, n - 1);
    const cat = cats.find((c) => c.id === categoryId);
    const habit = habits.find((h) => h.id === habitId);
    const amount = parseAmount(target) ?? 0;
    const base = { id: newId(), updatedAt: '', kind, from: today, to, categoryId: null, habitId: null };
    let rec: object | null = null;
    if (kind === 'no-spend-category' && cat)
      rec = { ...base, categoryId: cat.id, icon: cat.icon, name: `${n} días sin ${cat.name.toLowerCase()}`, target: n };
    else if (kind === 'spend-under' && amount > 0)
      rec = {
        ...base,
        categoryId: cat?.id ?? null,
        icon: cat?.icon ?? '🎯',
        name: `${cat ? cat.name : 'Todo'}: no pasar de $ ${amount.toLocaleString('es-UY')} en ${n} días`,
        target: amount,
      };
    else if (kind === 'no-spend-days' && amount > 0)
      rec = { ...base, icon: '✅', name: `${amount} días sin gastar en ${n}`, target: Math.min(n, Math.round(amount)) };
    else if (kind === 'habit-days' && habit && amount > 0)
      rec = {
        ...base,
        habitId: habit.id,
        icon: habit.icon,
        name: `${habit.name}: ${amount} de ${n} días`,
        target: Math.round(amount),
      };
    else if (kind === 'save' && amount > 0)
      rec = { ...base, icon: '🐷', name: `Ahorrar $ ${amount.toLocaleString('es-UY')} en ${n} días`, target: amount };
    const r = rec ? challengeSchema.safeParse(rec) : null;
    if (!r?.success) return setError('Completá lo que falta.');
    mutate('challenge', 'upsert', r.data);
    toast(`¡Desafío creado! ${r.data.name}`);
    onClose();
  };
  return (
    <Sheet
      title="Nuevo desafío"
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save}>
          Empezar hoy
        </button>
      }
    >
      <div className="form">
        {error && <p className="field-error">{error}</p>}
        <Field label="¿Qué desafío?">
          <Chips
            label="Tipo de desafío"
            value={kind}
            onChange={(k) => setKind(k as Kind)}
            options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
        </Field>
        {(kind === 'no-spend-category' || kind === 'spend-under') && (
          <Field label={kind === 'spend-under' ? 'En qué (vacío = todo)' : 'Sin gastar en'}>
            <Chips
              label="Categoría"
              value={categoryId}
              onChange={setCategoryId}
              options={cats.map((c) => ({
                value: c.id as string | null,
                label: c.parentId ? `↳ ${c.name}` : c.name,
                icon: c.icon,
                color: c.color,
              }))}
            />
          </Field>
        )}
        {kind === 'habit-days' && (
          <Field label="Rutina">
            <Chips
              label="Rutina"
              value={habitId}
              onChange={setHabitId}
              options={habits.map((h) => ({ value: h.id as string | null, label: h.name, icon: h.icon }))}
            />
          </Field>
        )}
        <div className="row">
          <Field label="Durante (días)">
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </Field>
          {kind !== 'no-spend-category' && (
            <Field label={kind === 'no-spend-days' || kind === 'habit-days' ? 'Cuántos días' : 'Monto ($)'}>
              <input
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={kind === 'save' ? 'Ej: 5000' : 'Ej: 3'}
              />
            </Field>
          )}
        </div>
      </div>
    </Sheet>
  );
}
