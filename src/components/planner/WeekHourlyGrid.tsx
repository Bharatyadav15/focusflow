import React, { useEffect, useRef, useState } from 'react';
import { ListTodo, Play, Plus } from 'lucide-react';
import type { CalendarEvent, Priority, Project, TaskItem, TimerState } from '../../types';
import { getPriorityMeta, PRIORITIES } from '../../utils/priority';
import { getEffectiveProjectId } from '../../utils/taskTree';
import { extractYmd, formatTime, toLocalYmd } from '../../utils/time';

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

interface DragItem {
  kind: 'event' | 'task';
  id: string;
  label: string;
}

interface DropTarget {
  dayKey: string;
  hour: number | null;
}

interface WeekHourlyGridProps {
  days: Date[];
  todayKey: string;
  selectedDayKey: string;
  onSelectDay: (key: string) => void;
  includeCalendarEvents: boolean;
  eventsByDay: Map<string, CalendarEvent[]>;
  tasksByDay: Map<string, TaskItem[]>;
  focusMinutesByDay: Map<string, number>;
  tasks: TaskItem[];
  projectMap: Map<string, Project>;
  onStartAddForDay: (dayKey: string, hour?: number) => void;
  onSelectEvent: (evt: CalendarEvent) => void;
  onSelectTask: (task: TaskItem) => void;
  onSetEventPriority: (eventId: string, priority: Priority) => void;
  onStartFocus: (target: TimerState['activeTarget']) => void;
  onConvertEventToTask: (evt: CalendarEvent) => Promise<void>;
  onRescheduleEvent: (evt: CalendarEvent, startIso: string, endIso: string) => void;
  onRescheduleTask: (task: TaskItem, dueIso: string) => void;
  onTimeBlockTask: (task: TaskItem, targetDateKey: string) => Promise<void>;
  onScheduleTaskAtTime?: (
    task: TaskItem,
    targetDateKey: string,
    hour: number,
    minute?: number
  ) => Promise<void>;
  onReloadRange: () => Promise<void>;
  getEventDurationMinutes: (evt: CalendarEvent) => number | undefined;
}

export const WeekHourlyGrid: React.FC<WeekHourlyGridProps> = ({
  days,
  todayKey,
  selectedDayKey,
  onSelectDay,
  includeCalendarEvents,
  eventsByDay,
  tasksByDay,
  focusMinutesByDay,
  tasks,
  projectMap,
  onStartAddForDay,
  onSelectEvent,
  onSelectTask,
  onSetEventPriority,
  onStartFocus,
  onConvertEventToTask,
  onRescheduleEvent,
  onRescheduleTask,
  onTimeBlockTask,
  onScheduleTaskAtTime,
  onReloadRange,
  getEventDurationMinutes,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, []);

  const findDropTargetAtPoint = (x: number, y: number): DropTarget | null => {
    const els = document.elementsFromPoint(x, y);
    let dayKey: string | null = null;
    let hour: number | null = null;
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      if (hour === null && el.dataset.weekHour !== undefined) {
        const parsed = Number(el.dataset.weekHour);
        if (!Number.isNaN(parsed)) hour = parsed;
      }
      if (dayKey === null && el.dataset.weekDayKey) {
        dayKey = el.dataset.weekDayKey;
      }
      if (dayKey !== null && hour !== null) break;
    }
    return dayKey ? { dayKey, hour } : null;
  };

  const handlePointerDrop = async (item: DragItem, target: DropTarget) => {
    const { dayKey, hour } = target;
    onSelectDay(dayKey);

    if (item.kind === 'event') {
      let found: CalendarEvent | undefined;
      for (const list of eventsByDay.values()) {
        found = list.find((e) => e.id === item.id);
        if (found) break;
      }
      if (!found) return;
      const origStart = new Date(found.start);
      const origEnd = new Date(found.end);
      const durMs = Math.max(15 * 60_000, origEnd.getTime() - origStart.getTime());
      const [y, m, d] = dayKey.split('-').map(Number);
      const targetHour =
        hour !== null ? hour : found.isAllDay ? 9 : origStart.getHours();
      const targetMin = hour !== null ? 0 : found.isAllDay ? 0 : origStart.getMinutes();
      const nextStart = new Date(y, (m || 1) - 1, d || 1, targetHour, targetMin, 0, 0);
      const nextEnd = new Date(nextStart.getTime() + durMs);
      onRescheduleEvent(found, nextStart.toISOString(), nextEnd.toISOString());
      return;
    }

    const tk = tasks.find((t) => t.id === item.id);
    if (!tk) return;
    if (hour !== null && onScheduleTaskAtTime) {
      await onScheduleTaskAtTime(tk, dayKey, hour, 0);
      await onReloadRange();
      return;
    }
    if (extractYmd(tk.dueDate) !== dayKey) {
      const [y, m, d] = dayKey.split('-').map(Number);
      const dueIso = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0).toISOString();
      onRescheduleTask(tk, dueIso);
    }
  };

  const startPointerDrag = (
    e: React.PointerEvent,
    item: DragItem
  ) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, select, input, option, a')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active && Math.hypot(dx, dy) > 6) {
        active = true;
        suppressClickRef.current = true;
        setDragItem(item);
      }
      if (active) {
        setDragPos({ x: ev.clientX, y: ev.clientY });
        setDropTarget(findDropTargetAtPoint(ev.clientX, ev.clientY));
      }
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (active) {
        const hit = findDropTargetAtPoint(ev.clientX, ev.clientY);
        setDragItem(null);
        setDragPos(null);
        setDropTarget(null);
        if (hit) {
          void handlePointerDrop(item, hit);
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="rounded-2xl bg-surface-800 border border-surface-600/70 flex flex-col flex-1 min-h-[540px] overflow-hidden select-none">
      {/* Sticky Day Headers + All-Day / Due Tasks Strip */}
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-surface-700 bg-surface-900/50">
        <div className="p-2 border-r border-surface-700/80 text-[10px] text-slate-500 flex items-end justify-center pb-2">
          HRS
        </div>
        {days.map((day) => {
          const key = toLocalYmd(day);
          const isToday = key === todayKey;
          const isSelected = key === selectedDayKey;
          const dayEvents = includeCalendarEvents ? (eventsByDay.get(key) ?? []) : [];
          const allDayEvents = dayEvents.filter((e) => e.isAllDay);
          const dayTasks = tasksByDay.get(key) ?? [];
          const isDayOver = dropTarget?.dayKey === key && dropTarget?.hour === null;

          return (
            <div
              key={key}
              data-week-day-key={key}
              onClick={() => onSelectDay(key)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget({ dayKey: key, hour: null });
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDropTarget(null);
                const taskId = e.dataTransfer.getData('text/focusflow-task-id');
                const dragged = tasks.find((tk) => tk.id === taskId);
                if (dragged) {
                  onSelectDay(key);
                  await onTimeBlockTask(dragged, key);
                  await onReloadRange();
                }
              }}
              className={`p-2 border-r last:border-r-0 border-surface-700/80 space-y-1.5 transition cursor-pointer ${
                isDayOver
                  ? 'bg-emerald-500/15'
                  : isSelected
                    ? 'bg-indigo-500/10'
                    : isToday
                      ? 'bg-indigo-500/5'
                      : ''
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">
                    {day.toLocaleDateString([], { weekday: 'short' })}
                  </div>
                  <div
                    className={`text-sm font-bold ${
                      isToday ? 'text-indigo-300' : 'text-slate-100'
                    }`}
                  >
                    {day.getDate()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(focusMinutesByDay.get(key) ?? 0) > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                      {focusMinutesByDay.get(key)}m
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartAddForDay(key);
                    }}
                    className="p-1 rounded-lg bg-surface-700 hover:bg-indigo-500 text-slate-300 hover:text-white transition"
                    title="Add event or task on this day"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {(allDayEvents.length > 0 || dayTasks.length > 0) && (
                <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                  {allDayEvents.map((evt) => (
                    <div
                      key={evt.id}
                      onPointerDown={(e) =>
                        startPointerDrag(e, {
                          kind: 'event',
                          id: evt.id,
                          label: evt.summary,
                        })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!suppressClickRef.current) onSelectEvent(evt);
                      }}
                      className="px-2 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/35 text-[11px] text-indigo-200 truncate cursor-grab active:cursor-grabbing"
                      title={`${evt.summary} (drag to reschedule)`}
                    >
                      All day · {evt.summary}
                    </div>
                  ))}
                  {dayTasks.map((t) => {
                    const effProj = getEffectiveProjectId(tasks, t);
                    const tProj = effProj ? projectMap.get(effProj) : undefined;
                    return (
                      <div
                        key={t.id}
                        onPointerDown={(e) =>
                          startPointerDrag(e, {
                            kind: 'task',
                            id: t.id,
                            label: t.title,
                          })
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!suppressClickRef.current) onSelectTask(t);
                        }}
                        className="px-2 py-1 rounded-lg bg-sky-500/15 border border-sky-500/35 hover:border-sky-400 text-[11px] text-slate-100 cursor-grab active:cursor-grabbing space-y-0.5"
                        title={`${t.title} (drag to move day or drop onto an hour slot)`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-medium">
                            {t.durationMinutes && t.durationMinutes <= 10 ? '⏰ ' : ''}
                            {t.title}
                          </span>
                          <span
                            className={`text-[9px] px-1 rounded border shrink-0 ${getPriorityMeta(t.priority).badgeClass}`}
                          >
                            {getPriorityMeta(t.priority).short}
                          </span>
                        </div>
                        {tProj && (
                          <span
                            className="inline-block text-[9px] px-1.5 rounded-full truncate max-w-full"
                            style={{ backgroundColor: `${tProj.color}22`, color: tProj.color }}
                          >
                            {tProj.name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable 24-Hour Vertical Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        <div
          className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] relative"
          style={{ height: HOURS.length * HOUR_HEIGHT }}
        >
          {/* Left Hour Gutter */}
          <div className="border-r border-surface-700/80 bg-surface-900/30">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="border-b border-surface-700/50 pr-2 pt-1 text-right text-[10px] font-medium text-slate-500"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* 7 Day Columns */}
          {days.map((day) => {
            const key = toLocalYmd(day);
            const dayEvents = includeCalendarEvents
              ? (eventsByDay.get(key) ?? []).filter((e) => !e.isAllDay)
              : [];

            return (
              <div
                key={key}
                data-week-day-key={key}
                className="relative border-r last:border-r-0 border-surface-700/80"
              >
                {HOURS.map((hour) => {
                  const isOver =
                    dropTarget?.dayKey === key && dropTarget?.hour === hour;
                  return (
                    <div
                      key={hour}
                      data-week-day-key={key}
                      data-week-hour={hour}
                      style={{ height: HOUR_HEIGHT }}
                      onClick={() => onStartAddForDay(key, hour)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropTarget({ dayKey: key, hour });
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDropTarget(null);
                        const taskId = e.dataTransfer.getData('text/focusflow-task-id');
                        const dragged = tasks.find((tk) => tk.id === taskId);
                        if (dragged) {
                          onSelectDay(key);
                          if (onScheduleTaskAtTime) {
                            await onScheduleTaskAtTime(dragged, key, hour, 0);
                          } else {
                            await onTimeBlockTask(dragged, key);
                          }
                          await onReloadRange();
                        }
                      }}
                      className={`border-b border-surface-700/40 transition cursor-pointer ${
                        isOver
                          ? 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-400/70'
                          : 'hover:bg-surface-700/25'
                      }`}
                    />
                  );
                })}

                {/* Positioned Timed Events */}
                {dayEvents.map((evt) => {
                  const st = new Date(evt.start);
                  const en = new Date(evt.end);
                  const startMins = st.getHours() * 60 + st.getMinutes();
                  const durMins = Math.max(
                    25,
                    Math.round((en.getTime() - st.getTime()) / 60_000) || 45
                  );
                  const top = (startMins / 60) * HOUR_HEIGHT;
                  const height = Math.max(28, (durMins / 60) * HOUR_HEIGHT - 2);
                  const pMeta = getPriorityMeta(evt.priority);
                  const eProj = evt.projectId ? projectMap.get(evt.projectId) : undefined;
                  const eGrp =
                    eProj && evt.projectListId
                      ? eProj.lists?.find((l) => l.id === evt.projectListId)
                      : undefined;

                  return (
                    <div
                      key={`${evt.calendarId}-${evt.id}`}
                      style={{ top, height }}
                      onPointerDown={(e) =>
                        startPointerDrag(e, {
                          kind: 'event',
                          id: evt.id,
                          label: evt.summary,
                        })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!suppressClickRef.current) onSelectEvent(evt);
                      }}
                      className="absolute left-1 right-1 z-10 rounded-lg bg-surface-900/95 border border-indigo-500/40 hover:border-indigo-400 px-2 py-1 overflow-hidden flex flex-col justify-between cursor-grab active:cursor-grabbing shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-indigo-300 font-medium truncate">
                          {formatTime(evt.start)}
                        </span>
                        <select
                          value={evt.priority ?? 3}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            onSetEventPriority(evt.id, Number(e.target.value) as Priority);
                          }}
                          className={`text-[9px] px-1 py-0 rounded border bg-transparent ${pMeta.badgeClass}`}
                        >
                          {PRIORITIES.map((p) => (
                            <option
                              key={p.value}
                              value={p.value}
                              className="bg-surface-900 text-slate-100"
                            >
                              {p.short}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-[11px] font-medium text-slate-100 truncate">
                        {evt.summary}
                      </p>
                      {height >= 54 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {eProj && (
                            <span
                              className="text-[9px] px-1.5 rounded-full truncate max-w-full"
                              style={{ backgroundColor: `${eProj.color}22`, color: eProj.color }}
                            >
                              {eProj.name}
                              {eGrp ? ` · ${eGrp.title}` : ''}
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartFocus({
                                type: 'event',
                                id: evt.id,
                                title: evt.summary,
                                calendarEventId: evt.id,
                                projectId: evt.projectId,
                                durationMinutes: getEventDurationMinutes(evt),
                              });
                            }}
                            className="px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[9px] flex items-center gap-0.5"
                          >
                            <Play className="w-2.5 h-2.5" /> Focus
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onConvertEventToTask(evt);
                            }}
                            className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-[9px] flex items-center gap-0.5"
                            title="Convert to Task"
                          >
                            <ListTodo className="w-2.5 h-2.5" /> To Task
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Drag Ghost */}
      {dragItem && dragPos && (
        <div
          className="fixed z-50 pointer-events-none px-2.5 py-1.5 rounded-lg bg-indigo-600/95 text-white text-xs font-medium shadow-xl border border-indigo-300/40 max-w-[220px] truncate"
          style={{ left: dragPos.x + 12, top: dragPos.y + 12 }}
        >
          {dragItem.label}
          {dropTarget && (
            <span className="ml-1.5 text-[10px] text-indigo-200">
              → {dropTarget.dayKey.slice(5)}
              {dropTarget.hour !== null ? ` ${formatHourLabel(dropTarget.hour)}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
