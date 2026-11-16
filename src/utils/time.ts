import type { CalendarEvent, RecurrenceRule } from '../types';

/** Computes the next RFC3339 due timestamp for a recurring task rule. */
export function nextRecurrenceDueIso(
  currentDue: string | undefined,
  rule: RecurrenceRule
): string {
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let base = todayMidnight;
  const ymd = extractYmd(currentDue);
  if (ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    if (!Number.isNaN(parsed.getTime()) && parsed > todayMidnight) {
      base = parsed;
    }
  }
  const next = new Date(base);
  if (rule === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (rule === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (rule === 'weekdays') {
    next.setDate(next.getDate() + 1);
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
  }
  return `${toLocalYmd(next)}T00:00:00.000Z`;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so it matches what the user sees). */
export function toLocalYmd(d: Date): string {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

/**
 * Extracts a YYYY-MM-DD date string safely without timezone off-by-one shifts.
 * Google Tasks stores due dates as UTC midnight (YYYY-MM-DDT00:00:00.000Z), so we
 * preserve that calendar day directly instead of converting UTC midnight to local time.
 */
export function extractYmd(dateStr?: string): string {
  if (!dateStr) return '';
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
    /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(dateStr)
  ) {
    return dateStr.slice(0, 10);
  }
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) {
    return toLocalYmd(d);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : '';
}

/** Formats a local date (with optional day offset) as a Google Tasks RFC3339 due timestamp. */
export function localOffsetToDueIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${toLocalYmd(d)}T00:00:00.000Z`;
}

/** Local clock time such as "09:30" for an ISO timestamp. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Splits a number of seconds into zero-padded minutes and seconds for the timer display. */
export function formatTimer(secondsLeft: number): { mins: string; secs: string } {
  return {
    mins: Math.floor(secondsLeft / 60)
      .toString()
      .padStart(2, '0'),
    secs: (secondsLeft % 60).toString().padStart(2, '0'),
  };
}

/** Start time of an event for compact displays, or "All day". */
export function eventShortTime(evt: CalendarEvent): string {
  if (evt.isAllDay) return 'All day';
  return formatTime(evt.start);
}
