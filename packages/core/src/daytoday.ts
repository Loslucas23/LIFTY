import { convert, debtStatus } from './accounts';
import { countsInBudget, offBudgetAccounts, ownAmount, type MonthBudget } from './budget';
import { hourlyWage, workHoursPerMonth } from './coach';
import { isDue } from './habits';
import { formatMoney, fold, round2 } from './money';
import { addMonths, isActiveIn, monthLabel, monthOf } from './months';
import type { Category, Debt, FixedExpense, Habit, LiftyData, Transaction } from './schema';
import { addDays, daysBetween } from './weight';

/**
 * La plata del día a día, con cuentas simples y explicables: gastos hormiga, cuánto vale una
 * hora de tu trabajo, contado contra cuotas, cuánto te sale cada uso de lo que pagás por mes,
 * recordar a quien te debe y lo que sobra de una categoría.
 */

const keyOf = (description: string) =>
  fold(description)
    .replace(/\d+/g, ' ')
    .replace(/[^a-z ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Lo que pagaste vos (sin la parte que te devuelven), en pesos. */
function myUYU(t: Transaction, rate: number): number {
  const r = t.currency === 'USD' && t.fxRate !== 1 ? t.fxRate : rate;
  return convert(ownAmount(t), t.currency, 'UYU', r);
}

// ---------------- Lo que vale una hora de tu trabajo ----------------

export interface WorkHour {
  /** Sueldo líquido del mes (lo planificado). */
  salary: number;
  hoursPerMonth: number;
  value: number;
}

/**
 * Cuánto ganás por hora: sueldo líquido del mes ÷ horas por mes (horas por semana × 52 ÷ 12).
 * Null si no tenés sueldo cargado.
 */
export function workHour(data: LiftyData, b: MonthBudget): WorkHour | null {
  const value = hourlyWage(b, data.settings.weeklyHours);
  if (!value) return null;
  const salary = round2(b.income.planned.filter((l) => l.kind === 'salary').reduce((s, l) => s + l.planned, 0));
  return { salary, hoursPerMonth: round2(workHoursPerMonth(data.settings.weeklyHours)), value };
}

// ---------------- Gastos hormiga ----------------

/** Hasta cuánto es "chico" (en pesos). */
export const ANT_MAX = 600;

export interface AntGroup {
  key: string;
  name: string;
  categoryId: string | null;
  /** Veces en la ventana mirada. */
  count: number;
  /** Veces por mes, en promedio. */
  perMonth: number;
  average: number;
  monthly: number;
  yearly: number;
  /** Este mes: cuántas veces y cuánto. */
  thisMonth: { count: number; amount: number };
  txIds: string[];
}

export interface AntReport {
  groups: AntGroup[];
  monthly: number;
  yearly: number;
  /** Días mirados (los últimos 90, o desde que hay datos). */
  days: number;
  /** Del gasto del día a día de esos días, qué parte son hormiga (0 a 1). */
  share: number;
  /** Si los bajás a la mitad: lo que ahorrás por año. */
  halfSaving: number;
  /** En horas de tu trabajo (null si no hay sueldo cargado). */
  hours: number | null;
  max: number;
}

/**
 * Gastos hormiga: lo chico (hasta $ 600) que se repite (2 o más veces por mes, en promedio, en
 * los últimos 90 días). Se agrupa por descripción (sin números) o, si no tiene, por categoría.
 * Por mes = lo gastado ÷ meses mirados; por año = por mes × 12.
 */
export function antExpenses(data: LiftyData, today: string, hour: WorkHour | null = null): AntReport {
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  const firstDate = data.transactions.length ? data.transactions[data.transactions.length - 1].date : today;
  const from = [addDays(today, -89), firstDate].sort()[1];
  const days = Math.max(30, daysBetween(from, today) + 1);
  const months = days / 30;
  const month = monthOf(today);
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, { names: Map<string, number>; cats: Map<string | null, number>; txs: Transaction[] }>();
  let dayToDay = 0;
  for (const t of data.transactions) {
    if (t.date < from || t.date > today) continue;
    if (t.kind !== 'expense' || t.linkKind || !countsInBudget(t, off)) continue;
    const amount = myUYU(t, rate);
    dayToDay += amount;
    if (t.installments > 1 || amount <= 0 || amount > ANT_MAX) continue;
    const k = keyOf(t.description);
    const key = k.length >= 3 ? k : `cat:${t.categoryId ?? ''}`;
    const g = groups.get(key) ?? {
      names: new Map<string, number>(),
      cats: new Map<string | null, number>(),
      txs: [] as Transaction[],
    };
    const label = t.description.trim();
    if (label) g.names.set(label, (g.names.get(label) ?? 0) + 1);
    g.cats.set(t.categoryId, (g.cats.get(t.categoryId) ?? 0) + 1);
    g.txs.push(t);
    groups.set(key, g);
  }
  const top = <T>(m: Map<T, number>): T | null => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const out: AntGroup[] = [];
  for (const [key, g] of groups) {
    const perMonth = g.txs.length / months;
    if (g.txs.length < 3 || perMonth < 2) continue;
    const total = g.txs.reduce((s, t) => s + myUYU(t, rate), 0);
    const categoryId = top(g.cats);
    // El nombre más usado, sin números ("Café 3" y "Café 12" son "Café").
    const named = top(g.names);
    const clean = named?.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    const name =
      (clean && clean.length >= 3 ? clean : named) ??
      (categoryId ? `${catName.get(categoryId) ?? 'Otros'} (sin descripción)` : 'Sin descripción');
    const monthly = round2(total / months);
    const mine = g.txs.filter((t) => monthOf(t.date) === month);
    out.push({
      key,
      name: capital(name),
      categoryId,
      count: g.txs.length,
      perMonth: round2(perMonth),
      average: round2(total / g.txs.length),
      monthly,
      yearly: round2(monthly * 12),
      thisMonth: { count: mine.length, amount: round2(mine.reduce((s, t) => s + myUYU(t, rate), 0)) },
      txIds: g.txs.map((t) => t.id),
    });
  }
  out.sort((a, b) => b.monthly - a.monthly);
  const monthly = round2(out.reduce((s, g) => s + g.monthly, 0));
  const yearly = round2(monthly * 12);
  const antTotal = out.reduce((s, g) => s + g.monthly * months, 0);
  return {
    groups: out,
    monthly,
    yearly,
    days,
    share: dayToDay > 0 ? round2(antTotal / dayToDay) : 0,
    halfSaving: round2(yearly / 2),
    hours: hour ? round2(yearly / hour.value) : null,
    max: ANT_MAX,
  };
}

// ---------------- ¿Contado con descuento o en cuotas? ----------------

export interface CashVsInstallmentsInput {
  /** Precio de lista (el de las cuotas, sin recargo). */
  price: number;
  /** Descuento por pagar contado (%). */
  discount: number;
  /** Cantidad de cuotas. */
  count: number;
  /** Recargo de las cuotas (%), 0 = sin recargo. */
  surcharge: number;
  /** Inflación (o lo que rinde tu plata) anual, en %. */
  annualRate: number;
}

export interface CashVsInstallments {
  cash: number;
  total: number;
  each: number;
  monthlyRate: number;
  /** Lo que valen hoy las cuotas: cada una dividida por (1 + tasa mensual) elevado al mes en que se paga. */
  presentValue: number;
  best: 'cash' | 'installments' | 'same';
  /** Cuánto ganás eligiendo lo mejor (en plata de hoy). */
  difference: number;
  /** Con qué descuento contado da lo mismo. */
  breakEven: number;
  rows: { n: number; amount: number; today: number }[];
}

/**
 * Contado contra cuotas, en plata de hoy. Con inflación, una cuota de dentro de 6 meses "pesa"
 * menos que la misma plata hoy: se divide por (1 + i)^mes, con i la tasa mensual que sale de la
 * anual ((1 + anual)^(1/12) − 1). La primera cuota se paga en el resumen del mes que viene.
 * Si las cuotas en plata de hoy salen menos que el precio contado, conviene en cuotas.
 */
export function cashVsInstallments(input: CashVsInstallmentsInput): CashVsInstallments {
  const price = Math.max(0, input.price);
  const count = Math.max(1, Math.round(input.count));
  const cash = round2(price * (1 - input.discount / 100));
  const total = round2(price * (1 + input.surcharge / 100));
  const each = round2(total / count);
  const i = Math.pow(1 + Math.max(0, input.annualRate) / 100, 1 / 12) - 1;
  const rows = Array.from({ length: count }, (_, k) => {
    const amount = k === count - 1 ? round2(total - each * (count - 1)) : each;
    return { n: k + 1, amount, today: round2(amount / Math.pow(1 + i, k + 1)) };
  });
  const presentValue = round2(rows.reduce((s, r) => s + r.today, 0));
  const diff = round2(cash - presentValue);
  return {
    cash,
    total,
    each,
    monthlyRate: round2(i * 100),
    presentValue,
    best: Math.abs(diff) < 1 ? 'same' : diff > 0 ? 'installments' : 'cash',
    difference: Math.abs(diff),
    breakEven: price > 0 ? round2((1 - presentValue / price) * 100) : 0,
    rows,
  };
}

/** Qué tasa usar: lo que rinde tu inversión en pesos (si tenés), si no la inflación de Ajustes. */
export function moneyRate(data: LiftyData): { rate: number; source: string } {
  const invest = data.accounts
    .filter((a) => a.investKind && !a.archived && a.currency === 'UYU' && a.rate)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  if (invest?.rate) return { rate: invest.rate, source: `lo que rinde ${invest.name}` };
  return { rate: data.settings.inflation ?? 5, source: 'la inflación estimada (Ajustes)' };
}

// ---------------- Cuánto te sale cada uso ----------------

export interface UseCost {
  fixed: FixedExpense;
  habit: Habit;
  /** Lo que pagás por mes (si es cada varios meses, la parte de un mes). */
  monthly: number;
  /** Mes mirado: este, o el anterior si recién empieza y todavía no lo usaste. */
  month: string;
  uses: number;
  perUse: number | null;
  /** Cuántas veces tocaba en ese mes según la rutina. */
  planned: number;
}

const fixedMonthly = (f: FixedExpense, rate: number) =>
  round2(convert(f.amount, f.currency, 'UYU', rate) / Math.max(1, f.everyMonths || 1));

const habitUses = (data: LiftyData, h: Habit, from: string, to: string) =>
  data.habitLogs.filter((l) => l.habitId === h.id && l.date >= from && l.date <= to && l.value >= h.target).length;

/**
 * Lo que pagás por mes (gimnasio, clases, una app) ÷ las veces que lo usaste en el mes, según la
 * rutina con la que lo uniste. Si el mes recién empieza y no lo usaste, mira el mes anterior.
 */
export function costPerUse(data: LiftyData, today: string): UseCost[] {
  const rate = data.settings.usdRate;
  const month = monthOf(today);
  const habits = new Map(data.habits.map((h) => [h.id, h]));
  const out: UseCost[] = [];
  for (const f of data.fixed) {
    if (f.archived || !f.habitId || !isActiveIn(month, f.startMonth, f.endMonth)) continue;
    const habit = habits.get(f.habitId);
    if (!habit || habit.archived) continue;
    let m = month;
    let uses = habitUses(data, habit, `${month}-01`, today);
    let end = today;
    if (uses === 0 && Number(today.slice(8)) < 8) {
      m = addMonths(month, -1);
      end = addDays(`${month}-01`, -1);
      uses = habitUses(data, habit, `${m}-01`, end);
    }
    let planned = 0;
    for (let d = `${m}-01`; d <= end; d = addDays(d, 1)) if (isDue(habit, d)) planned++;
    const monthly = fixedMonthly(f, rate);
    out.push({ fixed: f, habit, monthly, month: m, uses, perUse: uses ? round2(monthly / uses) : null, planned });
  }
  return out.sort((a, b) => (b.perUse ?? Infinity) - (a.perUse ?? Infinity));
}

/** Fijos que parecen ir con una rutina (mismo nombre o palabra en común) y no están unidos. */
export function suggestUseLinks(data: LiftyData): { fixed: FixedExpense; habit: Habit }[] {
  const habits = data.habits.filter((h) => !h.archived);
  const words = (s: string) =>
    new Set(
      keyOf(s)
        .split(' ')
        .filter((w) => w.length >= 4),
    );
  const out: { fixed: FixedExpense; habit: Habit }[] = [];
  for (const f of data.fixed) {
    if (f.archived || f.habitId) continue;
    const fw = words(f.name);
    const habit = habits.find((h) =>
      [...words(h.name)].some((w) => fw.has(w) || [...fw].some((x) => x.startsWith(w) || w.startsWith(x))),
    );
    if (habit) out.push({ fixed: f, habit });
  }
  return out;
}

// ---------------- Recordar con amabilidad a quien te debe ----------------

export type ReminderTone = 'amable' | 'directo' | 'divertido';

const fmtDay = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** El mensaje para mandarle a quien te debe: con el monto que falta y el detalle. */
export function debtReminderText(d: Debt, tone: ReminderTone, ownerName = ''): string {
  const s = debtStatus(d);
  const first = d.person.trim().split(/\s+/)[0] || d.person;
  const amount = formatMoney(s.remaining, d.currency);
  // Si ya te pagó una parte, se nombra el total y después lo que falta.
  const main = s.paid > 0 ? formatMoney(d.amount, d.currency) : amount;
  const what = d.description && d.description !== 'Gasto dividido' ? ` de ${d.description.trim()}` : '';
  const when = ` (${fmtDay(d.date)})`;
  const partial = s.paid > 0 ? ` Ya me pasaste ${formatMoney(s.paid, d.currency)}, así que faltan ${amount}.` : '';
  const sign = ownerName ? `\n${ownerName.split(/\s+/)[0]}` : '';
  if (tone === 'directo')
    return `Hola ${first}, te recuerdo que quedaron pendientes ${main}${what}${when}.${partial} ¿Me los pasás esta semana? ¡Gracias!${sign}`;
  if (tone === 'divertido')
    return `¡${first}! Mi billetera te extraña 😅 Quedaron ${main}${what}${when}.${partial} ¡Cuando puedas, gracias!${sign}`;
  return `¡Hola ${first}! ¿Cómo andás? Te escribo por los ${main}${what}${when}.${partial} Cuando puedas me los pasás, sin apuro 🙂${sign}`;
}

/**
 * Link de WhatsApp. Con el celular arma el chat directo (los números uruguayos "099 123 456" se
 * pasan a 59899123456); sin celular, WhatsApp te deja elegir a quién mandarlo.
 */
export function whatsappLink(text: string, phone = ''): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 9) digits = `598${digits.slice(1)}`;
  else if (digits.length === 8 && digits.startsWith('9')) digits = `598${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Deudas a tu favor para recordar: más de 7 días, sin pagar y sin recordatorio en la última semana. */
export function debtsToRemind(data: LiftyData, today: string): Debt[] {
  return data.debts.filter((d) => {
    if (d.direction !== 'lent' || d.installmentAmount) return false;
    if (debtStatus(d).done) return false;
    if (daysBetween(d.date, today) < 7) return false;
    return !d.remindedAt || daysBetween(d.remindedAt, today) >= 7;
  });
}

// ---------------- Lo que sobra de una categoría ----------------

export interface Leftover {
  category: Category;
  month: string;
  amount: number;
  /** Descripción del ahorro (sirve para saber si ya lo pasaste). */
  description: string;
}

/**
 * Categorías con "lo que sobra va al ahorro": lo que quedó sin gastar del presupuesto del mes
 * pasado (presupuesto − gastado), si todavía no lo pasaste.
 */
export function leftoversToSave(data: LiftyData, prev: MonthBudget): Leftover[] {
  const out: Leftover[] = [];
  for (const c of data.categories) {
    if (c.rollover !== 'save' || c.archived) continue;
    const x = prev.categories.find((y) => y.categoryId === c.id);
    if (!x || x.limit === null) continue;
    const amount = Math.floor(round2(x.limit - x.spent));
    if (amount < 50) continue;
    const description = `Lo que sobró de ${c.name.toLowerCase()} en ${monthLabel(prev.month, false).toLowerCase()}`;
    if (data.transactions.some((t) => t.kind === 'saving' && t.description === description)) continue;
    out.push({ category: c, month: prev.month, amount, description });
  }
  return out;
}
