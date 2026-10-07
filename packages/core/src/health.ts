import type { MonthBudget } from './budget';
import { habitDay } from './habits';
import { monthSurplus } from './insights';
import { round2 } from './money';
import { moneyCheck } from './reconcile';
import type { LiftyData } from './schema';
import { addDays } from './weight';

/**
 * Puntajes de 0 a 100, cada uno armado con partes simples (cada parte dice cómo se calcula y
 * qué hacer para mejorarla). No es un juicio: es una foto para ver dónde conviene empujar.
 */

export interface HealthPart {
  key: string;
  label: string;
  /** 0 a 100. */
  score: number;
  /** Cuánto pesa en el total (los pesos suman 1). */
  weight: number;
  /** El dato, en palabras: "12% de lo que entra", "2,1 meses"… */
  value: string;
  /** Cómo se calcula. */
  detail: string;
  /** Qué hacer para subirlo (si hace falta). */
  tip: string | null;
}

export interface FinancialHealth {
  score: number;
  parts: HealthPart[];
  /** Fondo de emergencia: lo que necesitás por mes, lo que tenés y cuánto te cubre. */
  emergency: { essentials: number; have: number; months: number; target: number; missing: number; perMonth12: number };
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const fmt = (v: number) => `$ ${Math.round(v).toLocaleString('es-UY')}`;
const num = (v: number, d = 1) => v.toLocaleString('es-UY', { maximumFractionDigits: d });

/**
 * Salud financiera: ahorro (30%), colchón para emergencias (25%), presupuesto (20%), deudas
 * (15%) y orden (10%). Mira los últimos 3 meses terminados (`months` trae esos y el actual).
 */
export function financialHealth(data: LiftyData, months: MonthBudget[], today: string): FinancialHealth | null {
  if (months.length < 2) return null;
  const current = months[months.length - 1];
  const past = months.slice(-4, -1).filter((b) => b.income.total > 0 || b.expenses > 0);
  if (!past.length) return null;
  const income = past.reduce((s, b) => s + b.income.total, 0) / past.length;
  if (income <= 0) return null;
  const saved = past.reduce((s, b) => s + b.savings.total, 0) / past.length;
  const essentials = past.reduce((s, b) => s + b.fixed.total + b.variable.total + b.card.total, 0) / past.length;
  const c = moneyCheck(data, today, current);
  const parts: HealthPart[] = [];

  // 1) Ahorro: 20% de lo que entra es el 100.
  const rate = saved / income;
  parts.push({
    key: 'saving',
    label: 'Ahorro',
    score: Math.round(clamp(rate / 0.2) * 100),
    weight: 0.3,
    value: `${Math.round(rate * 100)}% de lo que entra`,
    detail: `Promedio de los últimos ${past.length} meses: ahorraste ${fmt(saved)} de ${fmt(income)} por mes. Llegar al 20% es el puntaje completo.`,
    tip: rate < 0.2 ? `Para llegar al 20%: ${fmt(income * 0.2 - saved)} más por mes (probá el ahorro automático).` : null,
  });

  // 2) Colchón: cuántos meses de gastos cubrís con lo que tenés (6 meses = 100).
  const have = Math.max(0, c.cash + c.reservedTotal + c.savingsOutside - c.cardOwed - c.iOwe);
  const coverage = essentials > 0 ? have / essentials : 0;
  const target = essentials * 3;
  const missing = Math.max(0, target - have);
  parts.push({
    key: 'emergency',
    label: 'Colchón para emergencias',
    score: Math.round(clamp(coverage / 6) * 100),
    weight: 0.25,
    value: `${num(coverage)} meses`,
    detail: `Lo que tenés (${fmt(have)}: bancos, efectivo y ahorros, menos la tarjeta y lo que debés) dividido lo que gastás por mes (${fmt(essentials)}: fijos, día a día y tarjeta). Se recomiendan de 3 a 6 meses.`,
    tip: coverage < 3 ? `Te faltan ${fmt(missing)} para 3 meses: ${fmt(missing / 12)} por mes durante un año.` : null,
  });

  // 3) Presupuesto: meses en los que no gastaste más de lo que entró.
  const ok = past.filter((b) => monthSurplus(b) >= 0).length;
  parts.push({
    key: 'budget',
    label: 'Gastar menos de lo que entra',
    score: Math.round((ok / past.length) * 100),
    weight: 0.2,
    value: `${ok} de ${past.length} meses`,
    detail: 'Meses en los que lo que entró alcanzó para los gastos y el ahorro (sin usar lo que venía de antes).',
    tip: ok < past.length ? 'Mirá en "Revisión del presupuesto" qué categorías se pasan siempre.' : null,
  });

  // 4) Deudas: cuotas que faltan y lo que le debés a otros, contra un mes de ingresos.
  const debt = c.cardFuture + c.iOwe;
  parts.push({
    key: 'debt',
    label: 'Deudas y cuotas',
    score: Math.round(clamp(1 - debt / income) * 100),
    weight: 0.15,
    value: debt > 0 ? fmt(debt) : 'Sin deudas',
    detail: `Las cuotas de la tarjeta de los meses que vienen y lo que le debés a otros (${fmt(debt)}), contra lo que entra en un mes (${fmt(income)}). Un mes de ingresos o más es puntaje 0.`,
    tip: debt > income * 0.5 ? 'Antes de sumar cuotas nuevas, probá "¿Me lo puedo comprar?".' : null,
  });

  // 5) Orden: que lo que dicen tus cuentas y tu presupuesto coincida.
  const off = Math.abs(c.difference);
  const tolerance = Math.max(100, income * 0.01);
  parts.push({
    key: 'order',
    label: 'Cuentas al día',
    score: off <= tolerance ? 100 : off <= income * 0.1 ? 50 : 0,
    weight: 0.1,
    value: off <= tolerance ? 'Cuadra' : `No cuadra por ${fmt(off)}`,
    detail: 'Si lo que hay en tus cuentas coincide con lo que dice tu presupuesto, tus números son confiables.',
    tip: off > tolerance ? 'Tocá "Poner a punto" en Cuentas.' : null,
  });

  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0));
  return {
    score,
    parts,
    emergency: {
      essentials: round2(essentials),
      have: round2(have),
      months: round2(coverage),
      target: round2(target),
      missing: round2(missing),
      perMonth12: round2(missing / 12),
    },
  };
}

export interface LifeBalance {
  score: number;
  parts: HealthPart[];
}

/** Balance de vida de los últimos 30 días: rutinas, sueño, ánimo y movimiento (lo que haya). */
export function lifeBalance(data: LiftyData, today: string, days = 30): LifeBalance | null {
  const from = addDays(today, -days + 1);
  const parts: Omit<HealthPart, 'weight'>[] = [];
  let due = 0;
  let done = 0;
  let workouts = 0;
  const exercise = new Set(data.habits.filter((h) => h.area === 'ejercicio' && !h.archived).map((h) => h.id));
  if (data.habits.some((h) => !h.archived)) {
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const h = habitDay(data.habits, data.habitLogs, d);
      // Hoy todavía no terminó: solo cuenta lo que ya hiciste.
      due += d === today ? h.done.length : h.due.length;
      done += h.done.length;
      if (h.done.some((x) => exercise.has(x.id))) workouts++;
    }
    if (due > 0)
      parts.push({
        key: 'habits',
        label: 'Rutinas',
        score: Math.round((done / due) * 100),
        value: `${Math.round((done / due) * 100)}% cumplidas`,
        detail: `Rutinas cumplidas de las que tocaban en los últimos ${days} días (${done} de ${due}).`,
        tip: done / due < 0.6 ? 'Mejor pocas rutinas que cumplas que muchas que no: probá sacar o mover alguna.' : null,
      });
  }
  const journal = data.journal.filter((j) => j.date >= from && j.date <= today);
  const sleeps = journal.filter((j) => j.sleepHours !== null).map((j) => j.sleepHours!);
  if (sleeps.length >= 5) {
    const avg = sleeps.reduce((s, x) => s + x, 0) / sleeps.length;
    parts.push({
      key: 'sleep',
      label: 'Sueño',
      score: Math.round(clamp((avg - 5) / 2) * 100),
      value: `${num(avg)} h por noche`,
      detail: `Promedio de ${sleeps.length} noches anotadas. 7 h o más es el puntaje completo; 5 h o menos, 0.`,
      tip: avg < 7 ? 'Fijate en el Diario qué cambia los días que dormís menos.' : null,
    });
  }
  const moods = journal.filter((j) => j.mood !== null).map((j) => j.mood!);
  if (moods.length >= 5) {
    const avg = moods.reduce((s, x) => s + x, 0) / moods.length;
    parts.push({
      key: 'mood',
      label: 'Ánimo',
      score: Math.round(((avg - 1) / 4) * 100),
      value: `${num(avg)} de 5`,
      detail: `Promedio de ${moods.length} días anotados en el Diario.`,
      tip: avg < 3 ? 'En "Qué te cambia el ánimo" (Diario) ves qué días te sentís mejor.' : null,
    });
  }
  if (exercise.size) {
    const perWeek = (workouts / days) * 7;
    parts.push({
      key: 'move',
      label: 'Movimiento',
      score: Math.round(clamp(perWeek / 3) * 100),
      value: `${num(perWeek)} días por semana`,
      detail: 'Días con tus rutinas de ejercicio cumplidas. 3 por semana es el puntaje completo.',
      tip: perWeek < 3 ? 'Aunque sea una caminata: sumá un día más por semana.' : null,
    });
  }
  if (!parts.length) return null;
  const weight = 1 / parts.length;
  return {
    score: Math.round(parts.reduce((s, p) => s + p.score * weight, 0)),
    parts: parts.map((p) => ({ ...p, weight })),
  };
}
