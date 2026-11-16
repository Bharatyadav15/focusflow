import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListTodo,
  Play,
  Plus,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import type {
  CalendarEvent,
  PomodoroSession,
  Priority,
  Project,
  TaskItem,
  TimerState,
} from '../types';
import { getPriorityMeta, PRIORITIES } from '../utils/priority';
import { parseSmartTaskInput } from '../utils/taskParser';
import { getEffectiveDueDate, getEffectiveProjectId } from '../utils/taskTree';
import { extractYmd, formatTime, toLocalYmd } from '../utils/time';
import { DayHourlyGrid } from './planner/DayHourlyGrid';
import { WeekHourlyGrid } from './planner/WeekHourlyGrid';
import { UnscheduledSidebar } from './planner/UnscheduledSidebar';
import { TaskEventDetailModal, type DetailModalTarget } from './TaskEventDetailModal';

interface PlannerViewProps {
  tasks: TaskItem[];
  projects?: Project[];
  sessions: PomodoroSession[];
  onToggleTask?: (taskId: string) => void;
  onDeleteTask?: (task: TaskItem) => void;
  fetchEventsForRange: (
    timeMin: string,
    timeMax: string
  ) => Promise<CalendarEvent[]>;
  onStartFocus: (target: TimerState['activeTarget']) => void;
  onRescheduleTask: (task: TaskItem, dueIso: string) => void;
  onRescheduleEvent: (
    evt: CalendarEvent,
    startIso: string,
    endIso: string
  ) => void;
  onSetEventPriority: (eventId: string, priority: Priority) => void;
  onCreateEvent: (payload: {
    summary: string;
    startIso: string;
    endIso: string;
    priority: Priority;
  }) => Promise<void>;
  onCreateTask: (payload: {
    title: string;
    dueIso: string;
    priority: Priority;
    durationMinutes?: number;
  }) => Promise<void>;
  onTimeBlockTask: (task: TaskItem, targetDateKey?: string) => Promise<void>;
  onScheduleTaskAtTime?: (
    task: TaskItem,
    targetDateKey: string,
    hour: number,
    minute?: number
  ) => Promise<void>;
  onConvertEventToTask: (evt: CalendarEvent) => Promise<void>;
  onLinkTaskToEvent?: (taskId: string, eventId: string | null) => void;
  onPlanMyDay?: (dateKey: string) => Promise<void>;
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

type Mode = 'day' | 'week' | 'month';

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const diff = copy.getDay(); // Sunday = 0
  copy.setDate(copy.getDate() - diff);
  return copy;
}

export const PlannerView: React.FC<PlannerViewProps> = ({
  tasks,
  projects = [],
  sessions,
  onToggleTask,
  onDeleteTask,
  fetchEventsForRange,
  onStartFocus,
  onRescheduleTask,
  onRescheduleEvent,
  onSetEventPriority,
  onCreateEvent,
  onCreateTask,
  onTimeBlockTask,
  onScheduleTaskAtTime,
  onConvertEventToTask,
  onLinkTaskToEvent,
  onPlanMyDay,
  onUpdateTaskDetails,
  onUpdateEventDetails,
}) => {
  const [mode, setMode] = useState<Mode>('week');
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string> | null>(null);
  const [includeNoProject, setIncludeNoProject] = useState(true);
  const [includeUnscheduledInGrid, setIncludeUnscheduledInGrid] = useState(true);
  const [includeCalendarEvents, setIncludeCalendarEvents] = useState(true);
  const [detailTarget, setDetailTarget] = useState<DetailModalTarget | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() =>
    toLocalYmd(new Date())
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [rescheduleEventId, setRescheduleEventId] = useState<string | null>(
    null
  );
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('09:00');
  const [editEnd, setEditEnd] = useState('10:00');

  const [addingForDayKey, setAddingForDayKey] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<'event' | 'task'>('event');
  const [addTitle, setAddTitle] = useState('');
  const [addStart, setAddStart] = useState('10:00');
  const [addEnd, setAddEnd] = useState('11:00');
  const [addPriority, setAddPriority] = useState<Priority>(3);

  const range = useMemo(() => {
    if (mode === 'day') {
      const [y, m, d] = selectedDayKey.split('-').map(Number);
      const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
      const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
      return { start, end };
    }
    if (mode === 'week') {
      const start = startOfWeek(cursor);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(firstOfMonth);
    const lastOfMonth = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0
    );
    const end = new Date(lastOfMonth);
    end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [cursor, mode, selectedDayKey]);

  const loadRange = useCallback(async () => {
    setLoading(true);
    try {
      const evts = await fetchEventsForRange(
        range.start.toISOString(),
        range.end.toISOString()
      );
      setEvents(evts);
    } finally {
      setLoading(false);
    }
  }, [fetchEventsForRange, range.end, range.start]);

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    const cur = new Date(range.start);
    while (cur <= range.end) {
      arr.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return arr;
  }, [range]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const evt of events) {
      if (mode !== 'day') {
        const linkedTask = evt.linkedTaskId
          ? tasks.find((t) => t.id === evt.linkedTaskId)
          : undefined;
        const effProj = evt.projectId ?? (linkedTask ? getEffectiveProjectId(tasks, linkedTask) : undefined);
        if (effProj) {
          if (selectedProjectIds !== null && !selectedProjectIds.has(effProj)) {
            continue;
          }
        } else if (!includeNoProject) {
          continue;
        }
      }
      const key = toLocalYmd(new Date(evt.start));
      const list = map.get(key) ?? [];
      list.push(evt);
      map.set(key, list);
    }
    for (const [k, list] of map.entries()) {
      list.sort(
        (a, b) =>
          (a.priority ?? 3) - (b.priority ?? 3) ||
          new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      map.set(k, list);
    }
    return map;
  }, [events, includeNoProject, mode, selectedProjectIds, tasks]);

  const taskPassesFilters = useCallback(
    (t: TaskItem) => {
      if (mode !== 'day') {
        const effProj = getEffectiveProjectId(tasks, t);
        if (effProj) {
          if (selectedProjectIds !== null && !selectedProjectIds.has(effProj)) {
            return false;
          }
        } else if (!includeNoProject) {
          return false;
        }
        const isUnscheduled =
          !t.linkedEventId &&
          !t.calendarEventId &&
          !(t.scheduledStart && t.scheduledEnd);
        if (!includeUnscheduledInGrid && isUnscheduled) {
          return false;
        }
      }
      return true;
    },
    [includeNoProject, includeUnscheduledInGrid, mode, selectedProjectIds, tasks]
  );

  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      if (!taskPassesFilters(t)) continue;
      const effDue = getEffectiveDueDate(tasks, t);
      if (!effDue) continue;
      const key = extractYmd(effDue);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [taskPassesFilters, tasks]);

  const focusMinutesByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.mode !== 'focus') continue;
      const key = toLocalYmd(new Date(s.startedAt));
      map.set(key, (map.get(key) ?? 0) + s.durationMinutes);
    }
    return map;
  }, [sessions]);

  const stepPeriod = (dir: -1 | 1) => {
    if (mode === 'day') {
      const [y, m, d] = selectedDayKey.split('-').map(Number);
      const next = new Date(y, (m || 1) - 1, (d || 1) + dir);
      setSelectedDayKey(toLocalYmd(next));
      setCursor(next);
      return;
    }
    const next = new Date(cursor);
    if (mode === 'week') next.setDate(next.getDate() + dir * 7);
    else next.setMonth(next.getMonth() + dir);
    setCursor(next);
  };

  const getEventDurationMinutes = (evt: CalendarEvent) => {
    if (evt.isAllDay) return undefined;
    const diff = Math.round(
      (new Date(evt.end).getTime() - new Date(evt.start).getTime()) / 60_000
    );
    return diff > 0 ? diff : undefined;
  };

  const openRescheduleEvent = (evt: CalendarEvent) => {
    const s = new Date(evt.start);
    const e = new Date(evt.end);
    setRescheduleEventId(evt.id);
    setEditDate(toLocalYmd(s));
    setEditStart(s.toTimeString().slice(0, 5));
    setEditEnd(e.toTimeString().slice(0, 5));
  };

  const submitRescheduleEvent = (evt: CalendarEvent) => {
    if (!editDate || !editStart || !editEnd) return;
    const startIso = new Date(`${editDate}T${editStart}:00`).toISOString();
    const endIso = new Date(`${editDate}T${editEnd}:00`).toISOString();
    onRescheduleEvent(evt, startIso, endIso);
    setRescheduleEventId(null);
    setEvents((prev) =>
      prev.map((item) =>
        item.id === evt.id ? { ...item, start: startIso, end: endIso } : item
      )
    );
  };

  const handleQuickCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addingForDayKey || !addTitle.trim()) return;
    if (addKind === 'event') {
      const startIso = new Date(
        `${addingForDayKey}T${addStart}:00`
      ).toISOString();
      const endIso = new Date(`${addingForDayKey}T${addEnd}:00`).toISOString();
      await onCreateEvent({
        summary: addTitle.trim(),
        startIso,
        endIso,
        priority: addPriority,
      });
      await loadRange();
    } else {
      const parsed = parseSmartTaskInput(addTitle, addingForDayKey);
      await onCreateTask({
        title: parsed.title,
        dueIso: new Date(
          `${parsed.dueDate ?? addingForDayKey}T00:00:00.000Z`
        ).toISOString(),
        priority: parsed.priority ?? addPriority,
        durationMinutes: parsed.durationMinutes,
      });
    }
    setAddTitle('');
    setAddingForDayKey(null);
  };

  const todayKey = toLocalYmd(new Date());
  const headerTitle =
    mode === 'day'
      ? range.start.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : mode === 'week'
        ? `${range.start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${range.end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
        : cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  const selectedDayEvents = eventsByDay.get(selectedDayKey) ?? [];
  const selectedDayTasks = tasksByDay.get(selectedDayKey) ?? [];
  const unscheduledTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.completed && !t.linkedEventId && !t.calendarEventId)
        .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3)),
    [tasks]
  );

  return (
    <div className="space-y-4 flex-1 min-h-0 flex flex-col">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface-800 border border-surface-600/70 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => stepPeriod(-1)}
            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-200"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const now = new Date();
              setCursor(now);
              setSelectedDayKey(toLocalYmd(now));
            }}
            className="px-3 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-200"
          >
            Today
          </button>
          <button
            onClick={() => stepPeriod(1)}
            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-200"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="text-base font-semibold text-slate-100 ml-2">
            {headerTitle}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {onPlanMyDay && (
            <button
              onClick={async () => {
                await onPlanMyDay(selectedDayKey);
                await loadRange();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-200 hover:text-white border border-indigo-500/40 text-xs font-medium transition"
              title="Auto-schedule top priority unscheduled tasks into free calendar slots on the selected day"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Plan {selectedDayKey.slice(5)}
            </button>
          )}
          <button
            onClick={() => setShowUnscheduled((s) => !s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              showUnscheduled
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                : 'bg-surface-700 border-surface-600 text-slate-300'
            }`}
          >
            Unscheduled ({unscheduledTasks.length})
          </button>
          <button
            onClick={loadRange}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Sync
          </button>
          <div className="flex rounded-xl bg-surface-900 p-1 border border-surface-700">
            <button
              onClick={() => setMode('day')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                mode === 'day'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setMode('week')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                mode === 'week'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                mode === 'month'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Quick Create Bar when a day's + button is clicked */}
      {addingForDayKey && (
        <form
          onSubmit={handleQuickCreate}
          className="rounded-2xl bg-surface-800 border border-indigo-500/50 p-4 flex flex-wrap items-center gap-2.5"
        >
          <span className="text-xs font-semibold text-indigo-300">
            New on {addingForDayKey}:
          </span>
          <select
            value={addKind}
            onChange={(e) => setAddKind(e.target.value as 'event' | 'task')}
            className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value="event">Calendar Event</option>
            <option value="task">Google Task</option>
          </select>
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder={
              addKind === 'event' ? 'Event summary...' : 'Task title...'
            }
            className="flex-1 min-w-[180px] rounded-xl bg-surface-900 border border-surface-600 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500"
            autoFocus
          />
          {addKind === 'event' && (
            <>
              <input
                type="time"
                value={addStart}
                onChange={(e) => setAddStart(e.target.value)}
                className="rounded-xl bg-surface-900 border border-surface-600 px-2 py-1.5 text-xs text-slate-200"
              />
              <input
                type="time"
                value={addEnd}
                onChange={(e) => setAddEnd(e.target.value)}
                className="rounded-xl bg-surface-900 border border-surface-600 px-2 py-1.5 text-xs text-slate-200"
              />
            </>
          )}
          <select
            value={addPriority}
            onChange={(e) => setAddPriority(Number(e.target.value) as Priority)}
            className="rounded-xl bg-surface-900 border border-surface-600 px-2 py-1.5 text-xs text-slate-200"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAddingForDayKey(null)}
            className="px-2.5 py-1.5 rounded-xl bg-surface-700 text-slate-300 text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Project & Layer Filter Bar (Week & Month) */}
      {mode !== 'day' && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-800/80 border border-surface-700 px-4 py-2.5 text-xs">
          <span className="text-[11px] uppercase tracking-wider text-slate-400 mr-1">
            Show:
          </span>
          {projects.map((p) => {
            const active = selectedProjectIds === null || selectedProjectIds.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedProjectIds((prev) => {
                    const next =
                      prev === null ? new Set(projects.map((x) => x.id)) : new Set(prev);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  });
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition ${
                  active
                    ? 'bg-surface-900 border-surface-500 text-slate-100'
                    : 'bg-surface-900/30 border-surface-700 text-slate-500 line-through'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                {p.name}
              </button>
            );
          })}
          <button
            onClick={() => setIncludeNoProject((v) => !v)}
            className={`px-2.5 py-1 rounded-full border transition ${
              includeNoProject
                ? 'bg-surface-900 border-surface-500 text-slate-100'
                : 'bg-surface-900/30 border-surface-700 text-slate-500 line-through'
            }`}
          >
            No Project
          </button>
          <button
            onClick={() => setIncludeUnscheduledInGrid((v) => !v)}
            className={`px-2.5 py-1 rounded-full border transition ${
              includeUnscheduledInGrid
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                : 'bg-surface-900/30 border-surface-700 text-slate-500 line-through'
            }`}
          >
            Unscheduled Tasks
          </button>
          <button
            onClick={() => setIncludeCalendarEvents((v) => !v)}
            className={`px-2.5 py-1 rounded-full border transition ${
              includeCalendarEvents
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                : 'bg-surface-900/30 border-surface-700 text-slate-500 line-through'
            }`}
          >
            Calendar Events
          </button>
          {(selectedProjectIds !== null ||
            !includeNoProject ||
            !includeUnscheduledInGrid ||
            !includeCalendarEvents) && (
            <button
              onClick={() => {
                setSelectedProjectIds(null);
                setIncludeNoProject(true);
                setIncludeUnscheduledInGrid(true);
                setIncludeCalendarEvents(true);
              }}
              className="ml-auto text-[11px] text-indigo-300 hover:text-indigo-200 underline"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Morgen-style Unscheduled Tasks Sidebar */}
        {showUnscheduled && (
          <UnscheduledSidebar
            unscheduledTasks={unscheduledTasks}
            selectedDayKey={selectedDayKey}
            onTimeBlockTask={onTimeBlockTask}
            onReloadRange={loadRange}
          />
        )}

        <div className={`${showUnscheduled ? 'lg:col-span-9' : 'lg:col-span-12'} flex flex-col min-h-0`}>
      {/* DAY VIEW (Hourly Drop Slots 06:00-22:00) */}
      {mode === 'day' && (
        <DayHourlyGrid
          selectedDayKey={selectedDayKey}
          selectedDayEvents={selectedDayEvents}
          tasks={tasks}
          onStartAddForDay={(hour) => {
            if (typeof hour === 'number') {
              setAddKind('event');
              setAddStart(`${String(hour).padStart(2, '0')}:00`);
              setAddEnd(`${String(Math.min(23, hour + 1)).padStart(2, '0')}:00`);
            }
            setAddingForDayKey(selectedDayKey);
          }}
          onStartFocus={onStartFocus}
          onScheduleTaskAtTime={onScheduleTaskAtTime}
          onTimeBlockTask={onTimeBlockTask}
          onReloadRange={loadRange}
          getEventDurationMinutes={getEventDurationMinutes}
          onSelectEvent={(evt) => setDetailTarget({ kind: 'event', event: evt })}
        />
      )}

      {/* WEEK VIEW */}
      {mode === 'week' && (
        <WeekHourlyGrid
          days={days}
          todayKey={todayKey}
          selectedDayKey={selectedDayKey}
          onSelectDay={setSelectedDayKey}
          includeCalendarEvents={includeCalendarEvents}
          eventsByDay={eventsByDay}
          tasksByDay={tasksByDay}
          focusMinutesByDay={focusMinutesByDay}
          tasks={tasks}
          projectMap={projectMap}
          onStartAddForDay={(dayKey, hour) => {
            setSelectedDayKey(dayKey);
            setAddingForDayKey(dayKey);
            if (hour !== undefined) {
              setAddKind('event');
              setAddStart(`${String(hour).padStart(2, '0')}:00`);
              setAddEnd(`${String(Math.min(23, hour + 1)).padStart(2, '0')}:00`);
            }
          }}
          onSelectEvent={(evt) => setDetailTarget({ kind: 'event', event: evt })}
          onSelectTask={(task) => setDetailTarget({ kind: 'task', task })}
          onSetEventPriority={(eventId, priority) => {
            onSetEventPriority(eventId, priority);
            setEvents((prev) =>
              prev.map((x) => (x.id === eventId ? { ...x, priority } : x))
            );
          }}
          onStartFocus={onStartFocus}
          onConvertEventToTask={onConvertEventToTask}
          onRescheduleEvent={(evt, startIso, endIso) => {
            onRescheduleEvent(evt, startIso, endIso);
            setEvents((prev) =>
              prev.map((item) =>
                item.id === evt.id ? { ...item, start: startIso, end: endIso } : item
              )
            );
          }}
          onRescheduleTask={onRescheduleTask}
          onTimeBlockTask={onTimeBlockTask}
          onScheduleTaskAtTime={onScheduleTaskAtTime}
          onReloadRange={loadRange}
          getEventDurationMinutes={getEventDurationMinutes}
        />
      )}

      {/* MONTH VIEW */}
      {mode === 'month' && (
        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-7 gap-2 text-center text-xs text-slate-400 font-medium">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2 flex-1 auto-rows-fr min-h-0">
            {days.map((day) => {
              const key = toLocalYmd(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const isSelected = key === selectedDayKey;
              const dayEvents = includeCalendarEvents ? (eventsByDay.get(key) ?? []) : [];
              const dayTasks = tasksByDay.get(key) ?? [];
              const focusMins = focusMinutesByDay.get(key) ?? 0;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDayKey(key)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverKey !== key) setDragOverKey(key);
                  }}
                  onDragLeave={() => {
                    if (dragOverKey === key) setDragOverKey(null);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragOverKey(null);
                    const taskId = e.dataTransfer.getData('text/focusflow-task-id');
                    const dragged = tasks.find((tk) => tk.id === taskId);
                    if (dragged) {
                      setSelectedDayKey(key);
                      await onTimeBlockTask(dragged, key);
                      await loadRange();
                    }
                  }}
                  className={`text-left rounded-xl border p-2 min-h-[100px] flex flex-col justify-between transition ${
                    dragOverKey === key
                      ? 'bg-emerald-500/15 border-emerald-400'
                      : isSelected
                        ? 'bg-indigo-500/15 border-indigo-400'
                        : isToday
                          ? 'bg-surface-800 border-indigo-500/50'
                          : 'bg-surface-800/80 border-surface-700 hover:border-surface-500'
                  } ${!inMonth ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-xs font-bold ${
                        isToday ? 'text-indigo-300' : 'text-slate-200'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {focusMins > 0 && (
                      <span className="text-[10px] px-1.5 rounded bg-emerald-500/20 text-emerald-300">
                        {focusMins}m
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 mt-1 w-full">
                    {dayEvents.slice(0, 2).map((evt) => (
                      <div
                        key={`${evt.calendarId}-${evt.id}`}
                        className="text-[10px] px-1.5 py-0.5 rounded truncate bg-surface-900/90 text-slate-200 border-l-2"
                        style={{ borderLeftColor: evt.calendarColor || '#6366f1' }}
                      >
                        {evt.summary}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <div className="text-[10px] text-slate-400">
                        +{dayEvents.length - 2} more
                      </div>
                    )}
                    {dayTasks.length > 0 && (
                      <div className="text-[10px] text-sky-300">
                        {dayTasks.length} task{dayTasks.length > 1 ? 's' : ''} due
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Day Detail Drawer */}
          <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                Schedule for {selectedDayKey}
              </h3>
              <button
                onClick={() => setAddingForDayKey(selectedDayKey)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add Event / Task
              </button>
            </div>
            {selectedDayEvents.length === 0 && selectedDayTasks.length === 0 ? (
              <p className="text-sm text-slate-500">
                No events or due tasks on this day.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedDayEvents.map((evt) => (
                  <div
                    key={evt.id}
                    className="p-3 rounded-xl bg-surface-900/70 border border-surface-700 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-indigo-300">
                        {evt.isAllDay
                          ? 'All day'
                          : `${formatTime(evt.start)} – ${formatTime(evt.end)}`}
                      </div>
                      <div className="text-sm font-medium text-slate-100 truncate">
                        {evt.summary}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onConvertEventToTask(evt)}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
                        title="Turn this Calendar Event into a Task with its calendar duration"
                      >
                        <ListTodo className="w-3.5 h-3.5" /> To Task
                      </button>
                      <button
                        onClick={() =>
                          onStartFocus({
                            type: 'event',
                            id: evt.id,
                            title: evt.summary,
                            calendarEventId: evt.id,
                            durationMinutes: getEventDurationMinutes(evt),
                          })
                        }
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium"
                      >
                        <Play className="w-3 h-3" /> Focus
                      </button>
                    </div>
                  </div>
                ))}
                {selectedDayTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setDetailTarget({ kind: 'task', task: t })}
                    className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 hover:border-sky-400 flex items-center justify-between gap-2 cursor-pointer transition"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-sky-300">Task Due</div>
                      <div className="text-sm font-medium text-slate-100 truncate">
                        {t.title}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartFocus({
                          type: 'task',
                          id: t.id,
                          title: t.title,
                        });
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium"
                    >
                      <Play className="w-3 h-3" /> Focus
                    </button>
                    {onToggleTask && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTask(t.id);
                        }}
                        className="px-2 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium"
                      >
                        {t.completed ? 'Reopen' : 'Done'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      </div>

      <TaskEventDetailModal
        target={detailTarget}
        tasks={tasks}
        events={events}
        projects={projects}
        onClose={() => setDetailTarget(null)}
        onStartFocus={onStartFocus}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onTimeBlockTask={(task) => {
          onTimeBlockTask(task, selectedDayKey).then(() => loadRange());
        }}
        onConvertEventToTask={onConvertEventToTask}
        onLinkTaskToEvent={onLinkTaskToEvent}
        onUpdateTaskDetails={onUpdateTaskDetails}
        onUpdateEventDetails={
          onUpdateEventDetails
            ? async (evt, patch) => {
                await onUpdateEventDetails(evt, patch);
                await loadRange();
              }
            : undefined
        }
      />
    </div>
  );
};
