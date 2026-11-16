import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  FolderKanban,
  Link2,
  ListChecks,
  Pencil,
  Play,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import type { CalendarEvent, Priority, Project, TaskItem, TimerState } from '../types';
import { getPriorityMeta, PRIORITIES } from '../utils/priority';
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
  events?: CalendarEvent[];
  projects: Project[];
  onClose: () => void;
  onStartFocus?: (target: TimerState['activeTarget']) => void;
  onToggleTask?: (taskId: string) => void;
  onDeleteTask?: (task: TaskItem) => void;
  onDeleteEvent?: (evt: CalendarEvent) => void;
  onTimeBlockTask?: (task: TaskItem) => void;
  onConvertEventToTask?: (evt: CalendarEvent) => void;
  onLinkTaskToEvent?: (taskId: string, eventId: string | null) => void;
  onUpdateTaskDetails?: (
    taskId: string,
    patch: {
      title?: string;
      notes?: string;
      priority?: Priority;
      projectId?: string;
      projectListId?: string;
      dueDate?: string;
    }
  ) => Promise<void> | void;
  onUpdateEventDetails?: (
    evt: CalendarEvent,
    patch: {
      summary?: string;
      description?: string;
      priority?: Priority;
      projectId?: string;
      projectListId?: string;
    }
  ) => Promise<void> | void;
}

export const TaskEventDetailModal: React.FC<TaskEventDetailModalProps> = ({
  target,
  tasks,
  events = [],
  projects,
  onClose,
  onStartFocus,
  onToggleTask,
  onDeleteTask,
  onDeleteEvent,
  onTimeBlockTask,
  onConvertEventToTask,
  onLinkTaskToEvent,
  onUpdateTaskDetails,
  onUpdateEventDetails,
}) => {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftPriority, setDraftPriority] = useState<Priority>(3);
  const [draftProjectId, setDraftProjectId] = useState('');
  const [draftGroupId, setDraftGroupId] = useState('');
  const [draftDueDate, setDraftDueDate] = useState('');

  useEffect(() => {
    setEditing(false);
    if (!target) return;
    if (target.kind === 'task') {
      const t = tasks.find((x) => x.id === target.task.id) ?? target.task;
      setDraftTitle(t.title);
      setDraftNotes(t.notes ?? '');
      setDraftPriority(t.priority ?? 3);
      setDraftProjectId(t.projectId ?? '');
      setDraftGroupId(t.projectListId ?? '');
      setDraftDueDate(t.dueDate ? extractYmd(t.dueDate) : '');
    } else {
      const ev = target.event;
      setDraftTitle(ev.summary);
      setDraftNotes(ev.description ?? '');
      setDraftPriority(ev.priority ?? 3);
      setDraftProjectId(ev.projectId ?? '');
      setDraftGroupId(ev.projectListId ?? '');
      setDraftDueDate('');
    }
  }, [target, tasks]);

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
    const groupObj = proj && t.projectListId
      ? proj.lists?.find((l) => l.id === t.projectListId)
      : undefined;
    const draftProj = draftProjectId ? projectMap.get(draftProjectId) : undefined;
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
            <div className="flex items-center gap-1">
              {onUpdateTaskDetails && (
                <button
                  onClick={() => setEditing((v) => !v)}
                  className={`p-1.5 rounded-lg transition ${
                    editing
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
                  }`}
                  title="Edit task"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-700"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {editing && onUpdateTaskDetails && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draftTitle.trim()) return;
                await onUpdateTaskDetails(t.id, {
                  title: draftTitle.trim(),
                  notes: draftNotes.trim(),
                  priority: draftPriority,
                  projectId: draftProjectId || undefined,
                  projectListId: draftProjectId ? draftGroupId || undefined : undefined,
                  dueDate: draftDueDate || undefined,
                });
                setEditing(false);
              }}
              className="rounded-xl bg-surface-900/80 border border-indigo-500/40 p-3 space-y-2.5 text-xs"
            >
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Task title"
                className="w-full rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-slate-100"
              />
              <textarea
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="Task notes..."
                rows={2}
                className="w-full rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-slate-100"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={draftPriority}
                  onChange={(e) => setDraftPriority(Number(e.target.value) as Priority)}
                  className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={draftDueDate}
                  onChange={(e) => setDraftDueDate(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100"
                />
                <select
                  value={draftProjectId}
                  onChange={(e) => {
                    setDraftProjectId(e.target.value);
                    setDraftGroupId('');
                  }}
                  className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={draftGroupId}
                  onChange={(e) => setDraftGroupId(e.target.value)}
                  disabled={!draftProj || (draftProj.lists ?? []).length === 0}
                  className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100 disabled:opacity-50"
                >
                  <option value="">No group</option>
                  {(draftProj?.lists ?? []).map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-2.5 py-1 rounded bg-surface-700 text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-indigo-500 text-white font-medium"
                >
                  Save
                </button>
              </div>
            </form>
          )}

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
                {groupObj ? ` · ${groupObj.title}` : ''}
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

          {onLinkTaskToEvent && events.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <select
                value={t.linkedEventId ?? ''}
                onChange={(e) => onLinkTaskToEvent(t.id, e.target.value || null)}
                className="flex-1 rounded-lg bg-surface-900 border border-surface-600 px-2.5 py-1 text-xs text-slate-100"
                title="Link this task to a calendar event"
              >
                <option value="">Link to calendar event...</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.isAllDay ? extractYmd(ev.start) : `${extractYmd(ev.start)} ${formatTime(ev.start)}`} · {ev.summary}
                  </option>
                ))}
              </select>
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

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-700">
            <div className="flex items-center gap-2">
              {onDeleteTask && (
                <button
                  onClick={() => {
                    onDeleteTask(t);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-medium text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {onToggleTask && (
                <button
                  onClick={() => {
                    onToggleTask(t.id);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium text-emerald-300"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t.completed ? 'Reopen' : 'Mark Complete'}
                </button>
              )}
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
      </div>
    );
  }

  const evt = target.event;
  const proj = evt.projectId ? projectMap.get(evt.projectId) : undefined;
  const evtGroup = proj && evt.projectListId
    ? proj.lists?.find((l) => l.id === evt.projectListId)
    : undefined;
  const draftEvtProj = draftProjectId ? projectMap.get(draftProjectId) : undefined;
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
          <div className="flex items-center gap-1">
            {onUpdateEventDetails && (
              <button
                onClick={() => setEditing((v) => !v)}
                className={`p-1.5 rounded-lg transition ${
                  editing
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-surface-700'
                }`}
                title="Edit event"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-700"
              aria-label="Close details"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {editing && onUpdateEventDetails && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draftTitle.trim()) return;
              await onUpdateEventDetails(evt, {
                summary: draftTitle.trim(),
                description: draftNotes.trim(),
                priority: draftPriority,
                projectId: draftProjectId || undefined,
                projectListId: draftProjectId ? draftGroupId || undefined : undefined,
              });
              setEditing(false);
            }}
            className="rounded-xl bg-surface-900/80 border border-indigo-500/40 p-3 space-y-2.5 text-xs"
          >
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Event summary"
              className="w-full rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-slate-100"
            />
            <textarea
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder="Event description / notes..."
              rows={2}
              className="w-full rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-slate-100"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={draftPriority}
                onChange={(e) => setDraftPriority(Number(e.target.value) as Priority)}
                className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <select
                value={draftProjectId}
                onChange={(e) => {
                  setDraftProjectId(e.target.value);
                  setDraftGroupId('');
                }}
                className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={draftGroupId}
                onChange={(e) => setDraftGroupId(e.target.value)}
                disabled={!draftEvtProj || (draftEvtProj.lists ?? []).length === 0}
                className="rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-slate-100 disabled:opacity-50"
              >
                <option value="">No group</option>
                {(draftEvtProj?.lists ?? []).map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-2.5 py-1 rounded bg-surface-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 rounded bg-indigo-500 text-white font-medium"
              >
                Save
              </button>
            </div>
          </form>
        )}

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
              {evtGroup ? ` · ${evtGroup.title}` : ''}
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

        {onLinkTaskToEvent && tasks.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select
              value={linkedTask?.id ?? ''}
              onChange={(e) => {
                if (linkedTask && !e.target.value) {
                  onLinkTaskToEvent(linkedTask.id, null);
                } else if (e.target.value) {
                  onLinkTaskToEvent(e.target.value, evt.id);
                }
              }}
              className="flex-1 rounded-lg bg-surface-900 border border-surface-600 px-2.5 py-1 text-xs text-slate-100"
              title="Link this calendar event to a task"
            >
              <option value="">
                {linkedTask ? 'Unlink task' : 'Link to task...'}
              </option>
              {tasks
                .filter((tk) => !tk.completed || tk.id === linkedTask?.id)
                .map((tk) => (
                  <option key={tk.id} value={tk.id}>
                    {tk.title}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-700">
          <div>
            {onDeleteEvent && (
              <button
                onClick={() => {
                  onDeleteEvent(evt);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-xs font-medium text-rose-300"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
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
    </div>
  );
};
