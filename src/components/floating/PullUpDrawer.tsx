import React from 'react';
import {
  ArrowUpDown,
  Calendar,
  CalendarClock,
  Check,
  Flame,
  Clock,
  ExternalLink,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import type { CalendarEvent, Priority, TaskItem, TimerState } from '../../types';
import { getPriorityMeta } from '../../utils/priority';
import { eventShortTime, extractYmd, formatTime, toLocalYmd } from '../../utils/time';

export type FilterTab = 'today' | 'upcoming' | 'all' | 'overdue';
export type SortOrder = 'due' | 'priority' | 'title';
export type ViewMode = 'tasks' | 'calendar';

function getTaskYmd(task: TaskItem): string | null {
  if (task.scheduledStart) {
    const d = new Date(task.scheduledStart);
    if (!Number.isNaN(d.getTime())) return toLocalYmd(d);
  }
  if (task.dueDate) {
    const ymd = extractYmd(task.dueDate);
    if (ymd) return ymd;
  }
  return null;
}

function formatDatePill(
  ymd: string,
  todayYmd: string
): { label: string; isOverdue: boolean; isToday: boolean } {
  const [y, m, d] = ymd.split('-').map(Number);
  const dateObj = new Date(y, (m || 1) - 1, d || 1);
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const todayObj = new Date(ty, (tm || 1) - 1, td || 1);
  const diffDays = Math.round(
    (dateObj.getTime() - todayObj.getTime()) / 86_400_000
  );

  if (diffDays === 0) return { label: 'Today', isOverdue: false, isToday: true };
  if (diffDays === -1) return { label: 'Yesterday', isOverdue: true, isToday: false };
  if (diffDays === 1) return { label: 'Tomorrow', isOverdue: false, isToday: false };

  return {
    label: dateObj.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    isOverdue: diffDays < 0,
    isToday: false,
  };
}

interface PullUpDrawerProps {
  placement?: 'up' | 'down';
  focusStats?: { todayMinutes: number; streakDays: number; goalMinutes: number };
  expanded: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  filterTab: FilterTab;
  onChangeFilterTab: (t: FilterTab) => void;
  sortOrderLabel: string;
  onCycleSortOrder: () => void;
  events: CalendarEvent[];
  taskSections: { title: string; items: TaskItem[] }[];
  todayYmd: string;
  timer: TimerState;
  syncing: boolean;
  googleConnected: boolean;
  lastSyncedAt?: string | null;
  lastSyncedLabel: string;
  defaultFocusMinutes: number;
  newTaskText: string;
  onChangeNewTaskText: (val: string) => void;
  quickAddInputRef: React.RefObject<HTMLInputElement>;
  onAddSubmit: (e: React.FormEvent) => Promise<void>;
  editingTaskId: string | null;
  editingTitle: string;
  onStartEdit: (task: TaskItem) => void;
  onChangeEditingTitle: (val: string) => void;
  onCommitEdit: (taskId: string) => Promise<void>;
  onCancelEdit: () => void;
  onToggleTask: (taskId: string) => void;
  onQuickReschedule: (taskId: string, offsetDays: number) => Promise<void>;
  onDeleteTask: (task: TaskItem) => void;
  onConvertEventToTask: (evt: CalendarEvent) => Promise<void>;
  onStartFocusAndCollapse: (target: {
    type: 'task' | 'event';
    id: string;
    title: string;
    calendarEventId?: string;
    linkedTaskId?: string;
    durationMinutes?: number;
  }) => void;
  onRescheduleActive?: (preset: 'plus1h' | 'tomorrow' | 'plus7d') => void;
  onManualSync: () => Promise<void>;
  distractionGuardEnabled?: boolean;
  blockedCount?: number;
  onToggleDistractionGuard?: () => void;
  onOpenFullApp: () => void;
}

export const PullUpDrawer: React.FC<PullUpDrawerProps> = ({
  placement = 'up',
  focusStats,
  expanded,
  pinned,
  onTogglePin,
  viewMode,
  onChangeViewMode,
  filterTab,
  onChangeFilterTab,
  sortOrderLabel,
  onCycleSortOrder,
  events,
  taskSections,
  todayYmd,
  timer,
  syncing,
  googleConnected,
  lastSyncedAt,
  lastSyncedLabel,
  defaultFocusMinutes,
  newTaskText,
  onChangeNewTaskText,
  quickAddInputRef,
  onAddSubmit,
  editingTaskId,
  editingTitle,
  onStartEdit,
  onChangeEditingTitle,
  onCommitEdit,
  onCancelEdit,
  onToggleTask,
  onQuickReschedule,
  onDeleteTask,
  onConvertEventToTask,
  onStartFocusAndCollapse,
  onRescheduleActive,
  onManualSync,
  distractionGuardEnabled = false,
  blockedCount = 0,
  onToggleDistractionGuard,
  onOpenFullApp,
}) => {
  return (
    <div
      className={`w-[354px] h-[488px] ${
        placement === 'down' ? 'mt-1.5 origin-top-left' : 'mb-1.5 origin-bottom-left'
      } rounded-2xl bg-[#1c1c21]/95 backdrop-blur-xl border border-white/[0.09] shadow-[0_16px_44px_rgba(0,0,0,0.78)] flex flex-col overflow-hidden transition-all duration-200 ease-out ${
        expanded
          ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
          : `opacity-0 ${placement === 'down' ? '-translate-y-4' : 'translate-y-4'} scale-95 pointer-events-none`
      }`}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-white/[0.05]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChangeViewMode('tasks')}
            className={`text-[14px] font-semibold tracking-tight transition ${
              viewMode === 'tasks'
                ? 'text-slate-100'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Tasks
          </button>
          <span className="text-slate-700 text-xs">/</span>
          <button
            onClick={() => onChangeViewMode('calendar')}
            className={`text-xs font-medium px-2 py-0.5 rounded-md transition flex items-center gap-1 ${
              viewMode === 'calendar'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3 h-3" />
            Schedule ({events.length})
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onCycleSortOrder}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition"
            title="Change task sort order"
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortOrderLabel}
          </button>
          <button
            onClick={onTogglePin}
            className={`p-1.5 rounded-md transition ${
              pinned
                ? 'bg-indigo-500/20 text-indigo-300'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
            }`}
            title={pinned ? 'Unpin drawer' : 'Keep drawer open on blur'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onOpenFullApp}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition"
            title="Open Full FocusFlow Dashboard"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {focusStats && (
        <div className="px-4 py-1.5 flex items-center gap-3 border-b border-white/[0.05] text-[11px]">
          <span
            className="flex items-center gap-1 font-semibold shrink-0"
            style={{ color: focusStats.streakDays > 0 ? '#fb923c' : '#64748b' }}
            title="Consecutive days with focus time"
          >
            <Flame
              className="w-3.5 h-3.5"
              fill={focusStats.streakDays > 0 ? 'currentColor' : 'none'}
            />
            {focusStats.streakDays}d streak
          </span>
          <span className="text-slate-400 tabular-nums shrink-0">
            Today {focusStats.todayMinutes}m / {focusStats.goalMinutes}m
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (focusStats.todayMinutes / focusStats.goalMinutes) * 100)}%`,
                background:
                  focusStats.todayMinutes >= focusStats.goalMinutes
                    ? '#10b981'
                    : 'linear-gradient(90deg,#6366f1,#fb923c)',
              }}
            />
          </div>
        </div>
      )}

      {/* Quick delay bar when timer has an active target */}
      {timer.activeTarget && onRescheduleActive && (
        <div className="px-3.5 py-1.5 bg-indigo-500/[0.08] border-b border-indigo-500/15 flex items-center justify-between text-[11px]">
          <span className="text-indigo-200 font-medium truncate pr-2 flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3 text-indigo-400 shrink-0" />
            Active: {timer.activeTarget.title}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onRescheduleActive('plus1h')}
              className="px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition"
            >
              +1h
            </button>
            <button
              onClick={() => onRescheduleActive('tomorrow')}
              className="px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition"
            >
              Tomorrow
            </button>
          </div>
        </div>
      )}

      {/* Filter pills & smart quick-add when in tasks view */}
      {viewMode === 'tasks' && (
        <>
          <div className="px-3.5 py-2 flex items-center gap-1.5 border-b border-white/[0.04]">
            {(['today', 'overdue', 'upcoming', 'all'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => onChangeFilterTab(tab)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium capitalize transition ${
                  filterTab === tab
                    ? 'bg-indigo-500 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <form onSubmit={onAddSubmit} className="px-3.5 py-2 border-b border-white/[0.05]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/[0.07] focus-within:border-indigo-500/60 transition">
              <Plus className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <input
                ref={quickAddInputRef}
                value={newTaskText}
                onChange={(e) => onChangeNewTaskText(e.target.value)}
                placeholder="Quick add (e.g. Ship v2 !p1 today 45m)…"
                className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </div>
          </form>
        </>
      )}

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 custom-scrollbar">
        {viewMode === 'tasks' ? (
          taskSections.every((s) => s.items.length === 0) ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No tasks in this view. Add one above!
            </div>
          ) : (
            taskSections.map(
              (section) =>
                section.items.length > 0 && (
                  <div key={section.title} className="space-y-1">
                    <div className="px-1.5 text-[10px] font-semibold tracking-wider text-slate-500">
                      {section.title} ({section.items.length})
                    </div>
                    {section.items.map((task) => {
                      const prioMeta = getPriorityMeta(task.priority);
                      const ymd = getTaskYmd(task);
                      const datePill = ymd ? formatDatePill(ymd, todayYmd) : null;
                      const isRunningThis =
                        timer.isRunning && timer.activeTarget?.id === task.id;

                      return (
                        <div
                          key={task.id}
                          className={`group px-2.5 py-2 rounded-xl border transition flex items-start gap-2.5 ${
                            isRunningThis
                              ? 'bg-indigo-500/15 border-indigo-500/35'
                              : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.04]'
                          }`}
                        >
                          <button
                            onClick={() => onToggleTask(task.id)}
                            className="mt-0.5 w-4 h-4 rounded border border-slate-500/70 hover:border-indigo-400 flex items-center justify-center shrink-0 transition"
                            title="Complete task"
                          >
                            {task.completed && <Check className="w-3 h-3 text-indigo-400" />}
                          </button>

                          <div className="flex-1 min-w-0">
                            {editingTaskId === task.id ? (
                              <input
                                autoFocus
                                value={editingTitle}
                                onChange={(e) => onChangeEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') onCommitEdit(task.id);
                                  if (e.key === 'Escape') onCancelEdit();
                                }}
                                onBlur={() => onCommitEdit(task.id)}
                                className="w-full bg-black/40 text-xs text-slate-100 px-1.5 py-0.5 rounded border border-indigo-500/50 focus:outline-none"
                              />
                            ) : (
                              <div className="text-xs font-medium text-slate-100 leading-snug break-words">
                                {task.title}
                              </div>
                            )}

                            <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px]">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded border font-medium ${prioMeta.badgeClass}`}
                              >
                                P{task.priority ?? 3}
                              </span>
                              {datePill && (
                                <span
                                  className={
                                    datePill.isOverdue
                                      ? 'text-rose-400 font-medium'
                                      : datePill.isToday
                                        ? 'text-indigo-300'
                                        : 'text-slate-400'
                                  }
                                >
                                  {datePill.label}
                                </span>
                              )}
                              <span className="text-slate-500 flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" />
                                {task.durationMinutes ?? defaultFocusMinutes}m
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() =>
                                onStartFocusAndCollapse({
                                  type: 'task',
                                  id: task.id,
                                  title: task.title,
                                  calendarEventId: task.linkedEventId ?? task.calendarEventId,
                                  durationMinutes:
                                    task.durationMinutes ?? defaultFocusMinutes,
                                })
                              }
                              className={`p-1.5 rounded-lg transition ${
                                isRunningThis
                                  ? 'bg-indigo-500 text-white'
                                  : 'bg-indigo-500/15 hover:bg-indigo-500 text-indigo-300 hover:text-white'
                              }`}
                              title="Start Pomodoro on this task"
                            >
                              <Play className="w-3 h-3 fill-current" />
                            </button>
                            <button
                              onClick={() => onStartEdit(task)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-slate-100 transition"
                              title="Rename"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onQuickReschedule(task.id, 1)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-amber-300 transition"
                              title="Push to tomorrow"
                            >
                              <CalendarClock className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onDeleteTask(task)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-400 transition"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
            )
          )
        ) : events.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No events scheduled for today.
          </div>
        ) : (
          <div className="space-y-1.5">
            {events.map((evt) => {
              const isRunningThis =
                timer.isRunning && timer.activeTarget?.id === evt.id;
              return (
                <div
                  key={evt.id}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 transition ${
                    isRunningThis
                      ? 'bg-indigo-500/15 border-indigo-500/35'
                      : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05]'
                  }`}
                >
                  <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: evt.calendarColor || '#6366f1' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {evt.summary}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {evt.isAllDay ? 'All day' : eventShortTime(evt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        onStartFocusAndCollapse({
                          type: 'event',
                          id: evt.id,
                          title: evt.summary,
                          calendarEventId: evt.id,
                          durationMinutes: defaultFocusMinutes,
                        })
                      }
                      className="p-1.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500 text-indigo-300 hover:text-white transition"
                      title="Start Pomodoro on event"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                    <button
                      onClick={() => onConvertEventToTask(evt)}
                      className="px-1.5 py-1 rounded text-[10px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.07] transition"
                      title="Save as timed task"
                    >
                      +Task
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Sync & App Controls */}
      <div className="px-3.5 py-2 border-t border-white/[0.06] bg-black/25 flex items-center justify-between text-[11px] text-slate-400">
        <button
          onClick={onManualSync}
          disabled={syncing}
          className="flex items-center gap-1.5 hover:text-slate-200 transition disabled:opacity-50"
          title={googleConnected ? 'Sync Google Calendar & Tasks' : 'Refresh local data'}
        >
          <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin text-indigo-400' : ''}`} />
          <span>
            {syncing
              ? 'Syncing…'
              : lastSyncedAt
                ? `Synced ${formatTime(lastSyncedAt)}`
                : lastSyncedLabel}
          </span>
        </button>

        <div className="flex items-center gap-2">
          {onToggleDistractionGuard && (
            <button
              onClick={onToggleDistractionGuard}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md border transition ${
                distractionGuardEnabled
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                  : 'border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
              }`}
              title={`Toggle Distraction Blocker (${blockedCount} rules configured)`}
            >
              {distractionGuardEnabled ? (
                <Shield className="w-3 h-3" />
              ) : (
                <ShieldOff className="w-3 h-3" />
              )}
              <span>{distractionGuardEnabled ? 'Blocker ON' : 'Blocker Off'}</span>
            </button>
          )}
          <button
            onClick={onOpenFullApp}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-100 transition"
            title="Open Full Window & Settings"
          >
            <Settings className="w-3 h-3" />
            <span>Dashboard</span>
          </button>
        </div>
      </div>
    </div>
  );
};
