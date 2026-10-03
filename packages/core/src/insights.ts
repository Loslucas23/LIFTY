import { convert } from './accounts';
import { countsInBudget, goalBalances, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { addMonths, daysInMonth, monthDiff, monthLabel, monthOf, occursIn } from './months';
import { round2 } from './money';
import { netSalary } from './salary';
import type { Goal, LiftyData, Transaction } from './schema';

/**
 * "Inteligencia" de Lifty: cuentas claras y reglas simples (sin IA). Cada resultado trae
 * los números con los que se calculó, para poder mostrar "¿de dónde sale?".
 */

// ---------------- Metas con fecha ----------------

export interface GoalPlan {
  goal: Goal;
  balance: number;
  target: number;
  /** Meses que quedan, contando el actual. */
  monthsLeft: number;
  /** Cuánto separar por mes para llegar (en la moneda de la meta). */
  perMonth: number;
  perMonthUYU: number;
  /** Lo que deberías tener a esta altura si ahorrás parejo. */
  expected: number;
  /** balance − expected (positivo = adelantado). */
  diff: number;
  status: 'done' | 'ahead' | 'on-track' | 'behind' | 'late';
}

export function goalPlans(data: LiftyData, today: string): GoalPlan[] {
  const current = monthOf(today);
  const rate = data.settings.usdRate;
  const balances = new Map(goalBalances(data).map((g) => [g.goalId, g.balance]));
  const out: GoalPlan[] = [];
  for (const goal of data.goals) {
    if (!goal.target || !goal.targetMonth || goal.archived) continue;
    const balance = balances.get(goal.id) ?? 0;
    const start = goal.startMonth ?? current;
    const monthsLeft = Math.max(1, monthDiff(current, goal.targetMonth) + 1);
    const total = Math.max(1, monthDiff(start, goal.targetMonth) + 1);
    const elapsed = Math.min(total, Math.max(0, monthDiff(start, current)));
    const expected = round2((goal.target * elapsed) / total);
    const missing = Math.max(0, goal.target - balance);
    const perMonth = round2(missing / monthsLeft);
    const diff = round2(balance - expected);
    const tolerance = goal.target * 0.02;
    const status: GoalPlan['status'] =
      missing <= 0
        ? 'done'
        : current > goal.targetMonth
          ? 'late'
          : diff > tolerance
            ? 'ahead'
            : diff < -tolerance
              ? 'behind'
              : 'on-track';
    out.push({
      goal,
      balance,
      target: goal.target,
      monthsLeft,
      perMonth,
      perMonthUYU: round2(convert(perMonth, goal.currency, 'UYU', rate)),
      expected,
      diff,
      status,
    });
  }
  return out;
}

// ---------------- Gastos que no son mensuales ----------------

export interface SinkingFund {
  id: string;
  name: string;
  amount: number;
  everyMonths: number;
  nextMonth: string;
  /** Lo que conviene apartar por mes para pagarlo sin sustos. */
  perMonth: number;
}

/** Gastos anuales / cada N meses: cuándo vienen y cuánto apartar por mes. */
export function sinkingFunds(data: LiftyData, month: string): SinkingFund[] {
  const rate = data.settings.usdRate;
  const out: SinkingFund[] = [];
  for (const f of data.fixed) {
    const every = f.everyMonths ?? 1;
    if (every <= 1 || (f.endMonth && f.endMonth < month)) continue;
    let next = f.startMonth > month ? f.startMonth : month;
    for (let i = 0; i < 24 && !occursIn(next, f.startMonth, f.endMonth, every); i++) next = addMonths(next, 1);
    if (!occursIn(next, f.startMonth, f.endMonth, every)) continue;
    const amount = convert(f.amount, f.currency, 'UYU', rate);
    out.push({
      id: f.id,
      name: f.name,
      amount: round2(amount),
      everyMonths: every,
      nextMonth: next,
      perMonth: round2(amount / every),
    });
  }
  return out.sort((a, b) => a.nextMonth.localeCompare(b.nextMonth));
}

// ---------------- Pronósticos y comparaciones ----------------

export interface Insight {
  id: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
  text: string;
  /** Cómo se calculó (para "¿de dónde sale?"). */
  detail: string;
  categoryId?: string | null;
}

/** Gastado (propio, en pesos) por categoría entre dos fechas inclusive: día a día y compras nuevas. */
function spendingByCategory(data: LiftyData, from: string, to: string): Map<string | null, number> {
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  const out = new Map<string | null, number>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off) || t.date < from || t.date > to) continue;
    const v = convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);
    out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + v);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Avisos del mes en curso: a este ritmo cómo terminás, en qué categoría te vas a pasar y
 * qué cambió respecto del mes pasado (comparando hasta el mismo día).
 */
export function monthInsights(data: LiftyData, b: MonthBudget, today: string): Insight[] {
  const out: Insight[] = [];
  const month = b.month;
  if (monthOf(today) !== month || !b.daily) return out;
  const day = b.daily.day;
  const dim = daysInMonth(month);
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const fmt = (v: number) => `$ ${Math.round(v).toLocaleString('es-UY')}`;

  // 1) A este ritmo…
  const d = b.daily;
  if (d.spentBefore + d.spentToday > 0) {
    out.push({
      id: 'pace',
      tone: d.forecastEnd >= 0 ? 'good' : 'bad',
      text:
        d.forecastEnd >= 0
          ? `A este ritmo terminás el mes con ${fmt(d.forecastEnd)} de margen.`
          : `A este ritmo te faltan ${fmt(-d.forecastEnd)} para llegar a fin de mes.`,
      detail: `Gastás en promedio ${fmt(d.pace)} por día (${fmt(d.spentBefore + d.spentToday)} en ${day} días). ${fmt(d.base)} disponibles − ${fmt(d.pace)} × ${dim} días = ${fmt(d.forecastEnd)}.`,
    });
  }

  // 2) Categorías con presupuesto: en qué día te pasás a este ritmo.
  for (const c of b.categories) {
    if (c.limit === null || !c.categoryId) continue;
    const name = names.get(c.categoryId) ?? 'una categoría';
    if (c.spent > c.limit) {
      out.push({
        id: `over-${c.categoryId}`,
        tone: 'bad',
        categoryId: c.categoryId,
        text: `Te pasaste ${fmt(c.spent - c.limit)} en ${name}.`,
        detail: `Gastaste ${fmt(c.spent)} y el presupuesto es ${fmt(c.limit)}.`,
      });
      continue;
    }
    if (c.spent <= 0) continue;
    const rate = c.spent / day;
    const hit = Math.ceil(c.limit / rate);
    if (hit <= dim) {
      out.push({
        id: `hit-${c.categoryId}`,
        tone: 'warn',
        categoryId: c.categoryId,
        text: `A este ritmo te pasás en ${name} el día ${hit}.`,
        detail: `Llevás ${fmt(c.spent)} en ${day} días (${fmt(rate)} por día). El presupuesto es ${fmt(c.limit)}: ${fmt(c.limit)} ÷ ${fmt(rate)} = día ${hit}.`,
      });
    }
  }

  // 3) Comparación con el mes pasado, hasta el mismo día.
  const prev = addMonths(month, -1);
  const prevDay = Math.min(day, daysInMonth(prev));
  const now = spendingByCategory(data, `${month}-01`, today);
  const before = spendingByCategory(data, `${prev}-01`, `${prev}-${pad(prevDay)}`);
  const changes: Insight[] = [];
  for (const [catId, v] of now) {
    const w = before.get(catId) ?? 0;
    if (w < 300 || !catId) continue;
    const pct = (v - w) / w;
    if (Math.abs(pct) >= 0.2 && Math.abs(v - w) >= 300) {
      const name = (names.get(catId) ?? 'esa categoría').toLowerCase();
      changes.push({
        id: `cmp-${catId}`,
        tone: pct > 0 ? 'warn' : 'good',
        categoryId: catId,
        text: `Gastaste ${Math.round(Math.abs(pct) * 100)}% ${pct > 0 ? 'más' : 'menos'} en ${name} que el mes pasado.`,
        detail: `Del 1 al ${day}: ${fmt(v)} este mes contra ${fmt(w)} en ${monthLabel(prev, false).toLowerCase()} (del 1 al ${prevDay}).`,
      });
    }
  }
  changes.sort((a, b) => Number(b.text.match(/\d+/)?.[0] ?? 0) - Number(a.text.match(/\d+/)?.[0] ?? 0));
  out.push(...changes.slice(0, 3));

  // 4) Meta de ahorro.
  if (b.savingsGoal.target > 0) {
    out.push(
      b.savingsGoal.pending > 0
        ? {
            id: 'savings',
            tone: 'info',
            text: `Te falta pasar ${fmt(b.savingsGoal.pending)} al ahorro para cumplir la meta del mes.`,
            detail: `Meta ${fmt(b.savingsGoal.target)} − ahorrado ${fmt(b.savingsGoal.saved)}. Ya está apartado: no cuenta en lo que podés gastar.`,
          }
        : {
            id: 'savings',
            tone: 'good',
            text: `¡Cumpliste la meta de ahorro del mes (${fmt(b.savingsGoal.target)})!`,
            detail: `Ahorraste ${fmt(b.savingsGoal.saved)} este mes.`,
          },
    );
  }
  return out;
}

// ---------------- Lo que viene ----------------

export interface UpcomingEvent {
  date: string;
  kind: 'fixed' | 'income' | 'load' | 'goal';
  name: string;
  amount: number;
  refId: string;
  overdue: boolean;
}

function dayIn(month: string, day: number): string {
  return `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
}

/** Vencimientos, cobros y cargas de los próximos `days` días (y lo vencido sin pagar del mes). */
export function upcomingEvents(data: LiftyData, budget: MonthBudget, today: string, days = 7): UpcomingEvent[] {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const months = [monthOf(today), monthOf(end)].filter((m, i, a) => a.indexOf(m) === i);
  const rate = data.settings.usdRate;
  const out: UpcomingEvent[] = [];
  const confirmed = new Set(budget.fixed.items.filter((l) => l.confirmed).map((l) => l.refId));
  const received = new Set(budget.income.planned.filter((l) => l.confirmed).map((l) => l.refId));
  for (const m of months) {
    for (const f of data.fixed) {
      if (!f.dayOfMonth || !occursIn(m, f.startMonth, f.endMonth, f.everyMonths ?? 1)) continue;
      if (m === budget.month && confirmed.has(f.id)) continue;
      const date = dayIn(m, f.dayOfMonth);
      const overdue = date < today && m === monthOf(today);
      if (date > end || (date < today && !overdue)) continue;
      out.push({
        date,
        kind: 'fixed',
        name: f.name,
        amount: round2(convert(f.amount, f.currency, 'UYU', rate)),
        refId: f.id,
        overdue,
      });
    }
    for (const i of data.incomes) {
      if (!i.payDay || !occursIn(m, i.startMonth, i.endMonth, i.everyMonths ?? 1)) continue;
      if (m === budget.month && received.has(i.id)) continue;
      const date = dayIn(m, i.payDay);
      if (date < today || date > end) continue;
      out.push({
        date,
        kind: 'income',
        name: i.name,
        amount: round2(convert(netSalary(i), i.currency, 'UYU', rate)),
        refId: i.id,
        overdue: false,
      });
    }
    for (const a of data.accounts) {
      if (a.type !== 'food' || !a.monthlyLoad || !a.loadDay || a.archived) continue;
      const loaded = data.transactions.some((t) => t.linkKind === 'load' && t.linkId === a.id && t.linkMonth === m);
      const date = dayIn(m, a.loadDay);
      if (loaded || date < today || date > end) continue;
      out.push({ date, kind: 'load', name: `Carga ${a.name}`, amount: a.monthlyLoad, refId: a.id, overdue: false });
    }
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date));
}

// ---------------- Informes ----------------

export interface MonthReport {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  /** % de los ingresos que se ahorró. */
  savingsRate: number | null;
}

export function monthReports(months: MonthBudget[]): MonthReport[] {
  return months.map((m) => ({
    month: m.month,
    income: m.income.total,
    expenses: m.expenses,
    savings: m.savings.total,
    savingsRate: m.income.total > 0 ? round2((m.savings.total / m.income.total) * 100) : null,
  }));
}

/** Gasto por categoría en cada mes (solo día a día y tarjeta; los fijos van aparte). */
export function categorySeries(months: MonthBudget[]): { categoryId: string | null; values: number[]; total: number }[] {
  const ids = new Set<string | null>();
  for (const m of months) for (const c of m.categories) if (c.spent > 0) ids.add(c.categoryId);
  return [...ids]
    .map((categoryId) => {
      const values = months.map((m) => m.categories.find((c) => c.categoryId === categoryId)?.spent ?? 0);
      return { categoryId, values, total: round2(values.reduce((s, v) => s + v, 0)) };
    })
    .sort((a, b) => b.total - a.total);
}

/** Los gastos más grandes de un mes (sin fijos). */
export function topExpenses(data: LiftyData, month: string, count = 5): Transaction[] {
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  return data.transactions
    .filter((t) => t.kind === 'expense' && !t.linkKind && countsInBudget(t, off) && monthOf(t.date) === month && t.amount > 0)
    .sort((a, b) => convert(ownAmount(b), b.currency, 'UYU', rate) - convert(ownAmount(a), a.currency, 'UYU', rate))
    .slice(0, count);
}

/** Gasto promedio por día de la semana en los últimos `days` días (lunes primero). */
export function spendingByWeekday(data: LiftyData, today: string, days = 90): { label: string; average: number }[] {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off) || t.date < from || t.date > today) continue;
    const dow = (new Date(`${t.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    totals[dow] += convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);
  }
  const weeks = days / 7;
  return ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((label, i) => ({
    label,
    average: round2(totals[i] / weeks),
  }));
}

/** Lo que sobró en un mes (ingresos − gastos − ahorro, sin contar lo que venía de antes). */
export function monthSurplus(b: MonthBudget): number {
  return round2(b.result - b.carryover.amount);
}
