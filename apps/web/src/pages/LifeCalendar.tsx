import { useMemo, useState } from 'react';
import { monthCalendar, monthOf, type CalendarDay } from '@lifty/core';
import { TxRow } from '../components/TxRow';
import { MonthPicker, PageHeader, Section } from '../components/ui';
import { dayLabel, money } from '../lib/format';
import { isPrivate } from '../lib/privacy';
import { navigate } from '../lib/router';
import { useData, useMonth, useToday } from '../lib/store';

const MOOD = ['', '😞', '😕', '😐', '🙂', '😄'];

/** Monto cortito para la grilla: 850, 1,2k, 15k. */
function short(v: number): string {
  if (isPrivate()) return '•••';
  if (v < 1000) return String(Math.round(v));
  return `${(v / 1000).toLocaleString('es-UY', { maximumFractionDigits: v < 10000 ? 1 : 0 })}k`;
}

/**
 * Calendario de todo: en un mes, lo que entra y sale (sueldos, fijos, tarjeta), vencimientos,
 * exámenes y vacaciones, y cómo te fue cada día (gasto, ánimo, rutinas). Tocá un día.
 */
export function LifeCalendar({ month: monthParam }: { month?: string }) {
  const data = useData();
  const today = useToday();
  const month = monthParam ?? monthOf(today);
  const b = useMonth(month);
  const days = useMemo(() => monthCalendar(data, b, today), [data, b, today]);
  const [selected, setSelected] = useState<string | null>(month === monthOf(today) ? today : null);
  const day = days.find((d) => d.date === selected) ?? null;
  const max = Math.max(1, ...days.map((d) => d.spent));
  const offset = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const past = days.filter((d) => d.date < today);
  const free = past.filter((d) => d.spent === 0).length;
  const moods = days.filter((d) => d.mood !== null);
  const avgMood = moods.length ? moods.reduce((s, d) => s + d.mood!, 0) / moods.length : null;
  const coming = days
    .filter((d) => d.date >= today)
    .flatMap((d) => d.items.filter((i) => !i.done).map((i) => ({ ...i, date: d.date })));
  const comingOut = coming.filter((i) => (i.amount ?? 0) < 0).reduce((s, i) => s + -(i.amount ?? 0), 0);
  const comingIn = coming.filter((i) => (i.amount ?? 0) > 0).reduce((s, i) => s + (i.amount ?? 0), 0);

  return (
    <div className="page narrow">
      <PageHeader title="Calendario" subtitle="Plata, vencimientos, exámenes, vacaciones y cómo te fue cada día" back="/mas" />
      <MonthPicker month={month} onChange={(m) => navigate(`/calendario/${m}`, { replace: true })} />
      <div className="stat-row">
        <div className="card stat">
          <span>Días sin gastar</span>
          <strong>
            {free}
            <small className="muted"> de {past.length}</small>
          </strong>
        </div>
        <div className="card stat">
          <span>Falta pagar</span>
          <strong className={comingOut ? 'text-expense' : ''}>{money(Math.round(comingOut))}</strong>
        </div>
        <div className="card stat">
          <span>Falta cobrar</span>
          <strong className={comingIn ? 'text-income' : ''}>{money(Math.round(comingIn))}</strong>
        </div>
        {avgMood !== null && (
          <div className="card stat">
            <span>Ánimo promedio</span>
            <strong>
              {MOOD[Math.round(avgMood)]} {avgMood.toLocaleString('es-UY', { maximumFractionDigits: 1 })}
            </strong>
          </div>
        )}
      </div>

      <div className="card calendar life-calendar" role="grid" aria-label="El mes día por día">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <span key={i} className="cal-head" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((d) => (
          <DayCell
            key={d.date}
            d={d}
            today={today}
            max={max}
            on={selected === d.date}
            onClick={() => setSelected(selected === d.date ? null : d.date)}
          />
        ))}
        <p className="cal-legend small muted">
          <span className="nowrap">
            <i className="mark-income" /> cobro
          </span>
          <span className="nowrap">
            <i className="mark-due" /> pago
          </span>
          <span className="nowrap">
            <i className="mark-event" /> vencimiento o examen
          </span>
          <span className="nowrap">
            <i className="mark-period" /> vacaciones o mes difícil
          </span>
          <span>· el color es lo que gastaste</span>
        </p>
      </div>

      {day && <DayDetail d={day} today={today} />}
    </div>
  );
}

function DayCell({
  d,
  today,
  max,
  on,
  onClick,
}: {
  d: CalendarDay;
  today: string;
  max: number;
  on: boolean;
  onClick: () => void;
}) {
  const num = Number(d.date.slice(8));
  const pay = d.items.some((i) => (i.amount ?? 0) < 0);
  const earn = d.items.some((i) => (i.amount ?? 0) > 0);
  const event = d.items.some((i) => i.kind === 'reminder' || i.kind === 'exam');
  const label = [
    dayLabel(d.date, today, true),
    d.spent > 0 ? `gastaste ${money(Math.round(d.spent))}` : d.date < today ? 'sin gastos' : null,
    ...d.items.map((i) => i.text),
    d.mood ? `ánimo ${d.mood} de 5` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      className={`cal-day ${d.date === today ? 'today' : ''} ${on ? 'on' : ''} ${d.date > today ? 'future' : ''} ${d.periods.length ? 'in-period' : ''}`}
      style={{ '--heat': d.spent > 0 ? 0.12 + 0.55 * (d.spent / max) : 0 } as React.CSSProperties}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      <span className="cal-num">
        {num}
        {d.mood ? <span className="cal-mood">{MOOD[d.mood]}</span> : null}
      </span>
      {d.spent > 0 ? (
        <span className="cal-amount">{short(d.spent)}</span>
      ) : d.date < today ? (
        <span className="cal-zero" aria-hidden="true">
          ✓
        </span>
      ) : null}
      <span className="cal-marks" aria-hidden="true">
        {earn && <i className="mark-income" />}
        {pay && <i className="mark-due" />}
        {event && <i className="mark-event" />}
        {d.periods.length > 0 && <i className="mark-period" />}
      </span>
    </button>
  );
}

function DayDetail({ d, today }: { d: CalendarDay; today: string }) {
  const data = useData();
  const txs = data.transactions.filter((t) => t.date === d.date);
  return (
    <Section title={dayLabel(d.date, today, true)}>
      <div className="card pad">
        <ul className="plain-list small">
          {d.periods.map((p) => (
            <li key={p.id}>
              {p.kind === 'vacation' ? '🏖️' : '🧮'} {p.name}
            </li>
          ))}
          {d.items.map((i, k) => (
            <li key={k} className={i.done ? 'muted' : ''}>
              {i.icon} {i.text}
              {i.amount !== undefined && (
                <strong className={i.amount > 0 ? 'text-income' : ''}>
                  {' '}
                  {i.amount > 0 ? '+' : '−'}
                  {money(Math.abs(i.amount))}
                </strong>
              )}
              {i.done && ' ✓'}
            </li>
          ))}
          {d.date <= today && (
            <li>
              💸 {d.spent > 0 ? `Gastaste ${money(Math.round(d.spent))}` : 'Sin gastos'}
              {d.earned > 0 && ` · entró ${money(Math.round(d.earned))}`}
            </li>
          )}
          {d.mood !== null && (
            <li>
              {MOOD[d.mood]} Ánimo {d.mood} de 5{d.sleep !== null && ` · dormiste ${d.sleep} h`}
            </li>
          )}
          {d.habits.due > 0 && (
            <li>
              ✅ Rutinas: {d.habits.done} de {d.habits.due}
            </li>
          )}
        </ul>
      </div>
      {txs.length > 0 && (
        <div className="card list">
          {txs.map((t) => (
            <TxRow key={t.id} tx={t} />
          ))}
        </div>
      )}
    </Section>
  );
}
