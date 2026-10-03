import { useState } from 'react';
import {
  addDays,
  monthOf,
  newId,
  nextReminderDate,
  recurringSummary,
  reminderSchema,
  reminderStatus,
  weekStart,
  weekSummary,
  type Reminder,
} from '@lifty/core';
import { openExplain, openFixedForm, openMenu } from '../components/Editors';
import { Icon } from '../components/Icon';
import { Empty, Field, PageHeader, Section, Sheet, toast } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { useData, useLookups, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const fmtDate = (d: string) => d.split('-').reverse().join('/');
const fmtH = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`);

// ---------------- Resumen semanal ----------------

export function Week() {
  const data = useData();
  const today = useToday();
  const { category } = useLookups();
  const [from, setFrom] = useState(weekStart(today));
  const w = weekSummary(data, from, today);
  const current = from === weekStart(today);
  const diff = w.spent - w.prevSpent;
  const pct = w.prevSpent > 0 ? Math.round((diff / w.prevSpent) * 100) : null;
  const items: { icon: string; title: string; text: string; tone?: 'good' | 'bad' }[] = [];
  items.push({
    icon: '💸',
    title: `Gastaste ${money(Math.round(w.spent))}`,
    text:
      pct === null
        ? 'La semana anterior no hubo gastos para comparar.'
        : `${pct === 0 ? 'Igual que' : `${Math.abs(pct)}% ${pct > 0 ? 'más' : 'menos'} que`} la semana anterior (${money(Math.round(w.prevSpent))}${current ? ', mismos días' : ''}).`,
    tone: pct !== null ? (pct > 10 ? 'bad' : pct < -10 ? 'good' : undefined) : undefined,
  });
  if (w.topCategories.length)
    items.push({
      icon: '🏷️',
      title: 'En qué',
      text: w.topCategories
        .map((c) => `${category.get(c.categoryId ?? '')?.name ?? 'Sin categoría'} ${money(Math.round(c.amount))}`)
        .join(' · '),
    });
  items.push({
    icon: '✅',
    title: `${w.noSpendDays} día${w.noSpendDays === 1 ? '' : 's'} sin gastar`,
    text: `de ${w.days} día${w.days === 1 ? '' : 's'}${current ? ' que van' : ''}.`,
    tone: w.noSpendDays >= 2 ? 'good' : undefined,
  });
  if (w.saved > 0)
    items.push({
      icon: '🐷',
      title: `Ahorraste ${money(Math.round(w.saved))}`,
      text: 'Pasado al ahorro esta semana.',
      tone: 'good',
    });
  if (w.habits && w.habits.due > 0)
    items.push({
      icon: '🗓️',
      title: `Rutinas: ${Math.round((w.habits.done / w.habits.due) * 100)}% cumplido`,
      text: `${w.habits.done} de ${w.habits.due}${w.habits.bestStreak ? ` · mejor racha: ${w.habits.bestStreak.name}, ${w.habits.bestStreak.days} días 🔥` : ''}`,
      tone: w.habits.done / w.habits.due >= 0.8 ? 'good' : undefined,
    });
  if (w.studyMinutes > 0)
    items.push({ icon: '📚', title: `Estudiaste ${fmtH(w.studyMinutes)}`, text: 'Entre todas las materias.' });
  if (w.workouts > 0)
    items.push({
      icon: '🏃',
      title: `Entrenaste ${w.workouts} día${w.workouts === 1 ? '' : 's'}`,
      text: 'Hábitos de ejercicio cumplidos.',
      tone: w.workouts >= 3 ? 'good' : undefined,
    });
  if (w.weight)
    items.push({
      icon: '⚖️',
      title: `Peso promedio ${w.weight.avg.toLocaleString('es-UY', { maximumFractionDigits: 1 })} kg`,
      text:
        w.weight.change === null
          ? 'Sin pesajes la semana anterior para comparar.'
          : `${w.weight.change < 0 ? 'Bajaste' : w.weight.change > 0 ? 'Subiste' : 'Igual que'} ${w.weight.change !== 0 ? `${Math.abs(w.weight.change).toLocaleString('es-UY')} kg ` : ''}contra la semana anterior.`,
    });

  return (
    <div className="page narrow">
      <PageHeader
        title="Tu semana"
        subtitle={`Del ${dayLabel(w.from, today, true).toLowerCase()} al ${dayLabel(w.to, today, true).toLowerCase()}`}
      />
      <div className="month-picker">
        <button className="icon-btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Semana anterior">
          <Icon name="left" />
        </button>
        <span className="month-picker-label">
          <span>{current ? 'Esta semana' : `Semana del ${fmtDate(from).slice(0, 5)}`}</span>
        </span>
        <button className="icon-btn" onClick={() => setFrom(addDays(from, 7))} disabled={current} aria-label="Semana siguiente">
          <Icon name="right" />
        </button>
      </div>
      <ul className="insights">
        {items.map((i) => (
          <li key={i.title}>
            <div className={`insight ${i.tone ? `insight-${i.tone}` : 'insight-info'}`}>
              <span aria-hidden="true">{i.icon}</span>
              <span className="grow">
                <strong>{i.title}</strong>
                <br />
                <span className="muted small">{i.text}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------- Suscripciones y gastos fijos ----------------

export function Recurring() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const r = recurringSummary(data, month);
  const { category } = useLookups();
  return (
    <div className="page">
      <PageHeader title="Lo que pagás siempre" subtitle="Suscripciones y gastos fijos: por mes, por año y cuánto aumentaron" />
      <div className="stat-row">
        <button
          className="card stat"
          onClick={() =>
            openExplain({
              title: 'Por mes',
              intro: 'Los gastos fijos vigentes. Los que no son mensuales se reparten: una patente anual cuenta 1/12 por mes.',
              rows: r.items.map((i) => ({ label: i.fixed.name, value: i.monthly, op: '+' as const })),
              result: { label: 'Por mes', value: r.monthly },
              footnote: `Por año: ${money(r.yearly)}.`,
            })
          }
        >
          <span>Por mes</span>
          <strong>{money(Math.round(r.monthly))}</strong>
        </button>
        <div className="card stat">
          <span>Por año</span>
          <strong>{money(Math.round(r.yearly))}</strong>
        </div>
        <div className="card stat">
          <span>Suscripciones ({r.subscriptions.count})</span>
          <strong>{money(Math.round(r.subscriptions.monthly))}/mes</strong>
        </div>
      </div>
      {r.items.length === 0 ? (
        <Empty icon="repeat" title="No tenés gastos fijos cargados">
          Cargá Netflix, Spotify, el celular, el gimnasio… en Presupuesto → Gasto fijo (las suscripciones con la categoría
          Suscripciones).
        </Empty>
      ) : (
        <Section title="De mayor a menor">
          <div className="card list">
            {r.items.map((i) => {
              const cat = category.get(i.fixed.categoryId ?? '');
              const last = i.changes[i.changes.length - 1];
              return (
                <button
                  key={i.fixed.id}
                  className="tx-row"
                  onClick={() =>
                    openMenu(i.fixed.name, [
                      { label: 'Editar', run: () => openFixedForm(i.fixed.id, month) },
                      ...(i.changes.length
                        ? [
                            {
                              label: 'Ver aumentos',
                              run: () =>
                                openExplain({
                                  title: `${i.fixed.name}: aumentos`,
                                  rows: i.changes.map((c) => ({
                                    label: `Desde ${c.month.split('-').reverse().join('/')}: ${money(c.from)} → ${money(c.to)}`,
                                    value: c.pct,
                                    raw: `${c.pct > 0 ? '+' : ''}${c.pct}%`,
                                  })),
                                  footnote:
                                    i.totalIncrease !== null
                                      ? `En total subió ${i.totalIncrease}% desde el primer monto.`
                                      : undefined,
                                }),
                            },
                          ]
                        : []),
                    ])
                  }
                >
                  <span className="tx-icon" style={{ '--tint': cat?.color } as React.CSSProperties}>
                    {cat?.icon ?? '🔁'}
                  </span>
                  <span className="tx-main">
                    <span className="tx-title">{i.fixed.name}</span>
                    <span className="tx-meta">
                      {[
                        i.fixed.everyMonths > 1
                          ? `${money(i.fixed.amount, i.fixed.currency)} cada ${i.fixed.everyMonths} meses`
                          : null,
                        `${money(Math.round(i.yearly))} por año`,
                        last ? `subió ${last.pct}% en ${last.month.split('-').reverse().join('/')}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="tx-amount">{money(Math.round(i.monthly))}/mes</span>
                </button>
              );
            })}
          </div>
          <p className="muted small">
            Para registrar un aumento usá "Cambiar el monto desde este mes" en el gasto fijo: así Lifty guarda la historia.
          </p>
        </Section>
      )}
    </div>
  );
}

// ---------------- Vencimientos de la casa ----------------

const REMINDER_PRESETS: Partial<Reminder>[] = [
  { name: 'Cédula de identidad', icon: '🪪', repeatMonths: 120, notifyDays: 60 },
  { name: 'Libreta de conducir', icon: '🚗', repeatMonths: 120, notifyDays: 60 },
  { name: 'Pasaporte', icon: '🛂', repeatMonths: 120, notifyDays: 90 },
  { name: 'Seguro del auto', icon: '🛡️', repeatMonths: 12, notifyDays: 30 },
  { name: 'Service del auto', icon: '🔧', repeatMonths: 12, notifyDays: 15 },
  { name: 'Carné de salud', icon: '🩺', repeatMonths: 24, notifyDays: 30 },
  { name: 'Garantía', icon: '📄', repeatMonths: null, notifyDays: 30 },
  { name: 'Matafuegos', icon: '🧯', repeatMonths: 12, notifyDays: 15 },
];

export function Reminders() {
  const data = useData();
  const today = useToday();
  const [editing, setEditing] = useState<Partial<Reminder> | null>(null);
  const list = data.reminders.filter((r) => !r.archived).map((r) => reminderStatus(r, today));
  const renew = (r: Reminder) => {
    const next = nextReminderDate(r);
    if (!next) {
      mutate('reminder', 'upsert', { ...r, archived: true });
      toast(`${r.name}: listo`, { action: { label: 'Deshacer', run: () => mutate('reminder', 'upsert', r) } });
      return;
    }
    mutate('reminder', 'upsert', { ...r, date: next });
    toast(`${r.name}: próximo vencimiento ${fmtDate(next)}`, {
      action: { label: 'Deshacer', run: () => mutate('reminder', 'upsert', r) },
    });
  };
  return (
    <div className="page">
      <PageHeader
        title="Vencimientos"
        subtitle="Documentos, seguros, services y garantías"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" /> Agregar
          </button>
        }
      />
      {list.length === 0 && (
        <Empty icon="calendar" title="Nada anotado todavía">
          Anotá cuándo vence la cédula, el seguro o la garantía de la heladera, y Lifty te avisa en Inicio antes de que venza.
        </Empty>
      )}
      {list.length > 0 && (
        <div className="card list">
          {list.map(({ reminder: r, daysLeft, status }) => (
            <div key={r.id} className="tx-row static">
              <span className="tx-icon">{r.icon}</span>
              <button className="tx-main" onClick={() => setEditing(r)}>
                <span className="tx-title">{r.name}</span>
                <span className={`tx-meta ${status === 'overdue' ? 'due-bad' : status === 'soon' ? 'due-warn' : ''}`}>
                  {daysLeft < 0 ? `Venció hace ${-daysLeft} días` : daysLeft === 0 ? 'Vence hoy' : `Vence en ${daysLeft} días`} (
                  {fmtDate(r.date)})
                  {r.repeatMonths
                    ? ` · se renueva cada ${r.repeatMonths >= 12 && r.repeatMonths % 12 === 0 ? `${r.repeatMonths / 12} año${r.repeatMonths > 12 ? 's' : ''}` : `${r.repeatMonths} meses`}`
                    : ''}
                </span>
              </button>
              {status !== 'ok' && (
                <button className="btn btn-ghost small" onClick={() => renew(r)}>
                  {r.repeatMonths ? 'Renové' : 'Listo'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Section title="Ideas">
        <div className="chips">
          {REMINDER_PRESETS.filter((p) => !data.reminders.some((r) => r.name === p.name && !r.archived)).map((p) => (
            <button key={p.name} className="chip" onClick={() => setEditing(p)}>
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      </Section>
      {editing && <ReminderForm reminder={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReminderForm({ reminder, onClose }: { reminder: Partial<Reminder>; onClose: () => void }) {
  const today = useToday();
  const existing = reminder.id ? (reminder as Reminder) : null;
  const [name, setName] = useState(reminder.name ?? '');
  const [icon, setIcon] = useState(reminder.icon ?? '📌');
  const [date, setDate] = useState(reminder.date ?? '');
  const [repeat, setRepeat] = useState(reminder.repeatMonths ? String(reminder.repeatMonths) : '');
  const [notify, setNotify] = useState(String(reminder.notifyDays ?? 30));
  const [note, setNote] = useState(reminder.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r = reminderSchema.safeParse({
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      updatedAt: '',
      name,
      icon: icon || '📌',
      date,
      repeatMonths: repeat.trim() ? Number(repeat) || null : null,
      notifyDays: Number(notify) || 0,
      note,
    });
    if (!r.success) return setError('Poné el nombre y la fecha.');
    mutate('reminder', 'upsert', r.data);
    toast('Guardado');
    onClose();
  };
  return (
    <Sheet
      title={existing ? 'Editar vencimiento' : 'Nuevo vencimiento'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                mutate('reminder', 'delete', existing.id);
                toast('Borrado', { action: { label: 'Deshacer', run: () => mutate('reminder', 'upsert', existing) } });
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
        {error && <p className="field-error">{error}</p>}
        <div className="row">
          <Field label="Ícono">
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} />
          </Field>
          <Field label="¿Qué vence?">
            <input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Seguro del auto"
              maxLength={60}
            />
          </Field>
        </div>
        <Field label="¿Cuándo vence?">
          <input
            type="date"
            value={date}
            min={existing ? undefined : today}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha de vencimiento"
          />
        </Field>
        <div className="row">
          <Field label="Se renueva cada (meses)" hint="Vacío = una sola vez. 12 = cada año.">
            <input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Avisarme (días antes)">
            <input inputMode="numeric" value={notify} onChange={(e) => setNotify(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <Field label="Nota">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: póliza 12345, BSE" maxLength={200} />
        </Field>
      </div>
    </Sheet>
  );
}
