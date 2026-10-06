import type { MonthBudget, TxLine } from './budget';
import { addMonths, daysInMonth, monthLabel } from './months';
import { round2 } from './money';
import type { Account, LiftyData, Transaction } from './schema';

const pad = (n: number) => String(n).padStart(2, '0');

/** Cuotas de una compra (copia local de `installmentsOf`, para no depender de budget.ts). */
function installmentMonths(tx: Transaction): { month: string; amount: number }[] {
  const n = Math.max(1, tx.installments || 1);
  const first = tx.firstInstallmentMonth ?? tx.date.slice(0, 7);
  const each = round2(tx.amount / n);
  return Array.from({ length: n }, (_, i) => ({
    month: addMonths(first, i),
    amount: i === n - 1 ? round2(tx.amount - each * (n - 1)) : each,
  }));
}

/** De qué cuenta sale el pago de la tarjeta: la elegida o tu cuenta principal en pesos. */
export function cardPayFrom(data: Pick<LiftyData, 'accounts'>, card: Account): Account | null {
  const usable = (a: Account) => (a.type === 'bank' || a.type === 'cash') && !a.archived && !a.reserved;
  if (card.payFromAccountId) {
    const chosen = data.accounts.find((a) => a.id === card.payFromAccountId);
    if (chosen && usable(chosen)) return chosen;
  }
  return (
    data.accounts.find((a) => usable(a) && a.type === 'bank' && a.currency === 'UYU') ??
    data.accounts.find((a) => usable(a) && a.currency === 'UYU') ??
    null
  );
}

/** Cuándo se paga el resumen de `month`: el día elegido del mes siguiente, o el último día del mes. */
export function cardPayDate(card: Pick<Account, 'payDay'>, month: string): string {
  if (card.payDay) {
    const next = addMonths(month, 1);
    return `${next}-${pad(Math.min(card.payDay, daysInMonth(next)))}`;
  }
  return `${month}-${pad(daysInMonth(month))}`;
}

/**
 * Lo que debías en la tarjeta cuando pusiste su saldo (no son compras que Lifty conozca): va al
 * primer resumen que se paga después de ese día.
 */
export function openingDebt(card: Account): { month: string; amount: number } | null {
  if (card.type !== 'credit' || !card.initialBalanceDate || !(card.initialBalance < 0)) return null;
  const m = card.initialBalanceDate.slice(0, 7);
  const month = cardPayDate(card, m) > card.initialBalanceDate ? m : addMonths(m, 1);
  return { month, amount: round2(-card.initialBalance) };
}

/**
 * Débito automático: cada resumen de una tarjeta con `autopay` cuya fecha de pago ya pasó se
 * da por pagado (lo que no pagaste a mano), con una transferencia desde tu cuenta. Los dólares
 * se pagan a la cotización de las compras, así la tarjeta queda en cero.
 */
export function cardAutoPayments(data: LiftyData, upTo: string): Transaction[] {
  const rate = data.settings.usdRate;
  const out: Transaction[] = [];
  for (const card of data.accounts) {
    if (card.type !== 'credit' || card.autopay === false) continue;
    const from = cardPayFrom(data, card);
    const due = new Map<string, { UYU: number; USD: number; usdInUYU: number }>();
    for (const t of data.transactions) {
      if (t.accountId !== card.id || t.kind !== 'expense') continue;
      const r = t.currency === 'USD' && t.fxRate && t.fxRate !== 1 ? t.fxRate : rate;
      for (const i of installmentMonths(t)) {
        const m = due.get(i.month) ?? { UYU: 0, USD: 0, usdInUYU: 0 };
        m[t.currency] += i.amount;
        if (t.currency === 'USD') m.usdInUYU += i.amount * r;
        due.set(i.month, m);
      }
    }
    const opening = openingDebt(card);
    if (opening) {
      const m = due.get(opening.month) ?? { UYU: 0, USD: 0, usdInUYU: 0 };
      m[card.currency] += opening.amount;
      if (card.currency === 'USD') m.usdInUYU += opening.amount * rate;
      due.set(opening.month, m);
    }
    for (const [month, total] of due) {
      const date = cardPayDate(card, month);
      if (date > upTo) continue;
      const paid = { UYU: 0, USD: 0 };
      for (const t of data.transactions)
        if (t.linkKind === 'cardbill' && t.toAccountId === card.id && t.linkMonth === month) paid[t.currency] += t.amount;
      for (const currency of ['UYU', 'USD'] as const) {
        const pending = round2(total[currency] - paid[currency]);
        if (pending <= 0.004) continue;
        out.push({
          id: `auto-cardbill:${card.id}:${month}:${currency}`,
          updatedAt: '',
          date,
          kind: 'transfer',
          amount: pending,
          currency,
          fxRate: currency === 'USD' && total.USD > 0 ? round2(total.usdInUYU / total.USD) : 1,
          categoryId: null,
          accountId: from?.id ?? null,
          toAccountId: card.id,
          goalId: null,
          description: `Débito automático · resumen de ${monthLabel(month, false).toLowerCase()}`,
          installments: 1,
          firstInstallmentMonth: null,
          linkKind: 'cardbill',
          linkId: card.id,
          linkMonth: month,
          sharedAmount: 0,
          sharedWith: '',
          tags: [],
        });
      }
    }
  }
  return out;
}

/**
 * Resumen de una tarjeta de crédito en un mes: las cuotas y compras que caen ese mes,
 * separadas en pesos y dólares (como viene el estado de cuenta), y lo que ya pagaste.
 * Pagar el resumen NO es un gasto: es mover plata del banco a la tarjeta (los gastos ya
 * se contaron al comprar o en cada cuota).
 */
export interface CardStatement {
  account: Account;
  month: string;
  items: TxLine[];
  /** Lo del mes en pesos y en dólares (moneda original). */
  uyu: number;
  usd: number;
  /** Total del mes pasado a pesos (cotización de cada compra). */
  totalUYU: number;
  paidUYU: number;
  paidUSD: number;
  pendingUYU: number;
  pendingUSD: number;
  /** Pagos del resumen (los del débito automático tienen id `auto-cardbill:…`). */
  payments: Transaction[];
  status: 'empty' | 'pending' | 'partial' | 'paid';
  /** Cuándo se paga (o se debita) este resumen. */
  payDate: string;
  /** Lo que debías al poner el saldo de la tarjeta (se suma a este resumen). */
  opening: number;
  autopay: boolean;
}

export function cardStatements(data: LiftyData, budget: MonthBudget, today?: string): CardStatement[] {
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const auto = today ? cardAutoPayments(data, today) : [];
  return cards
    .map((account) => {
      const items = budget.card.items.filter((l) => l.accountId === account.id);
      const od = openingDebt(account);
      const opening = od && od.month === budget.month ? od.amount : 0;
      const payments = [...data.transactions, ...auto].filter(
        (t) => t.linkKind === 'cardbill' && t.toAccountId === account.id && t.linkMonth === budget.month,
      );
      const uyu = round2(
        items.filter((l) => l.currency === 'UYU').reduce((s, l) => s + l.original, 0) +
          (account.currency === 'UYU' ? opening : 0),
      );
      const usd = round2(
        items.filter((l) => l.currency === 'USD').reduce((s, l) => s + l.original, 0) +
          (account.currency === 'USD' ? opening : 0),
      );
      const paidUYU = round2(payments.filter((t) => t.currency === 'UYU').reduce((s, t) => s + t.amount, 0));
      const paidUSD = round2(payments.filter((t) => t.currency === 'USD').reduce((s, t) => s + t.amount, 0));
      const pendingUYU = round2(Math.max(0, uyu - paidUYU));
      const pendingUSD = round2(Math.max(0, usd - paidUSD));
      const status: CardStatement['status'] =
        uyu === 0 && usd === 0
          ? 'empty'
          : pendingUYU === 0 && pendingUSD === 0
            ? 'paid'
            : paidUYU > 0 || paidUSD > 0
              ? 'partial'
              : 'pending';
      return {
        account,
        month: budget.month,
        items,
        uyu,
        usd,
        totalUYU: round2(
          items.reduce((s, l) => s + l.amount, 0) + (account.currency === 'USD' ? opening * data.settings.usdRate : opening),
        ),
        paidUYU,
        paidUSD,
        pendingUYU,
        pendingUSD,
        payments,
        status,
        payDate: cardPayDate(account, budget.month),
        opening,
        autopay: account.autopay !== false,
      };
    })
    .filter((s) => !s.account.archived || s.status !== 'empty');
}
