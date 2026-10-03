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
  /** Tarjeta de alimentación: lo que carga la empresa cada mes y qué día. */
  monthlyLoad: money.min(0).nullable().default(null),
  loadDay: z.number().int().min(1).max(31).nullable().default(null),
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
  /** Genera aguinaldo (junio y diciembre, o proporcional al terminar). */
  aguinaldo: z.boolean().default(true),
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
}
