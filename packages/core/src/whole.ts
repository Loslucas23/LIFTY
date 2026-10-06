import { accountBalances, convert } from './accounts';
import { categoryRootFn, countsInBudget, offBudgetAccounts, type MonthBudget } from './budget';
import { cardAutoPayments } from './card';
import { habitDay, habitsToday, isDue } from './habits';
import { noSpendDays, topExpenses } from './insights';
import { addMonths, daysInMonth, monthLabel, monthOf } from './months';
import { round2 } from './money';
import type { LiftyData, Transaction } from './schema';
import { weekdayForecast } from './smart';
import { addDays, dailyWeights } from './weight';

/**
 * Lifty como un todo: la plata, cómo dormís, cómo te sentís y lo que hacés se cruzan. Todo con
 * promedios simples y explicables (cada número dice con cuántos días se calculó).
 */

const pad = (n: number) => String(n).padStart(2, '0');
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// ---------------- Qué te cambia el ánimo ----------------

export interface MoodFactor {
  key: string;
  /** "Los días que cumplís «Gimnasio»", "Los días que dormís 7 h o más"… */
  label: string;
  /** Ánimo promedio (1 a 5) los días que sí y los días que no. */
  with: number;
  without: number;
  withDays: number;
  withoutDays: number;
  /** with − without (en puntos de ánimo). */
  diff: number;
}

/**
 * Compara tu ánimo (del diario) los días que pasa algo contra los días que no: cada rutina,
 * dormir 7 h o más, no gastar, gastar en cada categoría, estudiar. Hacen falta al menos 3 días
 * de cada lado y una diferencia de 0,3 puntos o más. Es una pista, no causa y efecto.
 */
export function moodFactors(data: LiftyData, today: string, days = 60): MoodFactor[] {
  const from = addDays(today, -days + 1);
  const entries = data.journal.filter((j) => j.date >= from && j.date <= today && j.mood !== null);
  if (entries.length < 6) return [];
  const off = offBudgetAccounts(data);
  const root = categoryRootFn(data.categories);
  const spentBy = new Map<string, Map<string | null, number>>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off) || t.date < from || t.date > today) continue;
    const m = spentBy.get(t.date) ?? new Map<string | null, number>();
    m.set(root(t.categoryId), (m.get(root(t.categoryId)) ?? 0) + 1);
    spentBy.set(t.date, m);
  }
  const studyBy = new Map<string, number>();
  for (const s of data.studySessions) studyBy.set(s.date, (studyBy.get(s.date) ?? 0) + s.minutes);
  const logs = new Map(data.habitLogs.map((l) => [l.id, l.value]));
  const cats = new Map(data.categories.map((c) => [c.id, c.name]));

  const candidates: { key: string; label: string; test: (date: string, sleep: number | null) => boolean | null }[] = [
    { key: 'sleep', label: 'Los días que dormís 7 h o más', test: (_d, sleep) => (sleep === null ? null : sleep >= 7) },
    { key: 'no-spend', label: 'Los días que no gastás', test: (d) => !spentBy.has(d) },
  ];
  if (data.studySessions.length)
    candidates.push({ key: 'study', label: 'Los días que estudiás', test: (d) => (studyBy.get(d) ?? 0) >= 30 });
  for (const h of data.habits.filter((x) => !x.archived))
    candidates.push({
      key: `habit:${h.id}`,
      label: `Los días que cumplís «${h.name}»`,
      test: (d) => (isDue(h, d) ? (logs.get(`${h.id}:${d}`) ?? 0) >= h.target : null),
    });
  // Las categorías en las que gastás más seguido.
  const freq = new Map<string, number>();
  for (const m of spentBy.values()) for (const c of m.keys()) if (c) freq.set(c, (freq.get(c) ?? 0) + 1);
  for (const [c] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5))
    candidates.push({
      key: `cat:${c}`,
      label: `Los días que gastás en ${(cats.get(c) ?? 'otra cosa').toLowerCase()}`,
      test: (d) => !!spentBy.get(d)?.has(c),
    });

  const out: MoodFactor[] = [];
  for (const f of candidates) {
    const yes: number[] = [];
    const no: number[] = [];
    for (const j of entries) {
      const r = f.test(j.date, j.sleepHours);
      if (r === null) continue;
      (r ? yes : no).push(j.mood!);
    }
    if (yes.length < 3 || no.length < 3) continue;
    const w = avg(yes)!;
    const wo = avg(no)!;
    if (Math.abs(w - wo) < 0.3) continue;
    out.push({
      key: f.key,
      label: f.label,
      with: round2(w),
      without: round2(wo),
      withDays: yes.length,
      withoutDays: no.length,
      diff: round2(w - wo),
    });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 6);
}

// ---------------- ¿Llego a fin de mes? ----------------

export interface CashFlowEvent {
  label: string;
  /** En pesos: + entra, − sale. */
  amount: number;
}

export interface CashFlowDay {
  date: string;
  /** Lo que tendrías en bancos y efectivo al terminar el día. */
  balance: number;
  events: CashFlowEvent[];
  spending: number;
}

export interface CashFlow {
  start: number;
  days: CashFlowDay[];
  lowest: { date: string; balance: number };
  end: number;
  /** Gasto del día a día que se supone por día (promedio). */
  typicalPerDay: number;
}

/**
 * Proyecta día por día lo que vas a tener en bancos y efectivo hasta fin de mes: lo de hoy, más
 * lo que falta cobrar (el día que se cobra), menos los fijos que faltan (el día que vencen), los
 * débitos de la tarjeta y tu gasto típico de cada día de la semana. Así ves tu punto más bajo.
 */
export function cashFlow(data: LiftyData, b: MonthBudget, today: string): CashFlow | null {
  const d = b.daily;
  if (!d || monthOf(today) !== b.month) return null;
  const rate = data.settings.usdRate;
  const spendable = new Set(
    data.accounts.filter((a) => (a.type === 'bank' || a.type === 'cash') && !a.reserved && !a.archived).map((a) => a.id),
  );
  const start = round2(
    accountBalances(data, today)
      .filter((x) => spendable.has(x.account.id))
      .reduce((s, x) => s + x.balanceUYU, 0),
  );
  const end = `${b.month}-${pad(daysInMonth(b.month))}`;
  const dayOf = (day: number | null, fallback: string) => {
    if (!day) return fallback;
    const date = `${b.month}-${pad(Math.min(day, daysInMonth(b.month)))}`;
    return date < today ? today : date;
  };
  const events = new Map<string, CashFlowEvent[]>();
  const push = (date: string, e: CashFlowEvent) => events.set(date, [...(events.get(date) ?? []), e]);
  // Lo que falta cobrar entra el día de cobro (sin día: a fin de mes, para no contar con plata antes).
  for (const l of b.income.planned)
    if (!l.confirmed && l.planned > 0) push(dayOf(l.day, end), { label: l.name, amount: l.planned });
  // Los fijos que faltan salen el día que vencen (sin día o vencidos: hoy).
  for (const l of b.fixed.items)
    if (!l.confirmed && l.planned > 0) push(dayOf(l.day, today), { label: l.name, amount: -l.planned });
  // Débitos de la tarjeta que vienen este mes.
  for (const p of cardAutoPayments(data, end)) {
    if (p.date <= today || !p.accountId || !spendable.has(p.accountId)) continue;
    push(p.date, {
      label: p.description,
      amount: -round2(convert(p.amount, p.currency, 'UYU', p.currency === 'USD' ? p.fxRate || rate : 1)),
    });
  }
  // Gasto del día a día: lo típico de cada día de la semana (o el ritmo del mes si no hay historia).
  const smart = weekdayForecast(data, b, today);
  const typical = new Map(smart?.rest.map((r) => [r.weekday, r.typical]) ?? []);
  const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const spendOn = (date: string) => {
    const w = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
    return smart ? (typical.get(w) ?? 0) : d.pace;
  };
  const days: CashFlowDay[] = [];
  let balance = start;
  let total = 0;
  for (let x = today; x <= end; x = addDays(x, 1)) {
    // Hoy: lo que ya gastaste ya está en las cuentas; solo lo que faltaría gastar.
    const spending = round2(x === today ? Math.max(0, spendOn(x) - d.spentToday) : spendOn(x));
    const evs = events.get(x) ?? [];
    balance = round2(balance + evs.reduce((s, e) => s + e.amount, 0) - spending);
    total += spending;
    days.push({ date: x, balance, events: evs, spending });
  }
  const lowest = days.reduce((m, x) => (x.balance < m.balance ? { date: x.date, balance: x.balance } : m), {
    date: today,
    balance: days[0]?.balance ?? start,
  });
  return { start, days, lowest, end: balance, typicalPerDay: round2(total / Math.max(1, days.length)) };
}

// ---------------- Resumen del mes ----------------

export interface ReviewHighlight {
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
}

export interface MonthReview {
  month: string;
  /** Días que cuenta (el mes entero, o hasta hoy si es el mes en curso). */
  days: number;
  money: {
    income: number;
    fixed: number;
    spent: number;
    saved: number;
    savingsRate: number | null;
    prevSpent: number | null;
    changePct: number | null;
    over: { categoryId: string; spent: number; limit: number }[];
    top: { categoryId: string | null; amount: number }[];
    biggest: Transaction | null;
    noSpendDays: number;
  };
  life: {
    habitsDone: number;
    habitsDue: number;
    bestStreak: { name: string; days: number } | null;
    studyMinutes: number;
    avgSleep: number | null;
    avgMood: number | null;
    journalDays: number;
    weightChange: number | null;
    workouts: number;
  };
  moods: MoodFactor[];
  highlights: ReviewHighlight[];
}

/** El mes en un vistazo: plata y vida juntas, con lo que salió bien y lo que se puede mejorar. */
export function monthReview(data: LiftyData, b: MonthBudget, prev: MonthBudget | null, today: string): MonthReview {
  const month = b.month;
  const first = `${month}-01`;
  const lastDay = `${month}-${pad(daysInMonth(month))}`;
  const last = lastDay < today ? lastDay : today;
  const days = last < first ? 0 : Number(last.slice(8));
  const spent = round2(b.variable.total + b.card.total);
  const prevSpent = prev ? round2(prev.variable.total + prev.card.total) : null;
  const changePct = prevSpent && prevSpent > 0 ? Math.round(((spent - prevSpent) / prevSpent) * 100) : null;
  const income = round2(b.income.total);
  const saved = round2(b.savings.total);

  let habitsDone = 0;
  let habitsDue = 0;
  let workouts = 0;
  const exercise = data.habits.filter((h) => h.area === 'ejercicio');
  for (let x = first; x <= last; x = addDays(x, 1)) {
    const h = habitDay(data.habits, data.habitLogs, x);
    habitsDue += h.due.length;
    habitsDone += h.done.length;
    if (exercise.some((e) => h.done.some((d) => d.id === e.id))) workouts++;
  }
  const best = data.habits.length
    ? habitsToday(data.habits, data.habitLogs, last).statuses.sort((a, c) => c.streak - a.streak)[0]
    : undefined;
  const journal = data.journal.filter((j) => j.date >= first && j.date <= last);
  const ws = dailyWeights(data.weights).filter((w) => w.date >= first && w.date <= last);
  const moods = moodFactors(data, last, days || 1).slice(0, 3);
  const r: MonthReview = {
    month,
    days,
    money: {
      income,
      fixed: round2(b.fixed.total),
      spent,
      saved,
      savingsRate: income > 0 ? round2(saved / income) : null,
      prevSpent,
      changePct,
      over: b.categories
        .filter((c) => c.categoryId && c.limit !== null && c.spent > c.limit)
        .map((c) => ({ categoryId: c.categoryId!, spent: round2(c.spent), limit: c.limit! }))
        .sort((a, c) => c.spent - c.limit - (a.spent - a.limit)),
      top: b.categories
        .filter((c) => c.spent > 0)
        .sort((a, c) => c.spent - a.spent)
        .slice(0, 3)
        .map((c) => ({ categoryId: c.categoryId, amount: round2(c.spent) })),
      biggest: topExpenses(data, month, 1)[0] ?? null,
      noSpendDays: noSpendDays(data, month, last).days,
    },
    life: {
      habitsDone,
      habitsDue,
      bestStreak: best && best.streak > 0 ? { name: best.habit.name, days: best.streak } : null,
      studyMinutes: data.studySessions.filter((s) => s.date >= first && s.date <= last).reduce((s, x) => s + x.minutes, 0),
      avgSleep: (() => {
        const v = avg(journal.filter((j) => j.sleepHours !== null).map((j) => j.sleepHours!));
        return v === null ? null : round2(v);
      })(),
      avgMood: (() => {
        const v = avg(journal.filter((j) => j.mood !== null).map((j) => j.mood!));
        return v === null ? null : round2(v);
      })(),
      journalDays: journal.length,
      weightChange: ws.length >= 2 ? round2(ws[ws.length - 1].kg - ws[0].kg) : null,
      workouts,
    },
    moods,
    highlights: [],
  };

  // Lo que se destaca (reglas simples, de lo más importante a lo menos).
  const h = r.highlights;
  const fmt = (v: number) => `$ ${Math.round(v).toLocaleString('es-UY')}`;
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const prevName = monthLabel(addMonths(month, -1), false).toLowerCase();
  if (r.money.savingsRate !== null) {
    if (r.money.savingsRate >= 0.1)
      h.push({
        icon: '🐷',
        tone: 'good',
        text: `Ahorraste ${Math.round(r.money.savingsRate * 100)}% de lo que entró (${fmt(saved)}).`,
      });
    else if (saved <= 0) h.push({ icon: '🐷', tone: 'warn', text: 'No pasaste nada al ahorro este mes.' });
  }
  if (changePct !== null && Math.abs(changePct) >= 5)
    h.push(
      changePct < 0
        ? { icon: '📉', tone: 'good', text: `Gastaste ${-changePct}% menos que en ${prevName} en el día a día.` }
        : {
            icon: '📈',
            tone: changePct > 15 ? 'warn' : 'info',
            text: `Gastaste ${changePct}% más que en ${prevName} en el día a día.`,
          },
    );
  for (const o of r.money.over.slice(0, 2))
    h.push({
      icon: '🔴',
      tone: 'bad',
      text: `Te pasaste ${fmt(o.spent - o.limit)} en ${(cat.get(o.categoryId) ?? '').toLowerCase()}.`,
    });
  if (r.money.noSpendDays >= 5) h.push({ icon: '✅', tone: 'good', text: `${r.money.noSpendDays} días sin gastar.` });
  if (habitsDue > 0) {
    const pct = habitsDone / habitsDue;
    h.push({
      icon: '🗓️',
      tone: pct >= 0.8 ? 'good' : pct < 0.5 ? 'warn' : 'info',
      text: `Cumpliste ${Math.round(pct * 100)}% de tus rutinas${r.life.bestStreak ? ` (mejor racha: ${r.life.bestStreak.name}, ${r.life.bestStreak.days} días)` : ''}.`,
    });
  }
  if (r.life.avgSleep !== null && r.life.journalDays >= 5)
    h.push({
      icon: '😴',
      tone: r.life.avgSleep < 6.5 ? 'warn' : 'good',
      text: `Dormiste ${r.life.avgSleep.toLocaleString('es-UY')} h por noche en promedio.`,
    });
  if (r.life.avgMood !== null && r.life.journalDays >= 5)
    h.push({
      icon: r.life.avgMood >= 3.5 ? '🙂' : r.life.avgMood <= 2.5 ? '😕' : '😐',
      tone: r.life.avgMood >= 3.5 ? 'good' : r.life.avgMood <= 2.5 ? 'warn' : 'info',
      text: `Tu ánimo promedio fue ${r.life.avgMood.toLocaleString('es-UY')} de 5.`,
    });
  const m = moods[0];
  if (m)
    h.push({
      icon: '💡',
      tone: 'info',
      text: `${m.label} tu ánimo es ${Math.abs(m.diff).toLocaleString('es-UY')} punto${Math.abs(m.diff) === 1 ? '' : 's'} ${m.diff > 0 ? 'mejor' : 'peor'}.`,
    });
  if (r.life.studyMinutes >= 60)
    h.push({ icon: '📚', tone: 'info', text: `Estudiaste ${Math.round(r.life.studyMinutes / 6) / 10} h.` });
  if (r.life.weightChange !== null && Math.abs(r.life.weightChange) >= 0.3)
    h.push({
      icon: '⚖️',
      tone: 'info',
      text: `${r.life.weightChange < 0 ? 'Bajaste' : 'Subiste'} ${Math.abs(r.life.weightChange).toLocaleString('es-UY')} kg${r.life.workouts ? ` (entrenaste ${r.life.workouts} días)` : ''}.`,
    });
  return r;
}

/** Para los avisos: ¿tus cuentas se quedan en rojo antes de fin de mes? */
export function cashFlowWarning(data: LiftyData, b: MonthBudget, today: string): { date: string; balance: number } | null {
  const f = cashFlow(data, b, today);
  if (!f || f.lowest.balance >= 0 || f.start < 0) return null;
  return f.lowest;
}
