import { describe, expect, it } from 'vitest';
import { habitLogSchema, habitSchema, habitStatus, habitsToday } from '../src';

const log = (habitId: string, date: string, value: number) =>
  habitLogSchema.parse({ id: `${habitId}:${date}`, habitId, date, value });

describe('rutinas y hábitos', () => {
  // 2026-10-11 es domingo.
  const today = '2026-10-11';
  it('cuenta la racha sin cortar por los días que no tocan ni por hoy sin hacer', () => {
    // Gimnasio lunes, miércoles y viernes.
    const gym = habitSchema.parse({ id: 'gym', name: 'Gimnasio', days: [1, 3, 5] });
    const logs = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09'].map((d) =>
      log('gym', d, 1),
    );
    const s = habitStatus(gym, logs, today);
    expect(s.dueToday).toBe(false);
    expect(s.streak).toBe(6);
    // De los últimos 7 días tocaban lunes 5, miércoles 7 y viernes 9: los 3 hechos.
    expect(s.week).toBe(1);
  });

  it('suma minutos de estudio y mide la meta del día', () => {
    const estudio = habitSchema.parse({ id: 'est', name: 'Estudiar', target: 60, unit: 'min' });
    const logs = [log('est', '2026-10-09', 90), log('est', '2026-10-10', 30), log('est', '2026-10-11', 60)];
    const s = habitStatus(estudio, logs, today);
    expect(s.done).toBe(true);
    // El 10 no llegó a 60: la racha es solo hoy.
    expect(s.streak).toBe(1);
    expect(s.best).toBe(1);
    expect(s.total7).toBe(180);
    const day = habitsToday([estudio], logs, today);
    expect(day.doneCount).toBe(1);
  });

  it('hoy sin hacer todavía no corta la racha', () => {
    const agua = habitSchema.parse({ id: 'agua', name: 'Agua', target: 8, unit: 'vasos' });
    const logs = [log('agua', '2026-10-09', 8), log('agua', '2026-10-10', 8), log('agua', '2026-10-11', 3)];
    const s = habitStatus(agua, logs, today);
    expect(s).toMatchObject({ done: false, streak: 2, today: 3 });
  });
});
