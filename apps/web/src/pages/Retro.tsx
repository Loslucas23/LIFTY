import { useMemo } from 'react';
import { categoryPath, MONTH_NAMES, monthOf, parseMonth, yearReview } from '@lifty/core';
import { Icon } from '../components/Icon';
import { Empty, PageHeader } from '../components/ui';
import { money } from '../lib/format';
import { navigate } from '../lib/router';
import { useData, useMonths, useToday } from '../lib/store';

const monthName = (m: string) => MONTH_NAMES[parseMonth(m).month - 1].toLowerCase();
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Tu año en Lifty: los números del año contados como una historia. */
export function Retro({ year: yearParam }: { year?: string }) {
  const data = useData();
  const today = useToday();
  const year = Number(yearParam) || parseMonth(monthOf(today)).year;
  const months = useMonths(`${year}-01`, `${year}-12`);
  const r = useMemo(() => yearReview(data, months, year, today), [data, months, year, today]);
  const cat = (id: string | null) => {
    const c = data.categories.find((x) => x.id === id);
    return c ? `${c.icon} ${categoryPath(data.categories, id)}` : 'Sin categoría';
  };

  return (
    <div className="page narrow">
      <PageHeader title={`Tu ${year}`} subtitle="Tu año en Lifty, contado con tus números" back="/informes" />
      <div className="month-picker">
        <button
          className="icon-btn"
          onClick={() => navigate(`/tu-anio/${year - 1}`, { replace: true })}
          aria-label="Año anterior"
        >
          <Icon name="left" />
        </button>
        <span className="month-picker-label">
          <span>{year}</span>
        </span>
        <button
          className="icon-btn"
          onClick={() => navigate(`/tu-anio/${year + 1}`, { replace: true })}
          aria-label="Año siguiente"
        >
          <Icon name="right" />
        </button>
      </div>
      {!r ? (
        <Empty icon="chart" title={`Nada cargado en ${year}`}>
          Cuando tengas movimientos de ese año, acá vas a ver tu resumen.
        </Empty>
      ) : (
        <div className="retro">
          <RetroCard icon="💰" title="Entró y salió">
            Entraron <strong>{money(r.income)}</strong> y gastaste <strong>{money(r.expenses)}</strong>
            {r.until < `${year}-12-31` && <span className="muted"> (hasta hoy)</span>}.
            {r.lastYearExpenses !== null && r.lastYearExpenses > 0 && (
              <>
                {' '}
                Contra el mismo período de {year - 1}:{' '}
                <strong className={r.expenses > r.lastYearExpenses ? 'text-expense' : 'text-income'}>
                  {r.expenses > r.lastYearExpenses ? '+' : '−'}
                  {pct(Math.abs(r.expenses / r.lastYearExpenses - 1))}
                </strong>
                .
              </>
            )}
          </RetroCard>
          {r.saved !== 0 && (
            <RetroCard icon="🐷" title="Ahorraste">
              <strong>{money(r.saved)}</strong>
              {r.savingsRate !== null && <> · el {pct(r.savingsRate)} de lo que entró</>}.
              {r.goalsDone.length > 0 && <> Llegaste a {r.goalsDone.map((g) => `${g.icon} ${g.name}`).join(', ')}. 🎉</>}
            </RetroCard>
          )}
          {r.topCategories.length > 0 && (
            <RetroCard icon="🏷️" title="En qué se fue">
              <ol className="retro-list">
                {r.topCategories.map((c) => (
                  <li key={String(c.categoryId)}>
                    {cat(c.categoryId)}: <strong>{money(c.amount)}</strong> <span className="muted">({pct(c.share)})</span>
                  </li>
                ))}
              </ol>
            </RetroCard>
          )}
          {(r.bestMonth || r.priciestMonth) && (
            <RetroCard icon="📆" title="Tus meses">
              {r.bestMonth && (
                <>
                  El mejor fue <strong>{monthName(r.bestMonth.month)}</strong> (te sobraron {money(r.bestMonth.result)}).{' '}
                </>
              )}
              {r.priciestMonth && (
                <>
                  El más caro, <strong>{monthName(r.priciestMonth.month)}</strong> ({money(r.priciestMonth.expenses)}).
                </>
              )}
            </RetroCard>
          )}
          {r.biggestExpense && (
            <RetroCard icon="🧾" title="El gasto más grande">
              <strong>{r.biggestExpense.description || cat(r.biggestExpense.categoryId)}</strong>:{' '}
              {money(r.biggestExpense.amount)} el {r.biggestExpense.date.split('-').reverse().slice(0, 2).join('/')}.
            </RetroCard>
          )}
          {r.favorite && (
            <RetroCard icon="⭐" title="Tu clásico">
              <strong>{r.favorite.description}</strong>: {r.favorite.times} veces, {money(r.favorite.total)} en total.
            </RetroCard>
          )}
          <RetroCard icon="✅" title="Días sin gastar">
            <strong>{r.noSpendDays}</strong> días
            {r.noSpendStreak > 1 && (
              <>
                , con una racha de <strong>{r.noSpendStreak}</strong> seguidos
              </>
            )}
            . Cargaste {r.movements} movimientos.
          </RetroCard>
          {(r.habits.checkIns > 0 || r.studyHours > 0 || r.challengesWon > 0) && (
            <RetroCard icon="💪" title="Rutinas y estudio">
              {r.habits.best && (
                <>
                  Tu rutina más constante: <strong>{`${r.habits.best.icon} ${r.habits.best.name}`}</strong> ({r.habits.best.days}{' '}
                  días).{' '}
                </>
              )}
              {r.studyHours > 0 && (
                <>
                  Estudiaste <strong>{r.studyHours.toLocaleString('es-UY', { maximumFractionDigits: 1 })} h</strong>.{' '}
                </>
              )}
              {r.challengesWon > 0 && (
                <>
                  Ganaste <strong>{r.challengesWon}</strong> desafío{r.challengesWon === 1 ? '' : 's'}. 🏆
                </>
              )}
            </RetroCard>
          )}
          {(r.mood || r.sleep || r.weight) && (
            <RetroCard icon="🙂" title="Cómo estuviste">
              {r.mood && (
                <>
                  Ánimo promedio <strong>{r.mood.average.toLocaleString('es-UY')}</strong> de 5 ({r.mood.days} días anotados)
                  {r.mood.bestMonth && <>, el mejor mes fue {monthName(r.mood.bestMonth)}</>}.{' '}
                </>
              )}
              {r.sleep && (
                <>
                  Dormiste <strong>{r.sleep.average.toLocaleString('es-UY', { maximumFractionDigits: 1 })} h</strong> en
                  promedio.{' '}
                </>
              )}
              {r.weight && (
                <>
                  Peso: {r.weight.from.toLocaleString('es-UY')} → {r.weight.to.toLocaleString('es-UY')} kg (
                  {r.weight.change > 0 ? '+' : ''}
                  {r.weight.change.toLocaleString('es-UY')}).
                </>
              )}
            </RetroCard>
          )}
          <p className="muted small">
            Todo sale de lo que cargaste: los totales son los del presupuesto de cada mes (Informes → Año), y los días sin gastar
            cuentan desde el primer día con algo cargado.
          </p>
        </div>
      )}
    </div>
  );
}

function RetroCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <article className="card pad retro-card">
      <span className="retro-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <h3>{title}</h3>
        <div className="retro-body">{children}</div>
      </div>
    </article>
  );
}
