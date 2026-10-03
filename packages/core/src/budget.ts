import { addMonths, daysInMonth, isActiveIn, monthOf, monthRange, parseMonth } from './months';
import { round2, toUYU } from './money';
import { aguinaldoFor, netSalary } from './salary';
import type { Account, BudgetEntry, Currency, LiftyData, LinkKind, MonthClosing, Transaction } from './schema';

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
  /**
   * Solo para el mes en curso. Si hay presupuestos, lo que queda de ellos repartido en los
   * días que faltan; si no, el saldo proyectado.
   */
  daily: { day: number; daysLeft: number; perDay: number; basis: 'budget' | 'balance' } | null;
}

export interface Installment {
  month: string;
  number: number;
  of: number;
  /** En la moneda original. */
  amount: number;
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
}

function buildIndex(data: LiftyData): Index {
  const byMonth: Index['byMonth'] = new Map();
  const linked: Index['linked'] = new Map();
  for (const tx of data.transactions) {
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
    closings: new Map(data.closings.map((c) => [c.id, c])),
    budgets: new Map((data.budgets ?? []).map((b) => [`${b.month}:${b.categoryId}`, b])),
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
    if (isActiveIn(month, src.startMonth, src.endMonth)) {
      const line = plannedLine(idx, {
        month,
        kind: 'salary',
        refId: src.id,
        name: src.name,
        detail: 'Sueldo líquido',
        currency: src.currency,
        plannedOriginal: netSalary(src),
        categoryId: src.categoryId,
        accountId: src.accountId,
        day: src.payDay,
      });
      used.add(line.key);
      incomePlanned.push(line);
    }
    const ag = aguinaldoFor(src, month);
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
    if (!isActiveIn(month, f.startMonth, f.endMonth)) continue;
    const line = plannedLine(idx, {
      month,
      kind: 'fixed',
      refId: f.id,
      name: f.name,
      detail: '',
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

  // Gasto por categoría: día a día y tarjeta (lo que cubre el presupuesto) y fijos aparte.
  const spend = new Map<string | null, number>();
  const fixedBy = new Map<string | null, number>();
  for (const l of [...variable, ...card]) spend.set(l.categoryId, (spend.get(l.categoryId) ?? 0) + l.amount);
  for (const l of fixedItems) fixedBy.set(l.categoryId, (fixedBy.get(l.categoryId) ?? 0) + l.amount);
  const categories: CategorySpend[] = [];
  const seen = new Set<string | null>();
  for (const c of data.categories) {
    if (c.kind !== 'expense') continue;
    seen.add(c.id);
    const spent = round2(spend.get(c.id) ?? 0);
    const fixed = round2(fixedBy.get(c.id) ?? 0);
    const override = idx.budgets.get(`${month}:${c.id}`);
    const limit = override ? override.amount : (c.monthlyLimit ?? null);
    const limitSource = override ? 'month' : c.monthlyLimit ? 'default' : null;
    if (spent === 0 && fixed === 0 && limit === null) continue;
    categories.push({
      categoryId: c.id,
      spent,
      fixed,
      total: round2(spent + fixed),
      limit,
      limitSource,
      remaining: limit === null ? null : round2(limit - spent),
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

  let daily: MonthBudget['daily'] = null;
  if (monthOf(today) === month) {
    const day = Number(today.slice(8, 10));
    const daysLeft = daysInMonth(month) - day + 1;
    daily =
      assigned > 0
        ? { day, daysLeft, perDay: round2(Math.min(remaining, Math.max(0, result)) / daysLeft), basis: 'budget' }
        : { day, daysLeft, perDay: round2(Math.max(0, result) / daysLeft), basis: 'balance' };
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
