import { useState } from 'react';
import { HABIT_AREAS, HABIT_TIMES, habitSchema, habitsToday, newId, type Habit, type HabitStatus } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Sheet, toast } from '../components/ui';
import { dayLabel } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { setHabitValue as setValue, tapHabit } from '../lib/life';
import { mutate } from '../lib/sync';

const AREA_LABEL: Record<Habit['area'], string> = {
  rutina: '🗓️ Rutina',
  estudio: '📚 Estudio',
  ejercicio: '🏋️ Ejercicio',
  salud: '💪 Salud',
  casa: '🏠 Casa',
  otro: '✨ Otro',
};
const TIME_LABEL: Record<Habit['time'], string> = {
  mañana: '🌅 Mañana',
  tarde: '☀️ Tarde',
  noche: '🌙 Noche',
  cualquiera: '🕐 En el día',
};
const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/** Ideas para arrancar: un toque y queda creado (se puede editar). */
const PRESETS: Partial<Habit>[] = [
  { name: 'Tender la cama', icon: '🛏️', area: 'rutina', time: 'mañana' },
  { name: 'Tomar agua', icon: '💧', area: 'salud', time: 'cualquiera', target: 8, unit: 'vasos' },
  { name: 'Estudiar', icon: '📚', area: 'estudio', time: 'tarde', target: 60, unit: 'min', days: [1, 2, 3, 4, 5] },
  { name: 'Leer', icon: '📖', area: 'estudio', time: 'noche', target: 20, unit: 'páginas' },
  { name: 'Ejercicio', icon: '🏃', area: 'ejercicio', time: 'cualquiera', target: 30, unit: 'min', days: [1, 3, 5] },
  { name: 'Pesarme', icon: '⚖️', area: 'salud', time: 'mañana', days: [1] },
  { name: 'Caminar', icon: '🚶', area: 'ejercicio', time: 'cualquiera', target: 6000, unit: 'pasos' },
  { name: 'Meditar', icon: '🧘', area: 'salud', time: 'noche', target: 10, unit: 'min' },
  { name: 'Tomar la medicación', icon: '💊', area: 'salud', time: 'mañana' },
  { name: 'Anotar los gastos del día', icon: '💸', area: 'rutina', time: 'noche' },
  { name: 'Ordenar 10 minutos', icon: '🧹', area: 'casa', time: 'tarde' },
  { name: 'Practicar inglés', icon: '🇬🇧', area: 'estudio', time: 'cualquiera', target: 15, unit: 'min' },
];

export function Routines() {
  const data = useData();
  const today = useToday();
  const day = habitsToday(data.habits, data.habitLogs, today);
  const [editing, setEditing] = useState<Habit | Partial<Habit> | null>(null);
  const studyWeek = day.statuses
    .filter((s) => s.habit.area === 'estudio' && s.habit.unit === 'min')
    .reduce((a, s) => a + s.total7, 0);
  const notToday = day.statuses.filter((s) => !s.dueToday);

  return (
    <div className="page">
      <PageHeader
        title="Rutinas"
        subtitle={`${dayLabel(today, today)} · ${day.due.length ? `${day.doneCount} de ${day.due.length} hechas` : 'nada para hoy'}`}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" /> Hábito
          </button>
        }
      />

      {data.habits.length === 0 ? (
        <>
          <Empty icon="check" title="Armá tu rutina">
            Agregá hábitos (estudiar, tomar agua, ejercicio…). Cada día los tildás y Lifty te muestra la racha y cómo viene la
            semana.
          </Empty>
          <Section title="Ideas para empezar">
            <div className="chips">
              {PRESETS.map((p) => (
                <button key={p.name} className="chip" onClick={() => setEditing(p)}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </Section>
        </>
      ) : (
        <>
          {day.due.length > 0 && (
            <div className="card pad routine-progress">
              <div className="limit-head">
                <strong>Hoy</strong>
                <span>
                  {day.doneCount} de {day.due.length}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill bar-good" style={{ width: `${(day.doneCount / day.due.length) * 100}%` }} />
              </div>
              {studyWeek > 0 && (
                <p className="muted small">
                  📚 Estudiaste {Math.floor(studyWeek / 60)} h {Math.round(studyWeek % 60)} min en los últimos 7 días.
                </p>
              )}
            </div>
          )}
          {HABIT_TIMES.map((time) => {
            const list = day.due.filter((s) => s.habit.time === time);
            if (!list.length) return null;
            return (
              <Section key={time} title={TIME_LABEL[time]}>
                <div className="card list">
                  {list.map((s) => (
                    <HabitRow key={s.habit.id} s={s} onEdit={() => setEditing(s.habit)} />
                  ))}
                </div>
              </Section>
            );
          })}
          {notToday.length > 0 && (
            <Section title="Hoy no toca">
              <div className="card list">
                {notToday.map((s) => (
                  <HabitRow key={s.habit.id} s={s} onEdit={() => setEditing(s.habit)} />
                ))}
              </div>
            </Section>
          )}
          <Section title="Más ideas">
            <div className="chips">
              {PRESETS.filter((p) => !data.habits.some((h) => h.name === p.name)).map((p) => (
                <button key={p.name} className="chip" onClick={() => setEditing(p)}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
      {editing && <HabitForm habit={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HabitRow({ s, onEdit }: { s: HabitStatus; onEdit: () => void }) {
  const today = useToday();
  const h = s.habit;
  const simple = h.target === 1 && !h.unit;
  const step = h.unit === 'min' ? Math.min(15, h.target) : h.target >= 1000 ? 1000 : 1;
  const tap = () => tapHabit(s, today);
  const explain = () =>
    openExplain({
      title: `${h.icon} ${h.name}`,
      intro: `Meta: ${simple ? 'hacerlo' : `${h.target} ${h.unit}`} ${h.days.length === 7 ? 'todos los días' : `los ${h.days.map((d) => ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][d]).join(', ')}`}. Los días que no toca no cortan la racha.`,
      rows: [
        { label: 'Racha actual', value: s.streak, raw: `${s.streak} días` },
        { label: 'Mejor racha', value: s.best, raw: `${s.best} días` },
        ...(s.week !== null ? [{ label: 'Últimos 7 días', value: s.week, raw: `${Math.round(s.week * 100)}%` }] : []),
        ...(!simple
          ? [
              { label: 'Total 7 días', value: s.total7, raw: `${s.total7.toLocaleString('es-UY')} ${h.unit}` },
              { label: 'Total 30 días', value: s.total30, raw: `${s.total30.toLocaleString('es-UY')} ${h.unit}` },
            ]
          : []),
      ],
    });
  return (
    <div className={`tx-row static habit-row ${s.done ? 'done' : ''}`}>
      <button
        className="check habit-check"
        aria-pressed={s.done}
        aria-label={`${h.name}: ${s.done ? 'hecho' : 'marcar'}`}
        onClick={tap}
      >
        <Icon name="check" size={16} />
      </button>
      <button className="tx-main" onClick={explain}>
        <span className="tx-title">
          {h.icon} {h.name}
        </span>
        <span className="tx-meta">
          {!simple && `${s.today.toLocaleString('es-UY')} de ${h.target.toLocaleString('es-UY')} ${h.unit}`}
          {!simple && s.streak > 0 && ' · '}
          {s.streak > 0 && `🔥 ${s.streak} día${s.streak === 1 ? '' : 's'}`}
        </span>
        <span className="habit-week" aria-hidden="true">
          {s.last7.map((d) => (
            <i key={d.date} className={d.done === null ? 'off' : d.done ? 'ok' : ''} />
          ))}
        </span>
      </button>
      {!simple && (
        <button
          className="btn btn-ghost small"
          onClick={() => setValue(h.id, today, s.today + step)}
          aria-label={`Sumar ${step} ${h.unit} a ${h.name}`}
        >
          +{step.toLocaleString('es-UY')}
        </button>
      )}
      <button className="icon-btn" onClick={onEdit} aria-label={`Editar ${h.name}`}>
        <Icon name="edit" size={16} />
      </button>
    </div>
  );
}

function HabitForm({ habit, onClose }: { habit: Habit | Partial<Habit>; onClose: () => void }) {
  const data = useData();
  const existing = 'id' in habit && habit.id ? (habit as Habit) : null;
  const [name, setName] = useState(habit.name ?? '');
  const [icon, setIcon] = useState(habit.icon ?? '✅');
  const [area, setArea] = useState<Habit['area']>(habit.area ?? 'rutina');
  const [time, setTime] = useState<Habit['time']>(habit.time ?? 'cualquiera');
  const [days, setDays] = useState<number[]>(habit.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [target, setTarget] = useState(String(habit.target ?? 1));
  const [unit, setUnit] = useState(habit.unit ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r = habitSchema.safeParse({
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      updatedAt: '',
      name,
      icon: icon || '✅',
      area,
      time,
      days: [...days].sort(),
      target: Number(target.replace(',', '.')) || 1,
      unit: unit.trim(),
      sort: existing?.sort ?? data.habits.length,
    });
    if (!r.success) return setError('Poné el nombre y al menos un día.');
    mutate('habit', 'upsert', r.data);
    toast(existing ? 'Hábito guardado' : `${r.data.name} agregado`);
    onClose();
  };
  return (
    <Sheet
      title={existing ? 'Editar hábito' : 'Nuevo hábito'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('habit', 'upsert', { ...existing, archived: true });
                toast(`${existing.name} archivado`, {
                  action: { label: 'Deshacer', run: () => mutate('habit', 'upsert', existing) },
                });
                onClose();
              }}
            >
              Ya no lo hago
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
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="Nombre">
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Estudiar"
              maxLength={60}
            />
          </Field>
        </div>
        <Field label="¿Qué días?">
          <div className="day-picker" role="group" aria-label="Días">
            {DAYS.map((d, i) => (
              <button
                key={i}
                type="button"
                className={`chip ${days.includes(i) ? 'on' : ''}`}
                aria-pressed={days.includes(i)}
                onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Field label="¿Cuándo?">
          <Chips
            label="Momento"
            value={time}
            onChange={setTime}
            options={HABIT_TIMES.map((t) => ({ value: t, label: TIME_LABEL[t] }))}
          />
        </Field>
        <div className="row">
          <Field label="Meta del día" hint="1 = hecho o no">
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="En (opcional)" hint="min, vasos, páginas…">
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="min" maxLength={12} />
          </Field>
        </div>
        <Field label="Área">
          <Chips
            label="Área"
            value={area}
            onChange={setArea}
            options={HABIT_AREAS.map((a) => ({ value: a, label: AREA_LABEL[a] }))}
          />
        </Field>
      </div>
    </Sheet>
  );
}
