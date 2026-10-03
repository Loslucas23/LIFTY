import ExcelJS from 'exceljs';
import {
  addMonths,
  applyMutation,
  computeMonths,
  formatMoney,
  makeMonth,
  monthOf,
  parseEntity,
  seedRecords,
  toLiftyData,
  URUGUAY_DEDUCTIONS,
  type Category,
  type EntityName,
  type EntityTypes,
  type RecordStore,
  type Settings,
} from '@lifty/core';

/**
 * Importa la planilla "finanzas.xlsm" (hojas Fijos, movimientos, Tarjeta, RESUMEN y
 * parametros). No escribe nada: devuelve los registros para que la app los muestre y
 * los guarde con el mecanismo normal de sincronización.
 *
 * Los ids se derivan del contenido, así que importar dos veces no duplica nada.
 */

export interface ImportedRecord {
  entity: EntityName;
  record: EntityTypes[EntityName];
}

export interface ImportResult {
  records: ImportedRecord[];
  /** Ajustes sugeridos (se mezclan con los actuales, no los reemplazan). */
  settings: Partial<Settings>;
  summary: { label: string; count: number }[];
  warnings: string[];
  /** Totales de cada mes según la planilla y según Lifty, con el porqué de cada diferencia. */
  comparison: MonthComparison[];
}

export interface ComparisonPart {
  label: string;
  excel: number;
  lifty: number;
  /** Por qué no coinciden (null si coinciden). */
  note: string | null;
  /** false = diferencia que Lifty no sabe explicar. */
  explained: boolean;
}

export interface MonthComparison {
  month: string;
  parts: ComparisonPart[];
}

type Cell = string | number | Date | null;

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') {
    if ('result' in v) {
      const r = (v as { result?: unknown }).result;
      if (r === undefined || r === null || (typeof r === 'object' && !(r instanceof Date))) return null;
      return r as Cell;
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
  }
  return null;
}

const isFormulaConstant = (v: ExcelJS.CellValue) => typeof v === 'number';

function num(v: Cell): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))))
    return Number(v.replace(',', '.'));
  return null;
}

function isoDate(v: Cell): string | null {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;
  return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Mes a partir de una fecha y, si existe, de la columna "nro" que la planilla usaba
 * de verdad en sus fórmulas (a veces está escrita a mano y difiere de la fecha).
 */
function monthFromCells(date: Cell, nro: Cell): string | null {
  const iso = isoDate(date);
  if (!iso) return null;
  const n = num(nro);
  return n !== null && n >= 1 && n <= 12 ? makeMonth(Number(iso.slice(0, 4)), Math.round(n)) : monthOf(iso);
}

interface Table {
  rows: { row: number; get: (header: string) => Cell; raw: (header: string) => ExcelJS.CellValue }[];
}

/** Busca una tabla por sus encabezados (en cualquier fila / columna de la hoja). */
function findTable(ws: ExcelJS.Worksheet | undefined, headers: string[]): Table | null {
  if (!ws) return null;
  const wanted = headers.map(norm);
  for (let r = 1; r <= Math.min(ws.rowCount, 50); r++) {
    const row = ws.getRow(r);
    const cols = new Map<string, number>();
    row.eachCell((cell, col) => {
      const key = norm(cellValue(cell.value));
      if (key && !cols.has(key)) cols.set(key, col);
    });
    if (!wanted.every((h) => cols.has(h))) continue;
    const rows: Table['rows'] = [];
    for (let rr = r + 1; rr <= ws.rowCount; rr++) {
      const data = ws.getRow(rr);
      const get = (h: string) => {
        const c = cols.get(norm(h));
        return c ? cellValue(data.getCell(c).value) : null;
      };
      const raw = (h: string) => {
        const c = cols.get(norm(h));
        return c ? data.getCell(c).value : null;
      };
      const empty = wanted.every((h) => {
        const v = get(h);
        return v === null || v === '';
      });
      if (empty) break;
      rows.push({ row: rr, get, raw });
    }
    return { rows };
  }
  return null;
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => norm(ws.name) === norm(name));
}

/** Id estable a partir del contenido (FNV-1a de 64 bits en hex). */
function stableId(prefix: string, ...parts: unknown[]): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of parts.map((p) => String(p)).join('|')) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `${prefix}-${h.toString(16).padStart(16, '0')}`;
}

const CATEGORY_ALIASES: Record<string, string> = {
  'gastos en casa': 'cat-casa',
  'gastos personal': 'cat-personal',
  'gastos personales': 'cat-personal',
  transporte: 'cat-transporte',
  estudios: 'cat-estudios',
  salud: 'cat-salud',
  ocio: 'cat-ocio',
  otros: 'cat-otros',
  supermercado: 'cat-super',
};

/** Pistas para categorizar gastos fijos y de tarjeta por su nombre. */
const KEYWORDS: [RegExp, string][] = [
  [/alquiler|deposito|ute|ose|gas\b|expensas/, 'cat-casa'],
  [/antel|claro|movistar|internet|celular/, 'cat-servicios'],
  [/stm|cabify|uber|omnibus|nafta|taxi/, 'cat-transporte'],
  [/ingles|curso|python|facultad|udemy|platzi|computadora/, 'cat-estudios'],
  [/gimnasio|gym|medic|farmacia|mutualista|dentista|rayo/, 'cat-salud'],
  [/barber|peluqu|higiene|ropa/, 'cat-personal'],
  [/youtube|spotify|netflix|music|disney|hbo|prime|icloud|google/, 'cat-suscripciones'],
  [/comida|pizza|burger|delivery|pedidosya|rappi/, 'cat-comida'],
  [/super|tienda inglesa|disco|devoto|ta-ta|tata/, 'cat-super'],
];

function guessCategory(text: string): string | null {
  const t = norm(text);
  for (const [re, id] of KEYWORDS) if (re.test(t)) return id;
  return null;
}

export async function importWorkbook(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);

  const out: ImportedRecord[] = [];
  const warnings: string[] = [];
  const counts = new Map<string, number>();
  const add = <E extends EntityName>(entity: E, value: unknown, label: string) => {
    out.push({ entity, record: parseEntity(entity, value) });
    counts.set(label, (counts.get(label) ?? 0) + 1);
  };
  const now = new Date().toISOString();

  const seeded = seedRecords();
  const seededCategories = seeded.filter((s) => s.entity === 'category').map((s) => s.record as Category);
  const accountIds = new Map<string, string>([
    ['brou', 'acc-brou'],
    ['itau', 'acc-itau'],
    ['efectivo', 'acc-efectivo'],
  ]);
  const categoryIds = new Map<string, string>(Object.entries(CATEGORY_ALIASES));
  for (const c of seededCategories) categoryIds.set(norm(c.name), c.id);

  // ---- parametros: bancos y categorías ----
  const params = sheet(wb, 'parametros');
  for (const r of findTable(params, ['Banco'])?.rows ?? []) {
    const name = String(r.get('Banco') ?? '').trim();
    if (!name || accountIds.has(norm(name))) continue;
    const id = stableId('acc', norm(name));
    accountIds.set(norm(name), id);
    add('account', { id, name, type: /efectivo/i.test(name) ? 'cash' : 'bank', icon: '🏦', updatedAt: now }, 'Cuentas');
  }
  for (const r of findTable(params, ['GASTOS'])?.rows ?? []) {
    const name = String(r.get('GASTOS') ?? '').trim();
    if (!name || categoryIds.has(norm(name))) continue;
    const id = stableId('cat', norm(name));
    categoryIds.set(norm(name), id);
    add('category', { id, name, kind: 'expense', icon: '🏷️', color: '#64748b', sort: 50, updatedAt: now }, 'Categorías');
  }
  const categoryFor = (name: unknown) => categoryIds.get(norm(name)) ?? null;
  const accountFor = (name: unknown) => accountIds.get(norm(name)) ?? null;

  // Año de la planilla: el más frecuente en los movimientos.
  const movs = findTable(sheet(wb, 'movimientos'), ['fecha', 'Monto', 'Ahorros']);
  const years = new Map<number, number>();
  for (const r of movs?.rows ?? []) {
    const d = isoDate(r.get('fecha'));
    if (d) years.set(Number(d.slice(0, 4)), (years.get(Number(d.slice(0, 4))) ?? 0) + 1);
  }
  const dataYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();

  // ---- Fijos: cotización, sueldos y gastos fijos ----
  const fijos = sheet(wb, 'Fijos');
  let usdRate: number | null = null;
  fijos?.eachRow((row) => {
    row.eachCell((cell, col) => {
      if (usdRate === null && /^d[oó]lar$/i.test(String(cellValue(cell.value) ?? '').trim())) {
        usdRate = num(cellValue(row.getCell(col + 1).value));
      }
    });
  });
  const rate: number = usdRate ?? 41;

  const salaryTable = findTable(fijos, ['Sueldo nominal', 'SUELDO LIQUIDO', 'Desde', 'Hasta']);
  for (const r of salaryTable?.rows ?? []) {
    const gross = num(r.get('Sueldo nominal'));
    const from = monthFromCells(r.get('Desde'), r.get('DesdeNro'));
    if (gross === null || !from) continue;
    const to = monthFromCells(r.get('Hasta'), r.get('HastaNro'));
    // El nombre está en la columna anterior a "Sueldo nominal" (sin encabezado).
    const row = fijos!.getRow(r.row);
    let name = '';
    row.eachCell((cell) => {
      const v = cellValue(cell.value);
      if (!name && typeof v === 'string') name = v.trim();
    });
    name ||= 'Sueldo';
    const irpf = num(r.get('IRPF')) ?? 0;
    const liquidRaw = r.raw('SUELDO LIQUIDO');
    const liquid = num(r.get('SUELDO LIQUIDO'));
    const deductions = URUGUAY_DEDUCTIONS.map((d) =>
      d.label === 'Adicional SNIS' ? { ...d, extraBase: 7000 } : d.label === 'IRPF' ? { ...d, fixed: irpf } : d,
    );
    add(
      'income',
      {
        id: stableId('inc', name, from),
        name,
        gross,
        // Si en la planilla el líquido estaba escrito a mano, se respeta.
        netOverride: isFormulaConstant(liquidRaw) && liquid !== null ? liquid : null,
        deductions,
        startMonth: from,
        endMonth: to,
        aguinaldo: !/bps|paro/i.test(name),
        categoryId: 'cat-sueldo',
        updatedAt: now,
      },
      'Sueldos',
    );
  }

  const fixedTable = findTable(fijos, ['Gastos', 'Monto', 'Desde']);
  for (const r of fixedTable?.rows ?? []) {
    let name = String(r.get('Gastos') ?? '').trim();
    const amount = num(r.get('Monto'));
    let from = monthFromCells(r.get('Desde'), r.get('desdenro'));
    const toNro = num(r.get('hastanro'));
    // Fila sin nombre ni fecha pero con meses: la planilla igual la sumaba (MONTH de vacío = enero).
    if (!from && !isoDate(r.get('Desde')) && toNro !== null && amount && amount > 0) {
      name ||= 'Gasto fijo sin nombre';
      from = makeMonth(dataYear, Math.round(num(r.get('desdenro')) ?? 1) || 1);
      warnings.push(
        `"${name}" de ${amount} (fila ${r.row}): lo importé como gasto fijo de ${from} a ${makeMonth(dataYear, toNro)}. Ponele nombre.`,
      );
    }
    if (!name || !amount || amount <= 0 || !from) {
      if (amount) warnings.push(`Gasto fijo sin nombre o sin fecha en la fila ${r.row} (${amount}): no lo importé.`);
      continue;
    }
    const to = monthFromCells(r.get('hasta'), r.get('hastanro')) ?? (toNro !== null ? makeMonth(dataYear, toNro) : null);
    add(
      'fixed',
      {
        id: stableId('fix', name, from),
        name: name.charAt(0).toUpperCase() + name.slice(1),
        amount,
        categoryId: guessCategory(name),
        dayOfMonth: null,
        startMonth: from,
        endMonth: to,
        updatedAt: now,
      },
      'Gastos fijos',
    );
  }

  // ---- movimientos ----
  for (const r of movs?.rows ?? []) {
    const date = isoDate(r.get('fecha'));
    const amount = num(r.get('Monto'));
    if (!date || !amount) continue;
    const type = norm(r.get('Ahorros'));
    const currency = norm(r.get('Moneda')) === 'usd' ? 'USD' : 'UYU';
    const category = String(r.get('Categoria') ?? '');
    const sub = String(r.get('subcategoria') ?? '').trim();
    const desc = String(r.get('Descripcion') ?? '').trim();
    const description = [sub, desc && norm(desc) !== norm(sub) ? desc : ''].filter(Boolean).join(' · ');
    const kind = type.startsWith('ingreso') ? 'income' : type.startsWith('ahorro') ? 'saving' : 'expense';
    add(
      'transaction',
      {
        id: stableId('tx', r.row, date, amount, type, sub),
        date,
        kind,
        amount,
        currency,
        fxRate: currency === 'USD' ? rate : 1,
        categoryId:
          kind === 'income'
            ? 'cat-extras'
            : kind === 'expense'
              ? (categoryFor(category) ?? guessCategory(sub) ?? 'cat-otros')
              : null,
        goalId: kind === 'saving' ? (currency === 'USD' ? 'goal-usd' : 'goal-uyu') : null,
        accountId: accountFor(r.get('Banco')),
        description,
        updatedAt: now,
      },
      'Movimientos',
    );
  }

  // ---- Tarjeta: cada fila es una cuota; se reconstruye la compra ----
  // Solo desde la primera cuota que aparece en la planilla: las anteriores ya estaban
  // incluidas en los "Pago del mes" y contarlas de nuevo duplicaría gastos.
  const card = findTable(sheet(wb, 'Tarjeta'), ['Fecha', 'Gasto', 'Monto', 'Moneda', 'Cuota', 'de']);
  const purchases = new Map<
    string,
    { name: string; amount: number; currency: 'UYU' | 'USD'; of: number; minN: number; minMonth: string; date: string }
  >();
  for (const r of card?.rows ?? []) {
    const date = isoDate(r.get('Fecha'));
    const amount = num(r.get('Monto'));
    const name = String(r.get('Gasto') ?? '').trim();
    if (!date || !amount || !name) continue;
    const of = Math.max(1, Math.round(num(r.get('de')) ?? 1));
    const n = Math.min(of, Math.max(1, Math.round(num(r.get('Cuota')) ?? 1)));
    const currency = norm(r.get('Moneda')) === 'usd' ? 'USD' : 'UYU';
    const first = addMonths(monthOf(date), -(n - 1));
    // Las compras de una sola cuota se agrupan por fecha (pueden repetirse con el mismo nombre).
    const key =
      of > 1 ? [norm(name), amount, currency, of, first].join('|') : [norm(name), amount, currency, date, r.row].join('|');
    const existing = purchases.get(key);
    if (!existing) purchases.set(key, { name, amount, currency, of, minN: n, minMonth: monthOf(date), date });
    else if (n < existing.minN) Object.assign(existing, { minN: n, minMonth: monthOf(date), date });
  }
  // La planilla puede pasar los dólares de la tarjeta con otra cotización (ej: "*40").
  let cardRate = rate;
  for (const r of card?.rows ?? []) {
    const f = r.raw('monto UYU');
    const formula = f && typeof f === 'object' && 'formula' in f ? String(f.formula) : '';
    const m = formula.match(/\*\s*(\d+(?:\.\d+)?)\s*\)*\s*$/);
    if (m && norm(r.get('Moneda')) === 'usd') {
      cardRate = Number(m[1]);
      break;
    }
    if (m) cardRate = Number(m[1]);
  }
  if (cardRate !== rate && [...purchases.values()].some((p) => p.currency === 'USD')) {
    warnings.push(
      `En la hoja Tarjeta los dólares se pasan a pesos a ${cardRate} (no a ${rate}): las compras de la tarjeta en dólares quedan con esa cotización.`,
    );
  }
  for (const [key, p] of purchases) {
    const count = p.of - p.minN + 1;
    add(
      'transaction',
      {
        id: stableId('card', key),
        date: p.date,
        kind: 'expense',
        amount: Math.round(p.amount * count * 100) / 100,
        currency: p.currency,
        fxRate: p.currency === 'USD' ? cardRate : 1,
        accountId: 'acc-tarjeta',
        categoryId: guessCategory(p.name) ?? 'cat-otros',
        description: p.minN > 1 ? `${p.name} (cuotas ${p.minN} a ${p.of} de ${p.of})` : p.name,
        installments: count,
        firstInstallmentMonth: p.minMonth,
        updatedAt: now,
      },
      'Compras con tarjeta',
    );
  }

  // ---- RESUMEN: meses cerrados con su saldo real ----
  const year = dataYear;
  const summary = findTable(sheet(wb, 'RESUMEN'), ['mesnro', 'TERMINO MES', 'Total real']);
  for (const r of summary?.rows ?? []) {
    const m = num(r.get('mesnro'));
    if (!m || m < 1 || m > 12) continue;
    if (norm(r.get('TERMINO MES')) !== 'si') continue;
    const real = num(r.get('Total real'));
    const month = makeMonth(year, m);
    if (real === null || real === 0) {
      warnings.push(
        `${month}: estaba marcado como terminado pero con total real ${real ?? 'vacío'}; no lo cerré. Revisalo en Presupuesto.`,
      );
      continue;
    }
    add('closing', { id: month, realBalance: real, note: 'Importado de la planilla', updatedAt: now }, 'Meses cerrados');
  }

  const settings: Partial<Settings> = { usdRate: rate, startMonth: makeMonth(year, 1), startBalance: 0 };
  warnings.unshift(
    `Cotización del dólar: ${rate}. Lifty arranca a contar desde ${makeMonth(year, 1)} con saldo inicial 0 (se puede cambiar en Ajustes).`,
  );

  return {
    records: out,
    settings,
    summary: [...counts.entries()].map(([label, count]) => ({ label, count })),
    warnings,
    comparison: compareWithSheet(wb, out, settings, year),
  };
}

const money = (v: number) => formatMoney(Math.round(v * 100) / 100, 'UYU');

/** ¿La celda es un número escrito a mano (no una fórmula)? */
function isLiteral(v: ExcelJS.CellValue): boolean {
  return typeof v === 'number';
}

/** Un ajuste a mano al final de la fórmula, como "SUMIFS(...)-1030". */
function manualOffset(v: ExcelJS.CellValue): number | null {
  if (!v || typeof v !== 'object' || !('formula' in v)) return null;
  const m = String(v.formula).match(/\)\s*([+-])\s*(\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[2]) * (m[1] === '-' ? -1 : 1) : null;
}

/**
 * Compara mes a mes los totales que calcula la planilla (hojas INGRESOS, Gastos y AHORRO)
 * con los que calcula Lifty con lo importado, y explica cada diferencia.
 */
function compareWithSheet(
  wb: ExcelJS.Workbook,
  records: ImportedRecord[],
  settings: Partial<Settings>,
  year: number,
): MonthComparison[] {
  const incomeT = findTable(sheet(wb, 'INGRESOS'), ['mesnro', 'Sueldo', 'Aguinaldo', 'Extras']);
  const expenseT = findTable(sheet(wb, 'Gastos'), ['Mesnro', 'Monto fijo', 'Monto Variable', 'Tarjeta']);
  const savingT = findTable(sheet(wb, 'AHORRO'), ['MESNRO', 'MONTO UYU']);
  if (!incomeT && !expenseT && !savingT) return [];

  const store: RecordStore = {};
  for (const { entity, record } of seedRecords()) {
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  }
  for (const { entity, record } of records) {
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  }
  const data = toLiftyData(store);
  data.settings = { ...data.settings, ...settings };
  const months = computeMonths(data, makeMonth(year, 1), makeMonth(year, 12), `${year}-12-31`);

  const rowFor = (t: ReturnType<typeof findTable>, key: string, m: number) =>
    t?.rows.find((r) => Math.round(num(r.get(key)) ?? 0) === m);
  const out: MonthComparison[] = [];
  for (const b of months) {
    const m = Number(b.month.slice(5));
    const inc = rowFor(incomeT, 'mesnro', m);
    const exp = rowFor(expenseT, 'Mesnro', m);
    const sav = rowFor(savingT, 'MESNRO', m);
    const sum = (kind: string) => b.income.planned.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
    const salary = sum('salary');
    const aguinaldo = sum('aguinaldo');
    const parts: ComparisonPart[] = [];
    const part = (
      label: string,
      row: Table['rows'][number] | undefined,
      column: string,
      lifty: number,
      explain?: (excel: number) => string | null,
    ) => {
      if (!row) return;
      const excel = num(row.get(column)) ?? 0;
      const raw = row.raw(column);
      const diff = Math.round((lifty - excel) * 100) / 100;
      let note: string | null = null;
      let explained = true;
      if (Math.abs(diff) >= 1) {
        const offset = manualOffset(raw);
        if (isLiteral(raw)) {
          note = `En la planilla está escrito a mano (${money(excel)}); Lifty lo calcula con lo cargado.`;
        } else if (offset !== null && Math.abs(lifty - (excel - offset)) < 1) {
          note = `La planilla le ${offset < 0 ? 'resta' : 'suma'} ${money(Math.abs(offset))} a mano a la fórmula.`;
        } else {
          note = explain?.(excel) ?? null;
          if (!note) {
            note = `Lifty da ${money(lifty)} y la planilla ${money(excel)}: revisá este mes.`;
            explained = false;
          }
        }
      }
      parts.push({ label, excel: Math.round(excel * 100) / 100, lifty: Math.round(lifty * 100) / 100, note, explained });
    };
    part('Sueldos', inc, 'Sueldo', salary);
    part('Aguinaldo', inc, 'Aguinaldo', aguinaldo, (excel) =>
      aguinaldo > excel
        ? `Lifty calcula el aguinaldo por semestre (se cobra en junio y diciembre) y el proporcional cuando termina un trabajo: ${money(aguinaldo)}.`
        : `La planilla calcula el aguinaldo como medio sueldo (${money(excel)}); Lifty lo calcula por lo cobrado en el semestre.`,
    );
    part('Otros ingresos', inc, 'Extras', b.income.total - salary - aguinaldo);
    part('Gastos fijos', exp, 'Monto fijo', b.fixed.total);
    part('Gastos del día a día', exp, 'Monto Variable', b.variable.total);
    part('Tarjeta', exp, 'Tarjeta', b.card.total);
    part('Ahorro', sav, 'MONTO UYU', b.savings.total, () =>
      sav && (isLiteral(sav.raw('MONTO')) || isLiteral(sav.raw('MONTO USD')))
        ? 'En la planilla el ahorro de este mes está escrito a mano; Lifty suma los ahorros cargados.'
        : null,
    );
    out.push({ month: b.month, parts });
  }
  return out;
}
