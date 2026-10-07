import { habitLogId, nextReminderDate, type HabitStatus, type Reminder } from '@lifty/core';
import { openPrompt } from '../components/Editors';
import { toast } from '../components/ui';
import { mutate } from './sync';

/**
 * Acciones de la vida diaria que se usan desde Inicio y desde sus pantallas. Viven acá (y no
 * en cada pantalla) para que Inicio no tenga que cargar esas pantallas enteras al abrir.
 */

const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** "Renové": pasa al próximo vencimiento (o lo da por terminado si no se repite). */
export function renewReminder(r: Reminder) {
  const next = nextReminderDate(r);
  if (!next) {
    mutate('reminder', 'upsert', { ...r, archived: true });
    toast(`${r.name}: listo`, { action: { label: 'Deshacer', run: () => mutate('reminder', 'upsert', r) } });
    return;
  }
  mutate('reminder', 'upsert', { ...r, date: next });
  toast(`${r.name}: próximo vencimiento ${fmtDate(next)}`, {
    action: { label: 'Deshacer', run: () => mutate('reminder', 'upsert', r) },
  });
}

/** Tocar una rutina: si es "sí/no" la marca o desmarca; si tiene cantidad, pregunta cuánto. */
export function tapHabit(s: HabitStatus, date: string) {
  const h = s.habit;
  if (h.target === 1 && !h.unit) return setHabitValue(h.id, date, s.done ? 0 : 1);
  openPrompt({
    title: `${h.icon} ${h.name}`,
    label: `¿Cuánto hoy? (${h.unit || 'veces'})`,
    initial: String(s.today || ''),
    hint: `Meta: ${h.target} ${h.unit}. Podés sumar de a poco con el +.`,
    onSubmit: (v) => {
      if (v < 0) return 'Escribí un número';
      setHabitValue(h.id, date, v);
    },
  });
}

export function setHabitValue(habitId: string, date: string, value: number) {
  const id = habitLogId(habitId, date);
  if (value <= 0) mutate('habitLog', 'delete', id);
  else mutate('habitLog', 'upsert', { id, updatedAt: '', habitId, date, value });
}
