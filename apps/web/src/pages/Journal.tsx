import { useState } from 'react';
import { addDays, journalInsights, type Comparison, type JournalEntry } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { PageHeader, Section } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { getState, mutate } from '../lib/sync';

export const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

/** Guarda (o actualiza) el registro del día. Lee lo último guardado (dos toques seguidos no se pisan). */
export function saveJournal(date: string, patch: Partial<JournalEntry>) {
  const prev = getState().records.journal?.[date] as JournalEntry | undefined;
  mutate('journal', 'upsert', {
    id: date,
    updatedAt: '',
    date,
    sleepHours: null,
    mood: null,
    note: '',
    ...(prev ?? {}),
    ...patch,
  });
}

/** Lo rápido: cuántas horas dormiste y cómo estás. Sirve en Inicio y en el Diario. */
export function QuickJournal({ date, compact }: { date: string; compact?: boolean }) {
  const data = useData();
  const entry = data.journal.find((j) => j.date === date);
  return (
    <div className="journal-quick">
      <div className="journal-row">
        <span className="small muted">Dormiste</span>
        <div className="chips">
          {[5, 6, 7, 8, 9].map((h) => (
            <button
              key={h}
              className={`chip ${entry?.sleepHours === h ? 'on' : ''}`}
              aria-pressed={entry?.sleepHours === h}
              onClick={() => saveJournal(date, { sleepHours: h })}
            >
              {h === 5 ? '≤5' : h === 9 ? '9+' : h} h
            </button>
          ))}
        </div>
      </div>
      <div className="journal-row">
        <span className="small muted">Te sentís</span>
        <div className="chips">
          {MOODS.map((m, i) => (
            <button
              key={m}
              className={`chip mood ${entry?.mood === i + 1 ? 'on' : ''}`}
              aria-pressed={entry?.mood === i + 1}
              aria-label={`Ánimo ${i + 1} de 5`}
              onClick={() => saveJournal(date, { mood: i + 1 })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {!compact && entry && (
        <textarea
          defaultValue={entry.note}
          onBlur={(e) => e.target.value !== entry.note && saveJournal(date, { note: e.target.value })}
          placeholder="¿Algo para anotar del día? (opcional)"
          rows={2}
          maxLength={500}
          aria-label="Nota del día"
        />
      )}
    </div>
  );
}

function sentence(c: Comparison, what: string): string | null {
  if (c.diff === null || c.badDays < 2 || c.goodDays < 2 || Math.abs(c.diff) < 10) return null;
  const more = c.diff > 0;
  if (c.metric === 'gasto del día')
    return `Los días que ${what} gastás ${Math.abs(c.diff)}% ${more ? 'más' : 'menos'} (${money(Math.round(c.bad))} contra ${money(Math.round(c.good))}).`;
  if (c.metric.startsWith('rutinas'))
    return `Los días que ${what} cumplís ${Math.round(c.bad)}% de tus rutinas (los demás, ${Math.round(c.good)}%).`;
  return `Los días que ${what} estudiás ${Math.round(c.bad)} min (los demás, ${Math.round(c.good)} min).`;
}

export function Journal() {
  const data = useData();
  const today = useToday();
  const [date, setDate] = useState(today);
  const r = journalInsights(data, today);
  const lines = [
    ...r.bySleep.map((c) => ({ c, text: sentence(c, 'dormís menos de 6 h') })),
    ...r.byMood.map((c) => ({ c, text: sentence(c, 'estás bajón') })),
  ].filter((x) => x.text);
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  return (
    <div className="page narrow">
      <PageHeader
        title="Diario"
        subtitle={
          r.days
            ? `Últimos 60 días: dormís ${r.avgSleep?.toLocaleString('es-UY') ?? '—'} h en promedio · ánimo ${r.avgMood?.toLocaleString('es-UY') ?? '—'} de 5`
            : 'Cómo dormiste y cómo estás: 5 segundos por día'
        }
      />
      <section className="card pad">
        <div className="limit-head">
          <strong>{date === today ? 'Hoy' : dayLabel(date, today, true)}</strong>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Día"
          />
        </div>
        <QuickJournal key={date} date={date} />
      </section>
      <Section title="Últimos 14 días">
        <div className="card pad journal-strip">
          {last14.map((d) => {
            const j = data.journal.find((x) => x.date === d);
            return (
              <button
                key={d}
                className={`journal-day ${d === date ? 'on' : ''}`}
                onClick={() => setDate(d)}
                title={dayLabel(d, today, true)}
              >
                <span>{j?.mood ? MOODS[j.mood - 1] : '·'}</span>
                <small>{j?.sleepHours != null ? `${j.sleepHours}h` : ''}</small>
                <small className="muted">{Number(d.slice(8))}</small>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Lo que se nota">
        {lines.length ? (
          <ul className="insights">
            {lines.map(({ c, text }) => (
              <li key={text}>
                <button
                  className="insight insight-info"
                  onClick={() =>
                    openExplain({
                      title: 'Cómo se compara',
                      intro:
                        'Promedio de los días "malos" contra el de los demás, en los últimos 60 días. Es una pista, no causa y efecto.',
                      rows: [
                        { label: `Días malos (${c.badDays})`, value: c.bad },
                        { label: `Los demás (${c.goodDays})`, value: c.good },
                      ],
                    })
                  }
                >
                  <span aria-hidden="true">💡</span>
                  <span className="grow">{text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            Anotá unos días más (hacen falta al menos 2 días "malos" y 2 "buenos") y Lifty te muestra si dormir poco o estar bajón
            cambia lo que gastás, tus rutinas o tu estudio.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Para Inicio: si todavía no anotaste hoy. */
export function JournalPrompt() {
  const data = useData();
  const today = useToday();
  const entry = data.journal.find((j) => j.date === today);
  if (entry?.sleepHours != null && entry?.mood != null) return null;
  return (
    <section className="card pad">
      <div className="limit-head">
        <strong>¿Cómo dormiste y cómo estás?</strong>
        <a className="link small" href="#/diario">
          Diario
        </a>
      </div>
      <QuickJournal date={today} compact />
    </section>
  );
}
