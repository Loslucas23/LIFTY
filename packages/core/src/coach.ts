import { convert } from './accounts';
import { effectiveBudget, type MonthBudget } from './budget';
import { cardAutoPayments } from './card';
import { isDue } from './habits';
import { goalPlans, upcomingEvents } from './insights';
import { daysInMonth, monthDiff, monthOf } from './months';
import { formatNumber, round2 } from './money';
import type { Goal, LiftyData } from './schema';
import { median } from './smart';
import { stockOverview } from './stock';
import { subjectStatus } from './study';
import { addDays } from './weight';

/**
 * El "coach" de Lifty: arma propuestas a partir de tus números (plan del mes, cuánto separar
 * para cada meta, qué viene en la semana) y avisa antes de que pase. Cuentas simples, sin IA.
 */

const round100 = (v: number) => Math.round(v / 100) * 100;

// ---------------- Plan del mes con un toque ----------------

export interface PlanLine {
  categoryId: string;
  /** Lo que se propone para el mes. */
  suggested: number;
  /** El presupuesto que tiene hoy (si tiene). */
  current: number | null;
  /** Lo gastado en cada uno de los últimos meses (del más viejo al más nuevo). */
  history: number[];
}

export interface PlanProposal {
  month: string;
  income: number;
  fixed: number;
  /** Cuotas de compras anteriores que caen este mes. */
  committed: number;
  savings: number;
  lines: PlanLine[];
  assigned: number;
  /** Lo que queda sin asignar (negativo = no alcanza). */
  free: number;
  /** true si hubo que achicar todo para que entre. */
  scaled: boolean;
}

/**
 * Propone el presupuesto de cada categoría: lo que gastás normalmente (la mediana de los
 * últimos 3 meses, redondeada a 100). Si con eso no alcanza (ingresos − fijos − cuotas − ahorro),
 * achica todo en la misma proporción.
 */
export function monthPlanProposal(data: LiftyData, past: MonthBudget[], current: MonthBudget): PlanProposal | null {
  const month = current.month;
  const lastThree = past.slice(-3);
  if (!lastThree.length) return null;
  const lines: PlanLine[] = [];
  for (const c of data.categories) {
    if (c.archived || c.kind !== 'expense' || c.parentId) continue;
    const history = lastThree.map((b) => round2(b.categories.find((x) => x.categoryId === c.id)?.spent ?? 0));
    if (history.filter((v) => v > 0).length < 2) continue;
    const suggested = round100(median(history));
    if (suggested <= 0) continue;
    lines.push({ categoryId: c.id, suggested, current: effectiveBudget(data, month, c.id).amount, history });
  }
  if (!lines.length) return null;
  const income = round2(current.income.total);
  const fixed = round2(current.fixed.total);
  const committed = round2(current.card.items.filter((l) => monthOf(l.date) < month).reduce((s, l) => s + l.amount, 0));
  const savings = round2(current.savingsGoal.target);
  const room = income - fixed - committed - savings;
  let assigned = lines.reduce((s, l) => s + l.suggested, 0);
  let scaled = false;
  if (room > 0 && assigned > room) {
    const k = room / assigned;
    for (const l of lines) l.suggested = Math.max(100, Math.floor((l.suggested * k) / 100) * 100);
    assigned = lines.reduce((s, l) => s + l.suggested, 0);
    scaled = true;
  }
  lines.sort((a, b) => b.suggested - a.suggested);
  return { month, income, fixed, committed, savings, lines, assigned: round2(assigned), free: round2(room - assigned), scaled };
}

// ---------------- Avisos de ritmo por categoría ----------------

export interface PaceAlert {
  categoryId: string;
  spent: number;
  /** Lo que gastás normalmente en todo el mes (mediana de los últimos 3). */
  usual: number;
  /** A este ritmo, lo que gastarías en el mes. */
  projected: number;
  /** Qué tan más rápido que de costumbre (0,45 = 45% más). */
  faster: number;
  day: number;
}

/**
 * Categorías sin presupuesto en las que vas bastante más rápido que de costumbre: a esta altura
 * del mes ya gastaste 30% más de lo normal y, a este ritmo, terminarías 20% arriba. (Las que
 * tienen presupuesto ya avisan cuándo te pasás.)
 */
export function paceAlerts(data: LiftyData, past: MonthBudget[], current: MonthBudget, today: string): PaceAlert[] {
  if (monthOf(today) !== current.month) return [];
  const day = Number(today.slice(8));
  if (day < 5) return [];
  const frac = day / daysInMonth(current.month);
  const out: PaceAlert[] = [];
  for (const c of current.categories) {
    if (!c.categoryId || c.limit !== null || c.spent < 500) continue;
    const history = past.slice(-3).map((b) => b.categories.find((x) => x.categoryId === c.categoryId)?.spent ?? 0);
    if (history.filter((v) => v > 0).length < 2) continue;
    const usual = median(history);
    if (usual <= 0) continue;
    const projected = c.spent / frac;
    if (c.spent > usual * frac * 1.3 && projected > usual * 1.2)
      out.push({
        categoryId: c.categoryId,
        spent: round2(c.spent),
        usual: round2(usual),
        projected: round2(projected),
        faster: round2(projected / usual - 1),
        day,
      });
  }
  return out.sort((a, b) => b.projected - b.usual - (a.projected - a.usual));
}

// ---------------- Metas que se ajustan solas ----------------

export interface GoalMonth {
  goal: Goal;
  /** Lo que había que separar por mes cuando empezó (target ÷ meses). */
  original: number;
  /** Lo que hay que separar por mes desde este mes (con lo que tenías al empezar el mes). */
  perMonth: number;
  /** Lo que ya pusiste este mes y lo que falta. */
  savedThisMonth: number;
  pendingThisMonth: number;
  /** El plan se ajustó: ahora es bastante más (o menos) que al principio. */
  adjusted: 'up' | 'down' | null;
  monthsLeft: number;
}

/**
 * Para cada meta con fecha: cuánto separar este mes para llegar igual a la fecha. Si algún mes
 * pusiste menos, el resto se reparte en los meses que quedan (y si pusiste más, baja).
 */
export function goalMonths(data: LiftyData, today: string): GoalMonth[] {
  const month = monthOf(today);
  const rate = data.settings.usdRate;
  const out: GoalMonth[] = [];
  for (const p of goalPlans(data, today)) {
    if (p.status === 'done' || p.status === 'late') continue;
    const g = p.goal;
    const savedThisMonth = round2(
      data.transactions
        .filter((t) => t.kind === 'saving' && t.goalId === g.id && monthOf(t.date) === month)
        .reduce(
          (s, t) => s + convert(t.amount, t.currency, g.currency, t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate),
          0,
        ),
    );
    const startBalance = p.balance - savedThisMonth;
    const perMonth = round2(Math.max(0, (p.target - startBalance) / p.monthsLeft));
    const start = g.startMonth ?? month;
    const total = Math.max(1, monthDiff(start, g.targetMonth!) + 1);
    const original = round2(p.target / total);
    const adjusted = perMonth > original * 1.1 ? 'up' : perMonth < original * 0.9 && start < month ? 'down' : null;
    out.push({
      goal: g,
      original,
      perMonth,
      savedThisMonth,
      pendingThisMonth: round2(Math.max(0, perMonth - savedThisMonth)),
      adjusted,
      monthsLeft: p.monthsLeft,
    });
  }
  return out;
}

// ---------------- Semana planificada ----------------

export interface WeekItem {
  icon: string;
  text: string;
  /** + entra, − sale (pesos). */
  amount?: number;
  kind: 'pay' | 'income' | 'reminder' | 'exam' | 'card';
}

export interface WeekDay {
  date: string;
  items: WeekItem[];
  habits: number;
}

export interface WeekPlan {
  from: string;
  to: string;
  days: WeekDay[];
  payments: number;
  incomes: number;
  /** Lo que podés gastar por día en el día a día (del presupuesto) y en la semana. */
  perDay: number | null;
  weekBudget: number | null;
  shopping: { items: number; cost: number };
  /** Estudio que hace falta por día para los exámenes que vienen (minutos). */
  studyPerDay: number;
}

/** Los próximos 7 días: qué pagás, qué cobrás, qué vence, exámenes, rutinas y lo que podés gastar. */
export function weekPlan(data: LiftyData, b: MonthBudget, today: string): WeekPlan {
  const to = addDays(today, 6);
  const days: WeekDay[] = [];
  for (let d = today; d <= to; d = addDays(d, 1))
    days.push({ date: d, items: [], habits: data.habits.filter((h) => !h.archived && isDue(h, d)).length });
  const at = (date: string) => days.find((x) => x.date === date) ?? days[0];
  let payments = 0;
  let incomes = 0;
  for (const e of upcomingEvents(data, b, today, 6)) {
    if (e.kind === 'fixed') {
      at(e.overdue ? today : e.date).items.push({
        icon: '📅',
        text: `${e.name}${e.overdue ? ' (vencido)' : ''}`,
        amount: -e.amount,
        kind: 'pay',
      });
      payments += e.amount;
    } else if (e.kind === 'income') {
      at(e.date).items.push({ icon: '💼', text: e.name, amount: e.amount, kind: 'income' });
      incomes += e.amount;
    }
  }
  const rate = data.settings.usdRate;
  for (const p of cardAutoPayments(data, to)) {
    if (p.date < today) continue;
    const amount = round2(convert(p.amount, p.currency, 'UYU', p.currency === 'USD' ? p.fxRate || rate : 1));
    at(p.date).items.push({ icon: '💳', text: p.description, amount: -amount, kind: 'card' });
    payments += amount;
  }
  for (const r of data.reminders)
    if (!r.archived && r.date >= today && r.date <= to)
      at(r.date).items.push({ icon: r.icon, text: `Vence: ${r.name}`, kind: 'reminder' });
  let studyPerDay = 0;
  for (const s of data.subjects.filter((x) => !x.archived)) {
    if (s.examDate && s.examDate >= today && s.examDate <= to)
      at(s.examDate).items.push({ icon: s.icon, text: `Examen: ${s.name}`, kind: 'exam' });
    const st = subjectStatus(s, data.studySessions, today);
    if (st.neededPerDay && st.status !== 'past' && st.status !== 'done') studyPerDay += st.neededPerDay;
  }
  const d = b.daily;
  const inMonth = days.filter((x) => monthOf(x.date) === b.month).length;
  const overview = data.stockItems.length ? stockOverview(data.stockItems, data.stockMoves, today, data.settings) : null;
  const listed = data.shopEntries.filter((e) => !e.checked).length;
  return {
    from: today,
    to,
    days,
    payments: round2(payments),
    incomes: round2(incomes),
    perDay: d ? d.perDay : null,
    weekBudget: d ? round2(d.perDay * inMonth) : null,
    shopping: { items: Math.max(listed, overview?.shopping.length ?? 0), cost: overview?.shoppingCost ?? 0 },
    studyPerDay,
  };
}

// ---------------- ¿Cuántas horas de trabajo es? ----------------

/** Horas de trabajo por mes: las horas por semana (Ajustes; 40 si no) × 52 semanas ÷ 12 meses. */
export const workHoursPerMonth = (weeklyHours?: number | null) => ((weeklyHours || 40) * 52) / 12;

/** Lo que ganás por hora (sueldo líquido del mes ÷ horas por mes), o null si no hay sueldo cargado. */
export function hourlyWage(b: MonthBudget, weeklyHours?: number | null): number | null {
  const salary = b.income.planned.filter((l) => l.kind === 'salary').reduce((s, l) => s + l.planned, 0);
  return salary > 0 ? round2(salary / workHoursPerMonth(weeklyHours)) : null;
}

/** "Esto son 2,5 h de tu trabajo" (o días, si es mucho). */
export function workTime(amountUYU: number, b: MonthBudget, weeklyHours?: number | null): string | null {
  const w = hourlyWage(b, weeklyHours);
  if (!w || amountUYU <= 0) return null;
  const hours = amountUYU / w;
  if (hours < 0.5) return `${Math.max(1, Math.round(hours * 60))} min de tu trabajo`;
  if (hours < 16) return `${formatNumber(hours, 1, 0)} h de tu trabajo`;
  const days = hours / 8;
  return `${formatNumber(days, 1, 0)} días de tu trabajo`;
}
