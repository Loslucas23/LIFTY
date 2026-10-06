import { addMonths, daysInMonth, isActiveIn, monthOf, monthRange, occursIn, parseMonth } from './months';
import { dataDeps, remember } from './memo';
import { round2, toUYU } from './money';
import { aguinaldoFor, netSalary } from './salary';
import type { Account, BudgetEntry, Category, Currency, LiftyData, LinkKind, MonthClosing, Transaction } from './schema';

/** Algo planificado del mes (sueldo, aguinaldo o gasto fijo) y si ya se confirmó. */
export interface PlannedLine {
  key: string;
  kind: LinkKind;
  refId: string;
  name: string;
  detail: string;
  currency: Currency;
  /** Monto planificado en la moneda original. */
  plannedOriginal: number;
  /** Monto planificado en UYU. */
  planned: number;
  /** Monto real (UYU) si está confirmado. */
  actual: number | null;
  /** Lo que cuenta para el presupuesto: real si está confirmado, si no planificado. */
  amount: number;
  confirmed: boolean;
  txIds: string[];
  categoryId: string | null;
  accountId: string | null;
  day: number | null;
}

/** Un movimiento (o una cuota de un movimiento) que cae en el mes. */
export interface TxLine {
  txId: string;
  date: string;
  description: string;
  categoryId: string | null;
  accountId: string | null;
  goalId: string | null;
  currency: Currency;
  /** Monto en la moneda original (de esta cuota). */
  original: number;
  /** Monto en UYU (de esta cuota). */
  amount: number;
  installment: { number: number; of: number } | null;
}

export interface CategorySpend {
  categoryId: string | null;
  /** Gastado en el día a día y con tarjeta (lo que cubre el presupuesto de la categoría). */
  spent: number;
  /** Gastos fijos de la categoría (se planifican aparte). */
  fixed: number;
  /** spent + fixed */
  total: number;
  /** Presupuesto del mes para la categoría (null = sin presupuesto). */
  limit: number | null;
  /** De dónde sale el presupuesto: de este mes en particular o el de todos los meses. */
  limitSource: 'month' | 'default' | null;
  /** Lo que queda del presupuesto (negativo = te pasaste). */
  remaining: number | null;
  /** Detalle por subcategoría (si hay gastos en subcategorías). */
  subs?: { categoryId: string; spent: number }[];
}

/** El plan del mes: cuánto entra, qué está comprometido y cuánto queda sin asignar. */
export interface MonthPlan {
  /** Suma de los presupuestos por categoría. */
  assigned: number;
  /** Lo que todavía se puede gastar dentro de los presupuestos. */
  remaining: number;
  /** Lo que se gastó de más en categorías con presupuesto. */
  overspent: number;
  /** Gastado en categorías sin presupuesto (o sin categoría). */
  unbudgeted: number;
  /** arrastre + ingresos − fijos − ahorro − presupuestado − gastos sin presupuesto */
  unassigned: number;
  /** Cómo terminás el mes si gastás exactamente lo presupuestado. */
  projected: number;
}

/** Presupuesto de una categoría en un mes: el del mes si existe, si no el de todos los meses. */
export function effectiveBudget(
  data: Pick<LiftyData, 'budgets' | 'categories'>,
  month: string,
  categoryId: string,
): { amount: number | null; source: 'month' | 'default' | null } {
  const override = data.budgets.find((b) => b.month === month && b.categoryId === categoryId);
  if (override) return { amount: override.amount, source: 'month' };
  const cat = data.categories.find((c) => c.id === categoryId);
  return cat?.monthlyLimit ? { amount: cat.monthlyLimit, source: 'default' } : { amount: null, source: null };
}

export interface MonthBudget {
  month: string;
  income: { planned: PlannedLine[]; extras: TxLine[]; total: number; pending: number };
  carryover: { amount: number; source: 'real' | 'projected' | 'start' | 'none'; fromMonth: string | null };
  fixed: { items: PlannedLine[]; total: number; pending: number };
  variable: { items: TxLine[]; total: number };
  card: { items: TxLine[]; total: number };
  savings: { items: TxLine[]; total: number };
  /** fijos + variables + tarjeta */
  expenses: number;
  /** Saldo proyectado al terminar el mes: arrastre + ingresos − gastos − ahorro. */
  result: number;
  closing: MonthClosing | null;
  /** Lo que pasa al mes siguiente: real si el mes está cerrado, si no el proyectado. */
  endBalance: number;
  categories: CategorySpend[];
  plan: MonthPlan;
  /** Meta de ahorro del mes ("pagate a vos primero"). */
  savingsGoal: SavingsGoalStatus;
  /** Cuánto podés gastar por día (solo el mes en curso). */
  daily: DailyAllowance | null;
}

export interface SavingsGoalStatus {
  /** Lo que querés ahorrar este mes (0 = sin meta). */
  target: number;
  /** Lo que ya ahorraste este mes. */
  saved: number;
  /** Lo que se aparta: el mayor entre la meta y lo ahorrado. */
  reserve: number;
  /** Lo que falta ahorrar para cumplir la meta. */
  pending: number;
}

/**
 * Gasto diario disponible:
 *   (ingresos − gastos fijos − cuotas de compras anteriores − ahorro − lo ya gastado) ÷ días que quedan
 * Se calcula al empezar el día: si hoy gastás menos, mañana tenés más; si gastás más, baja.
 */
export interface DailyAllowance {
  day: number;
  daysLeft: number;
  income: number;
  fixed: number;
  /** Cuotas de compras de meses anteriores que caen este mes. */
  committedCard: number;
  savings: number;
  /** ingresos − fijos − cuotas − ahorro */
  base: number;
  /** Gastado en el mes antes de hoy (día a día y compras nuevas con tarjeta). */
  spentBefore: number;
  spentToday: number;
  /** Lo que queda para los días que faltan (incluido hoy) al empezar el día. */
  available: number;
  /** Para cada día que queda (al empezar hoy). */
  perDay: number;
  /** Lo que te queda para hoy. */
  todayLeft: number;
  /** Días de esta semana que quedan (hasta el domingo o fin de mes, incluido hoy). */
  weekDays: number;
  weekLeft: number;
  /** Si no gastás más hoy, cuánto vas a tener por día a partir de mañana. */
  tomorrowPerDay: number | null;
  /** Ritmo: gasto promedio por día en el mes (día a día y compras nuevas). */
  pace: number;
  /** A este ritmo, cómo terminás el mes (sin contar lo que viene del mes anterior). */
  forecastEnd: number;
}

export interface Installment {
  month: string;
  number: number;
  of: number;
  /** En la moneda original. */
  amount: number;
}

/** Cuentas que NO son plata (tarjeta de alimentación): sus movimientos van aparte del presupuesto. */
export function offBudgetAccounts(data: Pick<LiftyData, 'accounts'>): Set<string> {
  return new Set(data.accounts.filter((a) => a.type === 'food').map((a) => a.id));
}

/** ¿Este movimiento cuenta en el presupuesto? (no las transferencias ni la tarjeta de alimentación) */
export function countsInBudget(tx: Pick<Transaction, 'kind' | 'accountId' | 'linkKind'>, offBudget: Set<string>): boolean {
  if (tx.kind === 'transfer') return false;
  if (tx.linkKind === 'load' || tx.linkKind === 'cardbill') return false;
  return !(tx.accountId && offBudget.has(tx.accountId));
}

/** Lo que cuenta para mi presupuesto: sin la parte de otros en un gasto dividido. */
export function ownAmount(tx: Pick<Transaction, 'amount' | 'sharedAmount'>): number {
  return tx.amount > 0 ? tx.amount - (tx.sharedAmount ?? 0) : tx.amount;
}

export function txRate(tx: Pick<Transaction, 'currency' | 'fxRate'>, fallbackRate: number): number {
  if (tx.currency === 'UYU') return 1;
  return tx.fxRate && tx.fxRate !== 1 ? tx.fxRate : fallbackRate;
}

export function txToUYU(tx: Pick<Transaction, 'currency' | 'fxRate' | 'amount'>, fallbackRate: number): number {
  return tx.amount * txRate(tx, fallbackRate);
}

/** Reparte un movimiento en cuotas. Un movimiento sin cuotas tiene una sola, en su mes. */
export function installmentsOf(
  tx: Pick<Transaction, 'amount' | 'date' | 'installments' | 'firstInstallmentMonth'>,
): Installment[] {
  const n = Math.max(1, tx.installments || 1);
  const first = tx.firstInstallmentMonth ?? monthOf(tx.date);
  const each = round2(tx.amount / n);
  const out: Installment[] = [];
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? round2(tx.amount - each * (n - 1)) : each;
    out.push({ month: addMonths(first, i), number: i + 1, of: n, amount });
  }
  return out;
}

function firstDataMonth(data: LiftyData): string | null {
  const months: string[] = [];
  for (const t of data.transactions)
    months.push(t.firstInstallmentMonth && t.firstInstallmentMonth < monthOf(t.date) ? t.firstInstallmentMonth : monthOf(t.date));
  for (const i of data.incomes) months.push(i.startMonth);
  for (const f of data.fixed) months.push(f.startMonth);
  if (months.length === 0) return null;
  return months.reduce((a, b) => (a < b ? a : b));
}

export function effectiveStartMonth(data: LiftyData, fallback: string): string {
  return data.settings.startMonth ?? firstDataMonth(data) ?? fallback;
}

interface Index {
  rate: number;
  accounts: Map<string, Account>;
  /** Movimientos no vinculados, repartidos por mes (cuotas incluidas). */
  byMonth: Map<string, { tx: Transaction; inst: Installment }[]>;
  /** Movimientos vinculados a algo planificado: clave `${kind}:${id}:${mes}`. */
  linked: Map<string, Transaction[]>;
  closings: Map<string, MonthClosing>;
  budgets: Map<string, BudgetEntry>;
  offBudget: Set<string>;
  /** Categoría de arriba de cada subcategoría. */
  root: (id: string | null) => string | null;
}

/** Cuentas de plata guardada (no se usa para gastar). */
export function reservedAccounts(data: Pick<LiftyData, 'accounts'>): Set<string> {
  return new Set(data.accounts.filter((a) => a.reserved && (a.type === 'bank' || a.type === 'cash')).map((a) => a.id));
}

/**
 * Pasar plata a una cuenta de ahorro (ej: comprar dólares para BROU dólares) es ahorrar;
 * sacarla de ahí es retirar ahorro. Devuelve el monto con signo, o null si no es el caso.
 */
export function savingFromTransfer(
  tx: Pick<Transaction, 'kind' | 'accountId' | 'toAccountId' | 'amount'>,
  reserved: Set<string>,
): number | null {
  if (tx.kind !== 'transfer') return null;
  const from = !!tx.accountId && reserved.has(tx.accountId);
  const to = !!tx.toAccountId && reserved.has(tx.toAccountId);
  if (from === to) return null;
  return to ? tx.amount : -tx.amount;
}

function buildIndex(data: LiftyData): Index {
  return remember(data, 'budget-index', dataDeps(data), () => makeIndex(data));
}

function makeIndex(data: LiftyData): Index {
  const byMonth: Index['byMonth'] = new Map();
  const linked: Index['linked'] = new Map();
  const offBudget = offBudgetAccounts(data);
  const reserved = reservedAccounts(data);
  const investing = new Set(data.accounts.filter((a) => a.investKind).map((a) => a.id));
  for (const raw of data.transactions) {
    const asSaving = savingFromTransfer(raw, reserved);
    const original: Transaction =
      asSaving === null ? raw : { ...raw, kind: 'saving', amount: asSaving, toAccountId: null, goalId: null };
    if (!countsInBudget(original, offBudget)) continue;
    // Adentro de la plata guardada (asignar a una meta lo que ya está en una cuenta de ahorro,
    // los intereses de un plazo fijo): no toca el presupuesto del mes.
    if (asSaving === null && original.accountId && reserved.has(original.accountId)) {
      if (original.kind === 'saving') continue;
      if (original.kind === 'income' && (investing.has(original.accountId) || original.categoryId === 'cat-rendimientos'))
        continue;
    }
    const tx = original.sharedAmount ? { ...original, amount: ownAmount(original) } : original;
    if (tx.linkKind && tx.linkId && tx.linkMonth) {
      const key = `${tx.linkKind}:${tx.linkId}:${tx.linkMonth}`;
      const list = linked.get(key) ?? [];
      list.push(tx);
      linked.set(key, list);
      continue;
    }
    const parts: Installment[] =
      tx.kind === 'expense' ? installmentsOf(tx) : [{ month: monthOf(tx.date), number: 1, of: 1, amount: tx.amount }];
    for (const inst of parts) {
      const list = byMonth.get(inst.month) ?? [];
      list.push({ tx, inst });
      byMonth.set(inst.month, list);
    }
  }
  return {
    rate: data.settings.usdRate,
    accounts: new Map(data.accounts.map((a) => [a.id, a])),
    byMonth,
    linked,
    offBudget,
    closings: new Map(data.closings.map((c) => [c.id, c])),
    budgets: new Map((data.budgets ?? []).map((b) => [`${b.month}:${b.categoryId}`, b])),
    root: categoryRootFn(data.categories),
  };
}

function txLine(tx: Transaction, inst: Installment, rate: number): TxLine {
  const r = txRate(tx, rate);
  return {
    txId: tx.id,
    date: tx.date,
    description: tx.description,
    categoryId: tx.categoryId,
    accountId: tx.accountId,
    goalId: tx.goalId,
    currency: tx.currency,
    original: inst.amount,
    amount: round2(inst.amount * r),
    installment: inst.of > 1 ? { number: inst.number, of: inst.of } : null,
  };
}

function plannedLine(
  idx: Index,
  base: Omit<PlannedLine, 'planned' | 'actual' | 'amount' | 'confirmed' | 'txIds' | 'key'> & { month: string },
): PlannedLine {
  const { month, ...rest } = base;
  const key = `${base.kind}:${base.refId}:${month}`;
  const txs = idx.linked.get(key) ?? [];
  const planned = round2(toUYU(base.plannedOriginal, base.currency, idx.rate));
  const actual = txs.length ? round2(txs.reduce((s, t) => s + txToUYU(t, idx.rate), 0)) : null;
  return {
    ...rest,
    key,
    planned,
    actual,
    amount: actual ?? planned,
    confirmed: txs.length > 0,
    txIds: txs.map((t) => t.id),
  };
}

/** "Una vez", "Cada 3 meses", "Una vez al año". */
export function everyLabel(every: number, startMonth: string, endMonth: string | null): string {
  if (endMonth === startMonth) return 'Una sola vez';
  if (every === 12) return 'Una vez al año';
  if (every === 1) return 'Todos los meses';
  return `Cada ${every} meses`;
}

const sum = (xs: { amount: number }[]) => round2(xs.reduce((s, x) => s + x.amount, 0));

function computeSingle(
  data: LiftyData,
  idx: Index,
  month: string,
  carryover: MonthBudget['carryover'],
  today: string,
): MonthBudget {
  const used = new Set<string>();

  // Ingresos planificados: sueldos y aguinaldos.
  const incomePlanned: PlannedLine[] = [];
  for (const src of data.incomes) {
    if (src.accountId && idx.offBudget.has(src.accountId)) continue;
    const every = src.everyMonths ?? 1;
    if (occursIn(month, src.startMonth, src.endMonth, every)) {
      const line = plannedLine(idx, {
        month,
        kind: 'salary',
        refId: src.id,
        name: src.name,
        detail: every === 1 ? 'Sueldo líquido' : everyLabel(every, src.startMonth, src.endMonth),
        currency: src.currency,
        plannedOriginal: netSalary(src),
        categoryId: src.categoryId,
        accountId: src.accountId,
        day: src.payDay,
      });
      used.add(line.key);
      incomePlanned.push(line);
    }
    // Lo que se cobra una sola vez (salario vacacional, un bono) no genera aguinaldo.
    const ag = every === 1 && src.startMonth !== src.endMonth ? aguinaldoFor(src, month) : null;
    if (ag) {
      const line = plannedLine(idx, {
        month,
        kind: 'aguinaldo',
        refId: src.id,
        name: `Aguinaldo · ${src.name}`,
        detail: ag.settlement ? 'Proporcional (liquidación)' : 'Estimado: 1/12 del semestre',
        currency: src.currency,
        plannedOriginal: ag.amount,
        categoryId: src.categoryId,
        accountId: src.accountId,
        day: null,
      });
      used.add(line.key);
      incomePlanned.push(line);
    }
  }

  // Gastos fijos.
  const fixedItems: PlannedLine[] = [];
  for (const f of data.fixed) {
    if (f.accountId && idx.offBudget.has(f.accountId)) continue;
    const every = f.everyMonths ?? 1;
    if (!occursIn(month, f.startMonth, f.endMonth, every)) continue;
    const line = plannedLine(idx, {
      month,
      kind: 'fixed',
      refId: f.id,
      name: f.name,
      detail: every === 1 ? '' : everyLabel(every, f.startMonth, f.endMonth),
      currency: f.currency,
      plannedOriginal: f.amount,
      categoryId: f.categoryId,
      accountId: f.accountId,
      day: f.dayOfMonth,
    });
    used.add(line.key);
    fixedItems.push(line);
  }

  // Confirmaciones de cosas que ya no están planificadas (por ejemplo, un fijo borrado).
  for (const [key, txs] of idx.linked) {
    if (used.has(key) || !key.endsWith(`:${month}`)) continue;
    const t = txs[0];
    const amount = round2(txs.reduce((s, x) => s + txToUYU(x, idx.rate), 0));
    const line: PlannedLine = {
      key,
      kind: t.linkKind!,
      refId: t.linkId!,
      name: t.description || 'Confirmado',
      detail: 'Ya no está planificado',
      currency: t.currency,
      plannedOriginal: 0,
      planned: 0,
      actual: amount,
      amount,
      confirmed: true,
      txIds: txs.map((x) => x.id),
      categoryId: t.categoryId,
      accountId: t.accountId,
      day: null,
    };
    (t.linkKind === 'fixed' ? fixedItems : incomePlanned).push(line);
  }

  const byDay = (a: { day: number | null; name: string }, b: { day: number | null; name: string }) =>
    (a.day ?? 99) - (b.day ?? 99) || a.name.localeCompare(b.name);
  fixedItems.sort(byDay);

  const extras: TxLine[] = [];
  const variable: TxLine[] = [];
  const card: TxLine[] = [];
  const savings: TxLine[] = [];
  for (const { tx, inst } of idx.byMonth.get(month) ?? []) {
    const line = txLine(tx, inst, idx.rate);
    if (tx.kind === 'income') extras.push(line);
    else if (tx.kind === 'saving') savings.push(line);
    else if (tx.accountId && idx.accounts.get(tx.accountId)?.type === 'credit') card.push(line);
    else variable.push(line);
  }
  const byDate = (a: TxLine, b: TxLine) => b.date.localeCompare(a.date);
  for (const list of [extras, variable, card, savings]) list.sort(byDate);

  const incomeTotal = round2(sum(incomePlanned) + sum(extras));
  const fixedTotal = sum(fixedItems);
  const variableTotal = sum(variable);
  const cardTotal = sum(card);
  const savingsTotal = sum(savings);
  const expenses = round2(fixedTotal + variableTotal + cardTotal);
  const result = round2(carryover.amount + incomeTotal - expenses - savingsTotal);
  const closing = idx.closings.get(month) ?? null;

  // Gasto por categoría: día a día y tarjeta (lo que cubre el presupuesto) y fijos aparte. Lo
  // de una subcategoría suma a su categoría (y queda el detalle en `subs`).
  const spend = new Map<string | null, number>();
  const fixedBy = new Map<string | null, number>();
  const subSpend = new Map<string, Map<string, number>>();
  for (const l of [...variable, ...card]) {
    const root = idx.root(l.categoryId);
    spend.set(root, (spend.get(root) ?? 0) + l.amount);
    if (root && l.categoryId && root !== l.categoryId) {
      const m = subSpend.get(root) ?? new Map<string, number>();
      m.set(l.categoryId, (m.get(l.categoryId) ?? 0) + l.amount);
      subSpend.set(root, m);
    }
  }
  for (const l of fixedItems) {
    const root = idx.root(l.categoryId);
    fixedBy.set(root, (fixedBy.get(root) ?? 0) + l.amount);
  }
  const categories: CategorySpend[] = [];
  const seen = new Set<string | null>();
  for (const c of data.categories) {
    if (c.kind !== 'expense' || idx.root(c.id) !== c.id) continue;
    seen.add(c.id);
    const spent = round2(spend.get(c.id) ?? 0);
    const fixed = round2(fixedBy.get(c.id) ?? 0);
    const override = idx.budgets.get(`${month}:${c.id}`);
    const limit = override ? override.amount : (c.monthlyLimit ?? null);
    const limitSource = override ? 'month' : c.monthlyLimit ? 'default' : null;
    if (spent === 0 && fixed === 0 && limit === null) continue;
    const subs = subSpend.get(c.id);
    categories.push({
      categoryId: c.id,
      spent,
      fixed,
      total: round2(spent + fixed),
      limit,
      limitSource,
      remaining: limit === null ? null : round2(limit - spent),
      ...(subs
        ? {
            subs: [...subs.entries()]
              .map(([categoryId, v]) => ({ categoryId, spent: round2(v) }))
              .sort((a, b) => b.spent - a.spent),
          }
        : {}),
    });
  }
  for (const id of new Set([...spend.keys(), ...fixedBy.keys()])) {
    if (seen.has(id)) continue;
    const spent = round2(spend.get(id) ?? 0);
    const fixed = round2(fixedBy.get(id) ?? 0);
    if (spent === 0 && fixed === 0) continue;
    categories.push({
      categoryId: id,
      spent,
      fixed,
      total: round2(spent + fixed),
      limit: null,
      limitSource: null,
      remaining: null,
    });
  }
  categories.sort((a, b) => b.total - a.total);

  const budgeted = categories.filter((c) => c.limit !== null);
  const assigned = round2(budgeted.reduce((s, c) => s + c.limit!, 0));
  const remaining = round2(budgeted.reduce((s, c) => s + Math.max(0, c.remaining!), 0));
  const overspent = round2(budgeted.reduce((s, c) => s + Math.max(0, -c.remaining!), 0));
  const unbudgeted = round2(categories.filter((c) => c.limit === null).reduce((s, c) => s + c.spent, 0));
  const unassigned = round2(carryover.amount + incomeTotal - fixedTotal - savingsTotal - assigned - unbudgeted);
  const plan: MonthPlan = {
    assigned,
    remaining,
    overspent,
    unbudgeted,
    unassigned,
    projected: round2(result - remaining),
  };

  // Meta de ahorro: se aparta primero.
  const st = data.settings;
  const savingsTarget =
    st.savingsMode === 'amount'
      ? round2(st.savingsValue)
      : st.savingsMode === 'percent'
        ? round2((Math.max(0, incomeTotal) * st.savingsValue) / 100)
        : 0;
  const savingsReserve = round2(Math.max(savingsTarget, savingsTotal));
  const savingsGoal: SavingsGoalStatus = {
    target: savingsTarget,
    saved: savingsTotal,
    reserve: savingsReserve,
    pending: round2(Math.max(0, savingsTarget - savingsTotal)),
  };
  plan.unassigned = round2(plan.unassigned + savingsTotal - savingsReserve);
  plan.projected = round2(plan.projected - savingsGoal.pending);

  let daily: DailyAllowance | null = null;
  if (monthOf(today) === month) {
    const day = Number(today.slice(8, 10));
    const daysLeft = daysInMonth(month) - day + 1;
    // Lo "comprometido": cuotas de compras de meses anteriores. Lo gastado: día a día y
    // compras nuevas de este mes (con tarjeta cuentan el día de la compra).
    let committedCard = 0;
    let spentBefore = 0;
    let spentToday = 0;
    for (const l of [...variable, ...card]) {
      if (monthOf(l.date) !== month) {
        committedCard += l.amount;
      } else if (l.date < today) {
        spentBefore += l.amount;
      } else if (l.date === today) {
        spentToday += l.amount;
      }
    }
    const base = round2(incomeTotal - fixedTotal - committedCard - savingsReserve);
    const available = round2(base - spentBefore);
    const perDay = round2(Math.max(0, available) / daysLeft);
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const weekDays = Math.min(dow === 0 ? 1 : 8 - dow, daysLeft);
    const spentMonth = spentBefore + spentToday;
    const pace = round2(spentMonth / day);
    daily = {
      day,
      daysLeft,
      income: incomeTotal,
      fixed: fixedTotal,
      committedCard: round2(committedCard),
      savings: savingsReserve,
      base,
      spentBefore: round2(spentBefore),
      spentToday: round2(spentToday),
      available,
      perDay,
      todayLeft: round2(perDay - spentToday),
      weekDays,
      weekLeft: round2(perDay * weekDays - spentToday),
      tomorrowPerDay: daysLeft > 1 ? round2(Math.max(0, available - spentToday) / (daysLeft - 1)) : null,
      pace,
      forecastEnd: round2(base - pace * daysInMonth(month)),
    };
  }

  return {
    month,
    income: {
      planned: incomePlanned,
      extras,
      total: incomeTotal,
      pending: round2(incomePlanned.filter((l) => !l.confirmed).reduce((s, l) => s + l.planned, 0)),
    },
    carryover,
    fixed: {
      items: fixedItems,
      total: fixedTotal,
      pending: round2(fixedItems.filter((l) => !l.confirmed).reduce((s, l) => s + l.planned, 0)),
    },
    variable: { items: variable, total: variableTotal },
    card: { items: card, total: cardTotal },
    savings: { items: savings, total: savingsTotal },
    expenses,
    result,
    closing,
    endBalance: closing ? closing.realBalance : result,
    categories,
    plan,
    savingsGoal,
    daily,
  };
}

/**
 * Calcula el presupuesto de cada mes entre `from` y `to` (inclusive), arrastrando el
 * saldo desde el primer mes de Lifty. El saldo que pasa de un mes al otro es el real
 * si el mes se cerró, o el proyectado si no.
 */
export function computeMonths(data: LiftyData, from: string, to: string, today: string): MonthBudget[] {
  const idx = buildIndex(data);
  const start = effectiveStartMonth(data, from);
  const out: MonthBudget[] = [];
  let prev: MonthBudget | null = null;
  const first = start < from ? start : from;
  for (const month of monthRange(first, to)) {
    let carryover: MonthBudget['carryover'];
    if (month < start) carryover = { amount: 0, source: 'none', fromMonth: null };
    else if (month === start) carryover = { amount: data.settings.startBalance, source: 'start', fromMonth: null };
    else
      carryover = {
        amount: prev!.endBalance,
        source: prev!.closing ? 'real' : 'projected',
        fromMonth: prev!.month,
      };
    const budget = computeSingle(data, idx, month, carryover, today);
    if (month >= from) out.push(budget);
    prev = budget;
  }
  return out;
}

export function computeMonth(data: LiftyData, month: string, today: string): MonthBudget {
  return computeMonths(data, month, month, today)[0];
}

export function computeYear(data: LiftyData, year: number, today: string): MonthBudget[] {
  return computeMonths(data, `${year}-01`, `${year}-12`, today);
}

/** Compras en cuotas que siguen activas en `month`. */
export interface CardPlan {
  tx: Transaction;
  installments: Installment[];
  /** Número de cuota que cae en `month` (0 si todavía no empezó). */
  current: number;
  remainingOriginal: number;
  remaining: number;
  lastMonth: string;
}

export function activeInstallmentPlans(data: LiftyData, month: string): CardPlan[] {
  const rate = data.settings.usdRate;
  const plans: CardPlan[] = [];
  for (const tx of data.transactions) {
    if (tx.kind !== 'expense' || tx.installments <= 1 || tx.linkKind) continue;
    const inst = installmentsOf(tx);
    const lastMonth = inst[inst.length - 1].month;
    if (lastMonth < month) continue;
    const current = inst.find((i) => i.month === month)?.number ?? 0;
    const remainingOriginal = round2(inst.filter((i) => i.month >= month).reduce((s, i) => s + i.amount, 0));
    plans.push({
      tx,
      installments: inst,
      current,
      remainingOriginal,
      remaining: round2(remainingOriginal * txRate(tx, rate)),
      lastMonth,
    });
  }
  return plans.sort((a, b) => a.lastMonth.localeCompare(b.lastMonth));
}

export interface GoalBalance {
  goalId: string | null;
  name: string;
  currency: Currency;
  /** En la moneda de la meta. */
  balance: number;
  balanceUYU: number;
  target: number | null;
  progress: number | null;
}

/** Saldo de cada meta de ahorro (los ahorros sin meta se agrupan por moneda). */
export function goalBalances(data: LiftyData): GoalBalance[] {
  const rate = data.settings.usdRate;
  const out = new Map<string, GoalBalance>();
  for (const g of data.goals) {
    out.set(g.id, {
      goalId: g.id,
      name: g.name,
      currency: g.currency,
      balance: 0,
      balanceUYU: 0,
      target: g.target,
      progress: null,
    });
  }
  for (const tx of data.transactions) {
    if (tx.kind !== 'saving') continue;
    let entry = tx.goalId ? out.get(tx.goalId) : undefined;
    if (!entry) {
      const key = `none:${tx.currency}`;
      entry = out.get(key);
      if (!entry) {
        entry = {
          goalId: null,
          name: tx.currency === 'USD' ? 'Ahorro en dólares' : 'Ahorro en pesos',
          currency: tx.currency,
          balance: 0,
          balanceUYU: 0,
          target: null,
          progress: null,
        };
        out.set(key, entry);
      }
    }
    const uyu = txToUYU(tx, rate);
    entry.balance += entry.currency === tx.currency ? tx.amount : entry.currency === 'UYU' ? uyu : uyu / rate;
  }
  return [...out.values()].map((g) => {
    const balance = round2(g.balance);
    return {
      ...g,
      balance,
      balanceUYU: round2(toUYU(balance, g.currency, rate)),
      progress: g.target ? Math.min(1, Math.max(0, balance / g.target)) : null,
    };
  });
}

export function yearOf(month: string): number {
  return parseMonth(month).year;
}

/** Para cada categoría, la de arriba (si es subcategoría) o ella misma. */
export function categoryRootFn(categories: Pick<Category, 'id' | 'parentId'>[]): (id: string | null) => string | null {
  const parent = new Map(categories.map((c) => [c.id, c.parentId ?? null]));
  return (id) => {
    let cur = id;
    // Un solo nivel en la práctica, pero por las dudas se sube hasta arriba (sin ciclos). Si la
    // de arriba ya no existe, queda como categoría principal.
    for (let i = 0; i < 5 && cur; i++) {
      const up = parent.get(cur);
      if (!up || !parent.has(up)) break;
      cur = up;
    }
    return cur;
  };
}

/** La categoría y sus subcategorías (para filtrar movimientos "de Comida afuera"). */
export function categoryFamily(categories: Pick<Category, 'id' | 'parentId'>[], id: string): Set<string> {
  return new Set([id, ...categories.filter((c) => c.parentId === id).map((c) => c.id)]);
}

/** "Comida afuera › Delivery" (o solo el nombre si no es subcategoría). */
export function categoryPath(categories: Pick<Category, 'id' | 'name' | 'parentId'>[], id: string | null, sep = ' › '): string {
  const c = categories.find((x) => x.id === id);
  if (!c) return '';
  const parent = c.parentId ? categories.find((x) => x.id === c.parentId) : undefined;
  return parent ? `${parent.name}${sep}${c.name}` : c.name;
}

/** Las categorías en orden, cada una seguida de sus subcategorías (para listas y selectores). */
export function sortedCategories<T extends Pick<Category, 'id' | 'parentId' | 'sort'>>(categories: T[]): T[] {
  const ids = new Set(categories.map((c) => c.id));
  const bySort = (a: T, b: T) => a.sort - b.sort;
  // Una subcategoría cuya categoría de arriba no está en la lista queda como de arriba.
  const roots = categories.filter((c) => !c.parentId || !ids.has(c.parentId)).sort(bySort);
  return roots.flatMap((r) => [r, ...categories.filter((c) => c.parentId === r.id).sort(bySort)]);
}
