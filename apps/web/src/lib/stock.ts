import { newId, round2, type Mutation, type StockMove, type StockMoveKind, type Transaction } from '@lifty/core';
import { toast } from '../components/ui';
import { money } from './format';
import { mutate, mutateMany } from './sync';

/** Anota un movimiento de stock (con deshacer). */
export function addStockMove(
  itemId: string,
  kind: StockMoveKind,
  quantity: number,
  date: string,
  extra: Partial<Pick<StockMove, 'price' | 'store' | 'expiry' | 'txId'>> = {},
  message?: string,
) {
  const move: StockMove = {
    id: newId(),
    updatedAt: '',
    itemId,
    date,
    kind,
    quantity: round2(quantity),
    price: extra.price ?? null,
    store: extra.store ?? '',
    expiry: extra.expiry ?? null,
    txId: extra.txId ?? null,
  };
  mutate('stockMove', 'upsert', move);
  if (message) toast(message, { action: { label: 'Deshacer', run: () => mutate('stockMove', 'delete', move.id) } });
  return move;
}

export interface PurchaseLine {
  itemId: string;
  quantity: number;
  /** Total pagado por esa cantidad (puede faltar). */
  price: number | null;
  expiry: string | null;
}

/**
 * Registra una compra: suma cada producto al stock y, si querés, carga un solo gasto con el
 * total (categoría Súper) en la cuenta que elijas (ej: tarjeta de alimentación).
 */
export function recordPurchase(opts: {
  date: string;
  store: string;
  accountId: string | null;
  lines: PurchaseLine[];
  withExpense: boolean;
}) {
  const lines = opts.lines.filter((l) => l.quantity > 0);
  if (!lines.length) return;
  const total = round2(lines.reduce((s, l) => s + (l.price ?? 0), 0));
  const updatedAt = new Date().toISOString();
  const txId = opts.withExpense && total > 0 ? newId() : null;
  const moves: StockMove[] = lines.map((l) => ({
    id: newId(),
    updatedAt,
    itemId: l.itemId,
    date: opts.date,
    kind: 'buy',
    quantity: round2(l.quantity),
    price: l.price,
    store: opts.store.trim(),
    expiry: l.expiry,
    txId,
  }));
  const mutations: Mutation[] = moves.map((m) => ({ entity: 'stockMove', op: 'upsert', id: m.id, updatedAt, record: m }));
  if (txId) {
    const tx: Transaction = {
      id: txId,
      updatedAt,
      date: opts.date,
      kind: 'expense',
      amount: total,
      currency: 'UYU',
      fxRate: 1,
      categoryId: 'cat-super',
      accountId: opts.accountId,
      toAccountId: null,
      goalId: null,
      description: opts.store.trim() ? `Compra en ${opts.store.trim()}` : 'Compra del súper',
      installments: 1,
      firstInstallmentMonth: null,
      linkKind: null,
      linkId: null,
      linkMonth: null,
      sharedAmount: 0,
      sharedWith: '',
      tags: [],
    };
    mutations.push({ entity: 'transaction', op: 'upsert', id: txId, updatedAt, record: tx });
  }
  mutateMany(mutations);
  toast(
    txId
      ? `Compra registrada: ${lines.length} producto${lines.length === 1 ? '' : 's'} y gasto de ${money(total)}`
      : `Compra registrada: ${lines.length} producto${lines.length === 1 ? '' : 's'}`,
    {
      action: {
        label: 'Deshacer',
        run: () => {
          for (const m of moves) mutate('stockMove', 'delete', m.id);
          if (txId) mutate('transaction', 'delete', txId);
        },
      },
    },
  );
}
