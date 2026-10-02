import { addMonths, isActiveIn, makeMonth, monthRange, parseMonth } from './months';
import { round2 } from './money';
import type { Deduction, IncomeSource } from './schema';

/**
 * Descuentos típicos de un sueldo en Uruguay (los mismos que usaba la planilla).
 * Son una plantilla editable: las tasas reales dependen de cada caso (FONASA,
 * hijos, IRPF, etc.), por eso cada sueldo guarda los suyos.
 */
export const URUGUAY_DEDUCTIONS: Deduction[] = [
  { label: 'Aporte jubilatorio', percent: 15, extraBase: 0, fixed: 0 },
  { label: 'Seguro por enfermedad (FONASA)', percent: 3, extraBase: 0, fixed: 0 },
  { label: 'FRL', percent: 0.1, extraBase: 0, fixed: 0 },
  { label: 'Adicional SNIS', percent: 1.5, extraBase: 0, fixed: 0 },
  { label: 'IRPF', percent: 0, extraBase: 0, fixed: 0 },
];

export function deductionAmount(gross: number, d: Deduction): number {
  return round2(((gross + (d.extraBase ?? 0)) * (d.percent ?? 0)) / 100 + (d.fixed ?? 0));
}

export interface NetBreakdown {
  gross: number;
  lines: { label: string; amount: number }[];
  totalDeductions: number;
  net: number;
  overridden: boolean;
}

export function netBreakdown(src: Pick<IncomeSource, 'gross' | 'deductions' | 'netOverride'>): NetBreakdown {
  const lines = src.deductions.map((d) => ({ label: d.label, amount: deductionAmount(src.gross, d) }));
  const totalDeductions = round2(lines.reduce((s, l) => s + l.amount, 0));
  const computed = round2(src.gross - totalDeductions);
  const overridden = src.netOverride !== null && src.netOverride !== undefined;
  return { gross: src.gross, lines, totalDeductions, net: overridden ? (src.netOverride as number) : computed, overridden };
}

export function netSalary(src: Pick<IncomeSource, 'gross' | 'deductions' | 'netOverride'>): number {
  return netBreakdown(src).net;
}

export interface AguinaldoPayment {
  /** Mes en que se cobra. */
  month: string;
  /** Meses del semestre que se están pagando. */
  from: string;
  to: string;
  /** Monto en la moneda del sueldo. */
  amount: number;
  /** true si es la parte proporcional al terminar el trabajo (liquidación). */
  settlement: boolean;
}

/**
 * Semestres del aguinaldo en Uruguay:
 *  - diciembre → mayo se cobra en junio
 *  - junio → noviembre se cobra en diciembre
 */
export function aguinaldoSemesterOf(month: string): { start: string; end: string; payMonth: string } {
  const { year, month: m } = parseMonth(month);
  if (m === 12) return { start: month, end: makeMonth(year + 1, 5), payMonth: makeMonth(year + 1, 6) };
  if (m <= 5) return { start: makeMonth(year - 1, 12), end: makeMonth(year, 5), payMonth: makeMonth(year, 6) };
  return { start: makeMonth(year, 6), end: makeMonth(year, 11), payMonth: makeMonth(year, 12) };
}

/**
 * Aguinaldo estimado que cobra `src` en `month`: la doceava parte de lo cobrado en el
 * semestre. Si el trabajo termina antes del mes de cobro, la parte proporcional se
 * cobra con la liquidación, en el mes en que termina.
 */
export function aguinaldoFor(src: IncomeSource, month: string): AguinaldoPayment | null {
  if (!src.aguinaldo) return null;
  const net = netSalary(src);
  const sumActive = (from: string, to: string) =>
    monthRange(from, to).filter((m) => isActiveIn(m, src.startMonth, src.endMonth)).length * net;

  const { month: m } = parseMonth(month);
  const payments: AguinaldoPayment[] = [];

  if (m === 6 || m === 12) {
    const end = addMonths(month, -1);
    const start = addMonths(month, -6);
    const endedInside = src.endMonth !== null && src.endMonth >= start && src.endMonth <= end;
    const total = sumActive(start, end);
    if (!endedInside && total > 0) {
      payments.push({ month, from: start, to: end, amount: round2(total / 12), settlement: false });
    }
  }

  if (src.endMonth === month) {
    const sem = aguinaldoSemesterOf(month);
    const total = sumActive(sem.start, month);
    if (total > 0) payments.push({ month, from: sem.start, to: month, amount: round2(total / 12), settlement: true });
  }

  if (payments.length === 0) return null;
  if (payments.length === 1) return payments[0];
  // Termina justo en junio o diciembre: se cobra el semestre anterior + la parte nueva.
  return {
    month,
    from: payments[0].from,
    to: payments[payments.length - 1].to,
    amount: round2(payments.reduce((s, p) => s + p.amount, 0)),
    settlement: true,
  };
}
