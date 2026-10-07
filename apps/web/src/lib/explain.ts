import type { DailyAllowance, MonthBudget } from '@lifty/core';
import { openExplain } from '../components/Editors';
import { money } from './format';

/** "¿De dónde sale?" del gasto diario: la fórmula con los números de hoy. */
export function explainDaily(b: MonthBudget) {
  const d = b.daily as DailyAllowance;
  openExplain({
    title: '¿Cuánto podés gastar hoy?',
    intro:
      'Lo que entra en el mes, menos lo que ya está comprometido (fijos, cuotas de compras anteriores y tu meta de ahorro), menos lo que ya gastaste, repartido en los días que quedan. Se recalcula todos los días.',
    rows: [
      { label: 'Ingresos del mes', value: d.income, op: '+' },
      { label: 'Gastos fijos', value: d.fixed, op: '−' },
      { label: 'Cuotas de compras anteriores', value: d.committedCard, op: '−' },
      {
        label: 'Ahorro (se aparta primero)',
        value: d.savings,
        op: '−',
        note: b.savingsGoal.target > 0 ? `meta ${money(b.savingsGoal.target)}` : 'lo que ahorraste',
      },
      { label: 'Ya gastado antes de hoy', value: d.spentBefore, op: '−' },
      { label: `Días que quedan (con hoy)`, value: d.daysLeft, op: '÷', raw: String(d.daysLeft) },
      { label: 'Por día', value: d.perDay, op: '=' },
      { label: 'Gastado hoy', value: d.spentToday, op: '−' },
    ],
    result: { label: d.todayLeft < 0 ? 'Hoy te pasaste' : 'Hoy te queda', value: Math.abs(d.todayLeft) },
    footnote: `Esta semana (${d.weekDays} día${d.weekDays > 1 ? 's' : ''} contando hoy): ${money(d.perDay)} × ${d.weekDays} − lo de hoy = ${money(d.weekLeft)}. Si hoy gastás menos, mañana tenés más; si gastás más, baja. Lo que viene del mes anterior no entra: queda como colchón.`,
  });
}
