import { accountBalances, convert, debtStatus } from './accounts';
import { goalBalances, installmentsOf, offBudgetAccounts, txRate, type GoalBalance, type MonthBudget } from './budget';
import { cardAutoPayments } from './card';
import { sinkingFunds } from './insights';
import { addMonths, daysInMonth, isActiveIn, monthDiff, monthOf, occursIn } from './months';
import { round2 } from './money';
import { netSalary } from './salary';
import type { Account, Currency, Goal, LiftyData } from './schema';
import { addDays, daysBetween } from './weight';

/**
 * Tu plata: cada peso tiene un lugar (una cuenta) y un destino (gastar, lo comprometido hasta
 * el próximo cobro, una meta, o nada todavía). De ahí sale cuánto te sobra de verdad.
 *
 *   En tus cuentas para gastar
 *   − lo apartado para metas que está en esas cuentas
 *   − lo comprometido hasta que cobres (fijos, tarjeta, cuotas de préstamos, lo que falta
 *     ahorrar este mes y lo que deberías tener guardado para lo que pagás cada tanto)
 *   = te sobra (libre de verdad)
 *
 * Las cuentas de plata guardada (BROU dólares, un plazo fijo…) no son para gastar: su plata
 * está en metas o "sin destino".
 */

export type PlaceGroup = 'spend' | 'saved' | 'invest' | 'credit';

export interface PlaceGoal {
  goal: Goal;
  /** En la moneda de la meta. */
  balance: number;
  balanceUYU: number;
}

export interface InvestEstimate {
  /** Tasa anual (%). */
  rate: number;
  /** Intereses estimados desde la última vez que los anotaste (en la moneda de la cuenta). */
  accrued: number;
  /** Desde cuándo se cuentan. */
  since: string;
  maturity: string | null;
  /** Días que faltan para el vencimiento (negativo: ya venció). */
  daysToMaturity: number | null;
  /** Lo que tendrías al vencer (saldo + intereses hasta esa fecha). */
  atMaturity: number | null;
}

export interface Place {
  account: Account;
  group: PlaceGroup;
  /** En la moneda de la cuenta (en la tarjeta, negativo = lo que debés). */
  balance: number;
  balanceUYU: number;
  goals: PlaceGoal[];
  goalsUYU: number;
  /** Plata guardada sin meta (negativo: apartaste más de lo que hay en la cuenta). */
  unassignedUYU: number;
  invest: InvestEstimate | null;
}

export interface Commitment {
  kind: 'fixed' | 'card' | 'loan' | 'saving' | 'provision';
  id: string;
  name: string;
  /** Cuándo sale (null: no tiene día). */
  date: string | null;
  amount: number;
  /** Para "¿de dónde sale?". */
  note: string;
  overdue?: boolean;
}

export interface NextIncome {
  date: string;
  name: string;
  amount: number;
}

export interface Plata {
  today: string;
  nextIncome: NextIncome | null;
  /** Hasta cuándo tiene que alcanzar (el próximo cobro, o fin de mes si no hay). */
  until: string;
  /** Días que tiene que alcanzar (de hoy al día antes del cobro). */
  days: number;
  places: Place[];
  /** Totales en pesos. */
  spend: number;
  saved: number;
  invested: number;
  /** Intereses estimados de las inversiones (todavía no anotados). */
  accrued: number;
  /** Lo que debés en tarjetas (todo, también las cuotas que vienen). */
  cardDebt: number;
  goalsInSpend: number;
  commitments: Commitment[];
  committed: number;
  /** Te sobra: lo libre de verdad en tus cuentas para gastar. */
  free: number;
  /** Por día hasta el cobro (null si no te sobra nada). */
  freePerDay: number | null;
  /** Ahorro guardado en cuentas de ahorro e inversiones sin meta (en pesos). */
  unassigned: number;
  /** Metas que no dicen en qué cuenta está su plata (con una cuenta sugerida). */
  homeless: { goal: Goal; balance: GoalBalance; suggested: Account | null }[];
  /** Cuentas donde apartaste para metas más de lo que hay. */
  overAssigned: Place[];
  netWorth: {
    assets: number;
    debts: number;
    total: number;
    /** El total en dólares (a la cotización de hoy). */
    totalUSD: number;
    owedToMe: number;
    iOwe: number;
    /** Cuánto de lo que tenés (sin deudas) está en dólares. */
    usdShare: number;
  };
}

const dayIn = (month: string, day: number) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;

/** Una inversión: plata guardada con tipo de inversión. */
export const isInvestment = (a: Pick<Account, 'investKind'>) => !!a.investKind;

function groupOf(a: Account): PlaceGroup | null {
  if (a.type === 'credit') return 'credit';
  if (a.type === 'food') return null;
  if (isInvestment(a)) return 'invest';
  return a.reserved ? 'saved' : 'spend';
}

/** El próximo cobro (sueldo con día de cobro) desde hoy: si este mes ya cobraste, el del mes que viene. */
export function nextIncome(data: LiftyData, today: string): NextIncome | null {
  const month = monthOf(today);
  const rate = data.settings.usdRate;
  let best: NextIncome | null = null;
  for (const i of data.incomes) {
    if (i.archived || !i.payDay) continue;
    for (const m of [month, addMonths(month, 1)]) {
      if (!occursIn(m, i.startMonth, i.endMonth, i.everyMonths ?? 1)) continue;
      const date = dayIn(m, i.payDay);
      const received = data.transactions.some((t) => t.linkKind === 'salary' && t.linkId === i.id && t.linkMonth === m);
      if (received || date < today) continue;
      if (!best || date < best.date)
        best = { date, name: i.name, amount: round2(convert(netSalary(i), i.currency, 'UYU', rate)) };
      break;
    }
  }
  return best;
}

/** Intereses estimados de una inversión (interés simple sobre cada depósito, desde el último anotado). */
export function investEstimate(data: LiftyData, account: Account, today: string): InvestEstimate | null {
  if (!isInvestment(account) || !account.rate) return null;
  const rate = data.settings.usdRate;
  // Desde la última vez que anotaste rendimientos en esta cuenta (o desde siempre).
  const lastInterest = data.transactions
    .filter((t) => t.kind === 'income' && t.accountId === account.id && t.categoryId === 'cat-rendimientos' && t.date <= today)
    .map((t) => t.date)
    .sort()
    .pop();
  const events: { date: string; amount: number }[] = [];
  if (account.initialBalance && account.initialBalanceDate)
    events.push({ date: account.initialBalanceDate, amount: account.initialBalance });
  for (const t of data.transactions) {
    if (t.date > today) continue;
    const r = txRate(t, rate);
    const inAcc = (amount: number) => convert(amount, t.currency, account.currency, r);
    if (t.kind === 'transfer' && t.toAccountId === account.id) events.push({ date: t.date, amount: inAcc(t.amount) });
    else if (t.kind === 'transfer' && t.accountId === account.id) events.push({ date: t.date, amount: -inAcc(t.amount) });
    else if (t.kind === 'income' && t.accountId === account.id) events.push({ date: t.date, amount: inAcc(t.amount) });
    else if (
      t.kind === 'saving' &&
      t.goalId &&
      data.goals.find((g) => g.id === t.goalId)?.accountId === account.id &&
      t.accountId !== account.id
    )
      events.push({ date: t.date, amount: inAcc(t.amount) });
  }
  const since = lastInterest ?? events.map((e) => e.date).sort()[0] ?? today;
  const end = account.maturity && account.maturity < today ? account.maturity : today;
  const interestUntil = (to: string) => {
    let total = 0;
    for (const e of events) {
      const from = e.date > since ? e.date : since;
      if (from >= to) continue;
      total += (e.amount * (account.rate! / 100) * daysBetween(from, to)) / 365;
    }
    return Math.max(0, total);
  };
  const balance = accountBalances(data, today).find((b) => b.account.id === account.id)?.balance ?? 0;
  const accrued = round2(interestUntil(end));
  return {
    rate: account.rate,
    accrued,
    since,
    maturity: account.maturity,
    daysToMaturity: account.maturity ? daysBetween(today, account.maturity) : null,
    atMaturity: account.maturity && account.maturity >= today ? round2(balance + interestUntil(account.maturity)) : null,
  };
}

/** Lo que pagás de un préstamo en cuotas entre dos fechas (sin contar el mes que ya pagaste). */
function loanCommitments(data: LiftyData, today: string, until: string): Commitment[] {
  const rate = data.settings.usdRate;
  const out: Commitment[] = [];
  for (const d of data.debts ?? []) {
    if (d.direction !== 'borrowed' || !d.installmentAmount || !d.payDay) continue;
    const s = debtStatus(d);
    if (s.done) continue;
    let left = s.remaining;
    for (let m = monthOf(today); m <= monthOf(until) && left > 0; m = addMonths(m, 1)) {
      const date = dayIn(m, d.payDay);
      const paidThisMonth = d.payments.some((p) => monthOf(p.date) === m);
      if (paidThisMonth) continue;
      const overdue = date < today;
      if (!overdue && date >= until) continue;
      const amount = Math.min(left, d.installmentAmount);
      left -= amount;
      out.push({
        kind: 'loan',
        id: `${d.id}:${m}`,
        name: `Cuota: ${d.description || d.person}`,
        date,
        amount: round2(convert(amount, d.currency, 'UYU', rate)),
        note: `Préstamo con ${d.person}: te quedan ${Math.ceil(s.remaining / d.installmentAmount)} cuotas`,
        overdue,
      });
    }
  }
  return out;
}

/**
 * Gastos fijos que faltan pagar desde hoy hasta antes del cobro (y los vencidos del mes). Los
 * que se pagan con la tarjeta de crédito no van: salen con el resumen.
 */
function fixedCommitments(data: LiftyData, b: MonthBudget, today: string, until: string): Commitment[] {
  const rate = data.settings.usdRate;
  const credit = new Set(data.accounts.filter((a) => a.type === 'credit').map((a) => a.id));
  const out: Commitment[] = [];
  const month = monthOf(today);
  for (let m = month; m <= monthOf(until); m = addMonths(m, 1)) {
    for (const f of data.fixed) {
      if (f.archived || !occursIn(m, f.startMonth, f.endMonth, f.everyMonths ?? 1)) continue;
      if (f.accountId && credit.has(f.accountId)) continue;
      const paid =
        m === b.month
          ? b.fixed.items.some((l) => l.refId === f.id && l.confirmed)
          : data.transactions.some((t) => t.linkKind === 'fixed' && t.linkId === f.id && t.linkMonth === m);
      if (paid) continue;
      // Sin día de vencimiento: se cuenta en su mes.
      const date = f.dayOfMonth ? dayIn(m, f.dayOfMonth) : null;
      const overdue = !!date && date < today;
      if (date && !overdue && date >= until) continue;
      if (!date && m !== month) continue;
      out.push({
        kind: 'fixed',
        id: `${f.id}:${m}`,
        name: f.name,
        date,
        amount: round2(convert(f.amount, f.currency, 'UYU', rate)),
        note: overdue ? 'Vencido y sin marcar como pagado' : date ? `Vence el ${date.slice(8)}` : 'Este mes (sin día)',
        overdue,
      });
    }
  }
  return out;
}

/** Lo que te sale la tarjeta hasta antes del cobro (débito automático o, si lo pagás vos, lo ya gastado). */
function cardCommitments(data: LiftyData, today: string, until: string): Commitment[] {
  const rate = data.settings.usdRate;
  const out: Commitment[] = [];
  // Un renglón por resumen (pesos y dólares juntos, a la cotización de las compras).
  const byStatement = new Map<string, Commitment>();
  for (const p of cardAutoPayments(data, addDays(until, -1))) {
    if (p.date < today) continue;
    const card = data.accounts.find((a) => a.id === p.toAccountId);
    const key = `${p.toAccountId}:${p.linkMonth}`;
    const amount = round2(convert(p.amount, p.currency, 'UYU', p.currency === 'USD' ? p.fxRate || rate : 1));
    const prev = byStatement.get(key);
    if (prev) {
      prev.amount = round2(prev.amount + amount);
      prev.note = 'Débito automático del resumen (pesos y dólares)';
    } else
      byStatement.set(key, {
        kind: 'card',
        id: `card:${key}`,
        name: `${card?.name ?? 'Tarjeta'}: ${p.description.replace(/^Débito automático · /, '')}`,
        date: p.date,
        amount,
        note: 'Débito automático del resumen',
      });
  }
  out.push(...byStatement.values());
  // Tarjetas sin débito automático: lo que ya gastaste (sin las cuotas de los meses que vienen).
  const month = monthOf(today);
  const balances = accountBalances(data, today);
  for (const card of data.accounts) {
    if (card.type !== 'credit' || card.autopay !== false || card.archived) continue;
    const owed = -(balances.find((x) => x.account.id === card.id)?.balanceUYU ?? 0);
    let future = 0;
    for (const t of data.transactions) {
      if (t.kind !== 'expense' || t.accountId !== card.id || t.date > today) continue;
      for (const i of installmentsOf(t)) if (i.month > month) future += i.amount * txRate(t, rate);
    }
    const amount = round2(owed - future);
    if (amount > 0.5)
      out.push({
        kind: 'card',
        id: `card:${card.id}`,
        name: `${card.name}: lo que ya gastaste`,
        date: null,
        amount,
        note: 'Sin débito automático: lo gastado hasta hoy (sin las cuotas que vienen)',
      });
  }
  return out;
}

/**
 * Lo que pagás cada tanto (patente, seguro, contribución…): lo que ya deberías tener guardado
 * para cuando venza (lo de este mes, si falta pagarlo antes del cobro, ya está en los fijos).
 */
function provisionCommitments(data: LiftyData, b: MonthBudget, today: string, fixed: Commitment[]): Commitment[] {
  const month = monthOf(today);
  const out: Commitment[] = [];
  for (const s of sinkingFunds(data, month)) {
    let next = s.nextMonth;
    const paid = next === month && b.fixed.items.some((l) => l.refId === s.id && l.confirmed);
    if (paid) next = addMonths(next, s.everyMonths);
    // Si vence antes del cobro, ya está entero en los fijos.
    if (fixed.some((c) => c.id === `${s.id}:${next}`)) continue;
    const monthsLeft = Math.max(0, monthDiff(month, next));
    const share = Math.max(0, Math.min(1, (s.everyMonths - monthsLeft) / s.everyMonths));
    const amount = round2(s.amount * share);
    if (amount < 1) continue;
    out.push({
      kind: 'provision',
      id: `prov:${s.id}`,
      name: s.name,
      date: null,
      amount,
      note: `Vence ${monthsLeft === 0 ? 'este mes' : `en ${monthsLeft} mes${monthsLeft === 1 ? '' : 'es'}`} (${Math.round(share * 100)}% de ${Math.round(s.amount)}, a razón de ${Math.round(s.perMonth)} por mes)`,
    });
  }
  return out;
}

/** La cuenta donde conviene guardar una meta (la primera de ahorro en su moneda, o la principal). */
export function suggestGoalAccount(data: LiftyData, goal: Pick<Goal, 'currency'>): Account | null {
  const live = data.accounts.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash'));
  return (
    live.find((a) => a.reserved && !isInvestment(a) && a.currency === goal.currency) ??
    live.find((a) => a.currency === goal.currency && a.type === 'bank') ??
    live.find((a) => a.currency === goal.currency) ??
    null
  );
}

export function plata(data: LiftyData, b: MonthBudget, today: string): Plata {
  const rate = data.settings.usdRate;
  const off = offBudgetAccounts(data);
  const income = nextIncome(data, today);
  const monthEnd = dayIn(monthOf(today), 31);
  const until = income?.date ?? addDays(monthEnd, 1);
  const days = Math.max(1, daysBetween(today, until));

  // ---- Dónde está cada peso ----
  const goalsBy = new Map<string, PlaceGoal[]>();
  const homeless: Plata['homeless'] = [];
  const balancesByGoal = new Map(goalBalances(data).map((g) => [g.goalId, g]));
  for (const g of data.goals) {
    const bal = balancesByGoal.get(g.id);
    if (!bal) continue;
    if (!g.accountId || !data.accounts.some((a) => a.id === g.accountId)) {
      if (Math.abs(bal.balance) > 0.004 && !g.archived)
        homeless.push({ goal: g, balance: bal, suggested: suggestGoalAccount(data, g) });
      continue;
    }
    if (g.archived && Math.abs(bal.balance) < 0.005) continue;
    goalsBy.set(g.accountId, [
      ...(goalsBy.get(g.accountId) ?? []),
      { goal: g, balance: bal.balance, balanceUYU: bal.balanceUYU },
    ]);
  }
  const places: Place[] = [];
  for (const x of accountBalances(data, today)) {
    const group = groupOf(x.account);
    if (!group || off.has(x.account.id)) continue;
    const goals = goalsBy.get(x.account.id) ?? [];
    if (x.account.archived && Math.abs(x.balance) < 0.005 && !goals.length) continue;
    const goalsUYU = round2(goals.reduce((s, g) => s + g.balanceUYU, 0));
    places.push({
      account: x.account,
      group,
      balance: x.balance,
      balanceUYU: x.balanceUYU,
      goals,
      goalsUYU,
      unassignedUYU: group === 'saved' || group === 'invest' ? round2(x.balanceUYU - goalsUYU) : 0,
      invest: group === 'invest' ? investEstimate(data, x.account, today) : null,
    });
  }
  const sum = (g: PlaceGroup, f: (p: Place) => number = (p) => p.balanceUYU) =>
    round2(places.filter((p) => p.group === g).reduce((s, p) => s + f(p), 0));
  const spend = sum('spend');
  const saved = sum('saved');
  const invested = sum('invest');
  const accrued = round2(
    places.reduce((s, p) => s + (p.invest ? convert(p.invest.accrued, p.account.currency, 'UYU', rate) : 0), 0),
  );
  const cardDebt = round2(-sum('credit'));
  const goalsInSpend = sum('spend', (p) => p.goalsUYU);

  // ---- Lo comprometido hasta el cobro ----
  const fixed = fixedCommitments(data, b, today, until);
  const commitments: Commitment[] = [...fixed, ...cardCommitments(data, today, until), ...loanCommitments(data, today, until)];
  if (b.month === monthOf(today) && b.savingsGoal.pending > 0.5)
    commitments.push({
      kind: 'saving',
      id: 'saving-month',
      name: 'Lo que falta ahorrar este mes',
      date: null,
      amount: round2(b.savingsGoal.pending),
      note: `Tu meta de ahorro del mes es ${Math.round(b.savingsGoal.target)} y llevás ${Math.round(b.savingsGoal.target - b.savingsGoal.pending)}`,
    });
  commitments.push(...provisionCommitments(data, b, today, fixed));
  const committed = round2(commitments.reduce((s, c) => s + c.amount, 0));
  const free = round2(spend - goalsInSpend - committed);

  // ---- Patrimonio ----
  let owedToMe = 0;
  let iOwe = 0;
  for (const d of data.debts ?? []) {
    const s = debtStatus(d);
    if (s.done) continue;
    const v = convert(s.remaining, d.currency, 'UYU', rate);
    if (d.direction === 'lent') owedToMe += v;
    else iOwe += v;
  }
  const outside = homeless.reduce((s, h) => s + h.balance.balanceUYU, 0);
  const assets = round2(spend + saved + invested + accrued + owedToMe + outside);
  const debts = round2(cardDebt + iOwe);
  const usd = places
    .filter((p) => p.group !== 'credit' && p.account.currency === 'USD')
    .reduce((s, p) => s + Math.max(0, p.balanceUYU), 0);
  const positive = spend + saved + invested;

  return {
    today,
    nextIncome: income,
    until,
    days,
    places,
    spend,
    saved,
    invested,
    accrued,
    cardDebt,
    goalsInSpend,
    commitments: commitments.sort((a, b2) => (a.date ?? '9999').localeCompare(b2.date ?? '9999')),
    committed,
    free,
    freePerDay: free > 0 ? round2(free / days) : null,
    unassigned: round2(places.filter((p) => p.unassignedUYU > 0.5).reduce((s, p) => s + p.unassignedUYU, 0)),
    homeless,
    overAssigned: places.filter((p) => p.unassignedUYU < -0.5),
    netWorth: {
      assets,
      debts,
      total: round2(assets - debts),
      totalUSD: round2((assets - debts) / rate),
      owedToMe: round2(owedToMe),
      iOwe: round2(iOwe),
      usdShare: positive > 0 ? round2(usd / positive) : 0,
    },
  };
}

// ---------------- Repartir el cobro ----------------

export interface PaydayLine {
  kind: 'fixed' | 'card' | 'loan' | 'goal' | 'saving' | 'provision';
  id: string;
  name: string;
  /** En pesos. */
  amount: number;
  /** Metas: a qué meta va, en su moneda (dólares: cuánto comprar). */
  goalId?: string;
  currency?: Currency;
  original?: number;
  note: string;
  /** Se puede hacer con un toque (depositar en la meta). */
  action: boolean;
}

export interface PaydayPlan {
  income: number;
  /** Del cobro a la fecha del siguiente (para repartir lo que queda por día). */
  until: string;
  days: number;
  lines: PaydayLine[];
  reserved: number;
  left: number;
  perDay: number | null;
}

/**
 * Al cobrar: qué hacer con la plata, en orden (como "pagate primero"). Primero lo que tiene
 * fecha hasta el próximo cobro (fijos, tarjeta, cuotas), después las metas y el ahorro del mes,
 * lo de los gastos de cada tanto, y lo que queda es para gastar, por día.
 */
export function paydayPlan(
  data: LiftyData,
  b: MonthBudget,
  today: string,
  income: number,
  goalPending: { goal: Goal; pending: number }[],
): PaydayPlan {
  const rate = data.settings.usdRate;
  // Hasta el cobro siguiente (si hoy cobraste, el del mes que viene).
  const following = nextIncome(data, addDays(today, 1));
  const until = following?.date ?? addDays(dayIn(monthOf(today), 31), 1);
  const days = Math.max(1, daysBetween(today, until));
  const lines: PaydayLine[] = [];
  const fixed = fixedCommitments(data, b, today, until);
  const dated = [...fixed, ...cardCommitments(data, today, until), ...loanCommitments(data, today, until)].sort((a, b2) =>
    (a.date ?? '9999').localeCompare(b2.date ?? '9999'),
  );
  for (const c of dated)
    lines.push({ kind: c.kind as PaydayLine['kind'], id: c.id, name: c.name, amount: c.amount, note: c.note, action: false });
  let toGoals = 0;
  for (const { goal, pending } of goalPending) {
    if (pending <= 0.5) continue;
    const uyu = convert(pending, goal.currency, 'UYU', rate);
    toGoals += uyu;
    lines.push({
      kind: 'goal',
      id: `goal:${goal.id}`,
      name: `${goal.icon} ${goal.name}`,
      amount: round2(uyu),
      goalId: goal.id,
      currency: goal.currency,
      original: round2(pending),
      note: goal.currency === 'USD' ? `Comprar US$ ${Math.round(pending)} a ${rate}` : 'Lo que le toca este mes',
      action: true,
    });
  }
  // La meta de ahorro del mes, en lo que no cubren las metas.
  const rest = round2(b.savingsGoal.pending - toGoals);
  if (rest > 0.5) {
    const target =
      data.goals.find((g) => g.id === data.settings.autoSaveGoalId && !g.archived) ??
      data.goals.find((g) => !g.archived && g.currency === 'UYU');
    lines.push({
      kind: 'saving',
      id: 'saving-month',
      name: target ? `${target.icon} Ahorro del mes → ${target.name}` : 'Ahorro del mes',
      amount: rest,
      goalId: target?.id,
      currency: target?.currency ?? 'UYU',
      original: target ? round2(convert(rest, 'UYU', target.currency, rate)) : rest,
      note: 'Lo que falta para tu meta de ahorro del mes',
      action: !!target,
    });
  }
  const provisions = sinkingFunds(data, monthOf(today)).filter((s) => !fixed.some((c) => c.id.startsWith(`${s.id}:`)));
  const perMonth = round2(provisions.reduce((s, x) => s + x.perMonth, 0));
  if (perMonth > 0.5)
    lines.push({
      kind: 'provision',
      id: 'provisions',
      name: 'Para lo que pagás cada tanto',
      amount: perMonth,
      note: provisions.map((s) => `${s.name} ${Math.round(s.perMonth)}/mes`).join(' · '),
      action: false,
    });
  const reserved = round2(lines.reduce((s, l) => s + l.amount, 0));
  const left = round2(income - reserved);
  return { income: round2(income), until, days, lines, reserved, left, perDay: left > 0 ? round2(left / days) : null };
}

/** ¿Está activo este sueldo este mes? (para el plan del cobro). */
export const activeIncomes = (data: LiftyData, month: string) =>
  data.incomes.filter((i) => !i.archived && isActiveIn(month, i.startMonth, i.endMonth));
