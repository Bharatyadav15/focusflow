import React, { useMemo, useState } from 'react';
import { BellRing, CalendarRange, Moon, X } from 'lucide-react';
import type {
  CalendarEvent,
  EventMetadata,
  GoogleTaskListInfo,
  PomodoroSession,
  Priority,
  Project,
  RecurrenceRule,
  ShutdownReviewResult,
  TaskItem,
  TaskTemplate,
  TimerMode,
  TimerState,
} from '../types';
import { ShutdownReviewModal } from './ShutdownReviewModal';
import { TaskEventDetailModal, type DetailModalTarget } from './TaskEventDetailModal';
import { TimelineView } from './TimelineView';
import { DaySchedulePanel } from './day/DaySchedulePanel';
import { PomodoroCard } from './day/PomodoroCard';
import { TaskListPanel } from './day/TaskListPanel';
import type { AmbientPreset } from '../utils/ambientSound';
import { formatTime } from '../utils/time';

export type DayViewMode = 'plan' | 'actual' | 'planner';

interface TodayViewProps {
  tasks: TaskItem[];
  taskLists: GoogleTaskListInfo[];
  projects: Project[];
  events: CalendarEvent[];
  sessions?: PomodoroSession[];
  dailyGoalMinutes?: number;
  dayMode?: DayViewMode;
  onChangeDayMode?: (mode: DayViewMode) => void;
  plannerContent?: React.ReactNode;
  onLogToCalendar?: (sess: PomodoroSession) => void;
  onUpdateSessionNote?: (sessionId: string, note: string) => void;
  timer: TimerState;
  loadingEvents: boolean;
  syncingTasks: boolean;
  upcomingReminder: CalendarEvent | null;
  onDismissUpcomingReminder?: () => void;
  onSnoozeUpcomingReminder?: (mode: '5m' | 'start') => void;
  ambientPreset?: AmbientPreset;
  onChangeAmbient?: (preset: AmbientPreset) => void;
  onPlanMyDay?: () => void;
  onToggleTimer: () => void;
  onSwitchMode: (mode: TimerMode) => void;
  onResetTimer: () => void;
  onFinishStopwatch: () => void;
  onExtendTimer?: (minutes: number) => void;
  onStartFocus: (
    target: TimerState['activeTarget'],
    asStopwatch?: boolean
  ) => void;
  onAddTask: (
    title: string,
    taskListId?: string,
    priority?: Priority,
    projectId?: string,
    dueDate?: string,
    recurrence?: RecurrenceRule,
    durationMinutes?: number,
    parentId?: string
  ) => void;
  templates?: TaskTemplate[];
  onApplyTemplate?: (tpl: TaskTemplate) => void;
  onSaveAsTemplate?: (task: TaskItem) => void;
  onDeleteTemplate?: (templateId: string) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask: (task: TaskItem) => void;
  onSetTaskMetadata: (
    taskId: string,
    meta: {
      priority?: Priority;
      projectId?: string;
      estimatedPomodoros?: number;
      durationMinutes?: number;
      recurrence?: RecurrenceRule;
      blockedByTaskIds?: string[];
      noteLink?: string;
    }
  ) => void;
  onMoveTask?: (taskId: string, newParentId?: string | null) => Promise<boolean>;
  parentCompletionPrompt?: { parentId: string; parentTitle: string } | null;
  onDismissParentCompletionPrompt?: () => void;
  onAddSubtask?: (taskId: string, title: string) => void;
  onToggleSubtask?: (taskId: string, subtaskId: string) => void;
  onDeleteSubtask?: (taskId: string, subtaskId: string) => void;
  onSetEventMetadata: (eventId: string, meta: EventMetadata) => void;
  onRescheduleTask: (task: TaskItem, dueIso: string) => void;
  onRescheduleEvent: (
    evt: CalendarEvent,
    startIso: string,
    endIso: string
  ) => void;
  onTimeBlockTask: (task: TaskItem) => void;
  onLinkTaskToEvent: (taskId: string, eventId: string | null) => void;
  onConvertEventToTask: (evt: CalendarEvent) => void;
  onDeleteEvent: (evt: CalendarEvent) => void;
  onRefreshEvents: () => void;
  onSyncGoogleTasks: () => void;
  obsidianVaultPath?: string;
  onShutdownReview?: (opts: {
    rollUnfinished?: boolean;
    writeObsidian?: boolean;
    dryRun?: boolean;
  }) => Promise<ShutdownReviewResult>;
}

export const TodayView: React.FC<TodayViewProps> = ({
  tasks,
  taskLists,
  projects,
  events,
  sessions = [],
  dailyGoalMinutes = 120,
  dayMode = 'plan',
  onChangeDayMode,
  plannerContent,
  onLogToCalendar,
  onUpdateSessionNote,
  timer,
  loadingEvents,
  syncingTasks,
  upcomingReminder,
  onDismissUpcomingReminder,
  onSnoozeUpcomingReminder,
  ambientPreset = 'off',
  onChangeAmbient,
  onPlanMyDay,
  onToggleTimer,
  onSwitchMode,
  onResetTimer,
  onFinishStopwatch,
  onExtendTimer,
  onStartFocus,
  onAddTask,
  templates = [],
  onApplyTemplate,
  onSaveAsTemplate,
  onDeleteTemplate: _onDeleteTemplate,
  onToggleTask,
  onDeleteTask,
  onSetTaskMetadata,
  onMoveTask,
  parentCompletionPrompt,
  onDismissParentCompletionPrompt,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onSetEventMetadata,
  onRescheduleTask,
  onRescheduleEvent,
  onTimeBlockTask,
  onLinkTaskToEvent,
  onConvertEventToTask,
  onDeleteEvent,
  onRefreshEvents,
  onSyncGoogleTasks,
  obsidianVaultPath,
  onShutdownReview,
}) => {
  const [sortEventsByPriority, setSortEventsByPriority] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DetailModalTarget | null>(null);

  const sortedEvents = useMemo(() => {
    if (!sortEventsByPriority) return events;
    return [...events].sort(
      (a, b) =>
        (a.priority ?? 3) - (b.priority ?? 3) ||
        new Date(a.start).getTime() - new Date(b.start).getTime()
    );
  }, [events, sortEventsByPriority]);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );
  const eventMap = useMemo(
    () => new Map(events.map((e) => [e.id, e])),
    [events]
  );
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const getEventDurationMinutes = (evt?: CalendarEvent) => {
    if (!evt || evt.isAllDay) return undefined;
    const diff = Math.round(
      (new Date(evt.end).getTime() - new Date(evt.start).getTime()) / 60_000
    );
    return diff > 0 ? diff : undefined;
  };

  return (
    <div className="space-y-5">
      {/* Streamlined Day Workspace Header: Primary Plan | Actual + Subtle Week / Month Toggle */}
      {onChangeDayMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-800 border border-surface-600/70 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Day</span>
            <span className="hidden sm:inline">
              · Switch between today&apos;s plan and actual focus log
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-xl bg-surface-900 p-1 border border-surface-700">
              {(
                [
                  { id: 'plan', label: 'Plan' },
                  { id: 'actual', label: 'Actual' },
                ] as { id: DayViewMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeDayMode(opt.id)}
                  className={`px-3.5 py-1 rounded-lg text-xs font-medium transition ${
                    dayMode === opt.id
                      ? 'bg-indigo-500 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                onChangeDayMode(dayMode === 'planner' ? 'plan' : 'planner')
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition ${
                dayMode === 'planner'
                  ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-surface-900 border-surface-700 text-slate-400 hover:text-slate-200 hover:border-surface-600'
              }`}
              title="Toggle multi-day Week / Month planner"
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Week / Month</span>
            </button>

            {onShutdownReview && (
              <button
                type="button"
                onClick={() => setShutdownOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-900 border border-surface-700 hover:border-indigo-500/40 text-xs font-medium text-slate-300 hover:text-indigo-300 transition"
                title="End-of-Day Shutdown Review & Task Rollover"
              >
                <Moon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Shutdown</span>
              </button>
            )}
          </div>
        </div>
      )}

      {dayMode === 'planner' && plannerContent ? (
        plannerContent
      ) : dayMode === 'actual' ? (
        <TimelineView
          sessions={sessions}
          events={events}
          projects={projects}
          tasks={tasks}
          dailyGoalMinutes={dailyGoalMinutes}
          onLogToCalendar={onLogToCalendar ?? (() => {})}
          onUpdateSessionNote={onUpdateSessionNote ?? (() => {})}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Up Next Pomodoro Card + Tasks */}
          <div className="lg:col-span-7 space-y-6">
            {upcomingReminder && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/40 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BellRing className="w-4 h-4 text-amber-300 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-200 truncate">
                      Upcoming Event: {upcomingReminder.summary}
                    </p>
                    <p className="text-[11px] text-amber-300/80">
                      Starts at {formatTime(upcomingReminder.start)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => {
                      onStartFocus({
                        type: 'event',
                        id: upcomingReminder.id,
                        title: upcomingReminder.summary,
                        calendarEventId: upcomingReminder.id,
                        durationMinutes:
                          getEventDurationMinutes(upcomingReminder),
                      });
                      onDismissUpcomingReminder?.();
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition"
                  >
                    Start Focus
                  </button>
                  {onSnoozeUpcomingReminder && (
                    <>
                      <button
                        onClick={() => onSnoozeUpcomingReminder('5m')}
                        className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs transition"
                        title="Remind again in 5 minutes"
                      >
                        Snooze 5m
                      </button>
                      {new Date(upcomingReminder.start).getTime() >
                        Date.now() + 20_000 && (
                        <button
                          onClick={() => onSnoozeUpcomingReminder('start')}
                          className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs transition"
                          title="Remind again when the event starts"
                        >
                          At Start
                        </button>
                      )}
                    </>
                  )}
                  {onDismissUpcomingReminder && (
                    <button
                      onClick={onDismissUpcomingReminder}
                      className="p-1 rounded-lg text-amber-300 hover:bg-amber-500/20"
                      title="Dismiss reminder"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <PomodoroCard
              timer={timer}
              ambientPreset={ambientPreset}
              onChangeAmbient={onChangeAmbient}
              onToggleTimer={onToggleTimer}
              onSwitchMode={onSwitchMode}
              onResetTimer={onResetTimer}
              onFinishStopwatch={onFinishStopwatch}
              onExtendTimer={onExtendTimer}
            />

            <TaskListPanel
              tasks={tasks}
              taskLists={taskLists}
              projects={projects}
              events={events}
              templates={templates}
              taskMap={taskMap}
              eventMap={eventMap}
              projectMap={projectMap}
              timer={timer}
              syncingTasks={syncingTasks}
              onStartFocus={onStartFocus}
              onQuickAddTask={onAddTask}
              onApplyTemplate={onApplyTemplate}
              onSaveAsTemplate={onSaveAsTemplate}
              onToggleTask={onToggleTask}
              onDeleteTask={onDeleteTask}
              onSetTaskMetadata={onSetTaskMetadata}
              onMoveTask={onMoveTask}
              parentCompletionPrompt={parentCompletionPrompt}
              onDismissParentCompletionPrompt={onDismissParentCompletionPrompt}
              onAddSubtask={onAddSubtask}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onRescheduleTask={onRescheduleTask}
              onTimeBlockTask={onTimeBlockTask}
              onLinkTaskToEvent={onLinkTaskToEvent}
              onSyncGoogleTasks={onSyncGoogleTasks}
              onSelectTask={(t) => setDetailTarget({ kind: 'task', task: t })}
            />
          </div>

          <DaySchedulePanel
            sortedEvents={sortedEvents}
            taskMap={taskMap}
            timer={timer}
            loadingEvents={loadingEvents}
            sortEventsByPriority={sortEventsByPriority}
            onToggleSortEventsByPriority={() =>
              setSortEventsByPriority((s) => !s)
            }
            onPlanMyDay={onPlanMyDay}
            onRefreshEvents={onRefreshEvents}
            onSetEventMetadata={onSetEventMetadata}
            onConvertEventToTask={onConvertEventToTask}
            onRescheduleEvent={onRescheduleEvent}
            onStartFocus={onStartFocus}
            onDeleteEvent={onDeleteEvent}
            getEventDurationMinutes={getEventDurationMinutes}
            onSelectEvent={(evt) => setDetailTarget({ kind: 'event', event: evt })}
          />
        </div>
      )}

      {onShutdownReview && (
        <ShutdownReviewModal
          open={shutdownOpen}
          onClose={() => setShutdownOpen(false)}
          obsidianVaultPath={obsidianVaultPath}
          onRunReview={onShutdownReview}
        />
      )}

      <TaskEventDetailModal
        target={detailTarget}
        tasks={tasks}
        projects={projects}
        onClose={() => setDetailTarget(null)}
        onStartFocus={onStartFocus}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onTimeBlockTask={onTimeBlockTask}
        onConvertEventToTask={onConvertEventToTask}
      />
    </div>
  );
};
