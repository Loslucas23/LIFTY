import { convert } from './accounts';
import { categoryRootFn, countsInBudget, goalBalances, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { challengeStatus } from './challenges';
import { fold, round2 } from './money';
import type { LiftyData, Transaction } from './schema';
import { addDays } from './weight';

/**
 * Tu año en Lifty: los números del año contados como una historia (cuánto entró, en qué se
 * fue, tu mejor mes, el gasto más grande, días sin gastar, rutinas, ánimo, peso, estudio…).
 * Todo sale de lo que cargaste; cada dato dice de dónde sale.
 */

export interface YearReview {
  year: number;
  /** Hasta qué día cuenta (hoy si es el año en curso). */
  until: string;
  income: number;
  expenses: number;
  saved: number;
  /** Ahorro ÷ ingresos (0 a 1). */
  savingsRate: number | null;
  /** Gasto del año pasado hasta la misma fecha, para comparar. */
  lastYearExpenses: number | null;
  topCategories: { categoryId: string | null; amount: number; share: number }[];
  bestMonth: { month: string; result: number } | null;
  priciestMonth: { month: string; expenses: number } | null;
  biggestExpense: { description: string; amount: number; date: string; categoryId: string | null } | null;
  /** Lo que más veces compraste (por descripción). */
  favorite: { description: string; times: number; total: number } | null;
  noSpendDays: number;
  /** Racha más larga de días seguidos sin gastar. */
  noSpendStreak: number;
  movements: number;
  habits: { checkIns: number; best: { name: string; icon: string; days: number } | null };
  mood: { average: number; days: number; bestMonth: string | null } | null;
  sleep: { average: number; days: number } | null;
  weight: { from: number; to: number; change: number } | null;
  studyHours: number;
  challengesWon: number;
  goalsDone: { name: string; icon: string }[];
}

const uyu = (t: Transaction, rate: number) =>
  convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);

export function yearReview(data: LiftyData, months: MonthBudget[], year: number, today: string): YearReview | null {
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const until = today < end ? today : end;
  if (until < from) return null;
  const inYear = months.filter((m) => m.month.startsWith(`${year}-`) && `${m.month}-01` <= until);
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  const root = categoryRootFn(data.categories);
  const income = round2(inYear.reduce((s, m) => s + m.income.total, 0));
  const expenses = round2(inYear.reduce((s, m) => s + m.expenses, 0));
  const saved = round2(inYear.reduce((s, m) => s + m.savings.total, 0));

  // Gastos del día a día del año (lo que cuenta para el presupuesto).
  const spend = data.transactions.filter(
    (t) => t.kind === 'expense' && !t.linkKind && countsInBudget(t, off) && t.date >= from && t.date <= until,
  );
  if (!spend.length && income === 0) return null;
  const lastYearFrom = `${year - 1}-01-01`;
  const lastYearUntil = `${year - 1}${until.slice(4)}`;
  const lastYear = data.transactions
    .filter(
      (t) => t.kind === 'expense' && !t.linkKind && countsInBudget(t, off) && t.date >= lastYearFrom && t.date <= lastYearUntil,
    )
    .reduce((s, t) => s + uyu(t, rate), 0);

  const byCat = new Map<string | null, number>();
  for (const m of inYear) for (const c of m.categories) byCat.set(c.categoryId, (byCat.get(c.categoryId) ?? 0) + c.spent);
  const catTotal = [...byCat.values()].reduce((s, v) => s + v, 0);
  const topCategories = [...byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([categoryId, amount]) => ({
      categoryId: root(categoryId),
      amount: round2(amount),
      share: catTotal ? round2(amount / catTotal) : 0,
    }));

  const closedMonths = inYear.filter((m) => `${m.month}-31` < until || m.closing);
  const bestMonth = closedMonths.length
    ? closedMonths.reduce((a, m) => (m.income.total - m.expenses > a.income.total - a.expenses ? m : a))
    : null;
  const priciest = inYear.length ? inYear.reduce((a, m) => (m.expenses > a.expenses ? m : a)) : null;

  const biggest = spend.reduce<Transaction | null>((a, t) => (!a || uyu(t, rate) > uyu(a, rate) ? t : a), null);
  const byDesc = new Map<string, { description: string; times: number; total: number }>();
  for (const t of spend) {
    const key = fold(t.description);
    if (key.length < 3) continue;
    const e = byDesc.get(key) ?? { description: t.description.trim(), times: 0, total: 0 };
    e.times++;
    e.total += uyu(t, rate);
    byDesc.set(key, e);
  }
  const favorite = [...byDesc.values()].sort((a, b) => b.times - a.times || b.total - a.total)[0];

  // Días sin gastar: desde el primer día con algo cargado en el año.
  const spentDays = new Set(spend.filter((t) => t.amount > 0).map((t) => t.date));
  const firstLogged = data.transactions
    .filter((t) => t.date >= from && t.date <= until)
    .map((t) => t.date)
    .sort()[0];
  let noSpendDays = 0;
  let streak = 0;
  let noSpendStreak = 0;
  if (firstLogged)
    for (let d = firstLogged; d < until; d = addDays(d, 1)) {
      if (spentDays.has(d)) streak = 0;
      else {
        noSpendDays++;
        noSpendStreak = Math.max(noSpendStreak, ++streak);
      }
    }

  // Rutinas: días cumplidos (alguna marca) y la rutina más constante.
  const logs = data.habitLogs.filter((l) => l.date >= from && l.date <= until && l.value > 0);
  const perHabit = new Map<string, Set<string>>();
  for (const l of logs) perHabit.set(l.habitId, (perHabit.get(l.habitId) ?? new Set()).add(l.date));
  const bestHabit = [...perHabit.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  const habit = bestHabit ? data.habits.find((h) => h.id === bestHabit[0]) : undefined;

  const journal = data.journal.filter((j) => j.date >= from && j.date <= until);
  const moods = journal.filter((j) => j.mood !== null);
  const moodByMonth = new Map<string, number[]>();
  for (const j of moods) moodByMonth.set(j.date.slice(0, 7), [...(moodByMonth.get(j.date.slice(0, 7)) ?? []), j.mood!]);
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const bestMoodMonth = [...moodByMonth.entries()].filter(([, v]) => v.length >= 5).sort((a, b) => avg(b[1]) - avg(a[1]))[0];
  const sleeps = journal.filter((j) => j.sleepHours !== null).map((j) => j.sleepHours!);

  const weights = data.weights.filter((w) => w.date >= from && w.date <= until).sort((a, b) => a.date.localeCompare(b.date));

  return {
    year,
    until,
    income,
    expenses,
    saved,
    savingsRate: income > 0 ? round2(saved / income) : null,
    lastYearExpenses: lastYear > 0 ? round2(lastYear) : null,
    topCategories,
    bestMonth: bestMonth ? { month: bestMonth.month, result: round2(bestMonth.income.total - bestMonth.expenses) } : null,
    priciestMonth: priciest && priciest.expenses > 0 ? { month: priciest.month, expenses: round2(priciest.expenses) } : null,
    biggestExpense: biggest
      ? {
          description: biggest.description,
          amount: round2(uyu(biggest, rate)),
          date: biggest.date,
          categoryId: root(biggest.categoryId),
        }
      : null,
    favorite: favorite && favorite.times >= 3 ? { ...favorite, total: round2(favorite.total) } : null,
    noSpendDays,
    noSpendStreak,
    movements: data.transactions.filter((t) => t.date >= from && t.date <= until).length,
    habits: {
      checkIns: logs.length,
      best: habit && bestHabit ? { name: habit.name, icon: habit.icon, days: bestHabit[1].size } : null,
    },
    mood:
      moods.length >= 5
        ? { average: round2(avg(moods.map((j) => j.mood!))), days: moods.length, bestMonth: bestMoodMonth?.[0] ?? null }
        : null,
    sleep: sleeps.length >= 5 ? { average: round2(avg(sleeps)), days: sleeps.length } : null,
    weight:
      weights.length >= 2
        ? {
            from: weights[0].kg,
            to: weights[weights.length - 1].kg,
            change: round2(weights[weights.length - 1].kg - weights[0].kg),
          }
        : null,
    studyHours: round2(
      data.studySessions.filter((s) => s.date >= from && s.date <= until).reduce((s, x) => s + x.minutes, 0) / 60,
    ),
    challengesWon: data.challenges.filter(
      (c) => c.to >= from && c.to <= until && challengeStatus(c, data, today).status === 'won',
    ).length,
    goalsDone: goalBalances(data)
      .filter((g) => g.goalId && g.target && g.balance >= g.target)
      .map((g) => {
        const goal = data.goals.find((x) => x.id === g.goalId);
        return { name: g.name, icon: goal?.icon ?? '🎯' };
      }),
  };
}
