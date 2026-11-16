import type { Priority } from '../types';
import { toLocalYmd } from './time';

export interface ParsedTaskInput {
  title: string;
  dueDate?: string;
  priority?: Priority;
  durationMinutes?: number;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Parses inline natural-language tokens from a task title:
 * - Priority: p1..p5
 * - Due date: today, tomorrow, next week, or weekday names (mon/monday..sun/sunday)
 * - Duration: e.g. 30m, 45m, 1h, 90m
 */
export function parseSmartTaskInput(
  raw: string,
  todayYmd: string = toLocalYmd(new Date())
): ParsedTaskInput {
  let text = raw.trim();
  let priority: Priority | undefined = undefined;
  let dueDate: string | undefined = undefined;
  let durationMinutes: number | undefined = undefined;

  const prioMatch = text.match(/(?:^|\s)p([1-5])(?:\s|$)/i);
  if (prioMatch) {
    priority = Number(prioMatch[1]) as Priority;
    text = text.replace(prioMatch[0], ' ').replace(/\s{2,}/g, ' ').trim();
  }

  const durMatch = text.match(/(?:^|\s)(\d{1,3})\s*(m|min|mins|h|hr|hrs)(?:\s|$)/i);
  if (durMatch) {
    const val = Number(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    const mins = unit.startsWith('h') ? val * 60 : val;
    if (mins >= 5 && mins <= 480) {
      durationMinutes = mins;
      text = text.replace(durMatch[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  }

  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const baseDate = new Date(ty, (tm || 1) - 1, td || 1);

  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 1);
    dueDate = toLocalYmd(d);
    text = text.replace(/\btomorrow\b/i, '').replace(/\s{2,}/g, ' ').trim();
  } else if (/\btoday\b/i.test(text)) {
    dueDate = todayYmd;
    text = text.replace(/\btoday\b/i, '').replace(/\s{2,}/g, ' ').trim();
  } else if (/\bnext week\b/i.test(text)) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + 7);
    dueDate = toLocalYmd(d);
    text = text.replace(/\bnext week\b/i, '').replace(/\s{2,}/g, ' ').trim();
  } else {
    const dayRegex =
      /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
    const dayMatch = text.match(dayRegex);
    if (dayMatch) {
      const targetShort = dayMatch[1].slice(0, 3).toLowerCase();
      const targetIdx = WEEKDAYS.indexOf(targetShort as (typeof WEEKDAYS)[number]);
      if (targetIdx >= 0) {
        const diff = (targetIdx - baseDate.getDay() + 7) % 7 || 7;
        const d = new Date(baseDate);
        d.setDate(d.getDate() + diff);
        dueDate = toLocalYmd(d);
        text = text.replace(dayMatch[0], '').replace(/\s{2,}/g, ' ').trim();
      }
    }
  }

  return {
    title: text || raw.trim(),
    dueDate,
    priority,
    durationMinutes,
  };
}
