import type { MonthBudget, PlannedLine } from './budget';
import { addMonths, daysInMonth, monthLabel, monthOf } from './months';
import { fold, round2 } from './money';
import type { AutoLog, CategoryRule, LiftyData, Mutation, ShopEntry, Transaction } from './schema';
import { stockOverview, UNIT_LABEL } from './stock';

/**
 * Piloto automático: lo que Lifty hace solo, sin que lo anotes, con reglas que vos activás.
 *  - Gastos fijos con débito: el día que vencen se marcan pagados.
 *  - Sueldo: el día de cobro se marca cobrado.
 *  - Tarjeta de alimentación: la carga se anota el día de carga.
 *  - Ahorro: cuando cobraste, lo que falta para la meta del mes pasa al ahorro.
 *  - Lista de compras: lo que se termina en el stock va a la lista.
 *  - Reglas: los movimientos sin categoría cuya descripción coincide con una regla se categorizan.
 *
 * Cada acción tiene una clave (`fixed:<id>:<mes>`…) y queda en el historial (`autoLog`): se hace
 * una sola vez aunque haya varios dispositivos (los ids son siempre los mismos) y, si la
 * deshacés, no se vuelve a hacer.
 */

export interface AutoAction {
  key: string;
  kind: AutoLog['kind'];
  title: string;
  /** Lo que hay que guardar (registros nuevos o cambiados). */
  records: { entity: 'transaction' | 'shopEntry'; record: Transaction | ShopEntry; before?: Transaction }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayIn = (month: string, day: number) => `${month}-${pad(Math.min(day, daysInMonth(month)))}`;
/** Los ids que crea el piloto: siempre iguales para la misma acción (así no se duplica). */
const autoId = (key: string) => `ap-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`.slice(0, 64);

function tx(base: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'kind' | 'amount'>): Transaction {
  return {
    updatedAt: '',
    currency: 'UYU',
    fxRate: 1,
    categoryId: null,
    accountId: null,
    toAccountId: null,
    goalId: null,
    description: '',
    installments: 1,
    firstInstallmentMonth: null,
    linkKind: null,
    linkId: null,
    linkMonth: null,
    sharedAmount: 0,
    sharedWith: '',
    tags: [],
    ...base,
  };
}

/** El movimiento que confirma algo planificado (sueldo o fijo), como cuando lo tildás. */
function confirmLine(data: LiftyData, line: PlannedLine, month: string, date: string, key: string): Transaction {
  return tx({
    id: autoId(key),
    date,
    kind: line.kind === 'fixed' ? 'expense' : 'income',
    amount: line.plannedOriginal,
    currency: line.currency,
    fxRate: line.currency === 'USD' ? data.settings.usdRate : 1,
    categoryId: line.categoryId ?? (line.kind === 'fixed' ? null : 'cat-sueldo'),
    accountId: line.accountId,
    description: line.name,
    linkKind: line.kind,
    linkId: line.refId,
    linkMonth: month,
    tags: ['automático'],
  });
}

/** La regla que corresponde a una descripción (la más específica: el texto más largo). */
export function matchRule(rules: CategoryRule[], description: string): CategoryRule | null {
  const d = fold(description);
  if (!d) return null;
  return rules.filter((r) => d.includes(fold(r.contains))).sort((a, b) => b.contains.length - a.contains.length)[0] ?? null;
}

export function autopilot(data: LiftyData, b: MonthBudget, today: string): AutoAction[] {
  const month = monthOf(today);
  if (b.month !== month) return [];
  const done = new Set(data.autoLogs.map((l) => l.id));
  const out: AutoAction[] = [];
  const add = (a: AutoAction) => {
    const key = a.key.slice(0, 64);
    if (!done.has(key) && a.records.length) out.push({ ...a, key });
  };

  // Gastos fijos con débito automático.
  const fixedById = new Map(data.fixed.map((f) => [f.id, f]));
  for (const line of b.fixed.items) {
    const f = fixedById.get(line.refId);
    if (!f?.autopay || line.confirmed || !line.day) continue;
    const date = dayIn(month, line.day);
    if (date > today) continue;
    const key = `fixed:${f.id}:${month}`;
    add({
      key,
      kind: 'fixed',
      title: `${f.name}: pagado (débito automático)`,
      records: [{ entity: 'transaction', record: confirmLine(data, line, month, date, key) }],
    });
  }

  // Sueldos que se cobran solos el día de cobro.
  const incomeById = new Map(data.incomes.map((i) => [i.id, i]));
  for (const line of b.income.planned) {
    const inc = incomeById.get(line.refId);
    if (line.kind !== 'salary' || !inc?.autoConfirm || line.confirmed || !line.day) continue;
    const date = dayIn(month, line.day);
    if (date > today) continue;
    const key = `income:${inc.id}:${month}`;
    add({
      key,
      kind: 'income',
      title: `${inc.name}: cobrado`,
      records: [{ entity: 'transaction', record: confirmLine(data, line, month, date, key) }],
    });
  }

  // Carga de la tarjeta de alimentación.
  for (const a of data.accounts) {
    if (a.type !== 'food' || !a.autoLoad || !a.monthlyLoad || !a.loadDay || a.archived) continue;
    const date = dayIn(month, a.loadDay);
    if (date > today) continue;
    if (data.transactions.some((t) => t.linkKind === 'load' && t.linkId === a.id && t.linkMonth === month)) continue;
    const key = `load:${a.id}:${month}`;
    add({
      key,
      kind: 'load',
      title: `Carga de ${a.name}: ${a.monthlyLoad.toLocaleString('es-UY')}`,
      records: [
        {
          entity: 'transaction',
          record: tx({
            id: autoId(key),
            date,
            kind: 'income',
            amount: a.monthlyLoad,
            currency: a.currency,
            accountId: a.id,
            description: `Carga de ${monthLabel(month, false).toLowerCase()}`,
            linkKind: 'load',
            linkId: a.id,
            linkMonth: month,
            tags: ['automático'],
          }),
        },
      ],
    });
  }

  // Ahorro automático: cuando ya cobraste (todo lo planificado del mes), lo que falta de la meta.
  const st = data.settings;
  if (st.autoSave && b.savingsGoal.pending > 0 && b.income.planned.length > 0 && b.income.pending <= 0) {
    const goal =
      data.goals.find((g) => g.id === st.autoSaveGoalId && !g.archived) ??
      data.goals.find((g) => !g.archived && g.currency === 'UYU') ??
      null;
    const key = `saving:${month}`;
    add({
      key,
      kind: 'saving',
      title: `${round2(b.savingsGoal.pending).toLocaleString('es-UY')} al ahorro${goal ? ` (${goal.name})` : ''}`,
      records: [
        {
          entity: 'transaction',
          record: tx({
            id: autoId(key),
            date: today,
            kind: 'saving',
            amount: round2(b.savingsGoal.pending),
            goalId: goal?.id ?? null,
            description: 'Ahorro automático del mes',
            tags: ['automático'],
          }),
        },
      ],
    });
  }

  // Lista de compras: lo que se terminó o se termina antes de la próxima compra.
  if (st.autoShop && data.stockItems.length) {
    const listed = new Set(data.shopEntries.filter((e) => !e.checked).map((e) => e.itemId));
    for (const s of stockOverview(data.stockItems, data.stockMoves, today, data.settings).shopping) {
      if (listed.has(s.item.id)) continue;
      // Una vez por "vuelta": hasta la próxima compra de ese producto.
      const lastBuy = data.stockMoves
        .filter((m) => m.itemId === s.item.id && m.kind === 'buy')
        .reduce<string | null>((m, x) => (!m || x.date > m ? x.date : m), null);
      const key = `shop:${s.item.id}:${lastBuy ?? 'nunca'}`;
      add({
        key,
        kind: 'shop',
        title: `${s.item.name} a la lista de compras`,
        records: [
          {
            entity: 'shopEntry',
            record: {
              id: autoId(key),
              updatedAt: '',
              itemId: s.item.id,
              name: s.item.name,
              quantity: s.toBuy || s.item.packSize || 1,
              unit: UNIT_LABEL[s.item.unit],
              checked: false,
            },
          },
        ],
      });
    }
  }

  // Reglas de categoría para lo que quedó sin categoría (de los últimos 2 meses).
  if (data.rules.length) {
    const since = `${addMonths(month, -1)}-01`;
    for (const t of data.transactions) {
      if (t.categoryId || t.date < since || (t.kind !== 'expense' && t.kind !== 'income') || t.linkKind) continue;
      const rule = matchRule(data.rules, t.description);
      if (!rule) continue;
      const cat = data.categories.find((c) => c.id === rule.categoryId);
      if (!cat || cat.kind !== (t.kind === 'income' ? 'income' : 'expense')) continue;
      const key = `category:${t.id}`;
      add({
        key,
        kind: 'category',
        title: `"${t.description}" → ${cat.name}`,
        records: [{ entity: 'transaction', record: { ...t, categoryId: cat.id }, before: t }],
      });
    }
  }
  return out;
}

/** Las mutaciones para aplicar una acción y su registro en el historial. */
export function autopilotMutations(actions: AutoAction[], today: string, now = new Date().toISOString()): Mutation[] {
  const out: Mutation[] = [];
  for (const a of actions) {
    for (const r of a.records)
      out.push({ entity: r.entity, op: 'upsert', id: r.record.id, updatedAt: now, record: { ...r.record, updatedAt: now } });
    const log: AutoLog = {
      id: a.key.slice(0, 64),
      updatedAt: now,
      date: today,
      kind: a.kind,
      title: a.title.slice(0, 120),
      created: a.records.map((r) => ({ entity: r.entity, id: r.record.id })),
      before: a.records.filter((r) => r.before).map((r) => r.before),
      undone: false,
    };
    out.push({ entity: 'autoLog', op: 'upsert', id: log.id, updatedAt: now, record: log });
  }
  return out;
}

/** Deshacer lo que hizo el piloto: borra lo que creó (o vuelve atrás lo que cambió) y no lo repite. */
export function undoAutopilot(log: AutoLog, now = new Date().toISOString()): Mutation[] {
  const out: Mutation[] = [];
  const before = (log.before ?? []) as Transaction[];
  for (const c of log.created) {
    const prev = before.find((b) => b?.id === c.id);
    if (prev) out.push({ entity: c.entity, op: 'upsert', id: c.id, updatedAt: now, record: { ...prev, updatedAt: now } });
    else out.push({ entity: c.entity, op: 'delete', id: c.id, updatedAt: now });
  }
  out.push({ entity: 'autoLog', op: 'upsert', id: log.id, updatedAt: now, record: { ...log, updatedAt: now, undone: true } });
  return out;
}

/**
 * Reglas sugeridas: palabras que usaste 4 veces o más y siempre en la misma categoría
 * ("uber" → Transporte), que todavía no son una regla.
 */
export function suggestRules(data: LiftyData): { contains: string; categoryId: string; count: number }[] {
  const counts = new Map<string, Map<string, number>>();
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || !t.categoryId || t.linkKind) continue;
    for (const w of new Set(
      fold(t.description)
        .split(/[^a-z0-9ñ]+/)
        .filter((x) => x.length >= 4 && !/^\d+$/.test(x)),
    )) {
      const m = counts.get(w) ?? new Map<string, number>();
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
      counts.set(w, m);
    }
  }
  const existing = new Set(data.rules.map((r) => fold(r.contains)));
  const out: { contains: string; categoryId: string; count: number }[] = [];
  for (const [w, m] of counts) {
    if (m.size !== 1 || existing.has(w)) continue;
    const [[categoryId, count]] = [...m.entries()];
    if (count >= 4) out.push({ contains: w, categoryId, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 8);
}
