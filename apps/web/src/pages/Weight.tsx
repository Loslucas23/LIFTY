import { useMemo, useState } from 'react';
import {
  addDays,
  bmiLabel,
  dailyWeights,
  daysBetween,
  exerciseVsWeight,
  movingAverage,
  newId,
  todayISO,
  weightSchema,
  weightStats,
  type WeightEntry,
} from '@lifty/core';
import { openExplain } from '../components/Editors';
import { Icon } from '../components/Icon';
import { useWidth } from '../components/useWidth';
import { Empty, Field, PageHeader, Section, Segmented, Sheet, toast } from '../components/ui';
import { dayLabel, parseAmount } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const kg = (v: number) => `${v.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
const signedKg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${kg(Math.abs(v))}`;

type Range = '30' | '90' | '365' | 'all';

export function Weight() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<WeightEntry | 'new' | null>(null);
  const [range, setRange] = useState<Range>('90');
  const [showAll, setShowAll] = useState(false);
  const { heightCm, goalWeightKg } = data.settings;
  const stats = weightStats(data.weights, { heightCm, goalKg: goalWeightKg });
  const history = [...data.weights].reverse();

  return (
    <div className="page">
      <PageHeader
        title="Peso"
        subtitle="Anotá tu peso cuando quieras: Lifty muestra la tendencia"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Anotar peso
          </button>
        }
      />

      {!stats.latest ? (
        <Empty icon="scale" title="Todavía no anotaste tu peso">
          <p>Con un pesaje por semana alcanza para ver cómo vas. Si cargás tu altura, Lifty calcula el IMC.</p>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            Anotar el primero
          </button>
        </Empty>
      ) : (
        <>
          <section className="hero hero-calm">
            <p className="hero-label">Último pesaje · {dayLabel(stats.latest.date, today).toLowerCase()}</p>
            <p className="hero-value">{kg(stats.latest.kg)}</p>
            <div className="hero-stats">
              <div>
                <span>Última semana</span>
                <strong>{stats.change7 === null ? '—' : signedKg(stats.change7)}</strong>
              </div>
              <div>
                <span>Último mes</span>
                <strong>{stats.change30 === null ? '—' : signedKg(stats.change30)}</strong>
              </div>
              <div>
                <span>{stats.bmi !== null ? `IMC · ${bmiLabel(stats.bmi)}` : 'Promedio 7 días'}</span>
                <strong>
                  {stats.bmi !== null ? stats.bmi.toLocaleString('es-UY', { maximumFractionDigits: 1 }) : kg(stats.average7!)}
                </strong>
              </div>
            </div>
            {stats.toGoal !== null && (
              <p className="hero-foot">
                {Math.abs(stats.toGoal) < 0.1
                  ? '¡Llegaste a tu meta!'
                  : `Te faltan ${kg(Math.abs(stats.toGoal))} para tu meta de ${kg(goalWeightKg!)}`}
              </p>
            )}
          </section>

          <WeightChart entries={data.weights} goal={goalWeightKg} range={range} onRange={setRange} today={today} />

          <ExerciseAndWeight />

          <Section title="Historial">
            <div className="card list">
              {history.slice(0, showAll ? 500 : 10).map((w) => (
                <button key={w.id} className="tx-row" onClick={() => setEditing(w)}>
                  <span className="tx-icon" style={{ '--tint': 'var(--series-1)' } as React.CSSProperties}>
                    ⚖️
                  </span>
                  <span className="tx-main">
                    <span className="tx-title">{kg(w.kg)}</span>
                    <span className="tx-meta">{[dayLabel(w.date, today, true), w.note].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
            {history.length > 10 && (
              <button className="btn btn-ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Ver menos' : `Ver los ${history.length} pesajes`}
              </button>
            )}
          </Section>
        </>
      )}

      <BodySettings key={`${heightCm}-${goalWeightKg}`} />
      {editing && (
        <WeightForm entry={editing === 'new' ? null : editing} last={stats.latest?.kg ?? null} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function BodySettings() {
  const data = useData();
  const s = data.settings;
  const [height, setHeight] = useState(s.heightCm ? String(s.heightCm) : '');
  const [goal, setGoal] = useState(s.goalWeightKg ? String(s.goalWeightKg).replace('.', ',') : '');
  const save = () => {
    const h = parseAmount(height);
    const g = parseAmount(goal);
    if (h !== null && (h < 50 || h > 250)) return toast('La altura va en centímetros (ej: 175)', { tone: 'error' });
    if (g !== null && (g < 20 || g > 400)) return toast('La meta tiene que estar entre 20 y 400 kg', { tone: 'error' });
    mutate('settings', 'upsert', { ...s, heightCm: h, goalWeightKg: g });
    toast('Datos guardados');
  };
  return (
    <Section title="Tus datos">
      <form
        className="card pad form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="row">
          <Field label="Altura (cm)" hint="Para calcular el IMC">
            <input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="175" />
          </Field>
          <Field label="Meta (kg)" hint="Opcional">
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="75" />
          </Field>
        </div>
        <button className="btn" type="submit">
          Guardar
        </button>
      </form>
    </Section>
  );
}

function WeightForm({ entry, last, onClose }: { entry: WeightEntry | null; last: number | null; onClose: () => void }) {
  const [text, setText] = useState(entry ? String(entry.kg).replace('.', ',') : last ? String(last).replace('.', ',') : '');
  const [date, setDate] = useState(entry?.date ?? todayISO());
  const [note, setNote] = useState(entry?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const value = parseAmount(text);
    const result = weightSchema.safeParse({ id: entry?.id ?? newId(), updatedAt: '', date, kg: value ?? 0, note: note.trim() });
    if (!result.success) return setError('Escribí un peso entre 20 y 400 kg.');
    mutate('weight', 'upsert', result.data);
    toast(`Peso anotado: ${kg(result.data.kg)}`);
    onClose();
  };
  return (
    <Sheet
      title={entry ? 'Editar pesaje' : 'Anotar peso'}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('weight', 'delete', entry.id);
                toast('Pesaje borrado', { action: { label: 'Deshacer', run: () => mutate('weight', 'upsert', entry) } });
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
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="amount-input">
          <input
            data-autofocus
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="0,0"
            aria-label="Peso en kilos"
          />
          <span className="currency-btn">kg</span>
        </div>
        {error && <p className="field-error">{error}</p>}
        <Field label="Fecha">
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="Nota (opcional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej: en ayunas" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Pesajes (puntos) y promedio de 7 días (línea), con la meta como referencia. */
function WeightChart({
  entries,
  goal,
  range,
  onRange,
  today,
}: {
  entries: WeightEntry[];
  goal: number | null;
  range: Range;
  onRange: (r: Range) => void;
  today: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth<HTMLDivElement>();
  const all = useMemo(() => dailyWeights(entries), [entries]);
  const avgAll = useMemo(() => movingAverage(all, 7), [all]);
  const from = range === 'all' ? (all[0]?.date ?? today) : addDays(today, -Number(range));
  const points = all.filter((p) => p.date >= from);
  const avg = avgAll.filter((p) => p.date >= from);
  if (points.length === 0) {
    return (
      <figure className="card chart">
        <ChartHead range={range} onRange={onRange} />
        <div className="chart-box" ref={boxRef}>
          <p className="muted small">No hay pesajes en este período.</p>
        </div>
      </figure>
    );
  }

  const H = W < 520 ? 200 : 240;
  const pad = { top: 16, right: 12, bottom: 26, left: 36 };
  const start = points[0].date < from ? points[0].date : from;
  const span = Math.max(1, daysBetween(start, today));
  const values = [...points.map((p) => p.kg), ...(goal ? [goal] : [])];
  let lo = Math.floor(Math.min(...values) - 1);
  let hi = Math.ceil(Math.max(...values) + 1);
  if (hi - lo < 4) {
    lo -= 2;
    hi += 2;
  }
  const x = (date: string) => pad.left + ((W - pad.left - pad.right) * daysBetween(start, date)) / span;
  const y = (v: number) => pad.top + ((H - pad.top - pad.bottom) * (hi - v)) / (hi - lo);
  const step = Math.max(1, Math.round((hi - lo) / 4));
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const line = avg.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const h = hover !== null ? points[hover] : null;
  const hAvg = hover !== null ? avg[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    setHover(best);
  };

  const labelDates = [start, addDays(start, Math.round(span / 2)), today];

  return (
    <figure className="card chart">
      <ChartHead range={range} onRange={onRange} />
      <div className="chart-box" ref={boxRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Gráfico de peso: pesajes y promedio de 7 días"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {labelDates.map((d, i) => (
            <text key={d + i} x={x(d)} y={H - 8} className="axis" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
              {d.split('-').reverse().slice(0, 2).join('/')}
            </text>
          ))}
          {goal && (
            <g>
              <line x1={pad.left} x2={W - pad.right} y1={y(goal)} y2={y(goal)} className="goal-line" />
              <text x={W - pad.right} y={y(goal) - 6} className="axis" textAnchor="end">
                Meta {goal}
              </text>
            </g>
          )}
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={hover === i ? 5 : 3.5} className="dot" />
          ))}
          {h && <line x1={x(h.date)} x2={x(h.date)} y1={pad.top} y2={H - pad.bottom} className="crosshair" />}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: `${(x(h.date) / W) * 100}%` }}>
            <strong>{dayLabel(h.date, today)}</strong>
            <span>Pesaje {kg(h.kg)}</span>
            {hAvg && <span className="muted">Promedio 7 días {kg(hAvg.kg)}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}

function ChartHead({ range, onRange }: { range: Range; onRange: (r: Range) => void }) {
  return (
    <figcaption className="chart-head">
      <div>
        <strong>Tendencia</strong>
        <span className="legend">
          <span className="legend-item">
            <i className="legend-dot" /> Pesaje
          </span>
          <span className="legend-item">
            <i className="legend-line" /> Promedio 7 días
          </span>
        </span>
      </div>
      <Segmented
        label="Período"
        value={range}
        onChange={onRange}
        options={[
          { value: '30', label: '30 d' },
          { value: '90', label: '3 m' },
          { value: '365', label: '1 año' },
          { value: 'all', label: 'Todo' },
        ]}
      />
    </figcaption>
  );
}

/** Cruza los días que entrenaste (hábitos de área "Ejercicio" en Rutinas) con cómo cambió tu peso. */
function ExerciseAndWeight() {
  const data = useData();
  const today = useToday();
  const hasExercise = data.habits.some((h) => h.area === 'ejercicio' && !h.archived);
  const r = useMemo(
    () => exerciseVsWeight(data.habits, data.habitLogs, dailyWeights(data.weights), today, 12),
    [data.habits, data.habitLogs, data.weights, today],
  );
  if (!hasExercise)
    return (
      <Section title="Ejercicio y peso">
        <a className="card tile-link" href="#/rutinas">
          <Icon name="check" />
          <span className="tile-text">
            <strong>¿Entrenar te ayuda a bajar?</strong>
            <span className="muted small">
              Creá en Rutinas un hábito de área Ejercicio (gimnasio, caminar…) y Lifty compara tu peso las semanas que entrenás y
              las que no.
            </span>
          </span>
          <Icon name="right" size={18} />
        </a>
      </Section>
    );
  const t = r.threshold;
  const txt = (g: { weeks: number; avgChange: number | null }) =>
    g.avgChange === null
      ? 'sin datos todavía'
      : `${g.avgChange < 0 ? 'bajaste' : g.avgChange > 0 ? 'subiste' : 'quedaste igual'} ${g.avgChange !== 0 ? kg(Math.abs(g.avgChange)) : ''} por semana en promedio (${g.weeks} semana${g.weeks === 1 ? '' : 's'})`;
  const enough = r.active.weeks > 0 && r.rest.weeks > 0;
  return (
    <Section title="Ejercicio y peso">
      <div className="card pad exercise-weight">
        {enough ? (
          <p>
            Las semanas que entrenaste <strong>{t} o más veces</strong> {txt(r.active)}. Las demás {txt(r.rest)}.
          </p>
        ) : (
          <p className="muted">
            Todavía faltan semanas para comparar (hacen falta semanas con {t}+ entrenamientos y semanas con menos, pesándote en
            ambas). Por ahora: con {t}+ {txt(r.active)}; con menos {txt(r.rest)}.
          </p>
        )}
        <div className="ew-weeks" aria-label="Entrenamientos y cambio de peso por semana">
          {r.weeks.map((w) => (
            <div key={w.week} className="ew-week" title={`Semana del ${w.week.split('-').reverse().join('/')}`}>
              <span className={`ew-count ${w.workouts >= t ? 'ok' : ''}`}>{w.workouts}</span>
              <span
                className={`ew-change ${w.change === null ? 'muted' : w.change < 0 ? 'text-income' : w.change > 0 ? 'text-expense' : ''}`}
              >
                {w.change === null
                  ? '·'
                  : `${w.change > 0 ? '+' : w.change < 0 ? '−' : ''}${Math.abs(w.change).toLocaleString('es-UY')}`}
              </span>
            </div>
          ))}
        </div>
        <button
          className="link small"
          onClick={() =>
            openExplain({
              title: 'Ejercicio y peso',
              intro: `Por semana (lunes a domingo, sin la semana en curso): días que cumpliste algún hábito de ejercicio y cuánto cambió tu peso promedio contra la semana anterior. No es causa y efecto: también influye lo que comés.`,
              rows: r.weeks.map((w) => ({
                label: `Semana del ${w.week.split('-').reverse().slice(0, 2).join('/')} · ${w.workouts} entrenamiento${w.workouts === 1 ? '' : 's'}`,
                value: w.change ?? 0,
                raw: w.change === null ? 'sin pesajes' : signedKg(w.change),
              })),
            })
          }
        >
          Arriba: veces que entrenaste. Abajo: kg contra la semana anterior · ¿de dónde sale?
        </button>
      </div>
    </Section>
  );
}
