import { useState } from 'react';
import {
  addDays,
  addMonths,
  daysInMonth,
  debtTotals,
  foodCardMonth,
  formatNumber,
  habitsToday,
  weekStart,
  weekSummary,
  yearGoalStatus,
  monthInsights,
  monthLabel,
  monthOf,
  newId,
  round2,
  stockOverview,
  todayAgenda,
  upcomingEvents,
  cashFlowWarning,
  weekdayForecast,
  weightStats,
  type AgendaItem,
  type Insight,
  type MonthBudget,
  type StockOverview,
  type UpcomingEvent,
  goalMonths,
  paceAlerts,
  leftoversToSave,
  fxNews,
  antExpenses,
  workHour,
} from '@lifty/core';
import { confirmPlanned } from '../lib/actions';
import { openBudgetEditor, openBudgetWizard, openExplain, openFixedForm, openIncomeForm, openMenu } from '../components/Editors';
import { Icon, type IconName } from '../components/Icon';
import { openDebtReminder } from '../components/DebtReminder';
import { useMoneyCheck } from '../components/MoneyCheck';
import { openSetup } from '../components/Setup';
import { QuickJournal, saveJournal } from './Journal';
import { useHealth } from './Health';
import { useActiveChallenges } from './Challenges';
import { PeriodLine, useActivePeriods } from './Periods';
import { PaydaySheet, usePlata } from './Plata';
import { payInstallment } from '../lib/plata';
import { reviewMonth } from './Review';
import { renewReminder, tapHabit } from '../lib/life';
import { cookMeal } from '../lib/menu';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Empty, Progress, Section, toast } from '../components/ui';
import { explainDaily } from '../lib/explain';
import { dayLabel, money } from '../lib/format';
import { navigate } from '../lib/router';
import { local } from '../lib/local';
import { addToShoppingList } from '../lib/stock';
import { cached, useData, useLookups, useMonth, useMonths, useSync, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

export function Home() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const b = useMonth(month);
  const { category } = useLookups();
  const limits = b.categories.filter((c) => c.limit !== null).sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0));
  const recent = data.transactions.slice(0, 6);
  const name = data.settings.ownerName;
  const weight = weightStats(data.weights, { heightCm: data.settings.heightCm, goalKg: data.settings.goalWeightKg });
  const empty = data.transactions.length === 0 && data.incomes.length === 0 && data.fixed.length === 0;
  const past = useMonths(addMonths(month, -3), addMonths(month, -1));
  // ¿Las cuentas quedan en rojo antes de fin de mes? Va primero en los avisos.
  const low = empty ? null : cached(data, `cashflow:${today}`, () => cashFlowWarning(data, b, today));
  const insights: Insight[] = [
    ...(low
      ? [
          {
            id: 'cashflow',
            tone: 'bad' as const,
            text: `Ojo: el día ${Number(low.date.slice(8))} tus cuentas quedarían en ${money(Math.round(low.balance))}.`,
            detail: '',
            href: '#/cuentas',
          },
        ]
      : []),
    ...(empty ? [] : cached(data, `insights:${today}`, () => monthInsights(data, b, today))),
    // Categorías en las que vas mucho más rápido que de costumbre.
    ...(empty ? [] : paceAlerts(data, past, b, today)).slice(0, 2).map(
      (a): Insight => ({
        id: `pace-${a.categoryId}`,
        tone: 'warn',
        categoryId: a.categoryId,
        text: `En ${(category.get(a.categoryId)?.name ?? 'una categoría').toLowerCase()} vas ${Math.round(a.faster * 100)}% más rápido que de costumbre: a este ritmo terminás en ${money(Math.round(a.projected))}.`,
        detail: `Llevás ${money(Math.round(a.spent))} en ${a.day} días. Normalmente gastás ${money(Math.round(a.usual))} en todo el mes (la mediana de los últimos 3). A este ritmo: ${money(Math.round(a.spent))} ÷ ${a.day} días × los días del mes = ${money(Math.round(a.projected))}.`,
      }),
    ),
    // Metas con fecha que se ajustaron (un mes se puso menos).
    ...goalMonths(data, today)
      .filter((g) => g.adjusted === 'up' && g.pendingThisMonth > 0)
      .slice(0, 2)
      .map(
        (g): Insight => ({
          id: `goal-${g.goal.id}`,
          tone: 'info',
          text: `Para llegar a "${g.goal.name}" a tiempo, ahora son ${money(Math.ceil(g.perMonth), g.goal.currency)} por mes (era ${money(Math.ceil(g.original), g.goal.currency)}).`,
          detail: '',
          href: '#/ahorro',
        }),
      ),
  ];
  // El dólar: si bajó a tu aviso o está más barato que su promedio, es buen momento para comprar.
  const fx = fxNews(data, today);
  if (fx?.good)
    insights.unshift({
      id: `fx-${fx.date}`,
      tone: 'good',
      text: `💵 El dólar bajó a ${formatNumber(fx.rate, 2, 0)}: si querés comprar, es un buen momento (${fx.reason}).`,
      detail: fx.average
        ? `Cotización de hoy: ${formatNumber(fx.rate, 2, 0)}. Promedio del último mes: ${formatNumber(fx.average, 2, 0)} (${fx.change}%).`
        : `Cotización de hoy: ${formatNumber(fx.rate, 2, 0)}.`,
    });
  // Gastos hormiga (al final: es información, no un aviso urgente).
  const ants = empty ? null : cached(data, `ants:${today}`, () => antExpenses(data, today, workHour(data, b)));
  if (ants && ants.monthly >= 1000)
    insights.push({
      id: 'hormiga',
      tone: 'info',
      text: `Gastos hormiga: ${ants.groups
        .slice(0, 2)
        .map((g) => g.name.toLowerCase())
        .join(' y ')} te salen ${money(Math.round(ants.monthly))} por mes: ${money(Math.round(ants.yearly))} por año${
        ants.hours !== null ? `, ${formatNumber(ants.hours, 0)} horas de tu trabajo` : ''
      }.`,
      detail: '',
      href: '#/dia-a-dia',
    });
  const events = upcomingEvents(data, b, today);
  const debts = debtTotals(data);
  const foodCards = data.accounts.filter((a) => a.type === 'food' && !a.archived);
  const d = b.daily;
  // "A este ritmo": si hay historia, según cómo gastás cada día de la semana.
  const smart = d ? cached(data, `weekday:${today}`, () => weekdayForecast(data, b, today)) : null;
  const forecastEnd = smart ? smart.forecastEnd : (d?.forecastEnd ?? 0);
  const yearGoals = data.yearGoals
    .filter((g) => !g.archived && g.year === Number(today.slice(0, 4)))
    .map((g) => yearGoalStatus(g, data, today));
  const week = cached(data, `week:${today}`, () => weekSummary(data, weekStart(today), today));
  const stock = data.stockItems.length
    ? cached(data, `stock:${today}`, () => stockOverview(data.stockItems, data.stockMoves, today, data.settings))
    : null;
  // Lo de hoy (y lo vencido) va en "Para hoy"; en "Lo que viene", lo de los próximos días.
  const nextEvents = events.filter((e) => !e.overdue && e.date > today);

  return (
    <div className="page">
      <header className="greeting">
        <p className="muted">
          {weekday(today)} {Number(today.slice(8))} de {monthLabel(month, false).toLowerCase()}
        </p>
        <h1>{name ? `Hola, ${name}` : 'Hola'} 👋</h1>
      </header>

      {d && (
        <section
          className={`hero explainable-hero ${d.todayLeft < 0 ? 'hero-neg' : ''}`}
          onClick={() => explainDaily(b)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && explainDaily(b)}
          role="button"
          tabIndex={0}
          aria-label="Ver de dónde sale lo que podés gastar hoy"
        >
          <p className="hero-label">{d.todayLeft < 0 ? 'Hoy te pasaste' : 'Hoy podés gastar'}</p>
          <p className="hero-value">{money(Math.round(Math.abs(d.todayLeft)))}</p>
          <p className="hero-sub">
            {d.weekLeft >= 0 ? (
              <>
                Esta semana te quedan <strong>{money(Math.round(d.weekLeft))}</strong>
              </>
            ) : (
              <>
                Esta semana te pasaste <strong>{money(Math.round(-d.weekLeft))}</strong>
              </>
            )}
            {d.perDay > 0 && (
              <>
                {' '}
                · {money(Math.round(d.perDay))} por día, quedan {d.daysLeft} {d.daysLeft === 1 ? 'día' : 'días'}
              </>
            )}
          </p>
          <div className="hero-stats">
            <a href={`#/presupuesto/${month}`} onClick={(e) => e.stopPropagation()}>
              <span>Gastado en el mes</span>
              <strong>{money(Math.round(d.spentBefore + d.spentToday))}</strong>
            </a>
            <a href="#/ahorro" onClick={(e) => e.stopPropagation()}>
              <span>{b.savingsGoal.target > 0 ? 'Ahorro / meta' : 'Ahorrado'}</span>
              <strong>
                {money(Math.round(b.savingsGoal.saved))}
                {b.savingsGoal.target > 0 && <small> / {money(Math.round(b.savingsGoal.target))}</small>}
              </strong>
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (smart) {
                  openExplain({
                    title: 'A este ritmo…',
                    intro: `Según cómo gastás cada día de la semana (últimas ${Math.round(smart.historyDays / 7)} semanas): los sábados no son como los martes. No cuenta lo que viene del mes anterior: eso queda como colchón.`,
                    rows: [
                      { label: 'Para gastar en el mes', value: d.base, note: 'ingresos − fijos − cuotas − ahorro' },
                      { label: 'Ya gastaste', value: smart.spentSoFar, op: '−' },
                      ...smart.rest
                        .filter((r) => r.typical > 0)
                        .map((r) => ({
                          label: `${r.days} ${r.weekday}${r.days > 1 && !r.weekday.endsWith('s') ? 's' : ''} × ${money(Math.round(r.typical))}`,
                          value: round2(r.days * r.typical),
                          op: '−' as const,
                          note: 'lo típico de ese día',
                        })),
                    ],
                    result: {
                      label: smart.forecastEnd < 0 ? 'Te faltarían' : 'Te sobrarían',
                      value: Math.abs(smart.forecastEnd),
                    },
                    footnote: `Hoy cuenta lo que ya gastaste o lo típico del día, lo que sea más. Los días con gastos fuera de lo común cuentan como máximo ${money(Math.round(smart.cap))} (el 10% de días más caros), para que una compra grande no arruine el cálculo.`,
                  });
                  return;
                }
                openExplain({
                  title: 'A este ritmo…',
                  intro:
                    'Si seguís gastando como hasta hoy, así terminás el mes. No cuenta lo que viene del mes anterior: eso queda como colchón.',
                  rows: [
                    { label: 'Para gastar en el mes', value: d.base, note: 'ingresos − fijos − cuotas − ahorro' },
                    {
                      label: `Gastás ${money(Math.round(d.pace))} por día en promedio`,
                      value: round2(d.pace * daysInMonth(month)),
                      op: '−',
                      note: `× ${daysInMonth(month)} días del mes`,
                    },
                  ],
                  result: { label: d.forecastEnd < 0 ? 'Te faltarían' : 'Te sobrarían', value: Math.abs(d.forecastEnd) },
                });
              }}
            >
              <span>A este ritmo</span>
              <strong>
                {forecastEnd < 0 ? 'faltan ' : 'sobran '}
                {money(Math.round(Math.abs(forecastEnd)))}
              </strong>
            </button>
          </div>
          <p className="hero-foot">Tocá para ver de dónde sale</p>
        </section>
      )}

      <div className="quick-actions">
        <button className="qa qa-expense" onClick={() => openTxForm({ preset: { kind: 'expense' } })}>
          <span>−</span> Gasto
        </button>
        <button className="qa qa-income" onClick={() => openTxForm({ preset: { kind: 'income' } })}>
          <span>+</span> Ingreso
        </button>
        <button className="qa" onClick={() => openTxForm({ preset: { kind: 'saving' } })}>
          <span>🐷</span> Ahorro
        </button>
        <a className="qa" href={`#/presupuesto/${month}`}>
          <span>
            <Icon name="budget" size={18} />
          </span>{' '}
          Presupuesto
        </a>
      </div>

      {!empty && <PlataCard />}
      <PaydayPrompt />
      <PeriodNotes />
      <AutopilotToday />

      <SurplusProposal month={month} />
      <LeftoverProposal month={month} />

      <CloseReminder month={month} />

      {!empty && <MoneyMismatch />}

      {empty && (
        <Section>
          <Empty icon="wallet" title="Empecemos">
            <p>
              Armá tu presupuesto en 3 pasos (sueldo, gastos fijos y cuánto querés gastar en cada cosa) o traé todo desde tu
              planilla de Excel.
            </p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => openBudgetWizard(month)}>
                Armar mi presupuesto
              </button>
              <a className="btn" href="#/importar">
                Importar Excel
              </a>
            </div>
          </Empty>
        </Section>
      )}

      {insights.length > 0 && (
        <Section title="Avisos">
          <ul className="insights">
            {insights.slice(0, 5).map((i) => (
              <InsightRow key={i.id} insight={i} />
            ))}
          </ul>
        </Section>
      )}

      <TodayList b={b} events={events} stock={stock} />

      {nextEvents.length > 0 && (
        <Section
          title="Lo que viene"
          action={
            <a className="link" href={`#/presupuesto/${month}`}>
              Ver todo
            </a>
          }
        >
          <ul className="planned">
            {nextEvents.map((e) => (
              <EventRow key={`${e.kind}-${e.refId}-${e.date}`} event={e} />
            ))}
          </ul>
        </Section>
      )}

      {!empty && <FirstSteps month={month} />}

      {limits.length > 0 ? (
        <Section
          title="Te queda en cada categoría"
          action={
            <a className="link" href={`#/presupuesto/${month}`}>
              Ver presupuesto
            </a>
          }
        >
          <ul className="limits">
            {limits.map((c) => {
              const cat = c.categoryId ? category.get(c.categoryId) : undefined;
              const over = (c.remaining ?? 0) < 0;
              return (
                <li key={c.categoryId}>
                  <button className="cat-row" onClick={() => c.categoryId && openBudgetEditor(month, c.categoryId)}>
                    <div className="limit-head">
                      <span>
                        {cat?.icon} {cat?.name}
                      </span>
                      <span className={over ? 'text-bad' : ''}>
                        {over ? (
                          `Te pasaste ${money(-(c.remaining ?? 0))}`
                        ) : (
                          <>
                            Te quedan <strong>{money(c.remaining ?? 0)}</strong>
                          </>
                        )}
                        <span className="muted"> de {money(c.limit!)}</span>
                      </span>
                    </div>
                    <Progress value={c.spent} max={c.limit!} label={`${cat?.name}: gastado`} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : (
        !empty && (
          <Section>
            <button className="card tile-link cta-tile" onClick={() => openBudgetWizard(month)}>
              <Icon name="budget" />
              <span className="tile-text">
                <strong>Poné un presupuesto por categoría</strong>
                <span className="muted small">
                  Decí cuánto querés gastar en comida, salidas, transporte… y Lifty te avisa cuánto te queda.
                </span>
              </span>
              <Icon name="right" size={18} />
            </button>
          </Section>
        )
      )}

      <div className="tiles">
        {foodCards.map((a) => {
          const f = foodCardMonth(data, a.id, month, today);
          if (!f) return null;
          return (
            <Tile
              key={a.id}
              href="#/alimentacion"
              icon="food"
              title={a.name}
              text={f.perDay !== null ? `${money(Math.round(f.perDay))} por día · va aparte` : 'Va aparte del presupuesto'}
              value={money(Math.round(f.available))}
            />
          );
        })}
        {b.card.total > 0 && (
          <Tile
            href="#/tarjeta"
            icon="card"
            title="Tarjeta este mes"
            text={`${b.card.items.length} ${b.card.items.length === 1 ? 'cuota o compra' : 'cuotas o compras'}`}
            value={money(Math.round(b.card.total))}
          />
        )}
        {(debts.owedToMe > 0 || debts.iOwe > 0) && (
          <Tile
            href="#/deudas"
            icon="people"
            title="Deudas"
            text={
              debts.owedToMe > 0 && debts.iOwe > 0
                ? `Te deben ${money(Math.round(debts.owedToMe))} · debés ${money(Math.round(debts.iOwe))}`
                : debts.owedToMe > 0
                  ? 'Te deben'
                  : 'Debés'
            }
            value={money(Math.round(debts.owedToMe > 0 ? debts.owedToMe : debts.iOwe))}
          />
        )}
        {yearGoals.length > 0 && (
          <Tile
            href="#/metas"
            icon="chart"
            title={`Metas ${today.slice(0, 4)}`}
            text={`${yearGoals.filter((g) => g.status === 'behind').length ? `${yearGoals.filter((g) => g.status === 'behind').length} atrasada(s)` : 'Todas al día'}`}
            value={`${Math.round((yearGoals.reduce((s, g) => s + g.progress, 0) / yearGoals.length) * 100)}%`}
          />
        )}
        {!empty && (
          <Tile
            href="#/resumen"
            icon="chart"
            title={`Tu ${monthLabel(reviewMonth(today), false).toLowerCase()}`}
            text="Plata, rutinas, sueño y ánimo del mes"
            value="Ver"
          />
        )}
        <HealthTile />
        <ChallengesTile />
        <Tile
          href="#/semana"
          icon="calendar"
          title="Tu semana"
          text={`Gastaste ${money(Math.round(week.spent))}${week.prevSpent > 0 ? ` (${week.spent <= week.prevSpent ? 'menos' : 'más'} que la anterior)` : ''}`}
          value="Ver"
        />
        {stock && (
          <Tile
            href="#/stock"
            icon="box"
            title="Stock"
            text={[
              stock.shopping.length ? `${stock.shopping.length} para comprar` : 'Nada para comprar',
              stock.expiring.length ? `${stock.expiring.length} vence${stock.expiring.length === 1 ? '' : 'n'} pronto` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            value={stock.shoppingCost > 0 ? `~${money(Math.round(stock.shoppingCost))}` : '✓'}
          />
        )}
        {weight.latest && (
          <Tile
            href="#/peso"
            icon="scale"
            title="Peso"
            text={
              weight.change7 !== null
                ? `${weight.change7 > 0 ? '+' : weight.change7 < 0 ? '−' : ''}${formatNumber(Math.abs(weight.change7), 3, 0)} kg en la semana`
                : 'Último pesaje'
            }
            value={`${formatNumber(weight.latest.kg, 1)} kg`}
          />
        )}
      </div>

      <Section
        title="Últimos movimientos"
        action={
          <a className="link" href="#/movimientos">
            Ver todos
          </a>
        }
      >
        {recent.length ? (
          <div className="card list">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} showDate />
            ))}
          </div>
        ) : (
          <Empty icon="list" title="Todavía no hay movimientos">
            <button className="btn btn-primary" onClick={() => openTxForm()}>
              <Icon name="plus" /> Cargar el primero
            </button>
          </Empty>
        )}
      </Section>
    </div>
  );
}

/** Los desafíos en curso (el más cercano a terminar). */
/** Te sobra de verdad (lo libre en tus cuentas hasta el cobro), con el detalle en Tu plata. */
function PlataCard() {
  const p = usePlata();
  if (p.spend === 0 && p.saved === 0 && p.invested === 0) return null;
  return (
    <a className={`card pad plata-card ${p.free < 0 ? 'mismatch' : ''}`} href="#/plata">
      <span className="tx-icon" aria-hidden="true">
        💰
      </span>
      <span className="grow">
        <span className="muted small">{p.free >= 0 ? 'Te sobra de verdad' : 'Te falta hasta el cobro'}</span>
        <br />
        <strong className={p.free < 0 ? 'text-bad' : ''}>{money(Math.round(Math.abs(p.free)))}</strong>
        <span className="muted small">
          {p.free >= 0 && p.freePerDay !== null
            ? ` · ${money(Math.round(p.freePerDay))}/día hasta ${p.nextIncome ? `el ${p.until.slice(8)}` : 'fin de mes'}`
            : ''}
          {` · en tus cuentas ${money(Math.round(p.spend))}, comprometido ${money(Math.round(p.committed))}`}
        </span>
      </span>
      <Icon name="right" />
    </a>
  );
}

/** Cuando cobrás: proponer repartir el sueldo (una vez por cobro). */
function PaydayPrompt() {
  const data = useData();
  const today = useToday();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const salary = data.transactions.find(
    (t) => t.kind === 'income' && t.linkKind === 'salary' && t.date <= today && t.date >= addDays(today, -3),
  );
  if (!salary) return null;
  const key = `lifty-payday-${salary.id}`;
  if (local.get(key) === '1' && !open) return null;
  const dismiss = () => {
    local.set(key, '1');
    force((n) => n + 1);
  };
  return (
    <section className="card pad surplus">
      <p>
        💼 Cobraste <strong>{money(salary.amount, salary.currency)}</strong>. ¿Lo repartimos? Primero lo que tiene fecha, después
        tus metas, y lo que queda es para gastar por día.
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Repartir el cobro
        </button>
        <button className="btn btn-ghost" onClick={dismiss}>
          Ahora no
        </button>
      </div>
      {open && (
        <PaydaySheet
          amount={salary.amount}
          onClose={() => {
            setOpen(false);
            dismiss();
          }}
        />
      )}
    </section>
  );
}

/** Vacaciones o mes difícil: cuánto llevás (y lo que viene en la semana). */
function PeriodNotes() {
  const periods = useActivePeriods();
  if (!periods.length) return null;
  return (
    <>
      {periods.map((s) => (
        <a
          key={s.period.id}
          href="#/epocas"
          className={`note ${s.remaining !== null && s.remaining < 0 ? 'note-bad' : 'note-info'} period-note`}
        >
          <PeriodLine s={s} />
        </a>
      ))}
    </>
  );
}

function ChallengesTile() {
  const active = useActiveChallenges();
  if (!active.length) return null;
  const s = [...active].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  return (
    <Tile
      href="#/desafios"
      icon="check"
      title={active.length === 1 ? s.challenge.name : `${active.length} desafíos en curso`}
      text={`${s.text}${s.status === 'active' ? ` · quedan ${s.daysLeft} días` : ''}`}
      value={`${Math.round(s.progress * 100)}%`}
    />
  );
}

/** Los dos puntajes (plata y vida) en una tarjeta. */
function HealthTile() {
  const { money: h, life } = useHealth();
  if (!h && !life) return null;
  return (
    <Tile
      href="#/salud"
      icon="chart"
      title="Tu salud"
      text={[h ? `Plata ${h.score}/100` : null, life ? `Vida ${life.score}/100` : null].filter(Boolean).join(' · ')}
      value="Ver"
    />
  );
}

function weekday(date: string): string {
  // Sin Intl: la primera fecha con nombre de día carga todo el idioma y demora el arranque.
  const name = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(`${date}T12:00:00`).getDay()];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function Tile({ href, icon, title, text, value }: { href: string; icon: IconName; title: string; text: string; value: string }) {
  return (
    <a className="card tile-link" href={href}>
      <Icon name={icon} />
      <span className="tile-text">
        <strong>{title}</strong>
        <span className="muted small">{text}</span>
      </span>
      <strong>{value}</strong>
    </a>
  );
}

const TONE_ICON: Record<Insight['tone'], string> = { good: '✅', warn: '⚠️', bad: '🔴', info: '💡' };

function InsightRow({ insight }: { insight: Insight }) {
  if (insight.href)
    return (
      <li>
        <a className={`insight insight-${insight.tone}`} href={insight.href}>
          <span aria-hidden="true">{TONE_ICON[insight.tone]}</span>
          <span className="grow">{insight.text}</span>
          <Icon name="right" size={16} className="muted" />
        </a>
      </li>
    );
  return (
    <li>
      <button
        className={`insight insight-${insight.tone}`}
        onClick={() => openExplain({ title: insight.text, rows: [], footnote: insight.detail })}
      >
        <span aria-hidden="true">{TONE_ICON[insight.tone]}</span>
        <span className="grow">{insight.text}</span>
        <Icon name="info" size={16} className="muted" />
      </button>
    </li>
  );
}

function whenLabel(date: string, today: string, overdue: boolean): string {
  if (overdue) return `venció el ${Number(date.slice(8))}`;
  if (date === today) return 'hoy';
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 1) return 'mañana';
  return `el ${dayLabel(date, today).toLowerCase()}`;
}

/** "Para hoy": todo lo del día junto, venga de donde venga (plata, rutinas, estudio, stock, vencimientos, diario). */
function TodayList({ b, events, stock }: { b: MonthBudget; events: UpcomingEvent[]; stock: StockOverview | null }) {
  const data = useData();
  const today = useToday();
  const [showDone, setShowDone] = useState(false);
  const hour = new Date().getHours();
  const agenda = cached(data, `agenda:${today}:${hour}`, () => todayAgenda(data, b, today, hour));
  if (!agenda.items.length) return null;
  const done = agenda.items.filter((i) => i.done).length;
  const shown = showDone ? agenda.items : agenda.items.filter((i) => !i.done);
  return (
    <Section
      title={agenda.total ? `Para hoy · ${agenda.done} de ${agenda.total}` : 'Para hoy'}
      action={
        done > 0 ? (
          <button className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Ocultar lo hecho' : `Ver lo hecho (${done})`}
          </button>
        ) : undefined
      }
    >
      {agenda.total > 0 && <Progress value={agenda.done} max={agenda.total} label="Lo de hoy hecho" />}
      {shown.length === 0 ? (
        <p className="muted small agenda-done">✅ Listo todo lo de hoy.</p>
      ) : (
        <ul className="planned agenda">
          {shown.map((item) => {
            if (item.kind === 'fixed' || item.kind === 'income' || item.kind === 'load') {
              const e = events.find((x) => `${x.kind}:${x.refId}:${x.date}` === item.key);
              return e ? <EventRow key={item.key} event={e} /> : null;
            }
            return <AgendaRow key={item.key} item={item} stock={stock} />;
          })}
        </ul>
      )}
    </Section>
  );
}

function AgendaRow({ item, stock }: { item: AgendaItem; stock: StockOverview | null }) {
  const data = useData();
  const today = useToday();
  const meta = <span className={`planned-meta ${item.urgency === 2 && !item.done ? 'due-bad' : ''}`}>{item.detail}</span>;
  if (item.kind === 'journal' && !item.done)
    return (
      <li className="agenda-journal">
        <span className="check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <div className="planned-main">
          <a className="planned-name" href="#/diario">
            {item.title}
          </a>
          <QuickJournal date={today} compact />
        </div>
      </li>
    );
  let check: (() => void) | null = null;
  let checkLabel = '';
  let open: () => void = () => undefined;
  switch (item.kind) {
    case 'habit': {
      const s = habitsToday(data.habits, data.habitLogs, today).due.find((x) => x.habit.id === item.refId);
      if (s) {
        check = () => tapHabit(s, today);
        checkLabel = item.done ? `Desmarcar ${s.habit.name}` : `Marcar ${s.habit.name} como hecha`;
      }
      open = () => navigate('/rutinas');
      break;
    }
    case 'study':
      open = () => navigate('/estudio');
      break;
    case 'stock': {
      const st = stock?.statuses.find((x) => x.item.id === item.refId);
      const expiring = item.key.startsWith('expiry:');
      if (st && !expiring) {
        check = () => addToShoppingList(st, `${st.item.name}: a la lista de compras`);
        checkLabel = `Agregar ${st.item.name} a la lista de compras`;
      }
      open = () => {
        if (expiring) local.set('lifty-stock-tab', 'vence');
        navigate('/stock');
      };
      break;
    }
    case 'reminder': {
      const r = data.reminders.find((x) => x.id === item.refId);
      if (r) {
        check = () =>
          openMenu(r.name, [
            { label: r.repeatMonths ? 'Lo renové' : 'Listo, ya está', run: () => renewReminder(r) },
            { label: 'Ver vencimientos', run: () => navigate('/vencimientos') },
          ]);
        checkLabel = `Marcar ${r.name} como resuelto`;
      }
      open = () => navigate('/vencimientos');
      break;
    }
    case 'journal':
      open = () => navigate('/diario');
      break;
    case 'loan': {
      const d = data.debts.find((x) => x.id === item.refId);
      if (d && item.amount) {
        check = () => payInstallment(data, d, item.amount!, today);
        checkLabel = `Marcar la cuota de ${d.description || d.person} como ${d.direction === 'borrowed' ? 'pagada' : 'cobrada'}`;
      }
      open = () => navigate('/deudas');
      break;
    }
    case 'occasion':
      open = () => navigate('/fechas');
      break;
    case 'subs':
      open = () => navigate('/suscripciones');
      break;
    case 'benefit':
      open = () => navigate('/beneficios');
      break;
    case 'meal': {
      const meal = data.meals.find((m) => m.id === item.refId);
      if (meal) {
        check = () => cookMeal(data, meal, today);
        checkLabel = `Cociné ${item.title}: descontar del stock`;
      }
      open = () => navigate('/menu');
      break;
    }
    case 'remind':
      open = () => openDebtReminder(item.refId);
      check = open;
      checkLabel = 'Armar el mensaje para recordarle';
      break;
    case 'invest':
      open = () => navigate('/plata');
      check = open;
      checkLabel = 'Ver la inversión que vence';
      break;
    case 'checkin': {
      const ask = () =>
        openMenu('¿Gastaste algo hoy?', [
          { label: 'Sí: anotar un gasto', run: () => openTxForm({ preset: { kind: 'expense' } }) },
          { label: 'Hoy no gasté nada', run: () => saveJournal(today, { noSpend: true }) },
        ]);
      check = ask;
      checkLabel = 'Responder: ¿gastaste algo hoy?';
      open = ask;
      break;
    }
  }
  return (
    <li className={item.done ? 'done' : ''}>
      {check ? (
        <button className="check" aria-label={checkLabel} aria-pressed={item.done} onClick={check}>
          <Icon name={item.kind === 'stock' ? 'plus' : 'check'} size={16} />
        </button>
      ) : (
        <span className="check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
      <button className="planned-main" onClick={open}>
        <span className="planned-name">{item.title}</span>
        {meta}
      </button>
      {item.progress && !item.done ? (
        <span className="planned-amount muted">{Math.round((item.progress.value / item.progress.target) * 100)}%</span>
      ) : item.amount ? (
        <span className="planned-amount muted">~{money(Math.round(item.amount))}</span>
      ) : null}
    </li>
  );
}

function EventRow({ event: e }: { event: UpcomingEvent }) {
  const data = useData();
  const today = useToday();
  const eventMonth = monthOf(e.date);
  const b = useMonth(eventMonth);
  const line =
    e.kind === 'fixed'
      ? b.fixed.items.find((l) => l.refId === e.refId)
      : e.kind === 'income'
        ? b.income.planned.find((l) => l.refId === e.refId && l.kind === 'salary')
        : undefined;
  const confirm = () => {
    if (e.kind === 'load') {
      const acc = data.accounts.find((a) => a.id === e.refId);
      if (!acc?.monthlyLoad) return;
      const id = newId();
      mutate('transaction', 'upsert', {
        id,
        updatedAt: '',
        date: today,
        kind: 'income',
        amount: acc.monthlyLoad,
        currency: acc.currency,
        fxRate: 1,
        categoryId: null,
        accountId: acc.id,
        toAccountId: null,
        goalId: null,
        description: `Carga de ${monthLabel(eventMonth, false).toLowerCase()}`,
        installments: 1,
        firstInstallmentMonth: null,
        linkKind: 'load',
        linkId: acc.id,
        linkMonth: eventMonth,
        sharedAmount: 0,
        sharedWith: '',
        tags: [],
      });
      toast(`Carga de ${money(acc.monthlyLoad)} acreditada`, {
        action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', id) },
      });
    } else if (line) {
      confirmPlanned(data, line, eventMonth);
    }
  };
  const verb = e.kind === 'fixed' ? 'Se paga' : e.kind === 'income' ? 'Se cobra' : 'Se acredita';
  const done = e.kind === 'fixed' ? 'pagado' : e.kind === 'income' ? 'cobrado' : 'acreditado';
  return (
    <li>
      <button className="check" aria-label={`Marcar ${e.name} como ${done}`} onClick={confirm}>
        <Icon name="check" size={16} />
      </button>
      <button
        className="planned-main"
        onClick={() =>
          openMenu(e.name, [
            { label: `Marcar como ${done}`, run: confirm },
            ...(e.kind === 'fixed' ? [{ label: 'Editar gasto fijo', run: () => openFixedForm(e.refId, eventMonth) }] : []),
            ...(e.kind === 'income' ? [{ label: 'Editar ingreso', run: () => openIncomeForm(e.refId, eventMonth) }] : []),
            ...(e.kind === 'load' ? [{ label: 'Ir a la tarjeta de alimentación', run: () => navigate('/alimentacion') }] : []),
          ])
        }
      >
        <span className="planned-name">
          {e.kind === 'fixed' ? '📅' : e.kind === 'income' ? '💼' : '🍽️'} {e.name}
        </span>
        <span className={`planned-meta ${e.overdue ? 'due-bad' : e.date === today ? 'due-warn' : ''}`}>
          {verb} {whenLabel(e.date, today, e.overdue)}
          {e.kind === 'load' ? ' · va aparte' : ''}
        </span>
      </button>
      <span className="planned-amount">{money(e.amount)}</span>
    </li>
  );
}

/** Lo que el piloto automático hizo hoy (una línea, con link al historial). */
function AutopilotToday() {
  const data = useData();
  const today = useToday();
  const logs = data.autoLogs.filter((l) => l.date === today && !l.undone);
  if (!logs.length) return null;
  return (
    <a className="auto-today" href="#/piloto">
      <span aria-hidden="true">🤖</span>
      <span className="grow">
        Hoy Lifty hizo solo:{' '}
        {logs
          .slice(0, 3)
          .map((l) => l.title)
          .join(' · ')}
        {logs.length > 3 ? ` y ${logs.length - 3} más` : ''}
      </span>
      <Icon name="right" size={16} />
    </a>
  );
}

/** Aviso si lo que hay en las cuentas no coincide con lo que dice el presupuesto. */
function MoneyMismatch() {
  const c = useMoneyCheck();
  if (Math.abs(c.difference) < 100) return null;
  // Si la diferencia es grande o hay cuentas en negativo, lo más probable es que falten los saldos reales.
  const big = Math.abs(c.difference) > 5000 || c.accounts.some((x) => x.balanceUYU < 0);
  return (
    <div className="card pad tile-link mismatch">
      <span aria-hidden="true">⚖️</span>
      <span className="tile-text">
        <strong>Tus cuentas no cuadran por {money(Math.round(Math.abs(c.difference)))}</strong>
        <span className="muted small">
          {big
            ? 'Decime cuánto tenés hoy en cada cuenta y Lifty cuadra todo desde hoy (1 minuto).'
            : c.difference < 0
              ? 'En tus cuentas hay menos plata de la que dice tu presupuesto: ¿algún gasto sin anotar?'
              : 'En tus cuentas hay más plata de la que dice tu presupuesto: ¿algún ingreso sin anotar?'}
        </span>
      </span>
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => openSetup()}>
          Poner a punto
        </button>
        <a className="btn btn-ghost" href="#/cuentas">
          Ver
        </a>
      </div>
    </div>
  );
}

/** Recordatorio para cerrar el mes: el último día del mes y los primeros días del siguiente. */
function CloseReminder({ month }: { month: string }) {
  const data = useData();
  const today = useToday();
  const day = Number(today.slice(8));
  const lastDay = day === daysInMonth(month);
  const target = lastDay ? month : addMonths(month, -1);
  const b = useMonth(target);
  const key = `lifty-close-${target}`;
  const [dismissed, setDismissed] = useState(local.get(key) === '1');
  const active = data.transactions.some((t) => monthOf(t.date) === target) || b.income.total > 0;
  if (dismissed || b.closing || !active || (!lastDay && day > 10)) return null;
  const name = monthLabel(target, false).toLowerCase();
  return (
    <section className="card pad surplus">
      <p>
        📒 {lastDay ? `Hoy termina ${name}` : `${name.charAt(0).toUpperCase()}${name.slice(1)} todavía no está cerrado`}. Poné lo
        que te quedó de verdad y Lifty arranca el mes siguiente con ese número.
      </p>
      <div className="btn-row">
        <a className="btn btn-primary" href={`#/presupuesto/${target}`}>
          Cerrar {name}
        </a>
        <button
          className="btn btn-ghost"
          onClick={() => {
            local.set(key, '1');
            setDismissed(true);
          }}
        >
          Ahora no
        </button>
      </div>
    </section>
  );
}

/** "En septiembre te sobraron $X: ¿los pasás al ahorro?" */
function SurplusProposal({ month }: { month: string }) {
  const data = useData();
  const prevMonth = addMonths(month, -1);
  const prev = useMonth(prevMonth);
  const key = `lifty-surplus-${prevMonth}`;
  const [dismissed, setDismissed] = useState(local.get(key) === '1');
  const prevName = monthLabel(prevMonth, false).toLowerCase();
  const description = `Sobrante de ${prevName}`;
  const already = data.transactions.some(
    (t) => t.kind === 'saving' && t.description === description && monthOf(t.date) === prevMonth,
  );
  // Solo si el mes pasó de verdad: con movimientos y cerrado (o con lo que se cobra tildado). Si
  // no, "lo que sobró" sería una proyección, no plata real.
  const hasActivity = data.transactions.some((t) => monthOf(t.date) === prevMonth && !t.linkKind);
  // (Un cierre hecho por "Poner a punto" no es un sobrante: es el punto de partida.)
  const closedForReal = !!prev.closing && prev.closing.note !== 'Cuadre con las cuentas';
  const reliable =
    prev.carryover.source !== 'projected' && (closedForReal || (hasActivity && !prev.closing && prev.income.pending <= 0));
  const end = prev.closing ? prev.closing.realBalance : prev.result;
  const surplus = Math.floor(round2(end - prev.carryover.amount));
  if (dismissed || already || !reliable || surplus < 100) return null;
  const goals = data.goals.filter((g) => !g.archived && g.currency === 'UYU');
  const send = (goalId: string | null) => {
    const id = newId();
    mutate('transaction', 'upsert', {
      id,
      updatedAt: '',
      date: `${prevMonth}-${String(daysInMonth(prevMonth)).padStart(2, '0')}`,
      kind: 'saving',
      amount: surplus,
      currency: 'UYU',
      fxRate: 1,
      categoryId: null,
      accountId: null,
      toAccountId: null,
      goalId,
      description,
      installments: 1,
      firstInstallmentMonth: null,
      linkKind: null,
      linkId: null,
      linkMonth: null,
      sharedAmount: 0,
      sharedWith: '',
      tags: [],
    });
    // Si el mes estaba cerrado, lo que pasa al mes siguiente baja lo mismo.
    const closing = prev.closing;
    if (closing) mutate('closing', 'upsert', { ...closing, realBalance: round2(closing.realBalance - surplus) });
    toast(`${money(surplus)} al ahorro`, {
      action: {
        label: 'Deshacer',
        run: () => {
          mutate('transaction', 'delete', id);
          if (closing) mutate('closing', 'upsert', closing);
        },
      },
    });
  };
  return (
    <section className="card pad surplus">
      <p>
        🎉 En {prevName} te sobraron <strong>{money(surplus)}</strong>.{' '}
        <button
          className="link"
          onClick={() =>
            openExplain({
              title: `Lo que te sobró en ${prevName}`,
              rows: [
                {
                  label: prev.closing ? 'Lo que tenías al cerrar el mes' : 'Lo que te quedó según Lifty',
                  value: end,
                },
                { label: 'Lo que venía del mes anterior', value: prev.carryover.amount, op: '−' },
              ],
              result: { label: 'Te sobró', value: surplus },
              footnote:
                'Si lo pasás al ahorro, se carga como ahorro del último día del mes y deja de pasar al mes siguiente. Si no, sigue disponible este mes.',
            })
          }
        >
          ¿De dónde sale?
        </button>
      </p>
      <p className="muted small">¿Lo pasás al ahorro antes de gastarlo?</p>
      <div className="btn-row">
        {goals.length <= 1 ? (
          <button className="btn btn-primary" onClick={() => send(goals[0]?.id ?? null)}>
            Pasar al ahorro{goals[0] ? ` (${goals[0].name})` : ''}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() =>
              openMenu(
                '¿A qué meta?',
                goals.map((g) => ({ label: `${g.icon} ${g.name}`, run: () => send(g.id) })),
              )
            }
          >
            Pasar al ahorro…
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            local.set(key, '1');
            setDismissed(true);
          }}
        >
          Ahora no
        </button>
      </div>
    </section>
  );
}

/** Lista de primeros pasos: desaparece cuando está todo hecho (o si la ocultás). */
function FirstSteps({ month }: { month: string }) {
  const data = useData();
  const sync = useSync();
  const [hidden, setHidden] = useState(local.get('lifty-first-steps') === 'hidden');
  if (hidden) return null;
  const steps: { done: boolean; label: string; run: () => void }[] = [
    { done: data.incomes.length > 0, label: 'Cargá tu sueldo', run: () => openIncomeForm(null, month) },
    {
      done: data.fixed.length > 0,
      label: 'Cargá tus gastos fijos (alquiler, UTE, celular…)',
      run: () => openFixedForm(null, month),
    },
    {
      done: data.categories.some((c) => c.monthlyLimit) || data.budgets.length > 0,
      label: 'Poné cuánto querés gastar por categoría',
      run: () => openBudgetWizard(month),
    },
    { done: data.settings.savingsMode !== 'none', label: 'Elegí cuánto querés ahorrar por mes', run: () => navigate('/ahorro') },
    {
      done: data.accounts.some((a) => a.initialBalance !== 0) || !!local.get('lifty-setup-done'),
      label: 'Poné cuánto tenés hoy en cada cuenta (para que todo cuadre)',
      run: () => openSetup(),
    },
    {
      done:
        !data.accounts.some((a) => a.type === 'food' && !a.archived) ||
        data.accounts.some((a) => a.type === 'food' && a.monthlyLoad),
      label: 'Configurá la tarjeta de alimentación',
      run: () => navigate('/alimentacion'),
    },
    {
      done: !sync.local || local.get('lifty-paired') === '1',
      label: 'Vinculá tu celular',
      run: () => navigate('/conectar'),
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Section
      title={`Primeros pasos · ${done} de ${steps.length}`}
      action={
        <button
          className="link"
          onClick={() => {
            local.set('lifty-first-steps', 'hidden');
            setHidden(true);
          }}
        >
          Ocultar
        </button>
      }
    >
      <ul className="planned">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="check" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
            <button className="planned-main" onClick={s.run} disabled={s.done}>
              <span className="planned-name">{s.label}</span>
            </button>
            {!s.done && <Icon name="right" size={18} className="muted" />}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Categorías con "lo que sobra va al ahorro": al empezar el mes, pasarlo con un toque. */
function LeftoverProposal({ month }: { month: string }) {
  const data = useData();
  const prev = useMonth(addMonths(month, -1));
  const list = leftoversToSave(data, prev);
  if (!list.length) return null;
  const goal =
    data.goals.find((g) => g.id === data.settings.autoSaveGoalId) ?? data.goals.find((g) => !g.archived && g.currency === 'UYU');
  const send = (l: (typeof list)[number]) => {
    const id = newId();
    mutate('transaction', 'upsert', {
      id,
      updatedAt: '',
      date: `${l.month}-${String(daysInMonth(l.month)).padStart(2, '0')}`,
      kind: 'saving',
      amount: l.amount,
      currency: 'UYU',
      fxRate: 1,
      categoryId: null,
      accountId: null,
      toAccountId: null,
      goalId: goal?.id ?? null,
      description: l.description,
      installments: 1,
      firstInstallmentMonth: null,
      linkKind: null,
      linkId: null,
      linkMonth: null,
      sharedAmount: 0,
      sharedWith: '',
      tags: [],
    });
    const closing = prev.closing;
    if (closing) mutate('closing', 'upsert', { ...closing, realBalance: round2(closing.realBalance - l.amount) });
    toast(`${money(l.amount)} de ${l.category.name.toLowerCase()} al ahorro`, {
      action: {
        label: 'Deshacer',
        run: () => {
          mutate('transaction', 'delete', id);
          if (closing) mutate('closing', 'upsert', closing);
        },
      },
    });
  };
  return (
    <>
      {list.map((l) => (
        <section key={l.category.id} className="card pad surplus">
          <p>
            {l.category.icon} En {monthLabel(l.month, false).toLowerCase()} te sobraron <strong>{money(l.amount)}</strong> de{' '}
            {l.category.name.toLowerCase()}. Elegiste que lo que sobra vaya al ahorro.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => send(l)}>
              Pasar al ahorro{goal ? ` (${goal.name})` : ''}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
