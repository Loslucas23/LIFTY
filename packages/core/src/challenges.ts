import { convert } from './accounts';
import { countsInBudget, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { paceAlerts } from './coach';
import { habitsToday, isDue } from './habits';
import { daysInMonth } from './months';
import { round2 } from './money';
import type { Challenge, LiftyData } from './schema';
import { addDays, daysBetween } from './weight';
import { moodFactors } from './whole';

/**
 * Desafíos: metas cortas y concretas que se siguen solas con lo que cargás. Y sugerencias que
 * salen de tus números (en qué vas más rápido, qué te baja el ánimo, qué rutina cuesta).
 */

export interface ChallengeStatus {
  challenge: Challenge;
  status: 'upcoming' | 'active' | 'won' | 'lost';
  /** 0 a 1. */
  progress: number;
  /** "4 de 7 días", "$ 3.200 de $ 5.000"… */
  text: string;
  daysLeft: number;
}

/** Gastos necesarios: no tiene sentido un desafío de "no gastar" en esto. */
const ESSENTIAL = new Set(['cat-super', 'cat-casa', 'cat-salud', 'cat-servicios', 'cat-transporte', 'cat-estudios']);

const fmt = (v: number) => `$ ${Math.round(v).toLocaleString('es-UY')}`;

export function challengeStatus(c: Challenge, data: LiftyData, today: string): ChallengeStatus {
  const off = offBudgetAccounts(data);
  const rate = data.settings.usdRate;
  const end = c.to < today ? c.to : today;
  const totalDays = daysBetween(c.from, c.to) + 1;
  const elapsed = today < c.from ? 0 : Math.min(totalDays, daysBetween(c.from, end) + 1);
  const daysLeft = Math.max(0, daysBetween(today, c.to));
  const finished = today > c.to;
  const spend = data.transactions.filter(
    (t) =>
      t.kind === 'expense' &&
      !t.linkKind &&
      countsInBudget(t, off) &&
      t.date >= c.from &&
      t.date <= end &&
      (c.categoryId === null || t.categoryId === c.categoryId),
  );
  const uyu = (t: (typeof spend)[number]) =>
    convert(ownAmount(t), t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate);
  let progress = 0;
  let text = '';
  let won = false;
  let lost = false;
  switch (c.kind) {
    case 'no-spend-category': {
      lost = spend.length > 0;
      progress = lost ? 0 : elapsed / totalDays;
      text = lost
        ? `Gastaste el ${spend[spend.length - 1].date.split('-').reverse().join('/').slice(0, 5)}`
        : `${elapsed} de ${totalDays} días`;
      won = finished && !lost;
      break;
    }
    case 'spend-under': {
      const total = spend.reduce((s, t) => s + uyu(t), 0);
      lost = total > c.target;
      progress = Math.min(1, total / Math.max(1, c.target));
      text = `${fmt(total)} de ${fmt(c.target)}`;
      won = finished && !lost;
      break;
    }
    case 'no-spend-days': {
      const spentDays = new Set(spend.map((t) => t.date));
      // Cuentan los días ya terminados sin gastos (hoy todavía puede cambiar).
      const lastDone = finished ? c.to : addDays(today, -1);
      let free = 0;
      for (let d = c.from; d <= lastDone; d = addDays(d, 1)) if (!spentDays.has(d)) free++;
      const ahead = finished || today < c.from ? 0 : daysBetween(today, c.to) + 1 - (spentDays.has(today) ? 1 : 0);
      won = free >= c.target;
      lost = !won && free + ahead < c.target;
      progress = Math.min(1, free / Math.max(1, c.target));
      text = `${free} de ${c.target} días sin gastar`;
      break;
    }
    case 'habit-days': {
      const h = data.habits.find((x) => x.id === c.habitId);
      let done = 0;
      let ahead = 0;
      for (let d = c.from; h && d <= c.to; d = addDays(d, 1)) {
        const ok = d <= today && habitsToday([h], data.habitLogs, d).doneCount > 0;
        if (ok) done++;
        else if (d >= today && isDue(h, d)) ahead++;
      }
      won = done >= c.target;
      lost = !won && (finished || done + ahead < c.target);
      progress = Math.min(1, done / Math.max(1, c.target));
      text = `${done} de ${c.target} días${h ? ` de ${h.name}` : ''}`;
      break;
    }
    case 'save': {
      const saved = data.transactions
        .filter((t) => t.kind === 'saving' && t.date >= c.from && t.date <= end)
        .reduce((s, t) => s + convert(t.amount, t.currency, 'UYU', t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate), 0);
      won = saved >= c.target;
      lost = finished && !won;
      progress = Math.min(1, Math.max(0, saved / Math.max(1, c.target)));
      text = `${fmt(saved)} de ${fmt(c.target)}`;
      break;
    }
  }
  const status: ChallengeStatus['status'] =
    today < c.from ? 'upcoming' : won ? 'won' : lost ? 'lost' : finished ? 'lost' : 'active';
  return { challenge: c, status, progress: round2(progress), text, daysLeft };
}

export interface ChallengeIdea {
  key: string;
  why: string;
  challenge: Omit<Challenge, 'id' | 'updatedAt'>;
}

/** Desafíos sugeridos por tus números (los que ya tenés activos no se repiten). */
export function suggestChallenges(data: LiftyData, past: MonthBudget[], current: MonthBudget, today: string): ChallengeIdea[] {
  const out: ChallengeIdea[] = [];
  const active = data.challenges.filter((c) => !c.archived && c.to >= today);
  const has = (pred: (c: Challenge) => boolean) => active.some(pred);
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const in7 = addDays(today, 6);
  const monthEnd = `${current.month}-${String(daysInMonth(current.month)).padStart(2, '0')}`;

  // Lo que te baja el ánimo y además es gasto: una semana sin eso (solo lo que se puede
  // evitar: comida afuera, salidas, compras personales… no el súper, la casa o la salud).
  for (const f of moodFactors(data, today)) {
    if (!f.key.startsWith('cat:') || f.diff > -0.3) continue;
    const id = f.key.slice(4);
    if (ESSENTIAL.has(id)) continue;
    const c = cat.get(id);
    if (!c || has((x) => x.kind === 'no-spend-category' && x.categoryId === id)) continue;
    out.push({
      key: `mood-${id}`,
      why: `Los días que gastás en ${c.name.toLowerCase()} tu ánimo es ${Math.abs(f.diff).toLocaleString('es-UY')} puntos peor.`,
      challenge: {
        name: `7 días sin ${c.name.toLowerCase()}`,
        icon: c.icon,
        kind: 'no-spend-category',
        categoryId: id,
        habitId: null,
        target: 7,
        from: today,
        to: in7,
        archived: false,
      },
    });
  }
  // En lo que vas más rápido que de costumbre: terminar el mes en lo normal.
  for (const a of paceAlerts(data, past, current, today)) {
    const c = cat.get(a.categoryId);
    if (!c || has((x) => x.kind === 'spend-under' && x.categoryId === a.categoryId)) continue;
    out.push({
      key: `pace-${a.categoryId}`,
      why: `En ${c.name.toLowerCase()} vas ${Math.round(a.faster * 100)}% más rápido que de costumbre.`,
      challenge: {
        name: `${c.name}: no pasar de ${fmt(a.usual)} este mes`,
        icon: c.icon,
        kind: 'spend-under',
        categoryId: a.categoryId,
        habitId: null,
        target: Math.round(a.usual / 100) * 100,
        from: `${current.month}-01`,
        to: monthEnd,
        archived: false,
      },
    });
  }
  // La rutina que más cuesta: cumplirla 5 de los próximos 7 días.
  const statuses = habitsToday(data.habits, data.habitLogs, today).statuses.filter((s) => s.week !== null && s.week < 0.6);
  const hard = statuses.sort((a, b) => (a.week ?? 0) - (b.week ?? 0))[0];
  if (hard && !has((x) => x.kind === 'habit-days' && x.habitId === hard.habit.id)) {
    const due = Array.from({ length: 7 }, (_, i) => addDays(today, i)).filter((d) => isDue(hard.habit, d)).length;
    // Un poco más que lo que venís haciendo (no todo de golpe).
    const goal = Math.min(due, Math.floor(due * (hard.week ?? 0)) + 1);
    if (due >= 2)
      out.push({
        key: `habit-${hard.habit.id}`,
        why: `La semana pasada cumpliste ${Math.round((hard.week ?? 0) * 100)}% de «${hard.habit.name}».`,
        challenge: {
          name: `${hard.habit.name}: ${goal} de los próximos 7 días`,
          icon: hard.habit.icon,
          kind: 'habit-days',
          categoryId: null,
          habitId: hard.habit.id,
          target: goal,
          from: today,
          to: in7,
          archived: false,
        },
      });
  }
  // Clásico: 3 días sin gastar en la semana.
  if (
    !has((x) => x.kind === 'no-spend-days') &&
    data.transactions.some((t) => t.kind === 'expense' && t.date >= addDays(today, -14))
  )
    out.push({
      key: 'no-spend-week',
      why: 'Un clásico: frenar el gasto hormiga.',
      challenge: {
        name: '3 días sin gastar esta semana',
        icon: '✅',
        kind: 'no-spend-days',
        categoryId: null,
        habitId: null,
        target: 3,
        from: today,
        to: in7,
        archived: false,
      },
    });
  // Si tenés meta de ahorro y falta: juntarla antes de fin de mes.
  if (current.savingsGoal.pending > 0 && !has((x) => x.kind === 'save'))
    out.push({
      key: 'save-month',
      why: `Te faltan ${fmt(current.savingsGoal.pending)} para la meta de ahorro del mes.`,
      challenge: {
        name: `Ahorrar ${fmt(current.savingsGoal.pending)} antes de fin de mes`,
        icon: '🐷',
        kind: 'save',
        categoryId: null,
        habitId: null,
        target: Math.round(current.savingsGoal.pending),
        from: today,
        to: monthEnd,
        archived: false,
      },
    });
  return out.slice(0, 5);
}
