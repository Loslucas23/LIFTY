import { accountBalances, convert } from './accounts';
import { matchRule } from './autopilot';
import { cardAutoPayments, cardInstallments, cardPayDate, cardPayFrom } from './card';
import { addMonths, monthOf } from './months';
import { fold, round2 } from './money';
import type { Account, Currency, LiftyData, Transaction, TxKind } from './schema';
import { buildWordIndex, suggestCategory } from './smart';
import { addDays, daysBetween } from './weight';

/**
 * Importar el extracto del banco (o de la tarjeta) y cruzarlo con lo cargado. En Uruguay no hay
 * forma de conectar una app al banco: se baja el Excel o CSV de la web del banco y Lifty lo lee.
 * Todo es comparación simple: mismo monto (al centavo), fecha con hasta 3 días de diferencia y
 * la misma cuenta.
 */

export type Cell = string | number | null;

export interface ColumnMap {
  /** Fila de los títulos (-1 si no hay). */
  header: number;
  date: number;
  /** Columnas con el detalle (se juntan). */
  description: number[];
  /** Una sola columna de importe (negativo = sale) … */
  amount: number | null;
  /** … o débito y crédito por separado. */
  debit: number | null;
  credit: number | null;
  /** Tarjetas: importe en dólares aparte. */
  amountUSD: number | null;
  balance: number | null;
}

// ---------------- Lectura de números y fechas ----------------

/** "1.234,56", "-1234.56", "(1.234,56)", "$ 900", "1,234.56" → número. */
export function parseNumber(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    neg = true;
    s = s.replace(/-\s*$/, '');
  }
  s = s.replace(/[^\d,.-]/g, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/\d/.test(s) || /-/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, '');
  else if (lastDot >= 0 && (s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  else if (lastDot >= 0 && /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace('.', '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "15/09/2026", "15/09/26", "2026-09-15", "15-09-2026 10:32", número de Excel → "2026-09-15". */
export function parseDate(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    // Fecha de Excel (días desde 1899-12-30).
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return valid(y, +m[2], +m[1]);
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(`${date}T12:00:00Z`).getUTCDate() === d ? date : null;
}

// ---------------- Columnas ----------------

const H = {
  date: /^(fecha|f\.?\s*(valor|movimiento|operaci[oó]n)?|fecha (de )?(valor|movimiento|operaci[oó]n|compra|transacci[oó]n))$/,
  description: /(descripci[oó]n|concepto|detalle|movimiento|referencia|comercio|establecimiento|asunto|leyenda|observaci)/,
  debit: /(d[eé]bito|debe|cargo|egreso|retiro|salida)/,
  credit: /(cr[eé]dito|haber|abono|ingreso|dep[oó]sito|entrada)/,
  amountUSD: /(u\$s|us\$|usd|d[oó]lar)/,
  amount: /(importe|monto|valor|total|\$)/,
  balance: /(saldo)/,
};

const text = (v: Cell) => fold(String(v ?? '')).trim();

/**
 * Busca la fila de títulos (en las primeras 30) y qué columna es cada cosa. Si no hay títulos,
 * adivina por el contenido: la columna con fechas, la de texto más largo y las de números.
 */
export function detectColumns(rows: Cell[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const cells = rows[r].map(text);
    const date = cells.findIndex((c) => H.date.test(c));
    if (date < 0) continue;
    const description = cells.map((c, i) => (i !== date && H.description.test(c) ? i : -1)).filter((i) => i >= 0);
    const balance = cells.findIndex((c) => H.balance.test(c));
    const debit = cells.findIndex((c, i) => i !== balance && H.debit.test(c));
    const credit = cells.findIndex((c, i) => i !== balance && H.credit.test(c) && !H.description.test(c));
    const usd = cells.findIndex((c, i) => i !== balance && H.amountUSD.test(c) && H.amount.test(c));
    const amount = cells.findIndex(
      (c, i) => i !== balance && i !== usd && i !== date && H.amount.test(c) && !H.description.test(c),
    );
    if (debit < 0 && credit < 0 && amount < 0 && usd < 0) continue;
    return {
      header: r,
      date,
      description: description.length ? description : guessText(rows.slice(r + 1, r + 40), [date]),
      amount: debit >= 0 || credit >= 0 ? null : amount >= 0 ? amount : null,
      debit: debit >= 0 ? debit : null,
      credit: credit >= 0 ? credit : null,
      amountUSD: usd >= 0 ? usd : null,
      balance: balance >= 0 ? balance : null,
    };
  }
  // Sin títulos: por el contenido.
  const sample = rows.slice(0, 60);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const share = (test: (v: Cell) => boolean, i: number) => {
    const vals = sample.map((r) => r[i]).filter((v) => v !== null && v !== '');
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };
  const date = Array.from({ length: width }, (_, i) => i).find((i) => share((v) => parseDate(v) !== null, i) > 0.6);
  if (date === undefined) return null;
  const numeric = Array.from({ length: width }, (_, i) => i).filter(
    (i) => i !== date && share((v) => parseNumber(v) !== null && !parseDate(v), i) > 0.6,
  );
  if (!numeric.length) return null;
  return {
    header: -1,
    date,
    description: guessText(sample, [date, ...numeric]),
    amount: numeric[0],
    debit: null,
    credit: null,
    amountUSD: null,
    balance: numeric.length > 1 ? numeric[numeric.length - 1] : null,
  };
}

function guessText(rows: Cell[][], skip: number[]): number[] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best = -1;
  let len = 0;
  for (let i = 0; i < width; i++) {
    if (skip.includes(i)) continue;
    const avg = rows.reduce((s, r) => s + (typeof r[i] === 'string' ? String(r[i]).length : 0), 0) / Math.max(1, rows.length);
    if (avg > len) {
      len = avg;
      best = i;
    }
  }
  return best >= 0 ? [best] : [];
}

// ---------------- Renglones del extracto ----------------

export interface StatementLine {
  /** Fila en el archivo (para mostrarla y no confundir dos iguales). */
  row: number;
  date: string;
  description: string;
  /** Con signo: positivo entra plata a la cuenta, negativo sale. */
  amount: number;
  currency: Currency;
  balance: number | null;
}

/**
 * Los renglones con fecha e importe. `invert`: los gastos vienen en positivo (pasa en los
 * estados de cuenta de las tarjetas). La moneda es la de la cuenta, salvo la columna de dólares.
 */
export function statementLines(rows: Cell[][], map: ColumnMap, currency: Currency, invert = false): StatementLine[] {
  const out: StatementLine[] = [];
  for (let r = map.header + 1; r < rows.length; r++) {
    const row = rows[r];
    const date = parseDate(row[map.date] ?? null);
    if (!date) continue;
    const description = map.description
      .map((i) => String(row[i] ?? '').trim())
      .filter(Boolean)
      .join(' · ')
      .replace(/\s+/g, ' ');
    const balance = map.balance !== null ? parseNumber(row[map.balance] ?? null) : null;
    const push = (amount: number | null, cur: Currency) => {
      if (amount === null || Math.abs(amount) < 0.005) return;
      out.push({ row: r, date, description, amount: round2(invert ? -amount : amount), currency: cur, balance });
    };
    if (map.debit !== null || map.credit !== null) {
      const debit = map.debit !== null ? parseNumber(row[map.debit] ?? null) : null;
      const credit = map.credit !== null ? parseNumber(row[map.credit] ?? null) : null;
      const value = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
      // Las columnas de débito/crédito ya dicen el sentido: no se invierten.
      if (Math.abs(value) >= 0.005) out.push({ row: r, date, description, amount: round2(value), currency, balance });
    } else {
      push(map.amount !== null ? parseNumber(row[map.amount] ?? null) : null, currency);
    }
    if (map.amountUSD !== null) push(parseNumber(row[map.amountUSD] ?? null), 'USD');
  }
  return out;
}

/** "COMPRA CON TARJETA DEBITO 4589 TATA MONTEVIDEO" → "Tata Montevideo". */
export function cleanDescription(s: string): string {
  const out = s
    .replace(
      /\b(compra|pago|debito|débito|credito|crédito|con|tarjeta|tarj|pos|deb\.?|cred\.?|automatico|automático|transf\.?|mov\.?|nro\.?|n[°º]|ref\.?|cuota)\b/gi,
      ' ',
    )
    .replace(/\b\d+[/-]\d+\b/g, ' ')
    .replace(/[*#]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s*·\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = out.length >= 3 ? out : s.trim();
  return base
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase())
    .slice(0, 120);
}

// ---------------- Cruce con lo cargado ----------------

export interface Movement {
  id: string;
  date: string;
  /** Con signo, en la moneda de la cuenta. */
  amount: number;
  description: string;
  source: 'tx' | 'auto' | 'debt';
  tx: Transaction | null;
  /** Tarjetas: cuota número (1 = la compra). */
  installment: number;
}

/** Lo que Lifty dice que entró y salió de una cuenta (con signo, en la moneda de la cuenta). */
export function accountMovements(data: LiftyData, account: Account, upTo: string): Movement[] {
  const rate = data.settings.usdRate;
  const conv = (t: Pick<Transaction, 'amount' | 'currency' | 'fxRate'>) =>
    round2(convert(t.amount, t.currency, account.currency, t.currency === 'USD' && t.fxRate && t.fxRate !== 1 ? t.fxRate : rate));
  const goalAccount = new Map(data.goals.filter((g) => g.accountId).map((g) => [g.id, g.accountId!]));
  const out: Movement[] = [];
  const add = (tx: Transaction, sign: 1 | -1, source: Movement['source'] = 'tx') =>
    out.push({
      id: `${source}:${tx.id}`,
      date: tx.date,
      amount: sign * conv(tx),
      description: tx.description,
      source,
      tx,
      installment: 1,
    });
  for (const t of data.transactions) {
    if (t.date > upTo) continue;
    if (account.type === 'credit' && t.kind === 'expense' && t.accountId === account.id) {
      // En el estado de cuenta de la tarjeta viene cada cuota (con la fecha de la compra).
      for (const i of cardInstallments(account, t))
        out.push({
          id: `tx:${t.id}:${i.number}`,
          date: t.date,
          amount: -round2(conv({ ...t, amount: i.amount })),
          description: t.description,
          source: 'tx',
          tx: t,
          installment: i.number,
        });
      continue;
    }
    if (t.accountId === account.id) {
      if (t.kind === 'income') add(t, 1);
      else add(t, -1);
    }
    if (t.kind === 'transfer' && t.toAccountId === account.id) add(t, 1);
    if (t.kind === 'saving' && t.goalId && goalAccount.get(t.goalId) === account.id && t.accountId !== account.id) add(t, 1);
  }
  for (const t of cardAutoPayments(data, upTo)) {
    if (t.accountId === account.id) add(t, -1, 'auto');
    if (t.toAccountId === account.id) add(t, 1, 'auto');
  }
  for (const d of data.debts) {
    const cur = { currency: d.currency, fxRate: 1 } as const;
    if (d.accountId === account.id && !d.fromTxId && d.date <= upTo)
      out.push({
        id: `debt:${d.id}`,
        date: d.date,
        amount: (d.direction === 'lent' ? -1 : 1) * conv({ ...cur, amount: d.amount }),
        description: `${d.direction === 'lent' ? 'Préstamo a' : 'Préstamo de'} ${d.person}`,
        source: 'debt',
        tx: null,
        installment: 1,
      });
    for (const p of d.payments)
      if (p.accountId === account.id && p.date <= upTo)
        out.push({
          id: `debt:${d.id}:${p.id}`,
          date: p.date,
          amount: (d.direction === 'lent' ? 1 : -1) * conv({ ...cur, amount: p.amount }),
          description: `${d.person}: pago`,
          source: 'debt',
          tx: null,
          installment: 1,
        });
  }
  return out;
}

const wordsOf = (s: string) =>
  new Set(
    fold(s)
      .replace(/[^a-z0-9ñ ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w)),
  );
const similarity = (a: string, b: string) => {
  const A = wordsOf(a);
  let n = 0;
  for (const w of wordsOf(b)) if (A.has(w)) n++;
  return n;
};

export interface MissingLine {
  line: StatementLine;
  kind: TxKind;
  description: string;
  categoryId: string | null;
  /** De qué cuenta sale (o a cuál entra) el movimiento a anotar. */
  accountId: string;
  /** Pago de la tarjeta (va como "Mover" a la tarjeta, no como gasto) y de qué resumen. */
  toAccountId: string | null;
  linkMonth: string | null;
  /** Por qué esa categoría. */
  why: string | null;
}

export interface Reconciliation {
  account: Account;
  from: string;
  to: string;
  lines: number;
  matched: { line: StatementLine; movement: Movement; days: number }[];
  /** En el extracto y no en Lifty: falta anotarlo. */
  missing: MissingLine[];
  /** Cargado dos veces en Lifty (el extracto lo tiene una vez). */
  repeated: Movement[];
  /** En Lifty y no en el extracto (¿otra cuenta? ¿efectivo? ¿no pasó todavía?). */
  extra: Movement[];
  /** El saldo que dice el banco al final del extracto y el de Lifty ese día. */
  balance: { date: string; bank: number; lifty: number; diff: number } | null;
}

/** Cruza el extracto con lo cargado en la cuenta. */
export function reconcile(data: LiftyData, accountId: string, lines: StatementLine[]): Reconciliation | null {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account || !lines.length) return null;
  const own = lines.filter((l) => l.currency === account.currency);
  const dates = own.map((l) => l.date).sort();
  const to = dates[dates.length - 1] ?? lines[0].date;
  // En la tarjeta, las cuotas viejas traen la fecha de la compra: el período es el último mes y medio.
  const first = dates[0] ?? lines[0].date;
  const from = account.type === 'credit' && first < addDays(to, -45) ? addDays(to, -45) : first;
  const all = accountMovements(data, account, addDays(to, 3));
  const used = new Set<string>();
  const matched: Reconciliation['matched'] = [];
  const unmatched: StatementLine[] = [];
  // Primero los que coinciden el mismo día, después los de 1, 2 y 3 días de diferencia.
  const pending = [...own];
  for (let gap = 0; gap <= 3; gap++) {
    for (let i = 0; i < pending.length; i++) {
      const line = pending[i];
      const candidates = all.filter(
        (m) => !used.has(m.id) && Math.abs(m.amount - line.amount) <= 0.011 && Math.abs(daysBetween(m.date, line.date)) === gap,
      );
      if (!candidates.length) continue;
      const best = candidates.sort(
        (a, b) => similarity(b.description, line.description) - similarity(a.description, line.description),
      )[0];
      used.add(best.id);
      matched.push({ line, movement: best, days: gap });
      pending.splice(i--, 1);
    }
  }
  unmatched.push(...pending, ...lines.filter((l) => l.currency !== account.currency));

  // Lo de Lifty en esas fechas que no está en el extracto. Las cuotas 2, 3… de la tarjeta
  // tienen la fecha de la compra: solo cuentan si coinciden con un renglón.
  const inRange = all.filter((m) => !used.has(m.id) && m.date >= from && m.date <= to && m.installment === 1);
  const repeated: Movement[] = [];
  const extra: Movement[] = [];
  for (const m of inRange) {
    const twin = matched.find(
      (x) => Math.abs(x.movement.amount - m.amount) <= 0.011 && Math.abs(daysBetween(x.movement.date, m.date)) <= 3,
    );
    if (twin && m.source === 'tx') repeated.push(m);
    else extra.push(m);
  }

  // Sugerencias para lo que falta anotar: reglas, historial y palabras comunes.
  const valid = (kind: TxKind) => new Set(data.categories.filter((c) => c.kind === kind && !c.archived).map((c) => c.id));
  const index = { expense: buildWordIndex(data, 'expense'), income: buildWordIndex(data, 'income') };
  const ids = { expense: valid('expense'), income: valid('income') };
  const cards = data.accounts.filter((a) => a.type === 'credit' && !a.archived && a.id !== account.id);
  const missing: MissingLine[] = unmatched.map((line) => {
    const description = cleanDescription(line.description);
    const isOut = line.amount < 0;
    const cardWords =
      /\b(pago|debito|débito)\b.*\b(tarjeta|visa|master|oca|cabal|diners|amex|creditel|anda)\b|\b(visa|master|oca|cabal|diners|amex)\b.*\bpago\b/i;
    const card =
      isOut && account.type !== 'credit'
        ? (cards.find((c) => fold(line.description).includes(fold(c.name))) ??
          (cardWords.test(line.description) ? cards[0] : undefined))
        : undefined;
    const plain = { line, description, accountId: account.id, toAccountId: null, linkMonth: null };
    if (card)
      return {
        ...plain,
        kind: 'transfer',
        description: `Pago ${card.name}`,
        categoryId: null,
        toAccountId: card.id,
        linkMonth: paidStatement(card, line.date),
        why: 'parece el pago de la tarjeta',
      };
    // En el estado de cuenta de la tarjeta, lo que entra es tu pago (salvo devoluciones).
    if (account.type === 'credit' && !isOut && !/devoluci|reintegro|anulaci|bonificaci/i.test(line.description)) {
      const from = cardPayFrom(data, account);
      if (from)
        return {
          ...plain,
          kind: 'transfer',
          description: `Pago ${account.name}`,
          categoryId: null,
          accountId: from.id,
          toAccountId: account.id,
          linkMonth: paidStatement(account, line.date),
          why: 'es tu pago de la tarjeta',
        };
    }
    const kind: TxKind = isOut ? 'expense' : 'income';
    const rule = matchRule(data.rules, line.description);
    if (rule && ids[kind].has(rule.categoryId))
      return { ...plain, kind, categoryId: rule.categoryId, why: `tu regla "${rule.contains}"` };
    const s = suggestCategory(index[kind as 'expense' | 'income'], `${description} ${line.description}`, ids[kind]);
    return { ...plain, kind, categoryId: s?.categoryId ?? null, why: s ? `por "${s.word}"` : null };
  });

  // Saldo: el del último renglón (por fecha) que lo traiga.
  let balance: Reconciliation['balance'] = null;
  const withBalance = own.filter((l) => l.balance !== null);
  if (withBalance.length) {
    const ascending = own[0].date <= own[own.length - 1].date;
    const last = withBalance.reduce((a, b) => (b.date > a.date || (b.date === a.date && ascending) ? b : a));
    const lifty = accountBalances(data, last.date).find((x) => x.account.id === account.id)?.balance ?? 0;
    balance = { date: last.date, bank: last.balance!, lifty, diff: round2(last.balance! - lifty) };
  }

  return {
    account,
    from,
    to,
    lines: lines.length,
    matched,
    missing: missing.sort((a, b) => b.line.date.localeCompare(a.line.date)),
    repeated,
    extra: extra.sort((a, b) => b.date.localeCompare(a.date)),
    balance,
  };
}

/** Qué resumen paga un pago de la tarjeta hecho `date`: el que vence más cerca de ese día. */
export function paidStatement(card: Account, date: string): string {
  const m = monthOf(date);
  return [m, addMonths(m, -1), addMonths(m, -2)].sort(
    (a, b) => Math.abs(daysBetween(date, cardPayDate(card, a))) - Math.abs(daysBetween(date, cardPayDate(card, b))),
  )[0];
}
