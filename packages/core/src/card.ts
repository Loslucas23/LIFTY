import type { MonthBudget, TxLine } from './budget';
import { round2 } from './money';
import type { Account, LiftyData, Transaction } from './schema';

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
  payments: Transaction[];
  status: 'empty' | 'pending' | 'partial' | 'paid';
}

export function cardStatements(data: LiftyData, budget: MonthBudget): CardStatement[] {
  const cards = data.accounts.filter((a) => a.type === 'credit');
  return cards
    .map((account) => {
      const items = budget.card.items.filter((l) => l.accountId === account.id);
      const payments = data.transactions.filter(
        (t) => t.linkKind === 'cardbill' && t.toAccountId === account.id && t.linkMonth === budget.month,
      );
      const uyu = round2(items.filter((l) => l.currency === 'UYU').reduce((s, l) => s + l.original, 0));
      const usd = round2(items.filter((l) => l.currency === 'USD').reduce((s, l) => s + l.original, 0));
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
        totalUYU: round2(items.reduce((s, l) => s + l.amount, 0)),
        paidUYU,
        paidUSD,
        pendingUYU,
        pendingUSD,
        payments,
        status,
      };
    })
    .filter((s) => !s.account.archived || s.status !== 'empty');
}
