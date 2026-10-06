import { addMonths, cashFlow, monthLabel, monthOf, monthReview, moodFactors, type MoodFactor } from '@lifty/core';
import { LineChart } from '../components/charts';
import { openExplain } from '../components/Editors';
import { openSetup } from '../components/Setup';
import { MonthPicker, PageHeader, Section } from '../components/ui';
import { money } from '../lib/format';
import { navigate } from '../lib/router';
import { ReportTabs } from './Reports';
import { useData, useLookups, useMonth, useMonths, useToday } from '../lib/store';

/** Mes que conviene mostrar: hasta el día 10, el anterior (recién terminado); después, el actual. */
export const reviewMonth = (today: string) => (Number(today.slice(8)) <= 10 ? addMonths(monthOf(today), -1) : monthOf(today));

/** El mes en un vistazo: plata y vida juntas. */
export function Review({ month: monthParam }: { month?: string }) {
  const data = useData();
  const today = useToday();
  const month = monthParam ?? reviewMonth(today);
  const [prev, b] = useMonths(addMonths(month, -1), month);
  const r = monthReview(data, b, prev, today);
  const { category } = useLookups();
  const name = monthLabel(month, false).toLowerCase();
  const m = r.money;
  const l = r.life;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="page narrow">
      <PageHeader
        title={`Tu ${name}`}
        subtitle={month === monthOf(today) ? `Hasta hoy (${r.days} días)` : 'Plata y vida, en un vistazo'}
      />
      <ReportTabs active="resumen" />
      <MonthPicker month={month} onChange={(x) => navigate(`/resumen/${x}`, { replace: true })} />

      {r.highlights.length > 0 ? (
        <ul className="insights">
          {r.highlights.map((h) => (
            <li key={h.text}>
              <div className={`insight insight-${h.tone}`}>
                <span aria-hidden="true">{h.icon}</span>
                <span className="grow">{h.text}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Todavía no hay mucho para resumir en {name}.</p>
      )}

      <div className="review-grid">
        <section className="card pad">
          <h2 className="small-title">💰 Plata</h2>
          <dl className="receipt">
            <Row label="Entró" value={money(Math.round(m.income))} />
            <Row label="Gastos fijos" value={money(Math.round(m.fixed))} />
            <Row
              label="Día a día y tarjeta"
              value={money(Math.round(m.spent))}
              note={m.changePct !== null ? `${m.changePct > 0 ? '+' : ''}${m.changePct}% vs. el mes anterior` : undefined}
            />
            <Row
              label="Ahorraste"
              value={money(Math.round(m.saved))}
              note={m.savingsRate !== null ? `${pct(m.savingsRate)} de lo que entró` : undefined}
            />
            <Row label="Días sin gastar" value={String(m.noSpendDays)} />
          </dl>
          {m.top.length > 0 && (
            <>
              <h3 className="small-title">En qué se fue</h3>
              <ul className="review-list">
                {m.top.map((t) => {
                  const c = category.get(t.categoryId ?? '');
                  return (
                    <li key={t.categoryId ?? 'none'}>
                      <span>
                        {c?.icon ?? '📦'} {c?.name ?? 'Sin categoría'}
                      </span>
                      <strong>{money(Math.round(t.amount))}</strong>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {m.biggest && (
            <p className="muted small">
              El gasto más grande: {m.biggest.description || category.get(m.biggest.categoryId ?? '')?.name || 'un gasto'} (
              {money(Math.abs(m.biggest.amount), m.biggest.currency)}).
            </p>
          )}
        </section>

        <section className="card pad">
          <h2 className="small-title">🌱 Vos</h2>
          <dl className="receipt">
            {l.habitsDue > 0 && (
              <Row
                label="Rutinas cumplidas"
                value={pct(l.habitsDone / l.habitsDue)}
                note={l.bestStreak ? `mejor racha: ${l.bestStreak.name}, ${l.bestStreak.days} días` : undefined}
              />
            )}
            {l.workouts > 0 && <Row label="Días que entrenaste" value={String(l.workouts)} />}
            {l.studyMinutes > 0 && <Row label="Estudio" value={`${Math.round(l.studyMinutes / 6) / 10} h`} />}
            {l.avgSleep !== null && <Row label="Sueño promedio" value={`${l.avgSleep.toLocaleString('es-UY')} h`} />}
            {l.avgMood !== null && (
              <Row
                label="Ánimo promedio"
                value={`${l.avgMood.toLocaleString('es-UY')} de 5`}
                note={`${l.journalDays} días anotados`}
              />
            )}
            {l.weightChange !== null && (
              <Row label="Peso" value={`${l.weightChange > 0 ? '+' : ''}${l.weightChange.toLocaleString('es-UY')} kg`} />
            )}
          </dl>
          {l.habitsDue === 0 && l.journalDays === 0 && l.studyMinutes === 0 && (
            <p className="muted small">
              Anotá tus rutinas, cómo dormiste y cómo estás (en Inicio, "Para hoy") y acá vas a ver cómo se cruzan con tu plata.
            </p>
          )}
        </section>
      </div>

      {r.moods.length > 0 && (
        <Section title="Qué te cambia el ánimo">
          <MoodList factors={r.moods} />
        </Section>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="receipt-row">
      <dt>
        {label}
        {note && <small> · {note}</small>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/** "Los días que cumplís «Gimnasio» tu ánimo es 1,2 puntos mejor" (con la cuenta). */
export function MoodList({ factors }: { factors: MoodFactor[] }) {
  return (
    <ul className="insights">
      {factors.map((f) => (
        <li key={f.key}>
          <button
            className={`insight insight-${f.diff > 0 ? 'good' : 'warn'}`}
            onClick={() =>
              openExplain({
                title: f.label,
                intro: 'Tu ánimo promedio (1 a 5, del diario) esos días contra los demás. Es una pista, no causa y efecto.',
                rows: [
                  { label: `Sí (${f.withDays} días)`, value: f.with, raw: `${f.with.toLocaleString('es-UY')} de 5` },
                  { label: `No (${f.withoutDays} días)`, value: f.without, raw: `${f.without.toLocaleString('es-UY')} de 5` },
                ],
              })
            }
          >
            <span aria-hidden="true">{f.diff > 0 ? '🙂' : '😕'}</span>
            <span className="grow">
              {f.label} tu ánimo es {Math.abs(f.diff).toLocaleString('es-UY')} punto{Math.abs(f.diff) === 1 ? '' : 's'}{' '}
              {f.diff > 0 ? 'mejor' : 'peor'}.
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** ¿Llegás a fin de mes? Lo que tendrías en bancos y efectivo cada día, con el punto más bajo. */
export function CashFlowCard() {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const f = cashFlow(data, b, today);
  if (!f || f.days.length < 2) return null;
  // Con cuentas en negativo la proyección no sirve: primero hacen falta los saldos reales.
  if (f.start < 0)
    return (
      <Section title="¿Llegás a fin de mes?">
        <div className="card pad">
          <p className="muted">
            Para proyectar día por día hace falta saber cuánto tenés hoy de verdad.{' '}
            <button className="link" onClick={() => openSetup()}>
              Poné a punto tus saldos
            </button>{' '}
            y acá vas a ver tu punto más bajo del mes.
          </p>
        </div>
      </Section>
    );
  const low = f.lowest;
  const lowDay = Number(low.date.slice(8));
  return (
    <Section title="¿Llegás a fin de mes?">
      <div className="card pad chart">
        <p className={low.balance < 0 ? 'text-bad' : ''}>
          {low.balance < 0 ? (
            <>
              ⚠️ El día {lowDay} tus cuentas quedarían en <strong>{money(Math.round(low.balance))}</strong>
              {low.date < f.days[f.days.length - 1].date ? ' (antes de lo que cobrás)' : ''}. Ojo con los gastos de acá a esa
              fecha.
            </>
          ) : (
            <>
              ✅ Sí: tu punto más bajo es el día {lowDay}, con <strong>{money(Math.round(low.balance))}</strong>. A fin de mes
              tendrías {money(Math.round(f.end))}.
            </>
          )}
        </p>
        <LineChart
          points={f.days.map((x) => ({ label: String(Number(x.date.slice(8))), value: x.balance }))}
          label="Lo que tendrías en bancos y efectivo cada día"
          format={(v) => money(Math.round(v))}
          tooltip={(i) => {
            const x = f.days[i];
            return (
              <>
                <strong>Día {Number(x.date.slice(8))}</strong>: {money(Math.round(x.balance))}
                {x.events.map((e) => (
                  <div key={e.label}>
                    {e.label}: {e.amount > 0 ? '+' : '−'}
                    {money(Math.abs(Math.round(e.amount)))}
                  </div>
                ))}
              </>
            );
          }}
        />
        <button
          className="link small"
          onClick={() =>
            openExplain({
              title: '¿Cómo se calcula?',
              intro:
                'Empieza con lo que hay hoy en tus bancos y efectivo (sin la plata guardada). Cada día suma lo que cobrás ese día, resta los gastos fijos el día que vencen, los débitos de la tarjeta y tu gasto típico de ese día de la semana.',
              rows: [
                { label: 'Hoy en bancos y efectivo', value: f.start },
                ...f.days
                  .flatMap((x) =>
                    x.events.map((e) => ({
                      label: `Día ${Number(x.date.slice(8))}: ${e.label}`,
                      value: Math.abs(e.amount),
                      op: (e.amount > 0 ? '+' : '−') as '+' | '−',
                    })),
                  )
                  .slice(0, 12),
                {
                  label: `Día a día (~${money(Math.round(f.typicalPerDay))} por día)`,
                  value: f.days.reduce((s, x) => s + x.spending, 0),
                  op: '−',
                },
              ],
              result: { label: 'A fin de mes', value: f.end },
              footnote:
                'Si un sueldo no tiene día de cobro, se cuenta a fin de mes; un fijo sin día, hoy (para no contar con plata antes de tenerla).',
            })
          }
        >
          ¿De dónde sale?
        </button>
      </div>
    </Section>
  );
}

/** Qué te cambia el ánimo en los últimos 60 días (para el Diario). */
export function MoodFactorsSection() {
  const data = useData();
  const today = useToday();
  const f = moodFactors(data, today);
  if (!f.length) return null;
  return (
    <Section title="Qué te cambia el ánimo">
      <MoodList factors={f} />
    </Section>
  );
}
