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
  type: z.enum(ACCOUNT_TYPES),
  currency: currency.default('UYU'),
  color,
  icon,
  archived: z.boolean().default(false),
  sort: z.number().default(0),
});
export type Account = z.infer<typeof accountSchema>;

export const categorySchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  kind: z.enum(['expense', 'income']),
  color,
  icon,
  /** Tope mensual en UYU (presupuesto por categoría). */
  monthlyLimit: money.positive().nullable().default(null),
  archived: z.boolean().default(false),
  sort: z.number().default(0),
});
export type Category = z.infer<typeof categorySchema>;

export const TX_KINDS = ['expense', 'income', 'saving'] as const;
export type TxKind = (typeof TX_KINDS)[number];
export const LINK_KINDS = ['fixed', 'salary', 'aguinaldo'] as const;
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
    goalId: id.nullable().default(null),
    description: z.string().max(200).default(''),
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
  archived: z.boolean().default(false),
});
export type FixedExpense = z.infer<typeof fixedSchema>;

export const goalSchema = z.object({
  ...base,
  name: z.string().min(1).max(60),
  currency: currency.default('UYU'),
  target: money.positive().nullable().default(null),
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
});
export type Settings = z.infer<typeof settingsSchema>;

export const ENTITY_SCHEMAS = {
  account: accountSchema,
  category: categorySchema,
  transaction: transactionSchema,
  income: incomeSchema,
  fixed: fixedSchema,
  goal: goalSchema,
  closing: closingSchema,
  settings: settingsSchema,
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
}
