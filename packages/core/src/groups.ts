import { formatMoney, round2 } from './money';
import { ME, type Group, type GroupExpense, type GroupMember, type LiftyData, type Period, type Transaction } from './schema';

/**
 * Gastos en grupo (como Splitwise): quién puso cuánto, quién le debe a quién y cómo saldar con
 * la menor cantidad de pagos. Con tu plata se une así (y todo cuadra):
 * - Si pagaste vos: un gasto por el total desde tu cuenta, con la parte de los demás como
 *   "dividido" (en tu presupuesto cuenta solo tu parte).
 * - Si pagó otro: un gasto por tu parte sin cuenta (no salió plata tuya todavía).
 * - Saldar: un movimiento que saca (o mete) plata en tu cuenta sin ser gasto.
 */

/** Partes iguales, con los centavos que sobran repartidos de a uno (el total da exacto). */
export function equalSplit(amount: number, memberIds: string[]): { memberId: string; amount: number }[] {
  if (!memberIds.length) return [];
  const cents = Math.round(amount * 100);
  const each = Math.floor(cents / memberIds.length);
  let rest = cents - each * memberIds.length;
  return memberIds.map((memberId) => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return { memberId, amount: (each + extra) / 100 };
  });
}

export interface MemberBalance {
  member: GroupMember;
  /** Lo que puso (gastos que pagó y pagos que hizo para saldar). */
  paid: number;
  /** Lo que le tocaba (sus partes y los pagos que recibió). */
  share: number;
  /** Positivo: le deben. Negativo: debe. */
  balance: number;
}

/** Cómo queda cada uno: lo que puso − lo que le tocaba. */
export function groupBalances(group: Group, expenses: GroupExpense[]): MemberBalance[] {
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  for (const e of expenses) {
    if (e.groupId !== group.id) continue;
    paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.amount);
    for (const s of e.split) share.set(s.memberId, (share.get(s.memberId) ?? 0) + s.amount);
  }
  return group.members.map((member) => {
    const p = round2(paid.get(member.id) ?? 0);
    const s = round2(share.get(member.id) ?? 0);
    return { member, paid: p, share: s, balance: round2(p - s) };
  });
}

export interface Payment {
  from: GroupMember;
  to: GroupMember;
  amount: number;
}

/**
 * Cómo saldar con la menor cantidad de pagos: el que más debe le paga al que más le deben,
 * hasta que alguno queda en cero, y así (como mucho, un pago menos que la cantidad de personas).
 */
export function settleUp(balances: MemberBalance[]): Payment[] {
  const debtors = balances.filter((b) => b.balance < -0.004).map((b) => ({ m: b.member, v: -b.balance }));
  const creditors = balances.filter((b) => b.balance > 0.004).map((b) => ({ m: b.member, v: b.balance }));
  const out: Payment[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.v - a.v);
    creditors.sort((a, b) => b.v - a.v);
    const d = debtors[0];
    const c = creditors[0];
    const amount = round2(Math.min(d.v, c.v));
    out.push({ from: d.m, to: c.m, amount });
    d.v = round2(d.v - amount);
    c.v = round2(c.v - amount);
    if (d.v <= 0.004) debtors.shift();
    if (c.v <= 0.004) creditors.shift();
  }
  return out;
}

export interface GroupSummary {
  group: Group;
  balances: MemberBalance[];
  payments: Payment[];
  /** Lo gastado entre todos (sin los pagos para saldar). */
  total: number;
  /** Tu parte de lo gastado. */
  myShare: number;
  /** Positivo: te deben. Negativo: debés. */
  myBalance: number;
  count: number;
  period: Period | null;
}

export function groupSummary(data: Pick<LiftyData, 'groupExpenses' | 'periods'>, group: Group): GroupSummary {
  const expenses = data.groupExpenses.filter((e) => e.groupId === group.id);
  const balances = groupBalances(group, expenses);
  const spending = expenses.filter((e) => e.kind === 'expense');
  return {
    group,
    balances,
    payments: settleUp(balances),
    total: round2(spending.reduce((s, e) => s + e.amount, 0)),
    myShare: round2(spending.reduce((s, e) => s + (e.split.find((x) => x.memberId === ME)?.amount ?? 0), 0)),
    myBalance: balances.find((b) => b.member.id === ME)?.balance ?? 0,
    count: spending.length,
    period: group.periodId ? (data.periods.find((p) => p.id === group.periodId) ?? null) : null,
  };
}

/** Lo que te deben y lo que debés en todos los grupos (en pesos y en dólares por separado). */
export function groupTotals(data: Pick<LiftyData, 'groups' | 'groupExpenses' | 'periods'>) {
  const out = { UYU: { owedToMe: 0, iOwe: 0 }, USD: { owedToMe: 0, iOwe: 0 } };
  for (const g of data.groups) {
    if (g.archived) continue;
    const b = groupSummary(data, g).myBalance;
    if (b > 0) out[g.currency].owedToMe = round2(out[g.currency].owedToMe + b);
    else out[g.currency].iOwe = round2(out[g.currency].iOwe - b);
  }
  return out;
}

/**
 * El movimiento tuyo que va con un gasto o pago del grupo (o null si no te toca: un gasto
 * entre otros dos, o un pago entre otros). `existing` conserva el id (para editar).
 */
export function groupTransaction(
  data: Pick<LiftyData, 'periods' | 'settings'>,
  group: Group,
  e: GroupExpense,
  existing: Transaction | null,
): Transaction | null {
  const name = (id: string) => (id === ME ? 'vos' : (group.members.find((m) => m.id === id)?.name ?? 'alguien'));
  const period = group.periodId ? data.periods.find((p) => p.id === group.periodId) : null;
  const base = {
    id: existing?.id ?? `gx:${e.id}`,
    updatedAt: '',
    date: e.date,
    currency: group.currency,
    fxRate: group.currency === 'USD' ? data.settings.usdRate : 1,
    goalId: null,
    installments: 1,
    firstInstallmentMonth: null,
    linkKind: null,
    linkId: null,
    linkMonth: null,
    groupExpenseId: e.id,
    tags: period?.tag ? [period.tag] : [],
  } as const;
  const mine = round2(e.split.filter((s) => s.memberId === ME).reduce((s, x) => s + x.amount, 0));
  if (e.kind === 'settlement') {
    const to = e.split[0]?.memberId;
    if (e.paidBy === ME && to !== ME)
      return {
        ...base,
        kind: 'transfer',
        amount: e.amount,
        categoryId: null,
        accountId: e.accountId,
        toAccountId: null,
        sharedAmount: 0,
        sharedWith: '',
        description: `Le pagaste a ${name(to)} (${group.name})`,
      } as Transaction;
    if (to === ME && e.paidBy !== ME)
      return {
        ...base,
        kind: 'transfer',
        amount: e.amount,
        categoryId: null,
        accountId: null,
        toAccountId: e.accountId,
        sharedAmount: 0,
        sharedWith: '',
        description: `${name(e.paidBy)} te pagó (${group.name})`,
      } as Transaction;
    return null;
  }
  const what = e.description || 'Gasto';
  if (e.paidBy === ME)
    return {
      ...base,
      kind: 'expense',
      amount: e.amount,
      categoryId: e.categoryId,
      accountId: e.accountId,
      toAccountId: null,
      sharedAmount: round2(e.amount - mine),
      sharedWith: mine < e.amount ? group.name : '',
      description: what,
    } as Transaction;
  if (mine <= 0) return null;
  return {
    ...base,
    kind: 'expense',
    amount: mine,
    categoryId: e.categoryId,
    accountId: null,
    toAccountId: null,
    sharedAmount: 0,
    sharedWith: '',
    description: `${what} (pagó ${name(e.paidBy)})`,
  } as Transaction;
}

/** "¡Hola Juan! En «Floripa» quedaron $ 1.200 para pasarme…" */
export function groupReminderText(s: GroupSummary, memberId: string, ownerName = ''): string {
  const m = s.group.members.find((x) => x.id === memberId);
  const pay = s.payments.find((p) => p.from.id === memberId && p.to.id === ME);
  if (!m || !pay) return '';
  const first = m.name.split(/\s+/)[0];
  const sign = ownerName ? `\n${ownerName.split(/\s+/)[0]}` : '';
  return `¡Hola ${first}! Hice las cuentas de «${s.group.name}»: gastamos ${formatMoney(s.total, s.group.currency)} entre todos y para quedar a mano me tenés que pasar ${formatMoney(pay.amount, s.group.currency)}. Cuando puedas 🙂${sign}`;
}
