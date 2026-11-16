import React, { useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  CalendarClock,
  Clock,
  Link2,
  ListTodo,
  Play,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  CalendarEvent,
  EventMetadata,
  Priority,
  Project,
  TaskItem,
  TimerState,
} from '../../types';
import { getPriorityMeta, PRIORITIES } from '../../utils/priority';
import { extractYmd, formatTime } from '../../utils/time';

interface DaySchedulePanelProps {
  sortedEvents: CalendarEvent[];
  tasks?: TaskItem[];
  taskMap: Map<string, TaskItem>;
  projectMap?: Map<string, Project>;
  timer: TimerState;
  loadingEvents: boolean;
  sortEventsByPriority: boolean;
  onToggleSortEventsByPriority: () => void;
  onPlanMyDay?: () => void;
  onRefreshEvents: () => void;
  onSetEventMetadata: (eventId: string, meta: EventMetadata) => void;
  onConvertEventToTask: (evt: CalendarEvent) => void;
  onLinkTaskToEvent?: (taskId: string, eventId: string | null) => void;
  onRescheduleEvent: (
    evt: CalendarEvent,
    startIso: string,
    endIso: string
  ) => void;
  onStartFocus: (
    target: TimerState['activeTarget'],
    asStopwatch?: boolean
  ) => void;
  onDeleteEvent: (evt: CalendarEvent) => void;
  getEventDurationMinutes: (evt?: CalendarEvent) => number | undefined;
  onSelectEvent?: (evt: CalendarEvent) => void;
}

export const DaySchedulePanel: React.FC<DaySchedulePanelProps> = ({
  sortedEvents,
  tasks = [],
  taskMap,
  projectMap,
  timer,
  loadingEvents,
  sortEventsByPriority,
  onToggleSortEventsByPriority,
  onPlanMyDay,
  onRefreshEvents,
  onSetEventMetadata,
  onConvertEventToTask,
  onLinkTaskToEvent,
  onRescheduleEvent,
  onStartFocus,
  onDeleteEvent,
  getEventDurationMinutes,
  onSelectEvent,
}) => {
  const [rescheduleEventId, setRescheduleEventId] = useState<string | null>(
    null
  );
  const [linkingEventId, setLinkingEventId] = useState<string | null>(null);
  const [evtDate, setEvtDate] = useState('');
  const [evtStart, setEvtStart] = useState('09:00');
  const [evtEnd, setEvtEnd] = useState('10:00');

  return (
    <div className="lg:col-span-5 flex flex-col min-h-0">
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              Today&apos;s Google Calendar
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {onPlanMyDay && (
              <button
                onClick={onPlanMyDay}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-200 hover:text-white border border-indigo-500/40 transition"
                title="Auto-schedule top priority tasks into today's free slots"
              >
                <Wand2 className="w-3 h-3" />
                Plan Day
              </button>
            )}
            <button
              onClick={onToggleSortEventsByPriority}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
                sortEventsByPriority
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                  : 'border-surface-600 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ArrowUpDown className="w-3 h-3" />
              {sortEventsByPriority ? 'P1→P5' : 'Time'}
            </button>
            <button
              onClick={onRefreshEvents}
              disabled={loadingEvents}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-300 transition"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingEvents ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="space-y-3 flex-1 min-h-[320px] overflow-y-auto pr-1">
          {sortedEvents.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">
              No events scheduled for today. Time-block a task from the left!
            </p>
          )}

          {sortedEvents.map((evt) => {
            const linkedTask = evt.linkedTaskId
              ? taskMap.get(evt.linkedTaskId)
              : undefined;
            const proj = evt.projectId ? projectMap?.get(evt.projectId) : undefined;
            const grp = proj && evt.projectListId
              ? proj.lists?.find((l) => l.id === evt.projectListId)
              : undefined;
            const pMeta = getPriorityMeta(evt.priority);
            const isActive =
              (timer.activeTarget?.type === 'event' &&
                timer.activeTarget.id === evt.id) ||
              (linkedTask &&
                timer.activeTarget?.type === 'task' &&
                timer.activeTarget.id === linkedTask.id);

            return (
              <div
                key={`${evt.calendarId}-${evt.id}`}
                className={`p-3.5 rounded-xl border transition ${
                  isActive
                    ? 'bg-indigo-500/10 border-indigo-500/50'
                    : 'bg-surface-900/70 border-surface-700/80 hover:border-surface-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-indigo-300 font-medium">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {evt.isAllDay
                          ? 'All day'
                          : `${formatTime(evt.start)} – ${formatTime(evt.end)}`}
                      </span>
                      <select
                        value={evt.priority ?? 3}
                        onChange={(e) =>
                          onSetEventMetadata(evt.id, {
                            priority: Number(e.target.value) as Priority,
                          })
                        }
                        className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-semibold ${pMeta.badgeClass}`}
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
                      {evt.calendarName && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: evt.calendarColor || '#6366f1',
                            }}
                          />
                          {evt.calendarName}
                        </span>
                      )}
                      {proj && (
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: `${proj.color}22`,
                            color: proj.color,
                          }}
                        >
                          {proj.name}
                          {grp ? ` · ${grp.title}` : ''}
                        </span>
                      )}
                    </div>
                    <h4
                      onClick={() => onSelectEvent?.(evt)}
                      className={`text-sm font-semibold text-slate-100 mt-1 truncate ${
                        onSelectEvent ? 'cursor-pointer hover:text-indigo-300' : ''
                      }`}
                    >
                      {evt.summary}
                    </h4>
                    {linkedTask && (
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-300">
                        <Link2 className="w-3 h-3" />
                        Linked Task: {linkedTask.title}
                        {linkedTask.completed ? ' (Done)' : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onConvertEventToTask(evt)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition"
                      title="Turn this Calendar Event into a Task with its calendar duration"
                    >
                      <ListTodo className="w-3.5 h-3.5" />
                      To Task
                    </button>
                    {onLinkTaskToEvent && tasks.length > 0 && (
                      <button
                        onClick={() =>
                          setLinkingEventId(linkingEventId === evt.id ? null : evt.id)
                        }
                        className={`p-1.5 rounded-lg border transition ${
                          linkedTask
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-surface-700 hover:bg-surface-600 border-transparent text-slate-300'
                        }`}
                        title={linkedTask ? 'Change or unlink linked task' : 'Link to existing task'}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (rescheduleEventId === evt.id) {
                          setRescheduleEventId(null);
                        } else {
                          const s = new Date(evt.start);
                          const e = new Date(evt.end);
                          setRescheduleEventId(evt.id);
                          setEvtDate(extractYmd(evt.start));
                          setEvtStart(s.toTimeString().slice(0, 5));
                          setEvtEnd(e.toTimeString().slice(0, 5));
                        }
                      }}
                      className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300"
                      title="Reschedule Calendar Event"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        onStartFocus(
                          {
                            type: 'event',
                            id: evt.id,
                            title: evt.summary,
                            calendarEventId: evt.id,
                            projectId: evt.projectId,
                            linkedTaskId: linkedTask?.id,
                            durationMinutes: getEventDurationMinutes(evt),
                          },
                          timer.mode === 'stopwatch'
                        )
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
                      title="Start timer for this event"
                    >
                      <Play className="w-3 h-3" />{' '}
                      {timer.mode === 'stopwatch' ? 'Stopwatch' : 'Focus'}
                    </button>
                    <button
                      onClick={() => onDeleteEvent(evt)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 transition"
                      title="Delete Calendar Event"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {rescheduleEventId === evt.id && (
                  <div className="mt-2.5 pt-2.5 border-t border-surface-700 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={evtDate}
                      onChange={(e) => setEvtDate(e.target.value)}
                      className="rounded bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-100"
                    />
                    <input
                      type="time"
                      value={evtStart}
                      onChange={(e) => setEvtStart(e.target.value)}
                      className="rounded bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-100"
                    />
                    <input
                      type="time"
                      value={evtEnd}
                      onChange={(e) => setEvtEnd(e.target.value)}
                      className="rounded bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-100"
                    />
                    <button
                      onClick={() => {
                        if (!evtDate || !evtStart || !evtEnd) return;
                        onRescheduleEvent(
                          evt,
                          new Date(`${evtDate}T${evtStart}:00`).toISOString(),
                          new Date(`${evtDate}T${evtEnd}:00`).toISOString()
                        );
                        setRescheduleEventId(null);
                      }}
                      className="px-2.5 py-1 rounded bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium"
                    >
                      Save
                    </button>
                  </div>
                )}

                {linkingEventId === evt.id && onLinkTaskToEvent && (
                  <div className="mt-2.5 pt-2.5 border-t border-surface-700 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-300">Link to task:</span>
                    <select
                      value={linkedTask?.id ?? ''}
                      onChange={(e) => {
                        if (linkedTask && !e.target.value) {
                          onLinkTaskToEvent(linkedTask.id, null);
                        } else if (e.target.value) {
                          onLinkTaskToEvent(e.target.value, evt.id);
                        }
                        setLinkingEventId(null);
                      }}
                      className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-100"
                    >
                      <option value="">
                        {linkedTask ? 'Unlink current task' : 'Select task...'}
                      </option>
                      {tasks
                        .filter((tk) => !tk.completed || tk.id === linkedTask?.id)
                        .map((tk) => (
                          <option key={tk.id} value={tk.id}>
                            {tk.title}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => setLinkingEventId(null)}
                      className="px-2 py-1 rounded bg-surface-700 text-slate-300"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
