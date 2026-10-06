import { z } from 'zod';
import { isDate, isMonth } from './months';

/**
 * Todas las entidades de Lifty se guardan como "registros" (documentos JSON) con un
 * `id` y un `updatedAt`. Así un módulo nuevo (por ejemplo, Peso) solo necesita
 * declarar su esquema acá: el servidor y la sincronización ya lo soportan.
 */

const id = z.string().min(1).max(64);
const month = z.string().refine(isMonth, 'Mes inválido (YYYY-MM)');
const date = z.string().refine(isDate, 'Fecha inválida (YYYY-MM-DD)');
const money = z.number().finite();
const color = z.string().max(32).default('#6366f1');
const icon = z.string().max(16).default('•');

export const CURRENCIES = ['UYU', 'USD'] as const;
export const currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof currency>;

const base = {
  id,
  updatedAt: z.string().default(() => new Date().toISOString()),
};

export const ACCOUNT_TYPES = ['bank', 'cash', 'credit', 'food'] as const;
export const accountSchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  /**
   * bank / cash: plata. credit: tarjeta de crédito (las compras se pagan en cuotas).
   * food: tarjeta de alimentación: NO es plata, va aparte del presupuesto.
   */
  type: z.enum(ACCOUNT_TYPES),
  currency: currency.default('UYU'),
  color,
  icon,
  archived: z.boolean().default(false),
  sort: z.number().default(0),
  /** Saldo inicial (en la moneda de la cuenta). En la tarjeta de crédito, negativo = deuda. */
  initialBalance: money.default(0),
  /**
   * Cuándo se ajustó el saldo por última vez. En la tarjeta, lo que debías ese día se paga
   * en el resumen siguiente (con el débito automático).
   */
  initialBalanceDate: date.nullable().default(null),
  /** Tarjeta de alimentación: lo que carga la empresa cada mes y qué día. */
  monthlyLoad: money.min(0).nullable().default(null),
  loadDay: z.number().int().min(1).max(31).nullable().default(null),
  /**
   * Plata guardada (ej: BROU dólares): no se usa para gastar. No entra en lo disponible y
   * pasarle plata cuenta como ahorro (sacarle, como retiro de ahorro).
   */
  reserved: z.boolean().default(false),
  /**
   * Tarjeta de crédito: el resumen se paga entero todos los meses (débito automático o lo
   * pagás vos). Así, cada resumen vencido se da por pagado desde `payFromAccountId` (o tu
   * cuenta principal) aunque no lo anotes. Si pagás el mínimo o en partes, desactivalo y
   * anotá cada pago.
   */
  autopay: z.boolean().default(true),
  payFromAccountId: id.nullable().default(null),
  /** Día del mes siguiente en que se paga el resumen (si no, se toma el último día del mes). */
  payDay: z.number().int().min(1).max(28).nullable().default(null),
  /** Tarjeta de alimentación: la carga del mes se anota sola el día de carga. */
  autoLoad: z.boolean().default(false),
});
export type Account = z.infer<typeof accountSchema>;

export const categorySchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  kind: z.enum(['expense', 'income']),
  color,
  icon,
  /** Presupuesto mensual en UYU para todos los meses (cada mes se puede cambiar aparte). */
  monthlyLimit: money.positive().nullable().default(null),
  archived: z.boolean().default(false),
  sort: z.number().default(0),
});
export type Category = z.infer<typeof categorySchema>;

/** transfer: mover plata entre cuentas (cajero, pagar la tarjeta…): no es gasto ni ingreso. */
export const TX_KINDS = ['expense', 'income', 'saving', 'transfer'] as const;
export type TxKind = (typeof TX_KINDS)[number];
/**
 * fixed/salary/aguinaldo: confirma algo del presupuesto. load: carga mensual de la
 * tarjeta de alimentación. cardbill: pago del resumen de la tarjeta de crédito.
 */
export const LINK_KINDS = ['fixed', 'salary', 'aguinaldo', 'load', 'cardbill'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const transactionSchema = z
  .object({
    ...base,
    date,
    kind: z.enum(TX_KINDS),
    /** Monto total en la moneda del movimiento. Negativo = reintegro / retiro. */
    amount: money.refine((v) => v !== 0, 'El monto no puede ser 0'),
    currency: currency.default('UYU'),
    /** Pesos por unidad de moneda al momento de cargarlo (1 para UYU). */
    fxRate: money.positive().default(1),
    categoryId: id.nullable().default(null),
    accountId: id.nullable().default(null),
    /** Solo transferencias: cuenta destino (accountId es el origen). */
    toAccountId: id.nullable().default(null),
    /** Gasto dividido: la parte que le toca a otra persona (no cuenta en tu presupuesto). */
    sharedAmount: money.min(0).default(0),
    sharedWith: z.string().max(60).default(''),
    goalId: id.nullable().default(null),
    description: z.string().max(200).default(''),
    /** Etiquetas libres ("viaje Brasil", "cumple de mamá") para juntar gastos de distintas categorías. */
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    /** Cuotas (solo tiene sentido con tarjeta de crédito). */
    installments: z.number().int().min(1).max(60).default(1),
    /** Mes en que cae la primera cuota. Por defecto, el mes de la compra. */
    firstInstallmentMonth: month.nullable().default(null),
    /** Vínculo con algo planificado: confirma un sueldo, aguinaldo o gasto fijo. */
    linkKind: z.enum(LINK_KINDS).nullable().default(null),
    linkId: id.nullable().default(null),
    linkMonth: month.nullable().default(null),
  })
  .refine((t) => (t.linkKind === null) === (t.linkId === null && t.linkMonth === null), {
    message: 'Vínculo incompleto',
    path: ['linkKind'],
  })
  .refine((t) => t.sharedAmount === 0 || (t.kind === 'expense' && t.sharedAmount < Math.abs(t.amount)), {
    message: 'La parte de la otra persona tiene que ser menor que el total',
    path: ['sharedAmount'],
  })
  .refine((t) => t.kind !== 'transfer' || (t.accountId && t.toAccountId && t.accountId !== t.toAccountId && t.amount > 0), {
    message: 'Una transferencia necesita cuenta de origen y de destino distintas, y un monto positivo',
    path: ['toAccountId'],
  });
export type Transaction = z.infer<typeof transactionSchema>;

export const deductionSchema = z.object({
  label: z.string().min(1).max(60),
  /** Porcentaje sobre (nominal + extraBase). */
  percent: z.number().min(0).max(100).default(0),
  /** Suma a la base de cálculo (por ejemplo, ticket alimentación gravado). */
  extraBase: z.number().min(0).default(0),
  /** Monto fijo (por ejemplo, IRPF del mes). */
  fixed: z.number().min(0).default(0),
});
export type Deduction = z.infer<typeof deductionSchema>;

export const incomeSchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  /** Sueldo nominal. */
  gross: money.min(0),
  /** Si se indica, se usa como líquido en vez de calcularlo con los descuentos. */
  netOverride: money.min(0).nullable().default(null),
  deductions: z.array(deductionSchema).default([]),
  currency: currency.default('UYU'),
  startMonth: month,
  endMonth: month.nullable().default(null),
  /** Cada cuántos meses se cobra: 1 = todos los meses, 12 = una vez al año. */
  everyMonths: z.number().int().min(1).max(24).default(1),
  /** Genera aguinaldo (junio y diciembre). */
  aguinaldo: z.boolean().default(true),
  /**
   * Al terminar el trabajo, ¿te pagan el aguinaldo proporcional con la liquidación? Por defecto
   * no se cuenta: muchas veces se cobra tarde, junto con el último sueldo o nunca; si sabés que
   * lo vas a cobrar, se activa y se suma en el último mes.
   */
  aguinaldoOnExit: z.boolean().default(false),
  /** Piloto automático: el día de cobro se marca cobrado solo (si te depositan siempre el mismo día). */
  autoConfirm: z.boolean().default(false),
  payDay: z.number().int().min(1).max(31).nullable().default(null),
  categoryId: id.nullable().default(null),
  accountId: id.nullable().default(null),
  archived: z.boolean().default(false),
});
export type IncomeSource = z.infer<typeof incomeSchema>;

export const fixedSchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  amount: money.positive(),
  currency: currency.default('UYU'),
  categoryId: id.nullable().default(null),
  accountId: id.nullable().default(null),
  dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
  startMonth: month,
  endMonth: month.nullable().default(null),
  /** Cada cuántos meses se paga: 1 = mensual, 3 = trimestral, 12 = anual (patente, contribución…). */
  everyMonths: z.number().int().min(1).max(24).default(1),
  archived: z.boolean().default(false),
  /** Piloto automático: se debita solo (UTE, Antel, cuota…): el día que vence se marca pagado. */
  autopay: z.boolean().default(false),
});
export type FixedExpense = z.infer<typeof fixedSchema>;

export const goalSchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  currency: currency.default('UYU'),
  target: money.positive().nullable().default(null),
  /** Para cuándo (mes). Con esto Lifty calcula cuánto separar por mes. */
  targetMonth: month.nullable().default(null),
  /** Desde cuándo se ahorra para la meta (para saber si vas atrasado o adelantado). */
  startMonth: month.nullable().default(null),
  /**
   * Dónde está guardada la plata (ej: BROU dólares). Si se indica, ahorrar no la saca de tus
   * cuentas: queda en esa cuenta, apartada. Si no, se considera guardada fuera de tus cuentas.
   */
  accountId: id.nullable().default(null),
  color,
  icon,
  archived: z.boolean().default(false),
});
export type Goal = z.infer<typeof goalSchema>;

/** Cierre de mes: lo que realmente quedó (como "TERMINO MES" + "Total real"). */
export const closingSchema = z.object({
  ...base,
  /** El id es el mes ("YYYY-MM"). */
  id: month,
  realBalance: money,
  note: z.string().max(200).default(''),
});
export type MonthClosing = z.infer<typeof closingSchema>;

export const settingsSchema = z.object({
  ...base,
  id: z.literal('main').default('main'),
  ownerName: z.string().max(60).default(''),
  /** Pesos uruguayos por dólar. */
  usdRate: money.positive().default(41),
  /** Primer mes que lleva Lifty: desde ahí se arrastra el saldo. */
  startMonth: month.nullable().default(null),
  /** Saldo con el que arrancó `startMonth`. */
  startBalance: money.default(0),
  /** Meta de ahorro del mes ("pagate a vos primero"): nada, un monto fijo o un % de los ingresos. */
  savingsMode: z.enum(['none', 'amount', 'percent']).default('none'),
  savingsValue: money.min(0).default(0),
  /** Módulo Peso: altura (para el IMC) y peso objetivo. */
  heightCm: z.number().min(50).max(250).nullable().default(null),
  goalWeightKg: z.number().min(20).max(400).nullable().default(null),
  /** Módulo Stock: cada cuántos días hacés las compras (para saber qué comprar ahora). */
  shoppingDays: z.number().int().min(1).max(60).default(7),
  /** Piloto automático: cuando cobrás, lo que falta para la meta de ahorro del mes pasa solo al ahorro. */
  autoSave: z.boolean().default(false),
  autoSaveGoalId: id.nullable().default(null),
  /** Piloto automático: cuando cobrás, separa lo que le toca este mes a cada meta con fecha. */
  autoSaveGoals: z.boolean().default(false),
  /** Piloto automático: lo que se termina en el stock va solo a la lista de compras. */
  autoShop: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;

/**
 * Presupuesto de una categoría para un mes puntual. Si no hay, vale el presupuesto
 * general de la categoría (`monthlyLimit`, el de "todos los meses").
 */
export const budgetSchema = z.object({
  ...base,
  /** `${mes}:${categoryId}` */
  id,
  month,
  categoryId: id,
  amount: money.min(0),
});
export type BudgetEntry = z.infer<typeof budgetSchema>;

export function budgetId(month: string, categoryId: string): string {
  return `${month}:${categoryId}`;
}

/** Deudas y préstamos con otras personas (no son gastos ni ingresos). */
export const debtPaymentSchema = z.object({
  id,
  date,
  amount: money.positive(),
  /** Cuenta donde entró / de donde salió la plata (para el saldo de la cuenta). */
  accountId: id.nullable().default(null),
});
export type DebtPayment = z.infer<typeof debtPaymentSchema>;

export const debtSchema = z.object({
  ...base,
  person: z.string().min(1).max(60),
  /** lent: yo le presté (me deben). borrowed: me prestaron (debo). */
  direction: z.enum(['lent', 'borrowed']),
  amount: money.positive(),
  currency: currency.default('UYU'),
  date,
  description: z.string().max(200).default(''),
  /** Cuenta de donde salió (préstamo) o adonde entró (me prestaron). */
  accountId: id.nullable().default(null),
  /** Si viene de un gasto dividido, el movimiento original (la plata ya salió ahí). */
  fromTxId: id.nullable().default(null),
  payments: z.array(debtPaymentSchema).default([]),
  /** Saldada a mano (perdonada, compensada…). */
  settled: z.boolean().default(false),
});
export type Debt = z.infer<typeof debtSchema>;

/** Módulo Peso: un pesaje. */
export const weightSchema = z.object({
  ...base,
  date,
  kg: z.number().min(20).max(400),
  note: z.string().max(200).default(''),
});
export type WeightEntry = z.infer<typeof weightSchema>;

/** Módulo Stock: unidades y lugares de la casa. */
export const STOCK_UNITS = ['u', 'kg', 'g', 'l', 'ml', 'paq'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const STOCK_PLACES = ['despensa', 'heladera', 'freezer', 'limpieza', 'higiene', 'otros'] as const;
export type StockPlace = (typeof STOCK_PLACES)[number];

/** Un producto que tenés en casa (arroz, leche, detergente…). */
export const stockItemSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('📦'),
  place: z.enum(STOCK_PLACES).default('despensa'),
  unit: z.enum(STOCK_UNITS).default('u'),
  /** Avisar cuando quede esto o menos (opcional: si no, Lifty usa lo que consumís). */
  minQuantity: z.number().min(0).nullable().default(null),
  /** Cuánto viene en lo que comprás (ej: paquete de 1 kg): la lista redondea a esto. */
  packSize: z.number().positive().nullable().default(null),
  /** Para cuántos días querés tener (si no, los días entre compras de Ajustes). */
  coverDays: z.number().int().min(1).max(180).nullable().default(null),
  note: z.string().max(200).default(''),
  archived: z.boolean().default(false),
});
export type StockItem = z.infer<typeof stockItemSchema>;

/**
 * Un movimiento de stock. buy: compré (suma). use: usé (resta). waste: tiré (resta, se
 * cuenta aparte). count: conté y hay exactamente `quantity` (corrige sin borrar historia).
 */
export const STOCK_MOVE_KINDS = ['buy', 'use', 'waste', 'count'] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];
export const stockMoveSchema = z.object({
  ...base,
  itemId: id,
  date,
  kind: z.enum(STOCK_MOVE_KINDS),
  quantity: z.number().min(0).max(1_000_000),
  /** Solo compras: lo que pagaste en total por esa cantidad (pesos). */
  price: money.min(0).nullable().default(null),
  store: z.string().max(60).default(''),
  /** Solo compras: cuándo vence lo que compraste. */
  expiry: date.nullable().default(null),
  /** El gasto que se cargó con esta compra (si se cargó). */
  txId: id.nullable().default(null),
});
export type StockMove = z.infer<typeof stockMoveSchema>;

/** Lista de compras compartida (se tilda en el súper y se ve en todos los dispositivos). */
export const shopEntrySchema = z.object({
  ...base,
  /** Si es un producto del stock; si no, es algo suelto ("velas de cumpleaños"). */
  itemId: id.nullable().default(null),
  name: z.string().trim().min(1).max(60),
  quantity: z.number().min(0).nullable().default(null),
  unit: z.string().max(10).default(''),
  checked: z.boolean().default(false),
});
export type ShopEntry = z.infer<typeof shopEntrySchema>;

/** Rutinas y hábitos: tomar agua, estudiar, ejercicio, tender la cama… */
export const HABIT_AREAS = ['rutina', 'estudio', 'ejercicio', 'salud', 'casa', 'otro'] as const;
export const HABIT_TIMES = ['mañana', 'tarde', 'noche', 'cualquiera'] as const;
export const habitSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('✅'),
  area: z.enum(HABIT_AREAS).default('rutina'),
  time: z.enum(HABIT_TIMES).default('cualquiera'),
  /** Días de la semana (0 = domingo … 6 = sábado). */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  /** Meta del día (1 = hecho / no hecho; 8 vasos; 60 minutos…). */
  target: z.number().positive().max(10000).default(1),
  unit: z.string().max(12).default(''),
  sort: z.number().default(0),
  archived: z.boolean().default(false),
});
export type Habit = z.infer<typeof habitSchema>;

/** Lo hecho de un hábito en un día. El id es `${habitId}:${fecha}`. */
export const habitLogSchema = z.object({
  ...base,
  habitId: id,
  date,
  value: z.number().min(0).max(100000),
});
export type HabitLog = z.infer<typeof habitLogSchema>;

/** Estudio: una materia (o curso) con su examen y las horas que querés dedicarle. */
export const subjectSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('📘'),
  examDate: date.nullable().default(null),
  goalHours: z.number().positive().max(5000).nullable().default(null),
  archived: z.boolean().default(false),
});
export type Subject = z.infer<typeof subjectSchema>;

export const studySessionSchema = z.object({
  ...base,
  subjectId: id,
  date,
  minutes: z.number().positive().max(1440),
  note: z.string().max(200).default(''),
});
export type StudySession = z.infer<typeof studySessionSchema>;

/** Vencimientos de la casa: cédula, libreta, seguro, service, garantías… */
export const reminderSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('📌'),
  /** Cuándo vence (o cuándo toca). */
  date,
  /** Cada cuántos meses se renueva (null = una sola vez, ej: una garantía). */
  repeatMonths: z.number().int().min(1).max(240).nullable().default(null),
  /** Con cuántos días de anticipación avisar. */
  notifyDays: z.number().int().min(0).max(365).default(30),
  note: z.string().max(200).default(''),
  /** Ya no hace falta (una garantía vencida, un auto que vendiste). */
  archived: z.boolean().default(false),
});
export type Reminder = z.infer<typeof reminderSchema>;

/** Metas del año: el avance sale solo de lo que ya cargás (ahorro, peso, estudio, hábitos) o se anota a mano. */
export const YEAR_GOAL_KINDS = ['savings', 'weight', 'study', 'habit', 'manual'] as const;
export const yearGoalSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('🎯'),
  year: z.number().int().min(2000).max(2100),
  kind: z.enum(YEAR_GOAL_KINDS),
  /** savings: pesos ahorrados en el año. weight: peso al que querés llegar. study: horas. habit: días cumplidos. */
  target: z.number().positive().max(100_000_000),
  /** habit: el hábito; study: la materia (null = todas). */
  refId: id.nullable().default(null),
  /** manual: lo que llevás. */
  manualValue: z.number().min(0).default(0),
  unit: z.string().max(12).default(''),
  archived: z.boolean().default(false),
});
export type YearGoal = z.infer<typeof yearGoalSchema>;

/** Recetas: ingredientes del stock para saber qué podés cocinar y cuánto sale. */
export const recipeSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(8).default('🍲'),
  servings: z.number().int().min(1).max(50).default(2),
  ingredients: z
    .array(z.object({ itemId: id, quantity: z.number().positive().max(100000) }))
    .max(40)
    .default([]),
  note: z.string().max(500).default(''),
  archived: z.boolean().default(false),
});
export type Recipe = z.infer<typeof recipeSchema>;

/** Diario: cómo dormiste y cómo te sentiste. El id es la fecha. */
export const journalSchema = z.object({
  ...base,
  date,
  sleepHours: z.number().min(0).max(24).nullable().default(null),
  /** 1 (mal) a 5 (muy bien). */
  mood: z.number().int().min(1).max(5).nullable().default(null),
  note: z.string().max(500).default(''),
  /** "Hoy no gasté" (para distinguir un día sin gastos de un día sin anotar). */
  noSpend: z.boolean().default(false),
});
export type JournalEntry = z.infer<typeof journalSchema>;

/** Regla de categoría: si la descripción contiene `contains`, va a `categoryId`. */
export const ruleSchema = z.object({
  ...base,
  contains: z.string().trim().min(2).max(40),
  categoryId: id,
});
export type CategoryRule = z.infer<typeof ruleSchema>;

export const CHALLENGE_KINDS = ['no-spend-category', 'spend-under', 'no-spend-days', 'habit-days', 'save'] as const;

/**
 * Desafío: algo concreto para un período ("7 días sin pedir comida", "ahorrar $5.000 este mes").
 * El avance sale solo de lo que cargás.
 */
export const challengeSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(8).default('🏆'),
  kind: z.enum(CHALLENGE_KINDS),
  categoryId: id.nullable().default(null),
  habitId: id.nullable().default(null),
  /** Días (sin gastar, de la rutina) o pesos (tope de gasto, ahorro). */
  target: z.number().min(0).max(100_000_000),
  from: date,
  to: date,
  archived: z.boolean().default(false),
});
export type Challenge = z.infer<typeof challengeSchema>;

export const AUTO_KINDS = ['fixed', 'income', 'load', 'saving', 'shop', 'category'] as const;

/**
 * Lo que hizo el piloto automático (una vez por clave: `fixed:<id>:<mes>`…). Si lo deshacés,
 * queda `undone` y no lo vuelve a hacer.
 */
export const autoLogSchema = z.object({
  ...base,
  date,
  kind: z.enum(AUTO_KINDS),
  title: z.string().max(120),
  /** Lo que creó o cambió (para deshacer). */
  created: z
    .array(z.object({ entity: z.string(), id }))
    .max(30)
    .default([]),
  /** Cómo estaba antes lo que cambió (por ejemplo, la categoría de un movimiento). */
  before: z.array(z.unknown()).max(30).default([]),
  undone: z.boolean().default(false),
});
export type AutoLog = z.infer<typeof autoLogSchema>;

export const ENTITY_SCHEMAS = {
  account: accountSchema,
  category: categorySchema,
  transaction: transactionSchema,
  income: incomeSchema,
  fixed: fixedSchema,
  goal: goalSchema,
  closing: closingSchema,
  settings: settingsSchema,
  weight: weightSchema,
  budget: budgetSchema,
  debt: debtSchema,
  stockItem: stockItemSchema,
  stockMove: stockMoveSchema,
  shopEntry: shopEntrySchema,
  habit: habitSchema,
  habitLog: habitLogSchema,
  subject: subjectSchema,
  studySession: studySessionSchema,
  reminder: reminderSchema,
  yearGoal: yearGoalSchema,
  recipe: recipeSchema,
  journal: journalSchema,
  rule: ruleSchema,
  autoLog: autoLogSchema,
  challenge: challengeSchema,
} as const;

export type EntityName = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_NAMES = Object.keys(ENTITY_SCHEMAS) as EntityName[];

export interface EntityTypes {
  account: Account;
  category: Category;
  transaction: Transaction;
  income: IncomeSource;
  fixed: FixedExpense;
  goal: Goal;
  closing: MonthClosing;
  settings: Settings;
  weight: WeightEntry;
  budget: BudgetEntry;
  debt: Debt;
  stockItem: StockItem;
  stockMove: StockMove;
  shopEntry: ShopEntry;
  habit: Habit;
  habitLog: HabitLog;
  subject: Subject;
  studySession: StudySession;
  reminder: Reminder;
  yearGoal: YearGoal;
  recipe: Recipe;
  journal: JournalEntry;
  rule: CategoryRule;
  autoLog: AutoLog;
  challenge: Challenge;
}

export function isEntityName(value: string): value is EntityName {
  return Object.prototype.hasOwnProperty.call(ENTITY_SCHEMAS, value);
}

export function parseEntity<E extends EntityName>(entity: E, value: unknown): EntityTypes[E] {
  return ENTITY_SCHEMAS[entity].parse(value) as EntityTypes[E];
}

/** Una mutación: la unidad que viaja del dispositivo al servidor (y a la cola offline). */
export const mutationSchema = z.object({
  entity: z.string(),
  op: z.enum(['upsert', 'delete']),
  id,
  updatedAt: z.string(),
  record: z.unknown().optional(),
});
export type Mutation = z.infer<typeof mutationSchema>;

export interface LiftyData {
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  incomes: IncomeSource[];
  fixed: FixedExpense[];
  goals: Goal[];
  closings: MonthClosing[];
  weights: WeightEntry[];
  budgets: BudgetEntry[];
  debts: Debt[];
  stockItems: StockItem[];
  stockMoves: StockMove[];
  shopEntries: ShopEntry[];
  habits: Habit[];
  habitLogs: HabitLog[];
  subjects: Subject[];
  studySessions: StudySession[];
  reminders: Reminder[];
  yearGoals: YearGoal[];
  recipes: Recipe[];
  journal: JournalEntry[];
  rules: CategoryRule[];
  autoLogs: AutoLog[];
  challenges: Challenge[];
}
