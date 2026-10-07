import { addMonths, financialHealth, goalSchema, lifeBalance, monthOf, newId, type HealthPart } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { Empty, PageHeader, Section, toast } from '../components/ui';
import { money } from '../lib/format';
import { navigate } from '../lib/router';
import { cached, useData, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const tone = (s: number) => (s >= 75 ? 'good' : s >= 45 ? 'warn' : 'bad');
const word = (s: number) => (s >= 85 ? 'Muy bien' : s >= 70 ? 'Bien' : s >= 45 ? 'Se puede mejorar' : 'Atención');

/** Los dos puntajes juntos (para Inicio): plata y vida. */
export function useHealth() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const months = useMonths(addMonths(month, -3), month);
  return cached(data, `health:${today}`, () => ({ money: financialHealth(data, months, today), life: lifeBalance(data, today) }));
}

/** Tu salud: financiera (ahorro, colchón, presupuesto, deudas, orden) y de vida (rutinas, sueño, ánimo, movimiento). */
export function Health() {
  const data = useData();
  const today = useToday();
  const { money: h, life } = useHealth();
  const emergencyGoal = data.goals.find((g) => !g.archived && /emergencia|colch/i.test(g.name));
  const createGoal = () => {
    if (!h) return;
    const g = goalSchema.parse({
      id: newId(),
      updatedAt: '',
      name: 'Fondo de emergencia',
      icon: '🛟',
      color: '#0ea5e9',
      currency: 'UYU',
      target: Math.ceil(h.emergency.target / 1000) * 1000,
      targetMonth: addMonths(monthOf(today), 12),
      startMonth: monthOf(today),
    });
    mutate('goal', 'upsert', g);
    toast(`Meta creada: ${money(g.target!)} en un año`, { action: { label: 'Ver', run: () => navigate('/ahorro') } });
  };
  return (
    <div className="page narrow">
      <PageHeader title="Tu salud" subtitle="Plata y vida en dos números (tocá cada parte para ver la cuenta)" back="/mas" />
      {!h && !life ? (
        <Empty icon="chart" title="Todavía no hay suficientes datos">
          Con un mes terminado de movimientos (o tu Excel importado) aparece tu salud financiera; con unos días de rutinas o
          diario, tu balance de vida.
        </Empty>
      ) : (
        <div className="score-grid">
          {h && <ScoreCard title="💰 Salud financiera" score={h.score} parts={h.parts} />}
          {life && <ScoreCard title="🌱 Balance de vida" score={life.score} parts={life.parts} />}
        </div>
      )}
      {h && (
        <Section title="🛟 Fondo de emergencia">
          <div className="card pad">
            <p>
              Gastás unos <strong>{money(Math.round(h.emergency.essentials))}</strong> por mes. Lo que tenés te cubre{' '}
              <strong>
                {h.emergency.months.toLocaleString('es-UY', { maximumFractionDigits: 1 })}{' '}
                {h.emergency.months === 1 ? 'mes' : 'meses'}
              </strong>
              . Lo recomendable es 3 a 6 meses ({money(Math.round(h.emergency.target))} para 3).
            </p>
            <span className="score-bar" role="img" aria-label="Meses cubiertos (de 6)">
              <span
                className={`score-fill score-fill-${tone((h.emergency.months / 6) * 100)}`}
                style={{ width: `${Math.max(2, Math.min(100, (h.emergency.months / 6) * 100))}%` }}
              />
            </span>
            {h.emergency.missing > 0 ? (
              <>
                <p className="muted small">
                  Te faltan {money(Math.round(h.emergency.missing))}: con {money(Math.round(h.emergency.perMonth12))} por mes lo
                  tenés en un año.
                </p>
                {emergencyGoal ? (
                  <a className="btn" href="#/ahorro">
                    Ver tu meta "{emergencyGoal.name}"
                  </a>
                ) : (
                  <button className="btn btn-primary" onClick={createGoal}>
                    Crear la meta "Fondo de emergencia"
                  </button>
                )}
              </>
            ) : (
              <p className="muted small">✅ Ya tenés al menos 3 meses cubiertos.</p>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function ScoreCard({ title, score, parts }: { title: string; score: number; parts: HealthPart[] }) {
  return (
    <section className="card pad score-card">
      <div className="limit-head">
        <strong>{title}</strong>
        <span className={`tag tag-${tone(score)}`}>{word(score)}</span>
      </div>
      <p className={`score-value score-${tone(score)}`}>
        {score}
        <small>/100</small>
      </p>
      <ul className="score-parts">
        {parts.map((p) => (
          <li key={p.key}>
            <button
              className="link-plain score-part"
              onClick={() =>
                openExplain({
                  title: `${p.label}: ${p.score}/100`,
                  intro: p.detail,
                  rows: [{ label: p.label, value: p.score, raw: p.value }],
                  footnote: p.tip ?? 'Esta parte está bien.',
                })
              }
            >
              <span className="score-part-head">
                <span>{p.label}</span>
                <span className="muted small">{p.value}</span>
              </span>
              <span className="score-bar" role="img" aria-label={`${p.label}: ${p.score} de 100`}>
                <span className={`score-fill score-fill-${tone(p.score)}`} style={{ width: `${Math.max(2, p.score)}%` }} />
              </span>
              {p.tip && <span className="muted small">💡 {p.tip}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
