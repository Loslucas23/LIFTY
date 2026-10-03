import { useState } from 'react';
import {
  addMonths,
  categorySeries,
  monthLabel,
  monthOf,
  monthReports,
  personalInflation,
  netWorthHistory,
  round2,
  spendingByWeekday,
  tagTotals,
  topExpenses,
} from '@lifty/core';
import { LineChart } from '../components/charts';
import { openExplain } from '../components/Editors';
import { TxRow } from '../components/TxRow';
import { Empty, PageHeader, Section, Segmented } from '../components/ui';
import { money } from '../lib/format';
import { useData, useLookups, useMonths, useToday } from '../lib/store';

/** Pestañas compartidas entre "Este año" y "Tendencias". */
export function ReportTabs({ active }: { active: 'anio' | 'informes' }) {
  return (
    <nav className="report-tabs" aria-label="Informes">
      <a href="#/anio" className={active === 'anio' ? 'on' : ''} aria-current={active === 'anio' ? 'page' : undefined}>
        Año
      </a>
      <a
        href="#/informes"
        className={active === 'informes' ? 'on' : ''}
        aria-current={active === 'informes' ? 'page' : undefined}
      >
        Tendencias
      </a>
    </nav>
  );
}

const short = (m: string) => monthLabel(m, false).slice(0, 3);

export function Reports() {
  const data = useData();
  const today = useToday();
  const current = monthOf(today);
  const [range, setRange] = useState<'6' | '12'>('6');
  const count = Number(range);
  // Meses cerrados (sin el actual, que todavía no terminó) para promedios justos.
  const months = useMonths(addMonths(current, -count), addMonths(current, -1));
  const withCurrent = useMonths(addMonths(current, -count + 1), current);
  const reports = monthReports(months);
  const active = reports.filter((r) => r.income > 0 || r.expenses > 0);
  const avg = (f: (r: (typeof reports)[number]) => number) =>
    active.length ? round2(active.reduce((s, r) => s + f(r), 0) / active.length) : 0;
  const avgIncome = avg((r) => r.income);
  const avgExpenses = avg((r) => r.expenses);
  const avgSavings = avg((r) => r.savings);
  const rate = avgIncome > 0 ? Math.round((avgSavings / avgIncome) * 100) : null;
  const worth = netWorthHistory(data, today, count + 1);
  const last = worth[worth.length - 1];
  const first = worth[0];

  if (data.transactions.length === 0) {
    return (
      <div className="page">
        <PageHeader title="Informes" subtitle="Cómo te va mes a mes" />
        <ReportTabs active="informes" />
        <Empty icon="chart" title="Todavía no hay datos">
          Cuando cargues movimientos (o importes tu Excel) acá vas a ver tendencias, en qué se te va la plata y cómo crece tu
          patrimonio.
        </Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Informes"
        subtitle="Cómo te va mes a mes"
        actions={
          <Segmented
            label="Período"
            value={range}
            onChange={setRange}
            options={[
              { value: '6', label: '6 meses' },
              { value: '12', label: '12 meses' },
            ]}
          />
        }
      />
      <ReportTabs active="informes" />

      <div className="stat-row">
        <button
          className="card stat"
          onClick={() =>
            openExplain({
              title: 'Promedio por mes',
              intro: `Promedio de los últimos ${count} meses terminados (sin contar ${monthLabel(current, false).toLowerCase()}, que todavía no terminó)${active.length < count ? `; solo ${active.length} tienen movimientos` : ''}.`,
              rows: reports.map((r) => ({
                label: monthLabel(r.month),
                value: r.expenses,
                note: `entró ${money(Math.round(r.income))}`,
              })),
              result: { label: 'Gasto promedio', value: avgExpenses },
            })
          }
        >
          <span>Gastás por mes</span>
          <strong>{money(Math.round(avgExpenses))}</strong>
        </button>
        <div className="card stat">
          <span>Entra por mes</span>
          <strong>{money(Math.round(avgIncome))}</strong>
        </div>
        <div className="card stat">
          <span>Ahorrás de lo que entra</span>
          <strong>{rate === null ? '—' : `${rate}%`}</strong>
        </div>
      </div>

      <Section title="Tu patrimonio">
        <figure className="card chart">
          <figcaption className="chart-head">
            <div>
              <strong>{money(Math.round(last.total))}</strong>
              <span className={`small ${last.total >= first.total ? 'text-income' : 'text-expense'}`}>
                {' '}
                {last.total >= first.total ? '+' : '−'}
                {money(Math.round(Math.abs(last.total - first.total)))} en {count} meses
              </span>
            </div>
            <button
              className="link small"
              onClick={() =>
                openExplain({
                  title: 'Tu patrimonio hoy',
                  intro: 'Lo que tenés menos lo que debés. Los dólares se pasan a pesos con la cotización de Ajustes.',
                  rows: [
                    { label: 'Bancos y efectivo', value: last.cash, op: '+' },
                    { label: 'Ahorros', value: last.savings, op: '+' },
                    { label: 'Te deben', value: last.owedToMe, op: '+' },
                    { label: 'Tarjeta de crédito', value: -last.credit, op: '−' },
                    { label: 'Debés a otros', value: last.iOwe, op: '−' },
                  ],
                  result: { label: 'Patrimonio', value: last.total },
                  footnote:
                    'Es tan preciso como los saldos de tus cuentas: si no coinciden con el banco, ajustalos en Cuentas. La tarjeta de alimentación no cuenta: no es plata.',
                })
              }
            >
              ¿De dónde sale?
            </button>
          </figcaption>
          <LineChart
            label="Evolución del patrimonio mes a mes"
            points={worth.map((w) => ({ label: short(monthOf(w.date)), value: w.total }))}
            format={(v) => money(Math.round(v))}
            tooltip={(i) => (
              <>
                <span>{money(Math.round(worth[i].total))}</span>
                <span className="muted">
                  Cuentas {money(Math.round(worth[i].cash))} · ahorro {money(Math.round(worth[i].savings))}
                </span>
              </>
            )}
          />
        </figure>
      </Section>

      <Section title="Cuánto ahorrás de lo que entra">
        <ul className="card month-bars">
          {withCurrent.map((m) => {
            const r = m.income.total > 0 ? Math.round((m.savings.total / m.income.total) * 100) : null;
            return (
              <li key={m.month}>
                <a href={`#/presupuesto/${m.month}`}>{monthLabel(m.month)}</a>
                <div className="bar-track">
                  <div className="bar-fill bar-good" style={{ width: `${Math.max(0, Math.min(100, r ?? 0))}%` }} />
                </div>
                <strong>{r === null ? '—' : `${r}%`}</strong>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Ahorro del mes ÷ lo que entró ese mes. Un 10–20% es una buena meta para empezar.</p>
      </Section>

      <CategoryTrends months={withCurrent} />

      <Weekdays today={today} />

      <Tags />

      <Inflation />

      <Section title={`Los gastos más grandes de ${monthLabel(current, false).toLowerCase()}`}>
        <TopExpenses month={current} />
      </Section>
    </div>
  );
}

function CategoryTrends({ months }: { months: ReturnType<typeof useMonths> }) {
  const { category } = useLookups();
  const series = categorySeries(months).slice(0, 8);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  if (series.length === 0) return null;
  return (
    <Section title="En qué se te va la plata">
      <ul className="card trends">
        {series.map((s) => {
          const cat = s.categoryId ? category.get(s.categoryId) : undefined;
          const name = cat ? `${cat.icon} ${cat.name}` : 'Sin categoría';
          const done = s.values.slice(0, -1).filter((v) => v > 0);
          const avg = done.length ? done.reduce((a, v) => a + v, 0) / done.length : 0;
          const lastFull = s.values[s.values.length - 2] ?? 0;
          const change = avg > 0 && lastFull > 0 ? Math.round(((lastFull - avg) / avg) * 100) : null;
          return (
            <li key={s.categoryId ?? 'none'}>
              <button
                className="trend"
                onClick={() =>
                  openExplain({
                    title: name,
                    intro: 'Lo gastado en el día a día y con tarjeta (los gastos fijos van aparte).',
                    rows: months.map((m, i) => ({ label: monthLabel(m.month), value: s.values[i] })),
                    result: { label: 'Promedio (meses terminados)', value: round2(avg) },
                  })
                }
              >
                <span className="trend-name">
                  <strong>{name}</strong>
                  <span className="muted small">
                    {money(Math.round(avg))} por mes
                    {change !== null && Math.abs(change) >= 10 && (
                      <span className={change > 0 ? 'text-expense' : 'text-income'}>
                        {' '}
                        · {monthLabel(months[months.length - 2].month, false).toLowerCase()} {change > 0 ? '+' : ''}
                        {change}%
                      </span>
                    )}
                  </span>
                </span>
                <span className="spark" aria-hidden="true">
                  {s.values.map((v, i) => (
                    <i
                      key={months[i].month}
                      className={i === s.values.length - 1 ? 'now' : ''}
                      style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
                    />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">La última barra es el mes en curso. Tocá una categoría para ver los números.</p>
    </Section>
  );
}

function Weekdays({ today }: { today: string }) {
  const data = useData();
  const days = spendingByWeekday(data, today);
  const max = Math.max(1, ...days.map((d) => d.average));
  if (days.every((d) => d.average === 0)) return null;
  const top = days.reduce((a, b) => (b.average > a.average ? b : a));
  return (
    <Section title="Qué días gastás más">
      <ul className="card month-bars">
        {days.map((d) => (
          <li key={d.label}>
            <span>{d.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(d.average / max) * 100}%` }} />
            </div>
            <strong>{money(Math.round(d.average))}</strong>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Promedio de los últimos 90 días (día a día y tarjeta, sin fijos). El {top.label.toLowerCase()} es tu día más caro.
      </p>
    </Section>
  );
}

function Tags() {
  const data = useData();
  const tags = tagTotals(data).slice(0, 10);
  if (tags.length === 0) return null;
  const max = Math.max(1, ...tags.map((t) => t.total));
  return (
    <Section title="Por etiqueta">
      <ul className="card month-bars">
        {tags.map((t) => (
          <li key={t.tag}>
            <a href={`#/movimientos?etiqueta=${encodeURIComponent(t.tag)}`}>#{t.tag}</a>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(t.total / max) * 100}%` }} />
            </div>
            <strong>{money(Math.round(t.total))}</strong>
          </li>
        ))}
      </ul>
      <p className="muted small">Todo lo gastado con cada etiqueta (tu parte), sin importar la categoría ni el mes.</p>
    </Section>
  );
}

function TopExpenses({ month }: { month: string }) {
  const data = useData();
  const list = topExpenses(data, month, 5);
  if (list.length === 0) return <p className="muted small">Todavía no hay gastos este mes.</p>;
  return (
    <div className="card list">
      {list.map((t) => (
        <TxRow key={t.id} tx={t} showDate />
      ))}
    </div>
  );
}

/** Tu inflación: cuánto subió lo que vos comprás, pesado por lo que gastás en cada cosa. */
function Inflation() {
  const data = useData();
  const today = useToday();
  const r = personalInflation(data, today);
  if (!r.items.length) return null;
  return (
    <Section title="Tu inflación (último año)">
      <button
        className="card pad tile-link"
        onClick={() =>
          openExplain({
            title: 'Tu inflación',
            intro:
              'Cada producto del stock (precio por unidad, primera contra última compra del año) y cada gasto fijo que cambió de monto, pesado por lo que gastás por mes en eso.',
            rows: r.items.map((i) => ({
              label: `${i.name}: ${money(i.before)} → ${money(i.now)} (pesa ${money(Math.round(i.weight))}/mes)`,
              value: i.change,
              raw: `${i.change > 0 ? '+' : ''}${i.change.toLocaleString('es-UY')}%`,
            })),
            result:
              r.total !== null
                ? { label: 'Tu inflación', value: r.total, raw: `${r.total > 0 ? '+' : ''}${r.total.toLocaleString('es-UY')}%` }
                : undefined,
          })
        }
      >
        <span className="tile-text">
          <strong className={r.total !== null && r.total > 0 ? 'text-expense' : 'text-income'}>
            {r.total !== null
              ? `${r.total > 0 ? '+' : ''}${r.total.toLocaleString('es-UY', { maximumFractionDigits: 1 })}%`
              : '—'}
          </strong>
          <span className="muted small">
            Lo que más subió:{' '}
            {r.items
              .slice(0, 3)
              .map((i) => `${i.name} ${i.change > 0 ? '+' : ''}${Math.round(i.change)}%`)
              .join(' · ')}
          </span>
        </span>
        <span className="link small">¿De dónde sale?</span>
      </button>
    </Section>
  );
}
