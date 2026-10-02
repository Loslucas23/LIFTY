import { formatMoney, monthLabel, type Currency } from '@lifty/core';

export const money = (amount: number, currency: Currency = 'UYU') => formatMoney(amount, currency);

/** Monto compacto para gráficos: $ 12,3 mil */
export function compact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$ ${(abs / 1_000_000).toLocaleString('es-UY', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000) return `${sign}$ ${(abs / 1_000).toLocaleString('es-UY', { maximumFractionDigits: 1 })} mil`;
  return `${sign}$ ${Math.round(abs)}`;
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoy';
  const d = new Date(`${date}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 1) return 'Ayer';
  const name = DAY_NAMES[d.getDay()];
  const label = `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d.getDate()}`;
  return d.getFullYear() === t.getFullYear() ? label : `${label}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export { monthLabel };

/**
 * Interpreta montos como los escribe la gente: "1.234,50", "1234.5", "$ 900" y también
 * cuentas simples como en la planilla: "8000+5600" o "626+900-20".
 */
export function parseAmount(input: string): number | null {
  const clean = input.replace(/[$\sUSDuyu]/g, '');
  if (!clean) return null;
  const terms = clean.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  let total = 0;
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    let n = term.replace(/^[+-]/, '');
    if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');
    else if ((n.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(n)) n = n.replace(/\./g, '');
    if (!/^\d*\.?\d+$/.test(n)) return null;
    total += sign * Number(n);
  }
  return Math.round(total * 100) / 100;
}
