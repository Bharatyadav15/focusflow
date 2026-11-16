import React, { useEffect } from 'react';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FolderKanban,
  ListChecks,
  Play,
  Repeat,
  X,
} from 'lucide-react';
import type { CalendarEvent, Project, TaskItem, TimerState } from '../types';
import { getPriorityMeta } from '../utils/priority';
import {
  getChildren,
  getEffectiveCompletedPomodoros,
  getEffectiveDueDate,
  getEffectiveEstimatedPomodoros,
  getEffectiveProjectId,
  getTaskBreadcrumb,
} from '../utils/taskTree';
import { extractYmd, formatTime } from '../utils/time';

export type DetailModalTarget =
  | { kind: 'task'; task: TaskItem }
  | { kind: 'event'; event: CalendarEvent };

interface TaskEventDetailModalProps {
  target: DetailModalTarget | null;
  tasks: TaskItem[];
  projects: Project[];
  onClose: () => void;
  onStartFocus?: (target: TimerState['activeTarget']) => void;
  onToggleTask?: (taskId: string) => void;
  onTimeBlockTask?: (task: TaskItem) => void;
  onConvertEventToTask?: (evt: CalendarEvent) => void;
}

export const TaskEventDetailModal: React.FC<TaskEventDetailModalProps> = ({
  target,
  tasks,
  projects,
  onClose,
  onStartFocus,
  onToggleTask,
  onTimeBlockTask,
  onConvertEventToTask,
}) => {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, target]);

  if (!target) return null;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  if (target.kind === 'task') {
    const t = tasks.find((x) => x.id === target.task.id) ?? target.task;
    const pMeta = getPriorityMeta(t.priority);
    const effProjId = getEffectiveProjectId(tasks, t);
    const proj = effProjId ? projectMap.get(effProjId) : undefined;
    const effDue = getEffectiveDueDate(tasks, t);
    const effEst = getEffectiveEstimatedPomodoros(tasks, t.id);
    const effDone = getEffectiveCompletedPomodoros(tasks, t.id);
    const childTasks = getChildren(tasks, t.id);
    const crumb = getTaskBreadcrumb(tasks, t.id);
    const isQuickReminder = Boolean(t.durationMinutes && t.durationMinutes <= 10);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg rounded-2xl bg-surface-800 border border-surface-600 shadow-2xl p-5 space-y-4 text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {t.parentId && (
                <p className="text-[11px] text-indigo-300 truncate">{crumb}</p>
              )}
              <div className="flex items-center gap-2">
                {onToggleTask && (
                  <button
                    onClick={() => onToggleTask(t.id)}
                    className="text-slate-400 hover:text-indigo-400 flex-shrink-0"
                    title={t.completed ? 'Mark open' : 'Mark complete'}
                  >
                    {t.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Circle className="w-5 h-5" />
                    )}
                  </button>
                )}
                <h2
                  className={`text-base font-semibold ${
                    t.completed ? 'line-through text-slate-400' : 'text-slate-100'
                  }`}
                >
                  {t.title}
                </h2>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-700"
              aria-label="Close details"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`px-2 py-0.5 rounded border font-semibold ${pMeta.badgeClass}`}
            >
              {pMeta.short}
            </span>
            {proj && (
              <span
                className="px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                style={{ backgroundColor: `${proj.color}22`, color: proj.color }}
              >
                <FolderKanban className="w-3 h-3" />
                {proj.name}
              </span>
            )}
            {t.googleTaskListTitle && (
              <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300">
                {t.googleTaskListTitle}
              </span>
            )}
            {effDue && (
              <span className="px-2 py-0.5 rounded bg-surface-900 text-slate-300 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-indigo-300" />
                Due {extractYmd(effDue)}
                {!t.dueDate && ' (inherited)'}
              </span>
            )}
            {t.durationMinutes && (
              <span className="px-2 py-0.5 rounded bg-surface-900 text-slate-300 flex items-center gap-1">
                <Clock className="w-3 h-3 text-amber-300" />
                {t.durationMinutes}m{isQuickReminder ? ' · Quick reminder' : ''}
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-surface-900 text-slate-300">
              🍅 {effDone}/{effEst}
            </span>
            {t.recurrence && t.recurrence !== 'none' && (
              <span className="px-2 py-0.5 rounded bg-violet-500/15 text-violet-300 flex items-center gap-1">
                <Repeat className="w-3 h-3" />
                {t.recurrence}
              </span>
            )}
          </div>

          {t.scheduledStart && t.scheduledEnd && (
            <div className="text-xs px-3 py-2 rounded-xl bg-surface-900/80 border border-surface-700 text-sky-300 flex items-center gap-2">
              <CalendarClock className="w-3.5 h-3.5" />
              Scheduled: {extractYmd(t.scheduledStart)} · {formatTime(t.scheduledStart)}–
              {formatTime(t.scheduledEnd)}
            </div>
          )}

          {t.notes && (
            <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-3 text-xs text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {t.notes}
            </div>
          )}

          {t.noteLink && (
            <div className="text-xs text-indigo-300 flex items-center gap-1.5 truncate">
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t.noteLink}</span>
            </div>
          )}

          {childTasks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Child Tasks ({childTasks.filter((c) => !c.completed).length}/{childTasks.length} open)
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {childTasks.map((c) => (
                  <div
                    key={c.id}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-900/60 border border-surface-700/70 flex items-center justify-between gap-2"
                  >
                    <span className={c.completed ? 'line-through text-slate-500' : 'text-slate-200'}>
                      {c.title}
                    </span>
                    {c.dueDate && (
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {extractYmd(c.dueDate)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {t.subtasks && t.subtasks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <ListChecks className="w-3.5 h-3.5" />
                Checklist ({t.subtasks.filter((s) => s.done).length}/{t.subtasks.length})
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {t.subtasks.map((s) => (
                  <div key={s.id} className="text-xs text-slate-300 flex items-center gap-2">
                    <span className={s.done ? 'text-emerald-400' : 'text-slate-500'}>
                      {s.done ? '✓' : '○'}
                    </span>
                    <span className={s.done ? 'line-through text-slate-500' : ''}>{s.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700">
            {onTimeBlockTask && !t.completed && !t.linkedEventId && !t.calendarEventId && (
              <button
                onClick={() => {
                  onTimeBlockTask(t);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-200"
              >
                <CalendarClock className="w-3.5 h-3.5" /> Time-Block
              </button>
            )}
            {onStartFocus && !t.completed && (
              <button
                onClick={() => {
                  onStartFocus({
                    type: 'task',
                    id: t.id,
                    title: t.title,
                    projectId: effProjId,
                    calendarEventId: t.linkedEventId,
                    durationMinutes: t.durationMinutes,
                  });
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white"
              >
                <Play className="w-3.5 h-3.5" /> Start Focus
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const evt = target.event;
  const proj = evt.projectId ? projectMap.get(evt.projectId) : undefined;
  const linkedTask = evt.linkedTaskId
    ? tasks.find((t) => t.id === evt.linkedTaskId)
    : undefined;
  const durMins = evt.isAllDay
    ? undefined
    : Math.max(
        0,
        Math.round(
          (new Date(evt.end).getTime() - new Date(evt.start).getTime()) / 60_000
        )
      );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface-800 border border-surface-600 shadow-2xl p-5 space-y-4 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {evt.calendarName && (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {evt.calendarColor && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: evt.calendarColor }}
                  />
                )}
                <span>{evt.calendarName}</span>
              </div>
            )}
            <h2 className="text-base font-semibold text-slate-100">{evt.summary}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-700"
            aria-label="Close details"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-surface-900 text-indigo-300 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {evt.isAllDay
              ? `All day · ${extractYmd(evt.start)}`
              : `${extractYmd(evt.start)} · ${formatTime(evt.start)}–${formatTime(evt.end)}${durMins ? ` (${durMins}m)` : ''}`}
          </span>
          {proj && (
            <span
              className="px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${proj.color}22`, color: proj.color }}
            >
              {proj.name}
            </span>
          )}
          {linkedTask && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
              Linked task: {linkedTask.title}
            </span>
          )}
        </div>

        {evt.description && (
          <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-3 text-xs text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {evt.description}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-700">
          {onConvertEventToTask && !linkedTask && (
            <button
              onClick={() => {
                onConvertEventToTask(evt);
                onClose();
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-white text-xs font-medium transition"
            >
              To Task
            </button>
          )}
          {onStartFocus && (
            <button
              onClick={() => {
                onStartFocus({
                  type: 'event',
                  id: evt.id,
                  title: evt.summary,
                  calendarEventId: evt.id,
                  projectId: evt.projectId,
                  durationMinutes: durMins && durMins > 0 ? durMins : undefined,
                });
                onClose();
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white"
            >
              <Play className="w-3.5 h-3.5" /> Start Focus
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
