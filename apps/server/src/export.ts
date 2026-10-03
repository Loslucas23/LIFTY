import ExcelJS from 'exceljs';
import {
  computeMonths,
  effectiveStartMonth,
  monthLabel,
  monthOf,
  netSalary,
  todayISO,
  txToUYU,
  type LiftyData,
} from '@lifty/core';

const MONEY = '#,##0.00;[Red]-#,##0.00';

const TYPE_LABEL = { expense: 'Gasto', income: 'Ingreso', saving: 'Ahorro', transfer: 'Transferencia' } as const;

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B7A5A' } };
  return ws;
}

function finish(ws: ExcelJS.Worksheet) {
  if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/** Exporta todo a una planilla de Excel (para mirar, filtrar o guardar). */
export async function exportWorkbook(data: LiftyData, today = todayISO()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Lifty';
  wb.created = new Date();
  const rate = data.settings.usdRate;
  const category = new Map(data.categories.map((c) => [c.id, c.name]));
  const account = new Map(data.accounts.map((a) => [a.id, a.name]));
  const goal = new Map(data.goals.map((g) => [g.id, g.name]));

  // ---- Resumen mensual ----
  const thisMonth = monthOf(today);
  const start = effectiveStartMonth(data, thisMonth);
  const end = `${today.slice(0, 4)}-12`;
  const resumen = sheet(wb, 'Resumen', [
    { header: 'Mes', key: 'mes', width: 18 },
    { header: 'Viene del mes anterior', key: 'arrastre', width: 22, money: true },
    { header: 'Ingresos', key: 'ingresos', width: 14, money: true },
    { header: 'Gastos fijos', key: 'fijos', width: 14, money: true },
    { header: 'Día a día', key: 'variables', width: 14, money: true },
    { header: 'Tarjeta', key: 'tarjeta', width: 14, money: true },
    { header: 'Ahorro', key: 'ahorro', width: 14, money: true },
    { header: 'Proyectado', key: 'proyectado', width: 14, money: true },
    { header: 'Real (cierre)', key: 'real', width: 14, money: true },
  ]);
  if (start <= end) {
    for (const m of computeMonths(data, start, end, today)) {
      resumen.addRow({
        mes: monthLabel(m.month),
        arrastre: m.carryover.amount,
        ingresos: m.income.total,
        fijos: m.fixed.total,
        variables: m.variable.total,
        tarjeta: m.card.total,
        ahorro: m.savings.total,
        proyectado: m.result,
        real: m.closing?.realBalance ?? null,
      });
    }
  }
  finish(resumen);

  // ---- Movimientos ----
  const movs = sheet(wb, 'Movimientos', [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Monto', key: 'monto', width: 12, money: true },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Monto en $', key: 'uyu', width: 14, money: true },
    { header: 'Categoría / meta', key: 'categoria', width: 22 },
    { header: 'Cuenta', key: 'cuenta', width: 18 },
    { header: 'Detalle', key: 'detalle', width: 32 },
    { header: 'Cuotas', key: 'cuotas', width: 8 },
  ]);
  for (const t of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    movs.addRow({
      fecha: new Date(`${t.date}T12:00:00Z`),
      tipo: TYPE_LABEL[t.kind],
      monto: t.amount,
      moneda: t.currency,
      uyu: txToUYU(t, rate),
      categoria: t.kind === 'saving' ? (goal.get(t.goalId ?? '') ?? 'Ahorro') : (category.get(t.categoryId ?? '') ?? ''),
      cuenta: account.get(t.accountId ?? '') ?? '',
      detalle: t.description,
      cuotas: t.installments > 1 ? t.installments : null,
    });
  }
  movs.getColumn('fecha').numFmt = 'dd/mm/yyyy';
  finish(movs);

  // ---- Sueldos ----
  const sueldos = sheet(wb, 'Sueldos', [
    { header: 'Nombre', key: 'nombre', width: 22 },
    { header: 'Nominal', key: 'nominal', width: 14, money: true },
    { header: 'Líquido', key: 'liquido', width: 14, money: true },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Desde', key: 'desde', width: 10 },
    { header: 'Hasta', key: 'hasta', width: 10 },
    { header: 'Aguinaldo', key: 'aguinaldo', width: 10 },
  ]);
  for (const i of data.incomes) {
    sueldos.addRow({
      nombre: i.name,
      nominal: i.gross,
      liquido: netSalary(i),
      moneda: i.currency,
      desde: i.startMonth,
      hasta: i.endMonth ?? '',
      aguinaldo: i.aguinaldo ? 'Sí' : 'No',
    });
  }
  finish(sueldos);

  // ---- Gastos fijos ----
  const fijos = sheet(wb, 'Gastos fijos', [
    { header: 'Nombre', key: 'nombre', width: 22 },
    { header: 'Monto', key: 'monto', width: 12, money: true },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Categoría', key: 'categoria', width: 20 },
    { header: 'Día', key: 'dia', width: 6 },
    { header: 'Desde', key: 'desde', width: 10 },
    { header: 'Hasta', key: 'hasta', width: 10 },
  ]);
  for (const f of data.fixed) {
    fijos.addRow({
      nombre: f.name,
      monto: f.amount,
      moneda: f.currency,
      categoria: category.get(f.categoryId ?? '') ?? '',
      dia: f.dayOfMonth,
      desde: f.startMonth,
      hasta: f.endMonth ?? '',
    });
  }
  finish(fijos);

  // ---- Peso ----
  if (data.weights.length) {
    const peso = sheet(wb, 'Peso', [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Kg', key: 'kg', width: 8 },
      { header: 'Nota', key: 'nota', width: 30 },
    ]);
    for (const w of data.weights) peso.addRow({ fecha: new Date(`${w.date}T12:00:00Z`), kg: w.kg, nota: w.note });
    peso.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    peso.getColumn('kg').numFmt = '0.0';
    finish(peso);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
