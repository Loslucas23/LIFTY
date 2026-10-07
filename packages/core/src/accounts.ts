import { offBudgetAccounts } from './budget';
import { assetsAt } from './assets';
import { groupTotals } from './groups';
import { cardAutoPayments } from './card';
import { addMonths, daysInMonth, monthOf } from './months';
import { dataDeps, remember } from './memo';
import { round2 } from './money';
import type { Account, Currency, Debt, LiftyData, Transaction } from './schema';

/** Convierte un monto de una moneda a otra con la cotización dada (pesos por dólar). */
export function convert(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return from === 'USD' ? amount * rate : amount / rate;
}

function txRateOf(tx: Pick<Transaction, 'currency' | 'fxRate'>, fallback: number): number {
  return tx.currency === 'USD' && tx.fxRate && tx.fxRate !== 1 ? tx.fxRate : fallback;
}

export interface AccountBalance {
  account: Account;
  /** En la moneda de la cuenta. En la tarjeta de crédito, negativo = lo que debés. */
  balance: number;
  balanceUYU: number;
  /** Movimientos que entraron / salieron (sin el saldo inicial). */
  flows: number;
}

/**
 * Saldo de cada cuenta hasta `upTo` (inclusive): saldo inicial + ingresos − gastos − ahorros
 * ± transferencias ± préstamos. Es tan preciso como lo que cargues: se puede ajustar.
 */
export function accountBalances(data: LiftyData, upTo: string): AccountBalance[] {
  // Copia de la lista: quien la ordena o filtra no toca la recordada.
  return remember(data, `balances:${upTo}`, dataDeps(data), () => computeBalances(data, upTo)).slice();
}

function computeBalances(data: LiftyData, upTo: string): AccountBalance[] {
  const rate = data.settings.usdRate;
  const flows = new Map<string, number>(data.accounts.map((a) => [a.id, 0]));
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const goalAccount = new Map(data.goals.filter((g) => g.accountId).map((g) => [g.id, g.accountId!]));
  const add = (accountId: string | null, amount: number, currency: Currency, r: number) => {
    if (!accountId) return;
    const acc = byId.get(accountId);
    if (!acc) return;
    flows.set(accountId, (flows.get(accountId) ?? 0) + convert(amount, currency, acc.currency, r));
  };
  for (const tx of data.transactions) {
    if (tx.date > upTo) continue;
    const r = txRateOf(tx, rate);
    switch (tx.kind) {
      case 'income':
        add(tx.accountId, tx.amount, tx.currency, r);
        break;
      case 'expense':
        add(tx.accountId, -tx.amount, tx.currency, r);
        break;
      case 'saving': {
        // Si la meta tiene cuenta, la plata pasa (o queda) ahí, apartada. Si no, sale de tus cuentas.
        add(tx.accountId, -tx.amount, tx.currency, r);
        const to = tx.goalId ? goalAccount.get(tx.goalId) : undefined;
        if (to) add(to, tx.amount, tx.currency, r);
        break;
      }
      case 'transfer':
        add(tx.accountId, -tx.amount, tx.currency, r);
        add(tx.toAccountId, tx.amount, tx.currency, r);
        break;
    }
  }
  // Débito automático de la tarjeta: los resúmenes vencidos que no anotaste se dan por pagados.
  for (const tx of cardAutoPayments(data, upTo)) {
    const r = txRateOf(tx, rate);
    add(tx.accountId, -tx.amount, tx.currency, r);
    add(tx.toAccountId, tx.amount, tx.currency, r);
  }
  for (const d of data.debts ?? []) {
    // Si viene de un gasto dividido, la plata ya salió con ese gasto.
    if (d.date <= upTo && !d.fromTxId) add(d.accountId, d.direction === 'lent' ? -d.amount : d.amount, d.currency, rate);
    for (const p of d.payments) {
      if (p.date <= upTo) add(p.accountId, d.direction === 'lent' ? p.amount : -p.amount, d.currency, rate);
    }
  }
  return data.accounts.map((account) => {
    const f = round2(flows.get(account.id) ?? 0);
    const balance = round2((account.initialBalance ?? 0) + f);
    return { account, balance, balanceUYU: round2(convert(balance, account.currency, 'UYU', rate)), flows: f };
  });
}

/**
 * Saldo inicial necesario para que la cuenta muestre `desired` hoy ("ajustar saldo"). Se calcula
 * sin el saldo anterior (en la tarjeta, la deuda de antes se paga con el débito y depende de él).
 */
export function initialBalanceFor(data: LiftyData, accountId: string, desired: number, today: string): number {
  const clean = {
    ...data,
    accounts: data.accounts.map((a) => (a.id === accountId ? { ...a, initialBalance: 0, initialBalanceDate: null } : a)),
  };
  const b = accountBalances(clean, today).find((x) => x.account.id === accountId);
  return round2(desired - (b?.balance ?? 0));
}

/** La cuenta con el saldo ajustado para que hoy muestre `desired` (y la fecha del ajuste). */
export function adjustBalance(data: LiftyData, accountId: string, desired: number, today: string): Account | null {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  return { ...account, initialBalance: initialBalanceFor(data, accountId, desired, today), initialBalanceDate: today };
}

// ---------------- Tarjeta de alimentación ----------------

export interface FoodCardMonth {
  account: Account;
  month: string;
  /** Saldo actual de la tarjeta (todo lo cargado − todo lo gastado). */
  balance: number;
  /** Carga mensual configurada y si ya se confirmó este mes. */
  plannedLoad: number | null;
  loadDay: number | null;
  loadConfirmed: boolean;
  loaded: number;
  spent: number;
  /** Lo que queda para gastar este mes (saldo + la carga que falta confirmar). */
  available: number;
  /** Solo el mes en curso: cuánto podés gastar por día con lo que queda. */
  perDay: number | null;
  daysLeft: number | null;
  transactions: Transaction[];
}

/** La tarjeta de alimentación va aparte: no es plata del presupuesto. */
export function foodCardMonth(data: LiftyData, accountId: string, month: string, today: string): FoodCardMonth | null {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const rate = data.settings.usdRate;
  const inAccount = data.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId);
  const monthTx = inAccount.filter((t) => monthOf(t.date) === month);
  const sumKind = (kind: Transaction['kind']) =>
    round2(
      monthTx
        .filter((t) => t.kind === kind)
        .reduce((s, t) => s + convert(t.amount, t.currency, account.currency, txRateOf(t, rate)), 0),
    );
  const loaded = sumKind('income');
  const spent = round2(sumKind('expense') + sumKind('saving'));
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const balance = accountBalances(data, monthEnd < today ? monthEnd : today).find((b) => b.account.id === accountId)!.balance;
  const loadConfirmed = monthTx.some((t) => t.linkKind === 'load' && t.linkMonth === month);
  const pendingLoad = account.monthlyLoad && !loadConfirmed ? account.monthlyLoad : 0;
  const available = round2(balance + pendingLoad);
  let perDay: number | null = null;
  let daysLeft: number | null = null;
  if (monthOf(today) === month) {
    daysLeft = daysInMonth(month) - Number(today.slice(8, 10)) + 1;
    perDay = round2(Math.max(0, available) / daysLeft);
  }
  return {
    account,
    month,
    balance,
    plannedLoad: account.monthlyLoad,
    loadDay: account.loadDay,
    loadConfirmed,
    loaded,
    spent,
    available,
    perDay,
    daysLeft,
    transactions: monthTx.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

// ---------------- Deudas ----------------

export interface DebtStatus {
  debt: Debt;
  paid: number;
  remaining: number;
  done: boolean;
}

export function debtStatus(d: Debt): DebtStatus {
  const paid = round2(d.payments.reduce((s, p) => s + p.amount, 0));
  const remaining = round2(Math.max(0, d.amount - paid));
  return { debt: d, paid, remaining, done: d.settled || remaining <= 0.009 };
}

export interface LoanPlan {
  installment: number;
  payDay: number;
  /** Cuotas que faltan (con la última, que puede ser menor). */
  left: number;
  /** Mes de la última cuota. */
  endMonth: string;
  /** Lo que pagás de más (intereses), si sabés cuántas cuotas son en total. */
  interest: number | null;
}

/** Un préstamo en cuotas: cuántas faltan, cuándo terminás y cuánto pagás de intereses. */
export function loanPlan(d: Debt, today: string): LoanPlan | null {
  if (!d.installmentAmount || !d.payDay) return null;
  const s = debtStatus(d);
  const left = s.done ? 0 : Math.ceil(s.remaining / d.installmentAmount - 1e-9);
  // Si la cuota de este mes ya está paga, la próxima es el mes que viene.
  const month = monthOf(today);
  const paidThisMonth = d.payments.some((p) => monthOf(p.date) === month);
  const first = paidThisMonth || Number(today.slice(8)) > d.payDay ? addMonths(month, 1) : month;
  return {
    installment: d.installmentAmount,
    payDay: d.payDay,
    left,
    endMonth: addMonths(first, Math.max(0, left - 1)),
    interest: d.installments ? round2(Math.max(0, d.installments * d.installmentAmount - d.amount)) : null,
  };
}

/** Total que te deben y que debés (en pesos), de lo que sigue abierto. */
export function debtTotals(data: LiftyData): { owedToMe: number; iOwe: number } {
  const rate = data.settings.usdRate;
  let owedToMe = 0;
  let iOwe = 0;
  for (const d of data.debts ?? []) {
    const s = debtStatus(d);
    if (s.done) continue;
    const v = convert(s.remaining, d.currency, 'UYU', rate);
    if (d.direction === 'lent') owedToMe += v;
    else iOwe += v;
  }
  return { owedToMe: round2(owedToMe), iOwe: round2(iOwe) };
}

// ---------------- Patrimonio ----------------

export interface NetWorth {
  date: string;
  /** Cuentas de plata (bancos, efectivo) en pesos. */
  cash: number;
  /** Tarjeta de crédito (negativo = deuda). */
  credit: number;
  /** Ahorros en metas. */
  savings: number;
  owedToMe: number;
  iOwe: number;
  /** Bienes (auto, casa…) a lo que valen ese día. */
  goods: number;
  total: number;
}

/** Lo que tenés menos lo que debés, a una fecha. La tarjeta de alimentación no cuenta (no es plata). */
export function netWorthAt(data: LiftyData, date: string): NetWorth {
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  let cash = 0;
  let credit = 0;
  for (const b of accountBalances(data, date)) {
    if (off.has(b.account.id)) continue;
    if (b.account.type === 'credit') credit += b.balanceUYU;
    else cash += b.balanceUYU;
  }
  let savings = 0;
  // El ahorro guardado en una cuenta ya está en "cash": solo se suma el que está fuera de tus cuentas.
  const inAccount = new Set(data.goals.filter((g) => g.accountId).map((g) => g.id));
  for (const t of data.transactions) {
    if (t.kind === 'saving' && t.date <= date && !(t.goalId && inAccount.has(t.goalId)))
      savings += convert(t.amount, t.currency, 'UYU', txRateOf(t, rate));
  }
  let owedToMe = 0;
  let iOwe = 0;
  for (const d of data.debts ?? []) {
    if (d.date > date || d.settled) continue;
    const paid = d.payments.filter((p) => p.date <= date).reduce((s, p) => s + p.amount, 0);
    const v = convert(Math.max(0, d.amount - paid), d.currency, 'UYU', rate);
    if (d.direction === 'lent') owedToMe += v;
    else iOwe += v;
  }
  // Gastos en grupo: lo que pusiste de más te lo deben; lo que pusiste de menos, lo debés.
  const groups = groupTotals({ ...data, groupExpenses: (data.groupExpenses ?? []).filter((e) => e.date <= date) });
  owedToMe += groups.UYU.owedToMe + groups.USD.owedToMe * rate;
  iOwe += groups.UYU.iOwe + groups.USD.iOwe * rate;
  const goods = assetsAt(data, date).totalUYU;
  const total = cash + credit + savings + owedToMe - iOwe + goods;
  return {
    date,
    cash: round2(cash),
    credit: round2(credit),
    savings: round2(savings),
    owedToMe: round2(owedToMe),
    iOwe: round2(iOwe),
    goods,
    total: round2(total),
  };
}

/** Patrimonio al final de cada uno de los últimos `count` meses (el actual, a hoy). */
export function netWorthHistory(data: LiftyData, today: string, count = 12): NetWorth[] {
  const current = monthOf(today);
  const out: NetWorth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = addMonths(current, -i);
    const end = i === 0 ? today : `${m}-${String(daysInMonth(m)).padStart(2, '0')}`;
    out.push(netWorthAt(data, end));
  }
  return out;
}
