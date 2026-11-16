import type { PomodoroSession } from '../types';
import { toLocalYmd } from './time';

export interface FocusSummary {
  todayMinutes: number;
  streakDays: number;
  goalMinutes: number;
}

/** Today's focus minutes and the current streak (counts back from today, or yesterday if today is empty). */
export function computeFocusSummary(
  sessions: PomodoroSession[],
  goalMinutes: number
): FocusSummary {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    if (s.mode !== 'focus' && s.mode !== 'stopwatch') continue;
    const d = new Date(s.endedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = toLocalYmd(d);
    byDay.set(key, (byDay.get(key) ?? 0) + (s.durationMinutes || 0));
  }
  const today = new Date();
  const todayMinutes = byDay.get(toLocalYmd(today)) ?? 0;
  const cursor = new Date(today);
  if (todayMinutes <= 0) cursor.setDate(cursor.getDate() - 1);
  let streakDays = 0;
  while ((byDay.get(toLocalYmd(cursor)) ?? 0) > 0) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { todayMinutes, streakDays, goalMinutes: Math.max(1, goalMinutes) };
}
