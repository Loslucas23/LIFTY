import { round2 } from './money';
import type { StudySession, Subject } from './schema';
import { addDays, daysBetween } from './weight';

/** Estudio: cuánto llevás de cada materia, cuánto te falta y cuánto estudiar por día para llegar. */
export interface SubjectStatus {
  subject: Subject;
  /** Horas estudiadas en total. */
  hours: number;
  week: number;
  /** Días que faltan para el examen (null si no tiene fecha; 0 = es hoy). */
  daysLeft: number | null;
  remainingHours: number | null;
  /** Minutos por día que hacen falta desde hoy (contando hoy) para llegar a la meta. */
  neededPerDay: number | null;
  /** Ritmo de los últimos 7 días (minutos por día). */
  pacePerDay: number;
  /** Horas que vas a tener el día del examen a este ritmo. */
  forecastHours: number | null;
  status: 'done' | 'on-track' | 'behind' | 'past' | 'no-goal';
}

export function subjectStatus(subject: Subject, sessions: StudySession[], today: string): SubjectStatus {
  const mine = sessions.filter((s) => s.subjectId === subject.id && s.date <= today);
  const minutes = mine.reduce((s, x) => s + x.minutes, 0);
  const week = mine.filter((s) => s.date > addDays(today, -7)).reduce((s, x) => s + x.minutes, 0);
  const pacePerDay = week / 7;
  const daysLeft = subject.examDate ? daysBetween(today, subject.examDate) : null;
  const goal = subject.goalHours;
  const remainingHours = goal !== null ? round2(Math.max(0, goal - minutes / 60)) : null;
  // Días para estudiar: de hoy hasta el día anterior al examen (si el examen es hoy, solo hoy).
  const studyDays = daysLeft !== null ? Math.max(1, daysLeft) : null;
  const neededPerDay = remainingHours !== null && studyDays !== null ? Math.ceil((remainingHours * 60) / studyDays) : null;
  const forecastHours = studyDays !== null ? round2((minutes + pacePerDay * studyDays) / 60) : null;
  let status: SubjectStatus['status'] = 'no-goal';
  if (daysLeft !== null && daysLeft < 0) status = 'past';
  else if (goal !== null && remainingHours === 0) status = 'done';
  else if (goal !== null && forecastHours !== null) status = forecastHours >= goal ? 'on-track' : 'behind';
  return {
    subject,
    hours: round2(minutes / 60),
    week: round2(week / 60),
    daysLeft,
    remainingHours,
    neededPerDay,
    pacePerDay: round2(pacePerDay),
    forecastHours,
    status,
  };
}

/** Minutos estudiados por día (de todas las materias), los últimos `days` días. */
export function studyByDay(sessions: StudySession[], today: string, days = 14): { date: string; minutes: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    return { date, minutes: sessions.filter((s) => s.date === date).reduce((a, s) => a + s.minutes, 0) };
  });
}
