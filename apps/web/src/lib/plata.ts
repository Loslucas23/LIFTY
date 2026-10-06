import {
  addDays,
  convert,
  mainAccount,
  newId,
  round2,
  type Account,
  type Debt,
  type Goal,
  type LiftyData,
  type Mutation,
  type PaydayLine,
  type Transaction,
} from '@lifty/core';
import { toast } from '../components/ui';
import { money } from './format';
import { mutate, mutateMany } from './sync';

/** Acciones de "Tu plata": decir dónde está una meta, asignar ahorro, intereses, cuotas y el cobro. */

const stamp = () => new Date().toISOString();

function txBase(today: string): Omit<Transaction, 'id' | 'kind' | 'amount'> {
  return {
    updatedAt: '',
    date: today,
    currency: 'UYU',
    fxRate: 1,
    categoryId: null,
    accountId: null,
    toAccountId: null,
    sharedAmount: 0,
    sharedWith: '',
    goalId: null,
    description: '',
    tags: [],
    installments: 1,
    firstInstallmentMonth: null,
    linkKind: null,
    linkId: null,
    linkMonth: null,
  };
}

/** La meta vive en esta cuenta. */
export function setGoalAccount(goal: Goal, account: Account) {
  mutate('goal', 'upsert', { ...goal, accountId: account.id });
  toast(`${goal.name}: guardado en ${account.name}`, {
    action: { label: 'Deshacer', run: () => mutate('goal', 'upsert', goal) },
  });
}

/**
 * Asignar a una meta plata que ya está en su cuenta (ej: dólares guardados sin destino): no mueve
 * plata ni toca el presupuesto, solo le da un destino.
 */
export function assignToGoal(data: LiftyData, account: Account, goal: Goal, amount: number, today: string) {
  const rate = data.settings.usdRate;
  const tx: Transaction = {
    ...txBase(today),
    id: newId(),
    kind: 'saving',
    amount: round2(amount),
    currency: goal.currency,
    fxRate: goal.currency === 'USD' ? rate : 1,
    accountId: account.id,
    goalId: goal.id,
    description: `Asignado desde ${account.name}`,
  };
  mutate('transaction', 'upsert', tx);
  toast(`${money(amount, goal.currency)} a ${goal.name}`, {
    action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', tx.id) },
  });
}

/** Anota los intereses de una inversión (quedan en la inversión: es ahorro que crece). */
export function registerInterest(account: Account, amount: number, today: string) {
  const tx: Transaction = {
    ...txBase(today),
    id: newId(),
    kind: 'income',
    amount: round2(amount),
    currency: account.currency,
    accountId: account.id,
    categoryId: 'cat-rendimientos',
    description: `Intereses · ${account.name}`,
  };
  mutate('transaction', 'upsert', tx);
  toast(`Intereses anotados: ${money(amount, account.currency)}`, {
    action: { label: 'Deshacer', run: () => mutate('transaction', 'delete', tx.id) },
  });
}

/** Renovar un plazo fijo: corre el vencimiento. */
export function renewInvestment(account: Account, days: number, today: string) {
  const from = account.maturity && account.maturity > today ? account.maturity : today;
  mutate('account', 'upsert', { ...account, maturity: addDays(from, days) });
  toast(`${account.name}: renovado hasta el ${addDays(from, days).split('-').reverse().join('/')}`, {
    action: { label: 'Deshacer', run: () => mutate('account', 'upsert', account) },
  });
}

/** Pagar (o cobrar) la cuota del mes de un préstamo. */
export function payInstallment(data: LiftyData, debt: Debt, amount: number, today: string) {
  const payment = {
    id: newId(),
    date: today,
    amount: round2(amount),
    accountId: debt.accountId ?? mainAccount(data)?.id ?? null,
  };
  mutate('debt', 'upsert', { ...debt, payments: [...debt.payments, payment] });
  toast(`Cuota ${debt.direction === 'borrowed' ? 'pagada' : 'cobrada'}: ${money(amount, debt.currency)}`, {
    action: { label: 'Deshacer', run: () => mutate('debt', 'upsert', debt) },
  });
}

/**
 * Repartir el cobro: deposita en cada meta lo elegido (los dólares, a la cotización de hoy),
 * desde la cuenta donde cobraste.
 */
export function doPayday(data: LiftyData, lines: PaydayLine[], fromAccountId: string | null, today: string) {
  const rate = data.settings.usdRate;
  const from = fromAccountId ?? mainAccount(data)?.id ?? null;
  const updatedAt = stamp();
  const muts: Mutation[] = [];
  for (const l of lines) {
    if (!l.action || !l.goalId) continue;
    const currency = l.currency ?? 'UYU';
    const amount = round2(l.original ?? convert(l.amount, 'UYU', currency, rate));
    if (amount <= 0) continue;
    const record: Transaction = {
      ...txBase(today),
      id: newId(),
      kind: 'saving',
      amount,
      currency,
      fxRate: currency === 'USD' ? rate : 1,
      accountId: from,
      goalId: l.goalId,
      description: 'Repartir el cobro',
    };
    muts.push({ entity: 'transaction', op: 'upsert', id: record.id, updatedAt, record });
  }
  if (!muts.length) return 0;
  mutateMany(muts);
  toast(`Listo: ${muts.length} depósito${muts.length === 1 ? '' : 's'} a tus metas`, {
    action: { label: 'Deshacer', run: () => muts.forEach((m) => mutate('transaction', 'delete', m.id)) },
  });
  return muts.length;
}
