import ExcelJS from 'exceljs';
import {
  accountBalances,
  computeMonths,
  countsInBudget,
  debtStatus,
  goalBalances,
  goalPlans,
  offBudgetAccounts,
  stockOverview,
  UNIT_LABEL,
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
    { header: 'A la cuenta', key: 'destino', width: 18 },
    { header: 'Detalle', key: 'detalle', width: 32 },
    { header: 'Cuotas', key: 'cuotas', width: 8 },
    { header: 'Cuenta en el presupuesto', key: 'presupuesto', width: 12 },
    { header: 'Etiquetas', key: 'etiquetas', width: 20 },
  ]);
  const off = offBudgetAccounts(data);
  for (const t of [...data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    movs.addRow({
      fecha: new Date(`${t.date}T12:00:00Z`),
      tipo: TYPE_LABEL[t.kind],
      monto: t.amount,
      moneda: t.currency,
      uyu: txToUYU(t, rate),
      categoria: t.kind === 'saving' ? (goal.get(t.goalId ?? '') ?? 'Ahorro') : (category.get(t.categoryId ?? '') ?? ''),
      cuenta: account.get(t.accountId ?? '') ?? '',
      destino: account.get(t.toAccountId ?? '') ?? '',
      detalle: t.description,
      cuotas: t.installments > 1 ? t.installments : null,
      presupuesto: countsInBudget(t, off) ? 'Sí' : 'No',
      etiquetas: (t.tags ?? []).join(', '),
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

  // ---- Cuentas ----
  const cuentas = sheet(wb, 'Cuentas', [
    { header: 'Cuenta', key: 'cuenta', width: 22 },
    { header: 'Tipo', key: 'tipo', width: 16 },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Saldo', key: 'saldo', width: 14, money: true },
    { header: 'Saldo en $', key: 'uyu', width: 14, money: true },
  ]);
  const ACCOUNT_TYPE = {
    bank: 'Banco',
    cash: 'Efectivo',
    credit: 'Tarjeta de crédito',
    food: 'Alimentación (aparte)',
  } as const;
  for (const b of accountBalances(data, today)) {
    if (b.account.archived && b.balance === 0) continue;
    cuentas.addRow({
      cuenta: b.account.name,
      tipo: ACCOUNT_TYPE[b.account.type],
      moneda: b.account.currency,
      saldo: b.balance,
      uyu: b.balanceUYU,
    });
  }
  finish(cuentas);

  // ---- Metas de ahorro ----
  const balances = goalBalances(data);
  if (balances.length) {
    const plans = new Map(goalPlans(data, today).map((p) => [p.goal.id, p]));
    const metas = sheet(wb, 'Metas', [
      { header: 'Meta', key: 'meta', width: 24 },
      { header: 'Moneda', key: 'moneda', width: 8 },
      { header: 'Ahorrado', key: 'ahorrado', width: 14, money: true },
      { header: 'Objetivo', key: 'objetivo', width: 14, money: true },
      { header: 'Para', key: 'para', width: 10 },
      { header: 'Separar por mes', key: 'porMes', width: 16, money: true },
    ]);
    for (const g of balances) {
      const goalRecord = data.goals.find((x) => x.id === g.goalId);
      const plan = g.goalId ? plans.get(g.goalId) : undefined;
      metas.addRow({
        meta: g.name,
        moneda: g.currency,
        ahorrado: g.balance,
        objetivo: g.target,
        para: goalRecord?.targetMonth ?? '',
        porMes: plan && plan.status !== 'done' ? plan.perMonth : null,
      });
    }
    finish(metas);
  }

  // ---- Deudas ----
  if (data.debts.length) {
    const deudas = sheet(wb, 'Deudas', [
      { header: 'Persona', key: 'persona', width: 20 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Monto', key: 'monto', width: 12, money: true },
      { header: 'Moneda', key: 'moneda', width: 8 },
      { header: 'Pagado', key: 'pagado', width: 12, money: true },
      { header: 'Falta', key: 'falta', width: 12, money: true },
      { header: 'Detalle', key: 'detalle', width: 28 },
    ]);
    for (const d of data.debts) {
      const s = debtStatus(d);
      deudas.addRow({
        persona: d.person,
        tipo: d.direction === 'lent' ? 'Me debe' : 'Le debo',
        fecha: new Date(`${d.date}T12:00:00Z`),
        monto: d.amount,
        moneda: d.currency,
        pagado: s.paid,
        falta: s.done ? 0 : s.remaining,
        detalle: d.description,
      });
    }
    deudas.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    finish(deudas);
  }

  // ---- Stock ----
  if (data.stockItems.length) {
    const stock = sheet(wb, 'Stock', [
      { header: 'Producto', key: 'producto', width: 22 },
      { header: 'Lugar', key: 'lugar', width: 12 },
      { header: 'Hay', key: 'hay', width: 8 },
      { header: 'Unidad', key: 'unidad', width: 8 },
      { header: 'Usás por semana', key: 'semana', width: 14 },
      { header: 'Te dura (días)', key: 'dura', width: 12 },
      { header: 'Comprar', key: 'comprar', width: 10 },
      { header: 'Precio por unidad', key: 'precio', width: 16, money: true },
      { header: 'Por mes', key: 'mes', width: 12, money: true },
    ]);
    for (const s of stockOverview(data.stockItems, data.stockMoves, today, data.settings).statuses) {
      stock.addRow({
        producto: s.item.name,
        lugar: s.item.place,
        hay: s.quantity,
        unidad: UNIT_LABEL[s.item.unit],
        semana: s.usage ? Math.round(s.usage.perDay * 7 * 100) / 100 : null,
        dura: s.daysLeft,
        comprar: s.toBuy || null,
        precio: s.prices.last,
        mes: s.monthlyCost,
      });
    }
    finish(stock);
  }

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

  const byDateDesc = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => b.date.localeCompare(a.date));
  const asDate = (d: string) => new Date(`${d}T12:00:00Z`);

  // ---- Rutinas ----
  if (data.habitLogs.length) {
    const habit = new Map(data.habits.map((h) => [h.id, h]));
    const rutinas = sheet(wb, 'Rutinas', [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Rutina', key: 'rutina', width: 24 },
      { header: 'Hiciste', key: 'valor', width: 10 },
      { header: 'Meta', key: 'meta', width: 10 },
      { header: 'Unidad', key: 'unidad', width: 10 },
      { header: 'Cumplida', key: 'ok', width: 10 },
    ]);
    for (const l of byDateDesc(data.habitLogs)) {
      const h = habit.get(l.habitId);
      if (!h) continue;
      rutinas.addRow({
        fecha: asDate(l.date),
        rutina: h.name,
        valor: l.value,
        meta: h.target,
        unidad: h.unit,
        ok: l.value >= h.target ? 'Sí' : 'No',
      });
    }
    rutinas.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    finish(rutinas);
  }

  // ---- Estudio ----
  if (data.studySessions.length) {
    const subject = new Map(data.subjects.map((x) => [x.id, x.name]));
    const estudio = sheet(wb, 'Estudio', [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Materia', key: 'materia', width: 24 },
      { header: 'Minutos', key: 'minutos', width: 10 },
      { header: 'Nota', key: 'nota', width: 30 },
    ]);
    for (const x of byDateDesc(data.studySessions))
      estudio.addRow({ fecha: asDate(x.date), materia: subject.get(x.subjectId) ?? '', minutos: x.minutes, nota: x.note });
    estudio.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    finish(estudio);
  }

  // ---- Diario ----
  if (data.journal.length) {
    const diario = sheet(wb, 'Diario', [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Horas de sueño', key: 'sueno', width: 14 },
      { header: 'Ánimo (1 a 5)', key: 'animo', width: 13 },
      { header: 'Nota', key: 'nota', width: 40 },
    ]);
    for (const j of byDateDesc(data.journal))
      diario.addRow({ fecha: asDate(j.date), sueno: j.sleepHours, animo: j.mood, nota: j.note });
    diario.getColumn('fecha').numFmt = 'dd/mm/yyyy';
    finish(diario);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
