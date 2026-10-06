import { accountBalances, debtStatus } from './accounts';
import type { MonthBudget } from './budget';
import { monthOf } from './months';
import { reminderStatus } from './extras';
import { habitsToday } from './habits';
import { upcomingEvents } from './insights';
import { fold, round2 } from './money';
import { addDays, daysBetween } from './weight';
import type { LiftyData } from './schema';
import { routinesPaused } from './periods';
import { routineItems } from './shopping';
import { stockOverview } from './stock';
import { subjectStatus } from './study';

/**
 * "Para hoy": todo lo del día en una sola lista, venga del módulo que venga (plata, rutinas,
 * estudio, stock, vencimientos, diario). Cada ítem dice si ya está hecho.
 */
export type AgendaKind =
  | 'fixed'
  | 'income'
  | 'load'
  | 'habit'
  | 'study'
  | 'stock'
  | 'reminder'
  | 'journal'
  | 'checkin'
  | 'loan'
  | 'invest';

export interface AgendaItem {
  key: string;
  kind: AgendaKind;
  refId: string;
  title: string;
  detail: string;
  /** 2 = vencido / se terminó, 1 = es hoy, 0 = se viene. */
  urgency: 0 | 1 | 2;
  done: boolean;
  amount?: number;
  /** Para hábitos y estudio: cuánto llevás y la meta del día. */
  progress?: { value: number; target: number; unit: string };
}

export interface Agenda {
  items: AgendaItem[];
  done: number;
  total: number;
}

/** `hour`: la hora actual (0-23), para lo que depende del momento del día ("¿gastaste algo hoy?" a la noche). */
export function todayAgenda(data: LiftyData, b: MonthBudget, today: string, hour?: number): Agenda {
  const items: AgendaItem[] = [];

  // Plata: fijos que vencen hoy o ya vencieron, cobros y cargas de hoy.
  for (const e of upcomingEvents(data, b, today, 0)) {
    items.push({
      key: `${e.kind}:${e.refId}:${e.date}`,
      kind: e.kind === 'goal' ? 'fixed' : e.kind,
      refId: e.refId,
      title: e.name,
      detail:
        e.kind === 'fixed'
          ? e.overdue
            ? `Venció el ${Number(e.date.slice(8))}: ¿lo pagaste?`
            : 'Vence hoy'
          : e.kind === 'income'
            ? 'Se cobra hoy'
            : 'Se acredita hoy (va aparte)',
      urgency: e.overdue ? 2 : 1,
      done: false,
      amount: e.amount,
    });
  }

  // Rutinas de hoy (hechas y pendientes, para ver el avance).
  // De vacaciones (si lo pediste), las rutinas y el estudio no se piden.
  const paused = routinesPaused(data, today);
  for (const s of paused ? [] : habitsToday(data.habits, data.habitLogs, today).due) {
    const h = s.habit;
    const simple = h.target === 1 && !h.unit;
    items.push({
      key: `habit:${h.id}`,
      kind: 'habit',
      refId: h.id,
      title: `${h.icon} ${h.name}`,
      detail: simple
        ? s.streak > 0
          ? `🔥 ${s.streak} día${s.streak === 1 ? '' : 's'}`
          : 'Rutina'
        : `${s.today.toLocaleString('es-UY')} de ${h.target.toLocaleString('es-UY')} ${h.unit}`,
      urgency: 1,
      done: s.done,
      progress: simple ? undefined : { value: s.today, target: h.target, unit: h.unit },
    });
  }

  // Estudio: lo que hace falta hoy para llegar a cada examen.
  for (const subject of data.subjects.filter((x) => !x.archived && !paused)) {
    // La meta del día se calcula sin lo estudiado hoy, así no baja a medida que estudiás.
    const st = subjectStatus(
      subject,
      data.studySessions.filter((x) => x.date < today),
      today,
    );
    if (st.neededPerDay === null || st.neededPerDay <= 0 || st.status === 'past' || st.status === 'done') continue;
    const todayMin = data.studySessions
      .filter((x) => x.subjectId === subject.id && x.date === today)
      .reduce((a, x) => a + x.minutes, 0);
    items.push({
      key: `study:${subject.id}`,
      kind: 'study',
      refId: subject.id,
      title: `${subject.icon} Estudiar ${subject.name}`,
      detail: `${todayMin} de ${st.neededPerDay} min · examen ${st.daysLeft === 0 ? 'hoy' : `en ${st.daysLeft} días`}`,
      urgency: st.daysLeft !== null && st.daysLeft <= 3 ? 2 : 1,
      done: todayMin >= st.neededPerDay,
      progress: { value: todayMin, target: st.neededPerDay, unit: 'min' },
    });
  }

  // Stock: lo que se terminó o se termina mañana y todavía no está en la lista de compras.
  const listed = new Set(data.shopEntries.filter((e) => !e.checked).map((e) => e.itemId));
  const stock = stockOverview(data.stockItems, data.stockMoves, today, data.settings);
  for (const s of stock.statuses) {
    if (listed.has(s.item.id)) continue;
    const out = s.quantity <= 0;
    if (!out && !(s.daysLeft !== null && s.daysLeft <= 1)) continue;
    items.push({
      key: `stock:${s.item.id}`,
      kind: 'stock',
      refId: s.item.id,
      title: `${s.item.icon} ${s.item.name}`,
      detail: out ? 'No queda: ¿lo agregás a la lista?' : 'Se termina mañana: ¿lo agregás a la lista?',
      urgency: out ? 2 : 1,
      done: false,
      amount: s.estimatedCost ?? undefined,
    });
  }
  // Lo de siempre: lo que comprás cada tanto y ya toca (aunque no anotes cuánto usás).
  const flagged = new Set(items.filter((i) => i.kind === 'stock').map((i) => i.refId));
  for (const r of routineItems(data.stockItems, data.stockMoves, today)) {
    if (listed.has(r.item.id) || flagged.has(r.item.id) || r.next > today) continue;
    items.push({
      key: `routine:${r.item.id}`,
      kind: 'stock',
      refId: r.item.id,
      title: `${r.item.icon} ${r.item.name}`,
      detail: `Lo comprás cada ~${r.every} días y ya toca: ¿lo agregás a la lista?`,
      urgency: 1,
      done: false,
    });
  }
  // Lo que vence (comida) en los próximos 2 días.
  for (const e of stock.expiring.filter((x) => x.daysLeft <= 2)) {
    items.push({
      key: `expiry:${e.status.item.id}:${e.batch.expiry}`,
      kind: 'stock',
      refId: e.status.item.id,
      title: `${e.status.item.icon} ${e.status.item.name}`,
      detail:
        e.daysLeft < 0 ? 'Ya venció: usalo o tiralo' : e.daysLeft === 0 ? 'Vence hoy: usalo' : `Vence en ${e.daysLeft} días`,
      urgency: e.daysLeft <= 0 ? 2 : 1,
      done: false,
    });
  }

  // Cuotas de préstamos: el día de pago (y las atrasadas del mes).
  for (const d of data.debts ?? []) {
    if (!d.installmentAmount || !d.payDay) continue;
    const s = debtStatus(d);
    if (s.done) continue;
    const date = `${monthOf(today)}-${String(Math.min(d.payDay, 28)).padStart(2, '0')}`;
    const paid = d.payments.some((p) => monthOf(p.date) === monthOf(today));
    if (paid || date > addDays(today, 2)) continue;
    const borrowed = d.direction === 'borrowed';
    items.push({
      key: `loan:${d.id}:${monthOf(today)}`,
      kind: 'loan',
      refId: d.id,
      title: `${borrowed ? '🏦 Cuota' : '🤝 Te pagan la cuota'}: ${d.description || d.person}`,
      detail: date < today ? `Venció el ${date.slice(8)}` : date === today ? 'Es hoy' : `El ${date.slice(8)}`,
      urgency: date < today ? 2 : date === today ? 1 : 0,
      done: false,
      amount: Math.min(d.installmentAmount, s.remaining),
    });
  }

  // Inversiones que vencen (plazo fijo, letras…): renovar o pasar la plata.
  const invBalances = new Map(accountBalances(data, today).map((x) => [x.account.id, x.balance]));
  for (const a of data.accounts) {
    if (!a.investKind || !a.maturity || a.archived || (invBalances.get(a.id) ?? 0) <= 0) continue;
    const left = daysBetween(today, a.maturity);
    if (left > 3) continue;
    items.push({
      key: `invest:${a.id}:${a.maturity}`,
      kind: 'invest',
      refId: a.id,
      title: `📈 ${a.name}`,
      detail:
        left < 0
          ? `Venció hace ${-left} días: ¿lo renovás o lo pasás a tu cuenta?`
          : left === 0
            ? 'Vence hoy: ¿lo renovás o lo pasás a tu cuenta?'
            : `Vence en ${left} días`,
      urgency: left <= 0 ? 2 : 0,
      done: false,
    });
  }

  // Vencimientos de la casa.
  for (const r of data.reminders.filter((x) => !x.archived)) {
    const st = reminderStatus(r, today);
    if (st.status === 'ok') continue;
    items.push({
      key: `reminder:${r.id}`,
      kind: 'reminder',
      refId: r.id,
      title: `${r.icon} ${r.name}`,
      detail:
        st.daysLeft < 0 ? `Venció hace ${-st.daysLeft} días` : st.daysLeft === 0 ? 'Vence hoy' : `Vence en ${st.daysLeft} días`,
      urgency: st.daysLeft <= 0 ? 2 : 0,
      done: false,
    });
  }

  // Diario (si lo usás o tenés rutinas).
  if (data.journal.length || data.habits.length) {
    const j = data.journal.find((x) => x.date === today);
    items.push({
      key: 'journal',
      kind: 'journal',
      refId: today,
      title: '📓 Sueño y ánimo',
      detail:
        j?.sleepHours != null && j?.mood != null ? `${j.sleepHours} h · ánimo ${j.mood} de 5` : '¿Cómo dormiste y cómo estás?',
      urgency: 1,
      done: j?.sleepHours != null && j?.mood != null,
    });
  }

  // ¿Gastaste algo hoy? A la noche, si venís anotando gastos: para que un día sin anotar no
  // pase por un día sin gastar.
  if (hour !== undefined && hour >= 18) {
    const dayToDay = (t: (typeof data.transactions)[number]) => t.kind === 'expense' && !t.linkKind;
    const using = data.transactions.some((t) => dayToDay(t) && t.date >= addDays(today, -14) && t.date < today);
    if (using) {
      const spent = data.transactions.some((t) => dayToDay(t) && t.date === today);
      const j = data.journal.find((x) => x.date === today);
      items.push({
        key: 'checkin',
        kind: 'checkin',
        refId: today,
        title: '💸 ¿Gastaste algo hoy?',
        detail: spent ? 'Ya anotaste lo de hoy' : j?.noSpend ? 'Hoy no gastaste nada' : 'Anotalo, o marcá que hoy no gastaste',
        urgency: 1,
        done: spent || !!j?.noSpend,
      });
    }
  }

  items.sort((a, b) => Number(a.done) - Number(b.done) || b.urgency - a.urgency);
  const countable = items.filter((i) => i.kind !== 'reminder' || i.urgency === 2);
  return { items, done: countable.filter((i) => i.done).length, total: countable.length };
}

// ---------------- Buscar en todo ----------------

export type SearchKind =
  | 'movement'
  | 'stock'
  | 'recipe'
  | 'habit'
  | 'subject'
  | 'reminder'
  | 'goal'
  | 'debt'
  | 'fixed'
  | 'income'
  | 'account'
  | 'category';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  detail: string;
  /** Para ordenar: más alto, más arriba. */
  score: number;
  date?: string;
  /** Monto para mostrar (la app lo formatea, así respeta el modo privado). */
  amount?: number;
  currency?: 'UYU' | 'USD';
}

/** Busca en todos los módulos. Los movimientos más nuevos primero; también por monto ("1500"). */
export function searchAll(data: LiftyData, query: string, limit = 40): SearchResult[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const match = (...texts: (string | null | undefined)[]) => {
    const hay = fold(texts.filter(Boolean).join(' '));
    if (!words.every((w) => hay.includes(w))) return 0;
    const first = fold(texts[0] ?? '');
    return first.startsWith(q) ? 3 : first.includes(q) ? 2 : 1;
  };
  const out: SearchResult[] = [];
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const acc = new Map(data.accounts.map((a) => [a.id, a.name]));
  /** Las coincidencias de entidades van antes que los movimientos (por eso +1). */
  const add = (r: Omit<SearchResult, 'score'>, score: number) => score > 0 && out.push({ ...r, score: score + 1 });

  for (const a of data.accounts) add({ kind: 'account', id: a.id, title: a.name, detail: 'Cuenta' }, match(a.name));
  for (const c of data.categories)
    add({ kind: 'category', id: c.id, title: `${c.icon} ${c.name}`, detail: 'Categoría' }, match(c.name));
  for (const f of data.fixed)
    add(
      { kind: 'fixed', id: f.id, title: f.name, detail: 'Gasto fijo', amount: round2(f.amount), currency: f.currency },
      match(f.name, cat.get(f.categoryId ?? '')),
    );
  for (const i of data.incomes) add({ kind: 'income', id: i.id, title: i.name, detail: 'Sueldo / ingreso' }, match(i.name));
  for (const g of data.goals)
    add({ kind: 'goal', id: g.id, title: `${g.icon} ${g.name}`, detail: 'Meta de ahorro' }, match(g.name));
  for (const d of data.debts)
    add(
      { kind: 'debt', id: d.id, title: d.person, detail: d.direction === 'lent' ? 'Te debe' : 'Le debés' },
      match(d.person, d.description),
    );
  for (const s of data.stockItems)
    add({ kind: 'stock', id: s.id, title: `${s.icon} ${s.name}`, detail: 'Stock' }, match(s.name, s.note));
  for (const r of data.recipes)
    add({ kind: 'recipe', id: r.id, title: `${r.icon} ${r.name}`, detail: 'Receta' }, match(r.name, r.note));
  for (const h of data.habits) add({ kind: 'habit', id: h.id, title: `${h.icon} ${h.name}`, detail: 'Rutina' }, match(h.name));
  for (const s of data.subjects)
    add({ kind: 'subject', id: s.id, title: `${s.icon} ${s.name}`, detail: 'Estudio' }, match(s.name));
  for (const r of data.reminders)
    add(
      { kind: 'reminder', id: r.id, title: `${r.icon} ${r.name}`, detail: `Vence ${r.date.split('-').reverse().join('/')}` },
      match(r.name, r.note),
    );

  // Movimientos: por texto, categoría, cuenta, etiqueta o monto.
  const amountQuery = /^\d+([.,]\d+)?$/.test(q) ? Number(q.replace(',', '.')) : null;
  const movements: SearchResult[] = [];
  for (const t of data.transactions) {
    const score =
      amountQuery !== null
        ? Math.abs(Math.abs(t.amount) - amountQuery) < 0.01
          ? 2
          : 0
        : match(t.description, cat.get(t.categoryId ?? ''), acc.get(t.accountId ?? ''), ...(t.tags ?? []).map((x) => `#${x}`));
    if (score)
      movements.push({
        kind: 'movement',
        id: t.id,
        title: t.description || cat.get(t.categoryId ?? '') || 'Movimiento',
        detail: t.date.split('-').reverse().join('/'),
        date: t.date,
        amount: Math.abs(t.amount),
        currency: t.currency,
        score,
      });
  }
  movements.sort((a, b) => b.date!.localeCompare(a.date!));
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es'));
  return [...out, ...movements].slice(0, limit);
}
