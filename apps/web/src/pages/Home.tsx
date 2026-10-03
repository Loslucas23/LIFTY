import { useState } from 'react';
import {
  addMonths,
  daysInMonth,
  debtTotals,
  foodCardMonth,
  habitsToday,
  reminderStatus,
  weekStart,
  weekSummary,
  monthInsights,
  monthLabel,
  monthOf,
  newId,
  round2,
  stockOverview,
  upcomingEvents,
  weightStats,
  type Insight,
  type UpcomingEvent,
} from '@lifty/core';
import { confirmPlanned } from '../lib/actions';
import { openBudgetEditor, openBudgetWizard, openExplain, openFixedForm, openIncomeForm, openMenu } from '../components/Editors';
import { Icon, type IconName } from '../components/Icon';
import { useMoneyCheck } from '../components/MoneyCheck';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Empty, Progress, Section, toast } from '../components/ui';
import { explainDaily } from '../lib/explain';
import { dayLabel, money } from '../lib/format';
import { navigate } from '../lib/router';
import { local } from '../lib/local';
import { useData, useLookups, useMonth, useSync, useToday } from '../lib/store';
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
  const insights = empty ? [] : monthInsights(data, b, today);
  const events = upcomingEvents(data, b, today);
  const debts = debtTotals(data);
  const foodCards = data.accounts.filter((a) => a.type === 'food' && !a.archived);
  const d = b.daily;
  const week = weekSummary(data, weekStart(today), today);
  const dueReminders = data.reminders
    .filter((r) => !r.archived)
    .map((r) => reminderStatus(r, today))
    .filter((r) => r.status !== 'ok');
  const routines = habitsToday(data.habits, data.habitLogs, today);
  const stock = data.stockItems.length ? stockOverview(data.stockItems, data.stockMoves, today, data.settings) : null;

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
                {d.forecastEnd < 0 ? 'faltan ' : 'sobran '}
                {money(Math.round(Math.abs(d.forecastEnd)))}
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

      <SurplusProposal month={month} />

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

      {events.length > 0 && (
        <Section
          title="Lo que viene"
          action={
            <a className="link" href={`#/presupuesto/${month}`}>
              Ver todo
            </a>
          }
        >
          <ul className="planned">
            {events.map((e) => (
              <EventRow key={`${e.kind}-${e.refId}-${e.date}`} event={e} />
            ))}
          </ul>
        </Section>
      )}

      {!empty && <FirstSteps month={month} />}

      {dueReminders.length > 0 && (
        <Section
          title="Vence pronto"
          action={
            <a className="link" href="#/vencimientos">
              Ver todo
            </a>
          }
        >
          <ul className="insights">
            {dueReminders.map(({ reminder: r, daysLeft, status }) => (
              <li key={r.id}>
                <a className={`insight insight-${status === 'overdue' ? 'bad' : 'warn'}`} href="#/vencimientos">
                  <span aria-hidden="true">{r.icon}</span>
                  <span className="grow">
                    {r.name}:{' '}
                    {daysLeft < 0 ? `venció hace ${-daysLeft} días` : daysLeft === 0 ? 'vence hoy' : `vence en ${daysLeft} días`}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

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
        <Tile
          href="#/semana"
          icon="calendar"
          title="Tu semana"
          text={`Gastaste ${money(Math.round(week.spent))}${week.prevSpent > 0 ? ` (${week.spent <= week.prevSpent ? 'menos' : 'más'} que la anterior)` : ''}`}
          value="Ver"
        />
        {routines.due.length > 0 && (
          <Tile
            href="#/rutinas"
            icon="check"
            title="Rutinas de hoy"
            text={
              routines.doneCount === routines.due.length ? '¡Todo hecho!' : `Faltan ${routines.due.length - routines.doneCount}`
            }
            value={`${routines.doneCount}/${routines.due.length}`}
          />
        )}
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
                ? `${weight.change7 > 0 ? '+' : weight.change7 < 0 ? '−' : ''}${Math.abs(weight.change7).toLocaleString('es-UY')} kg en la semana`
                : 'Último pesaje'
            }
            value={`${weight.latest.kg.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`}
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

function weekday(date: string): string {
  const name = new Date(`${date}T12:00:00`).toLocaleDateString('es-UY', { weekday: 'long' });
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

/** Aviso si lo que hay en las cuentas no coincide con lo que dice el presupuesto. */
function MoneyMismatch() {
  const c = useMoneyCheck();
  if (Math.abs(c.difference) < 100) return null;
  return (
    <a className="card pad tile-link mismatch" href="#/cuentas">
      <span aria-hidden="true">⚖️</span>
      <span className="tile-text">
        <strong>Tus cuentas no cuadran por {money(Math.round(Math.abs(c.difference)))}</strong>
        <span className="muted small">
          {c.difference < 0
            ? 'En tus cuentas hay menos plata de la que dice tu presupuesto: ¿algún gasto sin anotar?'
            : 'En tus cuentas hay más plata de la que dice tu presupuesto: ¿algún ingreso sin anotar?'}
        </span>
      </span>
      <Icon name="right" size={18} />
    </a>
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
  const hasActivity = data.transactions.some((t) => monthOf(t.date) === prevMonth) || prev.income.total > 0;
  const end = prev.closing ? prev.closing.realBalance : prev.result;
  const surplus = Math.floor(round2(end - prev.carryover.amount));
  if (dismissed || already || !hasActivity || surplus < 100) return null;
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
      done: data.accounts.some((a) => a.initialBalance !== 0),
      label: 'Poné cuánto tenés en cada cuenta',
      run: () => navigate('/cuentas'),
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
