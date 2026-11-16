import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import type { CalendarEvent, TaskItem, TimerState } from '../../types';
import { formatTime } from '../../utils/time';

interface DayHourlyGridProps {
  selectedDayKey: string;
  selectedDayEvents: CalendarEvent[];
  tasks: TaskItem[];
  onStartAddForDay: (hour?: number) => void;
  onStartFocus: (target: TimerState['activeTarget']) => void;
  onScheduleTaskAtTime?: (
    task: TaskItem,
    targetDateKey: string,
    hour: number,
    minute?: number
  ) => Promise<void>;
  onTimeBlockTask: (task: TaskItem, targetDateKey: string) => Promise<void>;
  onReloadRange: () => Promise<void>;
  getEventDurationMinutes: (evt: CalendarEvent) => number | undefined;
  onSelectEvent?: (evt: CalendarEvent) => void;
}

export const DayHourlyGrid: React.FC<DayHourlyGridProps> = ({
  selectedDayKey,
  selectedDayEvents,
  tasks,
  onStartAddForDay,
  onStartFocus,
  onScheduleTaskAtTime,
  onTimeBlockTask,
  onReloadRange,
  getEventDurationMinutes,
  onSelectEvent,
}) => {
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);

  return (
    <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-surface-700">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Hourly Schedule — {selectedDayKey}
          </h3>
          <p className="text-[11px] text-slate-400">
            Drag an unscheduled task onto any hour slot to time-block it at that
            exact time.
          </p>
        </div>
        <button
          onClick={() => onStartAddForDay()}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {selectedDayEvents.filter((e) => e.isAllDay).length > 0 && (
        <div className="flex flex-wrap gap-2 pb-1">
          {selectedDayEvents
            .filter((e) => e.isAllDay)
            .map((evt) => (
              <span
                key={evt.id}
                className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200"
              >
                All day: {evt.summary}
              </span>
            ))}
        </div>
      )}

      <div className="divide-y divide-surface-700/70 max-h-[600px] overflow-y-auto pr-1">
        {Array.from({ length: 17 }, (_, i) => i + 6).map((hour) => {
          const hourLabel = `${String(hour).padStart(2, '0')}:00`;
          const slotEvents = selectedDayEvents.filter(
            (e) => !e.isAllDay && new Date(e.start).getHours() === hour
          );
          return (
            <div
              key={hour}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverHour !== hour) setDragOverHour(hour);
              }}
              onDragLeave={() => {
                if (dragOverHour === hour) setDragOverHour(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOverHour(null);
                const taskId = e.dataTransfer.getData('text/focusflow-task-id');
                const dragged = tasks.find((tk) => tk.id === taskId);
                if (dragged) {
                  if (onScheduleTaskAtTime) {
                    await onScheduleTaskAtTime(dragged, selectedDayKey, hour, 0);
                  } else {
                    await onTimeBlockTask(dragged, selectedDayKey);
                  }
                  await onReloadRange();
                }
              }}
              className={`flex items-start gap-3 py-2 px-2 rounded-lg transition min-h-[48px] ${
                dragOverHour === hour
                  ? 'bg-emerald-500/15 ring-1 ring-emerald-400'
                  : 'hover:bg-surface-900/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onStartAddForDay(hour)}
                className="w-14 shrink-0 text-left font-mono text-xs text-slate-400 hover:text-indigo-300 pt-0.5"
                title={`Click to add an event at ${hourLabel}`}
              >
                {hourLabel}
              </button>
              <div className="flex-1 flex flex-wrap gap-2">
                {slotEvents.map((evt) => (
                  <div
                    key={evt.id}
                    onClick={() => onSelectEvent?.(evt)}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-surface-900/90 border border-surface-600 hover:border-indigo-500/60 text-xs flex-1 min-w-[200px] cursor-pointer transition"
                  >
                    <div className="min-w-0">
                      <span className="text-indigo-300 font-mono mr-2">
                        {formatTime(evt.start)}–{formatTime(evt.end)}
                      </span>
                      <span className="text-slate-100 font-medium">
                        {evt.summary}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartFocus({
                          type: 'event',
                          id: evt.id,
                          title: evt.summary,
                          calendarEventId: evt.id,
                          durationMinutes: getEventDurationMinutes(evt),
                        });
                      }}
                      className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[11px] font-medium shrink-0"
                    >
                      Focus
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
