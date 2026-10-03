import { useEffect, useState } from 'react';
import { habitLogId, newId, studyByDay, subjectSchema, subjectStatus, type Subject, type SubjectStatus } from '@lifty/core';
import { openExplain, openPrompt } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Empty, Field, PageHeader, Progress, Section, Sheet, toast } from '../components/ui';
import { dayLabel, parseAmount } from '../lib/format';
import { local } from '../lib/local';
import { useData, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const fmtH = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

const STATUS: Record<SubjectStatus['status'], { label: string; tone: string }> = {
  done: { label: '¡Meta cumplida!', tone: 'tag-good' },
  'on-track': { label: 'A este ritmo llegás', tone: 'tag-good' },
  behind: { label: 'A este ritmo no llegás', tone: 'tag-bad' },
  past: { label: 'Ya pasó el examen', tone: '' },
  'no-goal': { label: '', tone: '' },
};

/** Guarda una sesión y la suma al hábito "Estudiar" (área estudio, en minutos) si lo tenés. */
function useSaveSession() {
  const data = useData();
  return (subjectId: string, date: string, minutes: number) => {
    const id = newId();
    mutate('studySession', 'upsert', { id, updatedAt: '', subjectId, date, minutes: Math.round(minutes), note: '' });
    const habit = data.habits.find((h) => !h.archived && h.area === 'estudio' && h.unit === 'min');
    const prevLog = habit ? data.habitLogs.find((l) => l.id === habitLogId(habit.id, date)) : undefined;
    if (habit)
      mutate('habitLog', 'upsert', {
        id: habitLogId(habit.id, date),
        updatedAt: '',
        habitId: habit.id,
        date,
        value: (prevLog?.value ?? 0) + Math.round(minutes),
      });
    toast(`${fmtH(minutes)} de estudio anotados${habit ? ` (y en "${habit.name}")` : ''}`, {
      action: {
        label: 'Deshacer',
        run: () => {
          mutate('studySession', 'delete', id);
          if (habit) {
            if (prevLog) mutate('habitLog', 'upsert', prevLog);
            else mutate('habitLog', 'delete', habitLogId(habit.id, date));
          }
        },
      },
    });
  };
}

export function Study() {
  const data = useData();
  const today = useToday();
  const save = useSaveSession();
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const subjects = data.subjects.filter((s) => !s.archived);
  const statuses = subjects.map((s) => subjectStatus(s, data.studySessions, today));
  const days = studyByDay(data.studySessions, today);
  const max = Math.max(30, ...days.map((d) => d.minutes));
  const week = days.slice(-7).reduce((s, d) => s + d.minutes, 0);
  const todayMin = days[days.length - 1].minutes;

  return (
    <div className="page">
      <PageHeader
        title="Estudio"
        subtitle={`Hoy ${fmtH(todayMin)} · esta semana ${fmtH(week)}`}
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Materia
          </button>
        }
      />
      {subjects.length === 0 ? (
        <Empty icon="calendar" title="Agregá lo que estás estudiando">
          Una materia o curso, con la fecha del examen y cuántas horas querés dedicarle. Lifty te dice cuánto estudiar por día
          para llegar y si a tu ritmo llegás.
        </Empty>
      ) : (
        <>
          <Timer subjects={subjects} onDone={(id, min) => save(id, today, min)} />
          <div className="goal-grid">
            {statuses.map((s) => (
              <SubjectCard
                key={s.subject.id}
                s={s}
                onEdit={() => setEditing(s.subject)}
                onAdd={(min) => save(s.subject.id, today, min)}
              />
            ))}
          </div>
          <Section title="Últimos 14 días">
            <div className="card pad">
              <div className="study-bars" aria-label="Minutos estudiados por día">
                {days.map((d) => (
                  <div key={d.date} className="mini-bar" title={`${dayLabel(d.date, today, true)}: ${fmtH(d.minutes)}`}>
                    <span className="mini-bar-track">
                      <span
                        className={`mini-bar-fill ${d.minutes > 0 ? 'good' : ''}`}
                        style={{ height: `${Math.max(2, (d.minutes / max) * 100)}%` }}
                      />
                    </span>
                    <span className="mini-bar-label">{Number(d.date.slice(8))}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
          <Section title="Sesiones">
            <div className="card list">
              {data.studySessions.slice(0, 15).map((x) => {
                const sub = data.subjects.find((s) => s.id === x.subjectId);
                return (
                  <div key={x.id} className="tx-row static">
                    <span className="tx-icon">{sub?.icon ?? '📘'}</span>
                    <span className="tx-main">
                      <span className="tx-title">{sub?.name ?? 'Materia borrada'}</span>
                      <span className="tx-meta">{dayLabel(x.date, today, true)}</span>
                    </span>
                    <span className="tx-amount">{fmtH(x.minutes)}</span>
                    <button
                      className="icon-btn"
                      aria-label="Borrar sesión"
                      onClick={() => {
                        mutate('studySession', 'delete', x.id);
                        toast('Sesión borrada', {
                          action: { label: 'Deshacer', run: () => mutate('studySession', 'upsert', x) },
                        });
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                );
              })}
              {data.studySessions.length === 0 && <p className="muted small pad">Todavía no anotaste sesiones.</p>}
            </div>
          </Section>
        </>
      )}
      {editing && <SubjectForm subject={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Cronómetro: se acuerda aunque cierres la app (guarda la hora de inicio en este dispositivo). */
function Timer({ subjects, onDone }: { subjects: Subject[]; onDone: (subjectId: string, minutes: number) => void }) {
  const [start, setStart] = useState<{ at: number; subjectId: string } | null>(() => {
    try {
      return JSON.parse(local.get('lifty-study-timer') ?? 'null');
    } catch {
      return null;
    }
  });
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!start) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
    };
  }, [start]);
  const persist = (v: typeof start) => {
    setStart(v);
    local.set('lifty-study-timer', v ? JSON.stringify(v) : null);
  };
  const elapsed = start ? Math.max(0, now - start.at) : 0;
  const mm = Math.floor(elapsed / 60000);
  const ss = Math.floor((elapsed % 60000) / 1000);
  const sub = subjects.find((s) => s.id === (start?.subjectId ?? subjectId));
  return (
    <section className={`card pad timer ${start ? 'running' : ''}`}>
      {start ? (
        <>
          <span className="muted small">Estudiando {sub?.name}</span>
          <strong className="timer-clock">
            {String(Math.floor(mm / 60)).padStart(2, '0')}:{String(mm % 60).padStart(2, '0')}:{String(ss).padStart(2, '0')}
          </strong>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                if (mm >= 1) onDone(start.subjectId, mm);
                else toast('Menos de un minuto: no lo anoté');
                persist(null);
              }}
            >
              Terminar y anotar
            </button>
            <button className="btn btn-ghost" onClick={() => persist(null)}>
              Descartar
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="muted small">Cronómetro</span>
          <div className="timer-start">
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Materia">
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.icon} {s.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => persist({ at: Date.now(), subjectId })} disabled={!subjectId}>
              ▶ Empezar
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SubjectCard({ s, onEdit, onAdd }: { s: SubjectStatus; onEdit: () => void; onAdd: (minutes: number) => void }) {
  const today = useToday();
  const st = STATUS[s.status];
  const goal = s.subject.goalHours;
  const explain = () =>
    openExplain({
      title: `${s.subject.name}: cuentas`,
      intro: 'Lo que falta para la meta, repartido en los días que quedan hasta el examen (contando hoy).',
      rows: [
        ...(goal !== null ? [{ label: 'Meta', value: goal, raw: `${goal} h` }] : []),
        { label: 'Estudiado', value: s.hours, op: '−' as const, raw: `${s.hours} h` },
        ...(s.remainingHours !== null
          ? [{ label: 'Falta', value: s.remainingHours, op: '=' as const, raw: `${s.remainingHours} h` }]
          : []),
        ...(s.daysLeft !== null
          ? [{ label: 'Días que quedan', value: s.daysLeft, op: '÷' as const, raw: String(Math.max(1, s.daysLeft)) }]
          : []),
      ],
      result: s.neededPerDay !== null ? { label: 'Por día', value: s.neededPerDay, raw: fmtH(s.neededPerDay) } : undefined,
      footnote:
        s.forecastHours !== null
          ? `Tu ritmo de los últimos 7 días es ${fmtH(s.pacePerDay)} por día: a ese ritmo llegás al examen con ${s.forecastHours} h${goal !== null ? ` (meta ${goal} h)` : ''}.`
          : undefined,
    });
  return (
    <article className="card goal">
      <div className="goal-head">
        <span className="goal-icon">{s.subject.icon}</span>
        <div>
          <strong>{s.subject.name}</strong>
          {s.subject.examDate && (
            <span className="muted small">
              {' '}
              · examen{' '}
              {s.daysLeft === 0
                ? 'hoy'
                : s.daysLeft! > 0
                  ? `en ${s.daysLeft} días (${dayLabel(s.subject.examDate, today, true).toLowerCase()})`
                  : 'pasado'}
            </span>
          )}
        </div>
        <button className="link small" onClick={onEdit}>
          Editar
        </button>
      </div>
      <p className="goal-value">
        {s.hours.toLocaleString('es-UY')} h{goal !== null && <small className="muted"> de {goal} h</small>}
      </p>
      {goal !== null && <Progress value={s.hours} max={goal} label={`Avance de ${s.subject.name}`} />}
      <button className="goal-plan" onClick={explain}>
        {st.label && <span className={`tag ${st.tone}`}>{st.label}</span>}
        <span className="small">
          {s.neededPerDay !== null && s.status !== 'done' && s.status !== 'past' ? (
            <>
              Estudiá <strong>{fmtH(s.neededPerDay)}</strong> por día
            </>
          ) : (
            `Esta semana: ${s.week} h`
          )}
        </span>
      </button>
      <div className="btn-row">
        <button className="btn" onClick={() => onAdd(30)}>
          +30 min
        </button>
        <button className="btn" onClick={() => onAdd(60)}>
          +1 h
        </button>
        <button
          className="btn btn-ghost"
          onClick={() =>
            openPrompt({
              title: `¿Cuánto estudiaste de ${s.subject.name}?`,
              label: 'Minutos',
              initial: '45',
              onSubmit: (v) => {
                if (v <= 0 || v > 1440) return 'Entre 1 y 1440 minutos';
                onAdd(v);
              },
            })
          }
        >
          Otro
        </button>
      </div>
    </article>
  );
}

function SubjectForm({ subject, onClose }: { subject: Subject | null; onClose: () => void }) {
  const [name, setName] = useState(subject?.name ?? '');
  const [icon, setIcon] = useState(subject?.icon ?? '📘');
  const [exam, setExam] = useState(subject?.examDate ?? '');
  const [goal, setGoal] = useState(subject?.goalHours ? String(subject.goalHours) : '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r = subjectSchema.safeParse({
      ...(subject ?? {}),
      id: subject?.id ?? newId(),
      updatedAt: '',
      name,
      icon: icon || '📘',
      examDate: exam || null,
      goalHours: parseAmount(goal) || null,
    });
    if (!r.success) return setError('Poné el nombre.');
    mutate('subject', 'upsert', r.data);
    toast('Materia guardada');
    onClose();
  };
  return (
    <Sheet
      title={subject ? 'Editar materia' : 'Nueva materia'}
      onClose={onClose}
      footer={
        <>
          {subject && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('subject', 'upsert', { ...subject, archived: true });
                toast(`${subject.name} archivada`, {
                  action: { label: 'Deshacer', run: () => mutate('subject', 'upsert', subject) },
                });
                onClose();
              }}
            >
              Archivar
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
          <Field label="Materia o curso">
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Matemática"
              maxLength={60}
            />
          </Field>
        </div>
        <div className="row">
          <Field label="Fecha del examen (opcional)">
            <input type="date" value={exam} onChange={(e) => setExam(e.target.value)} aria-label="Fecha del examen" />
          </Field>
          <Field label="Horas que querés dedicarle" hint="Opcional">
            <input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ej: 30" />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
