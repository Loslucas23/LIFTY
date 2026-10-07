import { useState } from 'react';
import { compact } from '../lib/format';
import { useWidth } from './useWidth';

export function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Barra con la punta redondeada (4px) y la base recta sobre el eje. */
export function Bar({ x, w, y0, y1, fill }: { x: number; w: number; y0: number; y1: number; fill: string }) {
  const h = y0 - y1;
  if (h <= 0.5) return null;
  const r = Math.min(4, h, w / 2);
  const d = `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  return <path d={d} fill={fill} />;
}

/** Línea con área suave, ejes con montos compactos y tooltip al pasar o tocar. */
export function LineChart({
  points,
  label,
  format,
  tooltip,
}: {
  points: { label: string; value: number }[];
  label: string;
  format: (v: number) => string;
  tooltip?: (i: number) => React.ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useWidth<HTMLDivElement>();
  const H = W < 520 ? 190 : 230;
  const pad = { top: 14, right: 12, bottom: 26, left: W < 520 ? 52 : 60 };
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const step = niceStep((hi - lo) / 4);
  const bottom = Math.floor(lo / step) * step;
  const top = Math.ceil(hi / step) * step;
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - (v - bottom) / (top - bottom || 1));
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => pad.left + ((W - pad.left - pad.right) * i) / n;
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${y(Math.max(bottom, 0))} L${x(0)},${y(Math.max(bottom, 0))} Z`;
  const every = W < 520 ? Math.ceil(points.length / 6) : 1;
  return (
    <div className="chart-box" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'grid grid-zero' : 'grid'} />
            <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
              {compact(t)}
            </text>
          </g>
        ))}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {points.map((p, i) => (
          <g key={p.label + i}>
            {(i % every === 0 || i === points.length - 1) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">
                {p.label}
              </text>
            )}
            {hover === i && <line x1={x(i)} x2={x(i)} y1={pad.top} y2={H - pad.bottom} className="crosshair" />}
            {(hover === i || i === points.length - 1) && <circle cx={x(i)} cy={y(p.value)} r={4} className="dot" />}
            <rect
              x={x(i) - (W - pad.left - pad.right) / n / 2}
              y={0}
              width={(W - pad.left - pad.right) / n}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{points[hover].label}</strong>
          {tooltip ? tooltip(hover) : <span>{format(points[hover].value)}</span>}
        </div>
      )}
    </div>
  );
}
