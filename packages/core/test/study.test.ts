import { describe, expect, it } from 'vitest';
import { exerciseVsWeight, habitLogSchema, habitSchema, studySessionSchema, subjectSchema, subjectStatus } from '../src';

let n = 0;
const ses = (date: string, minutes: number) => studySessionSchema.parse({ id: `s${++n}`, subjectId: 'mate', date, minutes });

describe('estudio', () => {
  const mate = subjectSchema.parse({ id: 'mate', name: 'Matemática', examDate: '2026-10-21', goalHours: 20 });
  it('calcula cuánto estudiar por día para llegar al examen', () => {
    // 10 horas hechas; la última semana 7 horas (60 min por día).
    const sessions = [
      ses('2026-09-20', 180),
      ...Array.from({ length: 7 }, (_, i) => ses(`2026-10-${String(i + 5).padStart(2, '0')}`, 60)),
    ];
    const s = subjectStatus(mate, sessions, '2026-10-11');
    expect(s.hours).toBe(10);
    expect(s.daysLeft).toBe(10);
    expect(s.remainingHours).toBe(10);
    // 10 horas en 10 días = 60 minutos por día.
    expect(s.neededPerDay).toBe(60);
    expect(s.pacePerDay).toBe(60);
    // A 60 min/día: 10 + 10 = 20 horas el día del examen → llega justo.
    expect(s.forecastHours).toBe(20);
    expect(s.status).toBe('on-track');
  });

  it('avisa si a este ritmo no llegás', () => {
    const s = subjectStatus(mate, [ses('2026-10-10', 30)], '2026-10-11');
    expect(s.status).toBe('behind');
    expect(s.neededPerDay).toBe(117);
  });
});

describe('ejercicio y peso', () => {
  it('compara el cambio de peso de las semanas con 3+ entrenamientos y las demás', () => {
    const gym = habitSchema.parse({ id: 'gym', name: 'Gimnasio', area: 'ejercicio', target: 30, unit: 'min' });
    // Hoy lunes 12/10: se miran las 3 semanas terminadas (desde el lunes 21/9).
    const logs = ['2026-10-05', '2026-10-07', '2026-10-09'].map((date) =>
      habitLogSchema.parse({ id: `gym:${date}`, habitId: 'gym', date, value: 40 }),
    );
    const weights = [
      { date: '2026-09-21', kg: 81 },
      { date: '2026-09-29', kg: 81.2 },
      { date: '2026-10-06', kg: 80.6 },
      { date: '2026-10-10', kg: 80.4 },
    ];
    const r = exerciseVsWeight([gym], logs, weights, '2026-10-12', 3);
    expect(r.weeks.map((w) => [w.week, w.workouts, w.avgKg, w.change])).toEqual([
      ['2026-09-21', 0, 81, null],
      ['2026-09-28', 0, 81.2, 0.2],
      ['2026-10-05', 3, 80.5, -0.7],
    ]);
    expect(r.active).toEqual({ weeks: 1, avgChange: -0.7 });
    expect(r.rest).toEqual({ weeks: 1, avgChange: 0.2 });
  });
});
