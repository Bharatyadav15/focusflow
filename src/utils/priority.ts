import type { Priority } from '../types';

export const PRIORITIES: {
  value: Priority;
  label: string;
  short: string;
  badgeClass: string;
}[] = [
  {
    value: 1,
    label: 'P1 — Urgent',
    short: 'P1',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  },
  {
    value: 2,
    label: 'P2 — High',
    short: 'P2',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  {
    value: 3,
    label: 'P3 — Medium',
    short: 'P3',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  },
  {
    value: 4,
    label: 'P4 — Normal',
    short: 'P4',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
  {
    value: 5,
    label: 'P5 — Low',
    short: 'P5',
    badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-600/50',
  },
];

export function getPriorityMeta(p?: Priority) {
  return PRIORITIES.find((item) => item.value === (p ?? 3)) ?? PRIORITIES[2];
}
