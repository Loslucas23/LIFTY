import { accountBalances, debtTotals } from './accounts';
import { computeMonth, goalBalances, installmentsOf, txRate, type MonthBudget } from './budget';
import { monthOf } from './months';
import { round2 } from './money';
import type { Account, LiftyData } from './schema';

/**
 * "¿Dónde está tu plata?": lo que hay en tus cuentas tiene que poder explicarse como plata
 * para gastar + ahorro + lo comprometido. Compara lo que dicen tus cuentas con lo que dice
 * tu presupuesto y muestra la diferencia (gastos sin anotar, saldos mal, cosas sin tildar).
 */
export interface MoneyCheck {
  today: string;
  /** Bancos y efectivo (sin tarjetas ni alimentación), en pesos. */
  accounts: { account: Account; balanceUYU: number }[];
  cash: number;
  /** Ahorro apartado que está dentro de esas cuentas. */
  savingsInAccounts: number;
  /** Ahorro guardado fuera de tus cuentas (metas sin cuenta): no está en `cash`. */
  savingsOutside: number;
  /** Tarjeta de crédito: lo ya gastado (cuotas que ya contaron en el presupuesto) que falta pagar. */
  cardOwed: number;
  /** Cuotas de meses que vienen (todavía no cuentan en el presupuesto). */
  cardFuture: number;
  owedToMe: number;
  iOwe: number;
  /** Lo que tenés disponible hoy según tus cuentas. */
  available: number;
  /** Lo mismo según tu presupuesto: lo que viene del mes anterior + lo que entró − lo que salió. */
  budget: {
    carryover: number;
    carryoverSource: MonthBudget['carryover']['source'];
    income: number;
    fixed: number;
    spent: number;
    saved: number;
    value: number;
  };
  /** available − budget.value. Positivo: tenés más plata de la que Lifty cree. */
  difference: number;
  /** Lo que falta en el mes (para "para gastar hasta fin de mes"). */
  pendingIncome: number;
  pendingFixed: number;
  pendingSavings: number;
  /** available − fijos que faltan − ahorro que falta + lo que falta cobrar. */
  untilMonthEnd: number;
  /** Movimientos de este mes cargados sin cuenta (no mueven ningún saldo). */
  withoutAccount: number;
}

export function moneyCheck(
  data: LiftyData,
  today: string,
  b: MonthBudget = computeMonth(data, monthOf(today), today),
): MoneyCheck {
  const rate = data.settings.usdRate;
  const month = monthOf(today);
  const balances = accountBalances(data, today);
  const money = balances.filter((x) => x.account.type === 'bank' || x.account.type === 'cash');
  const cash = round2(money.reduce((s, x) => s + x.balanceUYU, 0));
  const inAccount = new Set(data.goals.filter((g) => g.accountId).map((g) => g.id));
  let savingsInAccounts = 0;
  let savingsOutside = 0;
  for (const g of goalBalances(data)) {
    if (g.goalId && inAccount.has(g.goalId)) savingsInAccounts += g.balanceUYU;
    else savingsOutside += g.balanceUYU;
  }
  const credit = new Set(data.accounts.filter((a) => a.type === 'credit').map((a) => a.id));
  const creditDebt = -balances.filter((x) => credit.has(x.account.id)).reduce((s, x) => s + x.balanceUYU, 0);
  let cardFuture = 0;
  for (const tx of data.transactions) {
    if (tx.kind !== 'expense' || !tx.accountId || !credit.has(tx.accountId) || tx.date > today) continue;
    for (const i of installmentsOf(tx)) if (i.month > month) cardFuture += i.amount * txRate(tx, rate);
  }
  const cardOwed = round2(creditDebt - cardFuture);
  const debts = debtTotals(data);
  const available = round2(cash - savingsInAccounts - cardOwed + debts.owedToMe - debts.iOwe);

  const upToToday = <T extends { date: string; amount: number }>(lines: T[]) =>
    lines.filter((l) => l.date <= today).reduce((s, l) => s + l.amount, 0);
  const income = b.income.planned.filter((l) => l.confirmed).reduce((s, l) => s + l.amount, 0) + upToToday(b.income.extras);
  const fixed = b.fixed.items.filter((l) => l.confirmed).reduce((s, l) => s + l.amount, 0);
  const spent = upToToday(b.variable.items) + upToToday(b.card.items);
  const saved = upToToday(b.savings.items);
  const value = round2(b.carryover.amount + income - fixed - spent - saved);
  const pendingIncome = round2(b.income.planned.filter((l) => !l.confirmed).reduce((s, l) => s + l.planned, 0));
  const pendingFixed = round2(b.fixed.items.filter((l) => !l.confirmed).reduce((s, l) => s + l.planned, 0));
  const pendingSavings = b.savingsGoal.pending;
  const withoutAccount = data.transactions.filter(
    (t) => monthOf(t.date) === month && !t.accountId && t.kind !== 'transfer' && t.date <= today,
  ).length;

  return {
    today,
    accounts: money
      .filter((x) => !x.account.archived || x.balance !== 0)
      .map((x) => ({ account: x.account, balanceUYU: x.balanceUYU })),
    cash,
    savingsInAccounts: round2(savingsInAccounts),
    savingsOutside: round2(savingsOutside),
    cardOwed,
    cardFuture: round2(cardFuture),
    owedToMe: debts.owedToMe,
    iOwe: debts.iOwe,
    available,
    budget: {
      carryover: b.carryover.amount,
      carryoverSource: b.carryover.source,
      income: round2(income),
      fixed: round2(fixed),
      spent: round2(spent),
      saved: round2(saved),
      value,
    },
    difference: round2(available - value),
    pendingIncome,
    pendingFixed,
    pendingSavings,
    untilMonthEnd: round2(available - pendingFixed - pendingSavings + pendingIncome),
    withoutAccount,
  };
}
