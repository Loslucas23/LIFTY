import { groupTransaction, transactionSchema, type Group, type GroupExpense, type LiftyData, type Mutation } from '@lifty/core';
import { toast } from '../components/ui';
import { mutateMany } from './sync';

/**
 * Guardar un gasto (o un pago para saldar) del grupo junto con tu movimiento: tu parte del
 * gasto, lo que pagaste por todos o la plata que salió o entró al saldar.
 */
function syncMutations(data: LiftyData, group: Group, e: GroupExpense, now: string): Mutation[] {
  const existing = data.transactions.find((t) => t.groupExpenseId === e.id) ?? null;
  const tx = groupTransaction(data, group, e, existing);
  if (tx) {
    const record = transactionSchema.parse({ ...tx, updatedAt: now });
    return [{ entity: 'transaction', op: 'upsert', id: record.id, updatedAt: now, record }];
  }
  return existing ? [{ entity: 'transaction', op: 'delete', id: existing.id, updatedAt: now }] : [];
}

export function saveGroupExpense(data: LiftyData, group: Group, e: GroupExpense) {
  const now = new Date().toISOString();
  mutateMany([
    { entity: 'groupExpense', op: 'upsert', id: e.id, updatedAt: now, record: { ...e, updatedAt: now } },
    ...syncMutations(data, group, e, now),
  ]);
}

export function deleteGroupExpense(data: LiftyData, e: GroupExpense) {
  const now = new Date().toISOString();
  const tx = data.transactions.find((t) => t.groupExpenseId === e.id);
  mutateMany([
    { entity: 'groupExpense', op: 'delete', id: e.id, updatedAt: now },
    ...(tx ? [{ entity: 'transaction' as const, op: 'delete' as const, id: tx.id, updatedAt: now }] : []),
  ]);
  toast('Borrado', {
    action: {
      label: 'Deshacer',
      run: () => {
        const at = new Date().toISOString();
        mutateMany([
          { entity: 'groupExpense', op: 'upsert', id: e.id, updatedAt: at, record: { ...e, updatedAt: at } },
          ...(tx
            ? [
                {
                  entity: 'transaction' as const,
                  op: 'upsert' as const,
                  id: tx.id,
                  updatedAt: at,
                  record: { ...tx, updatedAt: at },
                },
              ]
            : []),
        ]);
      },
    },
  });
}

/** Guardar el grupo y poner al día tus movimientos (nombre, viaje y su etiqueta). */
export function saveGroup(data: LiftyData, group: Group) {
  const now = new Date().toISOString();
  const muts: Mutation[] = [
    { entity: 'group', op: 'upsert', id: group.id, updatedAt: now, record: { ...group, updatedAt: now } },
  ];
  for (const e of data.groupExpenses) if (e.groupId === group.id) muts.push(...syncMutations(data, group, e, now));
  mutateMany(muts);
}
