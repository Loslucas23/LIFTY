import { URUGUAY_DEDUCTIONS } from './salary';
import type { Account, Category, EntityName, EntityTypes, Goal, Settings } from './schema';

/**
 * Id aleatorio. No usa `crypto.randomUUID` porque en el celular, abriendo la app por
 * http dentro de la red de casa, no está disponible (requiere https).
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const at = '1970-01-01T00:00:00.000Z';

export function defaultSettings(): Settings {
  return {
    id: 'main',
    updatedAt: at,
    ownerName: '',
    usdRate: 41,
    startMonth: null,
    startBalance: 0,
    heightCm: null,
    goalWeightKg: null,
  };
}

function cat(id: string, name: string, kind: Category['kind'], icon: string, color: string, sort: number): Category {
  return { id, updatedAt: at, name, kind, icon, color, monthlyLimit: null, archived: false, sort };
}

function acc(id: string, name: string, type: Account['type'], icon: string, color: string, sort: number): Account {
  return { id, updatedAt: at, name, type, currency: 'UYU', icon, color, archived: false, sort };
}

function goal(id: string, name: string, currency: Goal['currency'], icon: string, color: string): Goal {
  return { id, updatedAt: at, name, currency, target: null, icon, color, archived: false };
}

/** Datos iniciales, inspirados en la hoja "parametros" de la planilla. Ids fijos: el seed es idempotente. */
export function seedRecords(): { entity: EntityName; record: EntityTypes[EntityName] }[] {
  const categories: Category[] = [
    cat('cat-casa', 'Gastos de la casa', 'expense', '🏠', '#0ea5e9', 1),
    cat('cat-super', 'Supermercado', 'expense', '🛒', '#22c55e', 2),
    cat('cat-personal', 'Gastos personales', 'expense', '🧴', '#a855f7', 3),
    cat('cat-transporte', 'Transporte', 'expense', '🚌', '#f59e0b', 4),
    cat('cat-estudios', 'Estudios', 'expense', '📚', '#6366f1', 5),
    cat('cat-salud', 'Salud', 'expense', '🩺', '#ef4444', 6),
    cat('cat-ocio', 'Ocio', 'expense', '🎉', '#ec4899', 7),
    cat('cat-comida', 'Comida afuera', 'expense', '🍔', '#f97316', 8),
    cat('cat-servicios', 'Servicios', 'expense', '💡', '#14b8a6', 9),
    cat('cat-suscripciones', 'Suscripciones', 'expense', '📺', '#8b5cf6', 10),
    cat('cat-otros', 'Otros', 'expense', '📦', '#64748b', 11),
    cat('cat-sueldo', 'Sueldo', 'income', '💼', '#16a34a', 1),
    cat('cat-extras', 'Extras', 'income', '✨', '#84cc16', 2),
    cat('cat-regalos', 'Regalos', 'income', '🎁', '#d946ef', 3),
  ];
  const accounts: Account[] = [
    acc('acc-brou', 'BROU', 'bank', '🏦', '#1d4ed8', 1),
    acc('acc-itau', 'Itaú', 'bank', '🏦', '#ea580c', 2),
    acc('acc-efectivo', 'Efectivo', 'cash', '💵', '#16a34a', 3),
    acc('acc-tarjeta', 'Tarjeta de crédito', 'credit', '💳', '#7c3aed', 4),
    acc('acc-alimentacion', 'Tarjeta alimentación', 'food', '🍽️', '#0d9488', 5),
  ];
  const goals: Goal[] = [
    goal('goal-uyu', 'Ahorro en pesos', 'UYU', '🐷', '#0ea5e9'),
    goal('goal-usd', 'Ahorro en dólares', 'USD', '💵', '#16a34a'),
  ];
  return [
    { entity: 'settings', record: defaultSettings() },
    ...categories.map((record) => ({ entity: 'category' as const, record })),
    ...accounts.map((record) => ({ entity: 'account' as const, record })),
    ...goals.map((record) => ({ entity: 'goal' as const, record })),
  ];
}

export { URUGUAY_DEDUCTIONS };
