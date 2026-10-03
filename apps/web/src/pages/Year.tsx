import { useState } from 'react';
import { MONTH_NAMES, monthOf, parseMonth, type MonthBudget } from '@lifty/core';
import { Bar, niceStep } from '../components/charts';
import { Icon } from '../components/Icon';
import { useWidth } from '../components/useWidth';
import { PageHeader } from '../components/ui';
import { ReportTabs } from './Reports';
import { compact, money } from '../lib/format';
import { navigate } from '../lib/router';
import { useMonths, useToday } from '../lib/store';

export function Year({ year: yearParam }: { year?: string }) {
  const today = useToday();
  const year = Number(yearParam) || parseMonth(monthOf(today)).year;
  const months = useMonths(`${year}-01`, `${year}-12`);
  const total = (f: (m: MonthBudget) => number) => months.reduce((s, m) => s + f(m), 0);

  return (
    <div className="page">
      <PageHeader title="Informes" subtitle="Ingresos, gastos y saldo de cada mes del año" />
      <ReportTabs active="anio" />
      <div className="month-picker">
        <button className="icon-btn" onClick={() => navigate(`/anio/${year - 1}`, { replace: true })} aria-label="Año anterior">
          <Icon name="left" />
        </button>
        <span className="month-picker-label">
          <span>{year}</span>
        </span>
        <button className="icon-btn" onClick={() => navigate(`/anio/${year + 1}`, { replace: true })} aria-label="Año siguiente">
          <Icon name="right" />
        </button>
      </div>

      <div className="stat-row">
        <div className="card stat">
          <span>Ingresos del año</span>
          <strong>{money(total((m) => m.income.total))}</strong>
        </div>
        <div className="card stat">
          <span>Gastos del año</span>
          <strong>{money(total((m) => m.expenses))}</strong>
        </div>
        <div className="card stat">
          <span>Ahorrado</span>
          <strong>{money(total((m) => m.savings.total))}</strong>
        </div>
      </div>

      <YearChart months={months} today={today} />

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Ingresos</th>
              <th scope="col">Gastos</th>
              <th scope="col">Ahorro</th>
              <th scope="col">Proyectado</th>
              <th scope="col">Real</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr
                key={m.month}
                onClick={() => navigate(`/presupuesto/${m.month}`)}
                className={m.month === monthOf(today) ? 'current' : ''}
              >
                <th scope="row">
                  <a href={`#/presupuesto/${m.month}`}>{MONTH_NAMES[parseMonth(m.month).month - 1]}</a>
                </th>
                <td>{money(m.income.total)}</td>
                <td>{money(m.expenses)}</td>
                <td>{money(m.savings.total)}</td>
                <td className={m.result < 0 ? 'text-bad' : ''}>{money(m.result)}</td>
                <td>{m.closing ? money(m.closing.realBalance) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        "Proyectado" incluye lo que viene del mes anterior. Cuando cerrás un mes, el saldo real reemplaza al proyectado para los
        meses siguientes.
      </p>
    </div>
  );
}

/** Barras agrupadas: ingresos vs. gastos por mes, con tooltip al pasar o tocar. */
function YearChart({ months, today }: { months: MonthBudget[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth<HTMLDivElement>();
  const H = W < 520 ? 200 : 240;
  const pad = { top: 16, right: 4, bottom: 26, left: W < 520 ? 48 : 56 };
  const max = Math.max(1, ...months.flatMap((m) => [m.income.total, m.expenses]));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - Math.max(0, v) / top);
  const colW = (W - pad.left - pad.right) / 12;
  const barW = Math.max(3, Math.min(18, (colW - 8) / 2));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const current = monthOf(today);
  const h = hover !== null ? months[hover] : null;

  return (
    <figure className="card chart">
      <figcaption className="chart-head">
        <strong>Ingresos y gastos por mes</strong>
        <span className="legend">
          <span className="legend-item">
            <i style={{ background: 'var(--series-1)' }} /> Ingresos
          </span>
          <span className="legend-item">
            <i style={{ background: 'var(--series-2)' }} /> Gastos
          </span>
        </span>
      </figcaption>
      <div className="chart-box" ref={boxRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Gráfico de barras de ingresos y gastos de cada mes del año"
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const x = pad.left + i * colW + colW / 2;
            const base = y(0);
            return (
              <g key={m.month}>
                {hover === i && <rect x={x - colW / 2} y={pad.top} width={colW} height={base - pad.top} className="hover-col" />}
                <Bar x={x - barW - 1} w={barW} y0={base} y1={y(m.income.total)} fill="var(--series-1)" />
                <Bar x={x + 1} w={barW} y0={base} y1={y(m.expenses)} fill="var(--series-2)" />
                <text x={x} y={H - 8} textAnchor="middle" className={`axis ${m.month === current ? 'axis-strong' : ''}`}>
                  {MONTH_NAMES[i].slice(0, 3)}
                </text>
                <rect
                  x={x - colW / 2}
                  y={0}
                  width={colW}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: `${((pad.left + hover * colW + colW / 2) / W) * 100}%` }}>
            <strong>{MONTH_NAMES[hover]}</strong>
            <span>
              <i style={{ background: 'var(--series-1)' }} /> Ingresos {money(h.income.total)}
            </span>
            <span>
              <i style={{ background: 'var(--series-2)' }} /> Gastos {money(h.expenses)}
            </span>
            <span className="muted">Queda {money(h.result)}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
