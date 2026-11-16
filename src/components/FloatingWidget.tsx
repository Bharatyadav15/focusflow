import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ListTodo,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Shield,
  ShieldOff,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  CalendarEvent,
  Priority,
  TaskItem,
  TimerMode,
  TimerState,
} from '../types';
import { getTaskBreadcrumb } from '../utils/taskTree';
import type { AmbientPreset } from '../utils/ambientSound';
import { parseSmartTaskInput } from '../utils/taskParser';
import { extractYmd, formatTimer, toLocalYmd } from '../utils/time';
import {
  type FilterTab,
  PullUpDrawer,
  type SortOrder,
  type ViewMode,
} from './floating/PullUpDrawer';

export type DockSide = 'left' | 'right' | 'top' | 'bottom';

export interface FloatingWidgetProps {
  focusStats?: { todayMinutes: number; streakDays: number; goalMinutes: number };
  onSwitchMode?: (mode: TimerMode) => void;
  tasks: TaskItem[];
  events: CalendarEvent[];
  timer: TimerState;
  syncing: boolean;
  googleConnected: boolean;
  lastSyncedAt?: string | null;
  defaultFocusMinutes: number;
  distractionGuardEnabled?: boolean;
  blockedCount?: number;
  onToggleDistractionGuard?: () => void;
  ambientPreset?: AmbientPreset;
  onCycleAmbient?: () => void;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onExtend5m?: () => void;
  onFinishStopwatch?: () => void;
  onCompleteActive?: () => void;
  onRescheduleActive?: (preset: 'plus1h' | 'tomorrow' | 'plus7d') => void;
  onSync: () => Promise<void>;
  onAddTask: (
    title: string,
    dueDate?: string,
    priority?: Priority,
    durationMinutes?: number
  ) => Promise<void>;
  onToggleTask: (taskId: string) => void;
  onUpdateTask: (
    taskId: string,
    patch: { title?: string; priority?: Priority; dueDate?: string }
  ) => Promise<void>;
  onDeleteTask: (task: TaskItem) => void;
  onConvertEventToTask: (evt: CalendarEvent) => Promise<void>;
  onStartFocus: (target: {
    type: 'task' | 'event';
    id: string;
    title: string;
    calendarEventId?: string;
    linkedTaskId?: string;
    durationMinutes?: number;
  }) => void;
}

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

export const FloatingWidget: React.FC<FloatingWidgetProps> = ({
  focusStats,
  onSwitchMode,
  tasks,
  events,
  timer,
  syncing,
  googleConnected,
  lastSyncedAt,
  defaultFocusMinutes,
  distractionGuardEnabled = false,
  blockedCount = 0,
  onToggleDistractionGuard,
  ambientPreset = 'off',
  onCycleAmbient,
  onToggleTimer,
  onResetTimer,
  onExtend5m,
  onFinishStopwatch,
  onCompleteActive,
  onRescheduleActive,
  onSync,
  onAddTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onConvertEventToTask,
  onStartFocus,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [filterTab, setFilterTab] = useState<FilterTab>('today');
  const [sortOrder, setSortOrder] = useState<SortOrder>('due');
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [lastSyncedLabel, setLastSyncedLabel] = useState('Local mode');

  const didDragRef = useRef(false);
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);
  const todayYmd = toLocalYmd(new Date());

  const hasActiveTimer = timer.isRunning || timer.activeTarget !== null;

  // ---- Hover / dock / celebration state ----
  const [hovered, setHovered] = useState(false);
  const [peek, setPeek] = useState(false);
  const [dock, setDock] = useState<DockSide | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const mountedAtRef = useRef(Date.now());
  const lastTickRef = useRef(timer.completedTickId ?? 0);

  // Cursor presence comes from the Rust hit-test loop (the window is click-through,
  // so DOM mouseenter/leave are unreliable); fall back to DOM events outside Tauri.
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.onTaskbarHover) return api.onTaskbarHover(setHovered);
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    document.documentElement.addEventListener('mouseenter', enter);
    document.documentElement.addEventListener('mouseleave', leave);
    return () => {
      document.documentElement.removeEventListener('mouseenter', enter);
      document.documentElement.removeEventListener('mouseleave', leave);
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    void api?.getTaskbarDock?.().then((d) => setDock((d as DockSide | null) ?? null));
    return api?.onTaskbarDock?.((d) => setDock((d as DockSide | null) ?? null));
  }, []);

  // Docked bar peeks out while hovered and for a moment afterwards.
  useEffect(() => {
    if (hovered) {
      setPeek(true);
      return;
    }
    const id = window.setTimeout(() => setPeek(false), 1500);
    return () => window.clearTimeout(id);
  }, [hovered]);

  // Session finished: flash + confetti for a few seconds.
  useEffect(() => {
    const tick = timer.completedTickId ?? 0;
    const prev = lastTickRef.current;
    lastTickRef.current = tick;
    if (tick > prev && Date.now() - mountedAtRef.current > 2000) {
      setCelebrate(true);
      const id = window.setTimeout(() => setCelebrate(false), 3000);
      return () => window.clearTimeout(id);
    }
  }, [timer.completedTickId]);

  const updateExpanded = (next: boolean) => {
    setExpanded(next);
    window.electronAPI?.setTaskbarExpanded(next);
  };

  // Collapse the large view a couple of seconds after the cursor leaves it.
  useEffect(() => {
    if (!expanded || pinned || hovered) return;
    if (newTaskText.trim() || editingTaskId) return;
    const id = window.setTimeout(() => {
      setExpanded(false);
      window.electronAPI?.setTaskbarExpanded(false);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [expanded, pinned, hovered, newTaskText, editingTaskId]);

  useEffect(() => {
    if (!window.electronAPI) return;
    return window.electronAPI.onTaskbarBlur(() => {
      if (!pinned && !newTaskText.trim() && !editingTaskId) {
        setExpanded(false);
        window.electronAPI?.setTaskbarExpanded(false);
      }
    });
  }, [pinned, newTaskText, editingTaskId]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onTaskbarQuickAdd) return;
    const openQuickAdd = () => {
      void api.takePendingQuickAdd?.();
      setViewMode('tasks');
      setExpanded(true);
      api.setTaskbarExpanded(true);
      setTimeout(() => quickAddInputRef.current?.focus(), 140);
    };
    api.takePendingQuickAdd?.().then((pending) => {
      if (pending) openQuickAdd();
    });
    return api.onTaskbarQuickAdd(openQuickAdd);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) {
        updateExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const handleWidgetMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const startScreenX = e.screenX;
    const startScreenY = e.screenY;
    const offsetX = e.clientX;
    const offsetY = e.clientY;
    didDragRef.current = false;
    setHovered(true);

    const onMove = (ev: MouseEvent) => {
      const dx = Math.abs(ev.screenX - startScreenX);
      const dy = Math.abs(ev.screenY - startScreenY);
      if (dx > 4 || dy > 4) {
        if (!didDragRef.current) {
          didDragRef.current = true;
          window.electronAPI?.setTaskbarDragging(true);
        }
        window.electronAPI?.moveTaskbarWindow(
          ev.screenX,
          ev.screenY,
          offsetX,
          offsetY
        );
      }
    };
    const onUp = () => {
      window.electronAPI?.setTaskbarDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const openTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);

  const overdueCount = useMemo(
    () =>
      openTasks.filter((t) => {
        const ymd = getTaskYmd(t);
        return ymd !== null && ymd < todayYmd;
      }).length,
    [openTasks, todayYmd]
  );

  const sortTasks = (list: TaskItem[]) =>
    [...list].sort((a, b) => {
      if (sortOrder === 'priority') return (a.priority ?? 3) - (b.priority ?? 3);
      if (sortOrder === 'title') return a.title.localeCompare(b.title);
      const ya = getTaskYmd(a) || '9999-12-31';
      const yb = getTaskYmd(b) || '9999-12-31';
      if (ya !== yb) return ya.localeCompare(yb);
      return (a.priority ?? 3) - (b.priority ?? 3);
    });

  const taskSections = useMemo(() => {
    const overdue: TaskItem[] = [];
    const todayList: TaskItem[] = [];
    const upcoming: TaskItem[] = [];
    const unscheduled: TaskItem[] = [];

    for (const t of openTasks) {
      const ymd = getTaskYmd(t);
      if (!ymd) unscheduled.push(t);
      else if (ymd < todayYmd) overdue.push(t);
      else if (ymd === todayYmd) todayList.push(t);
      else upcoming.push(t);
    }

    if (filterTab === 'overdue') {
      return [{ title: 'OVERDUE', items: sortTasks(overdue) }];
    }
    if (filterTab === 'today') {
      const sections: { title: string; items: TaskItem[] }[] = [];
      if (overdue.length > 0) {
        sections.push({ title: 'OVERDUE', items: sortTasks(overdue) });
      }
      sections.push({
        title: 'TODAY',
        items: sortTasks([...todayList, ...unscheduled]),
      });
      return sections;
    }
    if (filterTab === 'upcoming') {
      return [{ title: 'UPCOMING', items: sortTasks(upcoming) }];
    }

    const sections: { title: string; items: TaskItem[] }[] = [];
    if (overdue.length > 0) sections.push({ title: 'OVERDUE', items: sortTasks(overdue) });
    if (todayList.length > 0) sections.push({ title: 'TODAY', items: sortTasks(todayList) });
    if (upcoming.length > 0) sections.push({ title: 'UPCOMING', items: sortTasks(upcoming) });
    if (unscheduled.length > 0) sections.push({ title: 'TASKS', items: sortTasks(unscheduled) });
    return sections;
  }, [filterTab, openTasks, sortOrder, todayYmd]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    const parsed = parseSmartTaskInput(newTaskText, todayYmd);
    const effectiveDue =
      parsed.dueDate ?? (filterTab === 'today' ? todayYmd : undefined);
    setNewTaskText('');
    await onAddTask(
      parsed.title,
      effectiveDue,
      parsed.priority ?? 3,
      parsed.durationMinutes
    );
    setLastSyncedLabel('Synced just now');
  };

  const handleManualSync = async () => {
    await onSync();
    setLastSyncedLabel('Synced just now');
  };

  const handleQuickReschedule = async (taskId: string, offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    await onUpdateTask(taskId, { dueDate: toLocalYmd(d) });
  };

  const cycleSortOrder = () => {
    setSortOrder((prev) =>
      prev === 'due' ? 'priority' : prev === 'priority' ? 'title' : 'due'
    );
  };

  const sortOrderLabel =
    sortOrder === 'due' ? 'Order' : sortOrder === 'priority' ? 'Priority' : 'Title';

  const { mins, secs } = formatTimer(timer.secondsLeft);
  const progress =
    timer.mode === 'stopwatch'
      ? ((timer.secondsLeft % Math.max(60, timer.totalSeconds)) /
          Math.max(60, timer.totalSeconds)) *
        100
      : timer.totalSeconds > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((timer.totalSeconds - timer.secondsLeft) / timer.totalSeconds) * 100
            )
          )
        : 0;

  const accentColor =
    timer.mode === 'focus'
      ? '#6366f1'
      : timer.mode === 'stopwatch'
        ? '#f59e0b'
        : timer.mode === 'shortBreak'
          ? '#10b981'
          : '#38bdf8';

  const handleStopTimer = () => {
    if (
      timer.mode === 'stopwatch' &&
      timer.secondsLeft > 0 &&
      onFinishStopwatch
    ) {
      onFinishStopwatch();
    } else {
      onResetTimer();
    }
  };

  const handleStartFocusAndCollapse = (target: {
    type: 'task' | 'event';
    id: string;
    title: string;
    calendarEventId?: string;
    linkedTaskId?: string;
    durationMinutes?: number;
  }) => {
    onStartFocus(target);
    // Morph immediately into the compact floating Pomodoro capsule
    if (!pinned && expanded) {
      updateExpanded(false);
    }
  };

  // ---- Derived display state ----
  const isBreakMode = timer.mode === 'shortBreak' || timer.mode === 'longBreak';
  const breakReady =
    isBreakMode &&
    !timer.isRunning &&
    timer.totalSeconds > 0 &&
    timer.secondsLeft >= timer.totalSeconds;
  const showActive = hasActiveTimer || breakReady;
  const remainingPct =
    timer.totalSeconds > 0
      ? Math.min(100, Math.max(0, (timer.secondsLeft / timer.totalSeconds) * 100))
      : 0;

  let fillPct = remainingPct;
  let fillColor = '#6366f1';
  if (breakReady) {
    fillPct = 100;
    fillColor = '#10b981';
  } else if (timer.mode === 'focus') {
    fillPct = remainingPct; // drains as time runs out
    fillColor =
      timer.secondsLeft <= 60
        ? '#f43f5e'
        : remainingPct <= 20
          ? '#f59e0b'
          : '#6366f1';
  } else if (timer.mode === 'stopwatch') {
    fillPct = progress;
    fillColor = '#f59e0b';
  } else {
    fillPct = 100 - remainingPct; // breaks fill up
    fillColor = timer.mode === 'shortBreak' ? '#10b981' : '#38bdf8';
  }
  const paused = !timer.isRunning && !breakReady && showActive;
  const activeTaskBreadcrumb =
    timer.activeTarget?.type === 'task' && timer.activeTarget.id
      ? getTaskBreadcrumb(tasks, timer.activeTarget.id)
      : '';
  const activeLabel =
    activeTaskBreadcrumb ||
    timer.activeTarget?.title ||
    (timer.mode === 'shortBreak'
      ? 'Short Break'
      : timer.mode === 'longBreak'
        ? 'Long Break'
        : timer.mode === 'stopwatch'
          ? 'Stopwatch'
          : 'Focus Session');
  const breakMins = Math.max(1, Math.round(timer.totalSeconds / 60));

  type BarMode = 'bar' | 'compact' | 'capsule' | 'idle';
  const barMode: BarMode =
    dock && !expanded && !peek
      ? 'bar'
      : expanded
        ? showActive
          ? 'capsule'
          : 'idle'
        : showActive
          ? 'compact'
          : 'idle';
  const vertical = dock === 'left' || dock === 'right';
  const slop = barMode === 'bar' ? 10 : 0;

  // Tell Rust where the pill really is (hit-testing + edge docking).
  const reportRect = useCallback(() => {
    const el = pillRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.electronAPI?.reportTaskbarRect?.(r.x, r.y, r.width, r.height, slop);
  }, [slop]);

  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    reportRect();
    const t1 = window.setTimeout(reportRect, 80);
    const t2 = window.setTimeout(reportRect, 300);
    const ro = new ResizeObserver(reportRect);
    ro.observe(el);
    window.addEventListener('resize', reportRect);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener('resize', reportRect);
    };
  }, [reportRect, barMode, dock, showActive, expanded]);

  const handlePillClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if ((e.target as HTMLElement).closest('button')) return;
    updateExpanded(!expanded);
  };

  const rootLayout =
    dock === 'left'
      ? 'flex-col items-start pl-0 pr-1 pt-1 pb-1'
      : dock === 'right'
        ? 'flex-col items-end pr-0 pl-1 pt-1 pb-1'
        : dock === 'bottom'
          ? 'flex-col items-start px-1 pt-1 pb-0'
          : dock === 'top'
            ? 'flex-col-reverse items-start px-1 pt-0 pb-1'
            : 'flex-col items-start px-1 pb-1';

  let wrapperClass: string;
  const wrapperStyle: React.CSSProperties = {};
  if (barMode === 'bar') {
    wrapperClass = `relative overflow-hidden rounded-full border border-white/[0.12] bg-white/[0.08] cursor-grab ${
      vertical ? 'w-[8px] h-[96px]' : 'w-[96px] h-[8px]'
    } ${breakReady ? 'ff-break-pulse' : ''}`;
  } else if (barMode === 'compact') {
    wrapperClass = `relative overflow-hidden h-[44px] w-[272px] rounded-full backdrop-blur-xl border bg-[#18181f]/95 shadow-[0_10px_28px_rgba(0,0,0,0.65)] transition-all duration-200 cursor-grab ${
      celebrate ? 'ff-celebrate' : ''
    }`;
    wrapperStyle.borderColor = `${fillColor}66`;
  } else if (barMode === 'capsule') {
    wrapperClass =
      'relative overflow-hidden backdrop-blur-xl border shadow-[0_10px_28px_rgba(0,0,0,0.65)] transition-all duration-200 cursor-grab active:cursor-grabbing w-[348px] rounded-2xl bg-[#18181f]/95 border-indigo-500/35';
  } else {
    wrapperClass =
      'relative overflow-hidden backdrop-blur-xl border shadow-[0_10px_28px_rgba(0,0,0,0.65)] transition-all duration-200 cursor-grab active:cursor-grabbing h-[48px] px-2.5 rounded-full bg-[#1a1a22]/95 border-white/[0.11] hover:border-indigo-500/40';
  }

  const barFillStyle: React.CSSProperties = vertical
    ? { left: 0, right: 0, bottom: 0, height: `${showActive ? fillPct : 100}%` }
    : { top: 0, bottom: 0, left: 0, width: `${showActive ? fillPct : 100}%` };

  const confettiColors = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#38bdf8'];

  const barJsx = (
    <div
      className={`absolute transition-all duration-500 ease-linear ${
        paused ? 'opacity-50' : ''
      }`}
      style={{
        ...barFillStyle,
        backgroundColor: showActive ? fillColor : '#64748b',
        opacity: showActive ? undefined : 0.35,
        filter: paused ? 'grayscale(1)' : undefined,
      }}
    />
  );

  const compactJsx = (
    <>
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-linear"
        style={{
          width: `${fillPct}%`,
          background: `linear-gradient(90deg, ${fillColor}40, ${fillColor}90)`,
          filter: paused ? 'grayscale(1) opacity(0.6)' : undefined,
        }}
      >
        {timer.isRunning && (
          <div
            className="ff-edge absolute right-0 inset-y-1.5 w-[3px]"
            style={{ color: fillColor }}
          />
        )}
      </div>
      {celebrate &&
        confettiColors
          .concat(confettiColors, confettiColors)
          .map((c, i) => (
            <span
              key={i}
              className="ff-confetti"
              style={{
                left: `${(i * 37) % 96 + 2}%`,
                backgroundColor: c,
                animationDelay: `${(i % 7) * 90}ms`,
              }}
            />
          ))}
      <div className="relative h-full flex items-center gap-2 pl-4 pr-1.5">
        {breakReady ? (
          <>
            <span className="flex-1 min-w-0 truncate text-xs font-semibold text-emerald-50">
              {celebrate ? 'Session complete!' : `Stretch — ${breakMins} min break`}
            </span>
            <button
              onClick={onToggleTimer}
              className="shrink-0 px-2.5 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold transition"
              title="Start the break"
            >
              Start
            </button>
            {onSwitchMode && (
              <button
                onClick={() => onSwitchMode('focus')}
                className="shrink-0 p-1 rounded-full text-slate-300 hover:text-white hover:bg-white/[0.12] transition"
                title="Skip the break"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-50">
              {celebrate ? 'Session complete! ' : activeLabel}
            </span>
            <button
              onClick={onToggleTimer}
              className={`shrink-0 font-mono text-[13px] font-bold tabular-nums text-slate-50 px-1.5 rounded-md hover:bg-white/[0.12] transition ${
                paused ? 'ff-blink' : ''
              }`}
              title={timer.isRunning ? 'Click to pause' : 'Click to resume'}
            >
              {mins}:{secs}
            </button>
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateExpanded(true);
          }}
          className={`shrink-0 p-1 rounded-full text-slate-200 hover:bg-white/[0.14] transition-opacity duration-150 ${
            hovered || peek ? 'opacity-100' : 'opacity-0'
          }`}
          title="Open full view"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>
    </>
  );

  return (
    <div
      className={`w-screen h-screen flex justify-end bg-transparent overflow-hidden select-none ${rootLayout}`}
    >
      {/* Upward Pull-Up Menu Drawer */}
      <PullUpDrawer
        placement={dock === 'top' ? 'down' : 'up'}
        focusStats={focusStats}
        expanded={expanded}
        pinned={pinned}
        onTogglePin={() => setPinned((p) => !p)}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        filterTab={filterTab}
        onChangeFilterTab={setFilterTab}
        sortOrderLabel={sortOrderLabel}
        onCycleSortOrder={cycleSortOrder}
        events={events}
        taskSections={taskSections}
        todayYmd={todayYmd}
        timer={timer}
        syncing={syncing}
        googleConnected={googleConnected}
        lastSyncedAt={lastSyncedAt}
        lastSyncedLabel={lastSyncedLabel}
        defaultFocusMinutes={defaultFocusMinutes}
        newTaskText={newTaskText}
        onChangeNewTaskText={setNewTaskText}
        quickAddInputRef={quickAddInputRef}
        onAddSubmit={handleAddSubmit}
        editingTaskId={editingTaskId}
        editingTitle={editingTitle}
        onStartEdit={(task) => {
          setEditingTaskId(task.id);
          setEditingTitle(task.title);
        }}
        onChangeEditingTitle={setEditingTitle}
        onCommitEdit={async (taskId) => {
          const trimmed = editingTitle.trim();
          setEditingTaskId(null);
          if (trimmed) await onUpdateTask(taskId, { title: trimmed });
        }}
        onCancelEdit={() => setEditingTaskId(null)}
        onToggleTask={onToggleTask}
        onQuickReschedule={handleQuickReschedule}
        onDeleteTask={onDeleteTask}
        onConvertEventToTask={onConvertEventToTask}
        onStartFocusAndCollapse={handleStartFocusAndCollapse}
        onRescheduleActive={onRescheduleActive}
        onManualSync={handleManualSync}
        distractionGuardEnabled={distractionGuardEnabled}
        blockedCount={blockedCount}
        onToggleDistractionGuard={onToggleDistractionGuard}
        onOpenFullApp={() => window.electronAPI?.showMainWindow()}
      />

      {/* Morphing Bottom Bar: docked bar <-> compact pill <-> full capsule / idle pill */}
      <div
        ref={pillRef}
        onMouseDown={handleWidgetMouseDown}
        onClick={handlePillClick}
        className={wrapperClass}
        style={wrapperStyle}
      >
        {barMode === 'bar' ? (
          barJsx
        ) : barMode === 'compact' ? (
          compactJsx
        ) : barMode === 'capsule' ? (
          <>
            {/* Top linear progress strip */}
            <div className="h-[2.5px] w-full bg-white/[0.06]">
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${progress}%`, backgroundColor: accentColor }}
              />
            </div>

            <div className="px-2.5 py-2 flex items-center gap-2">
              <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />

              {/* Task Title & Optional Next Subtask */}
              <div
                onClick={() => updateExpanded(!expanded)}
                className="flex-1 min-w-0 cursor-pointer"
                title="Click or use arrow to pull up tasks & schedule"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      timer.isRunning ? 'animate-pulse' : 'opacity-60'
                    }`}
                    style={{ backgroundColor: accentColor }}
                  />
                  <span className="text-xs font-semibold text-slate-100 truncate">
                    {activeLabel}
                  </span>
                </div>
                {timer.activeTarget?.nextSubtask && (
                  <div className="text-[10px] text-slate-400 truncate pl-3">
                    Next: {timer.activeTarget.nextSubtask}
                  </div>
                )}
              </div>

              {/* Live Countdown */}
              <span className="text-xs font-mono font-bold tabular-nums text-slate-100 bg-white/[0.06] px-2 py-1 rounded-lg border border-white/[0.06] shrink-0">
                {mins}:{secs}
              </span>

              {/* Compact Actions */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={onToggleTimer}
                  className="p-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white transition"
                  title={timer.isRunning ? 'Pause' : 'Resume'}
                >
                  {timer.isRunning ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                </button>

                {timer.mode !== 'stopwatch' && onExtend5m && (
                  <button
                    onClick={onExtend5m}
                    className="px-1.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] text-[10px] font-semibold text-slate-200 transition flex items-center"
                    title="Add 5 minutes"
                  >
                    <Plus className="w-2.5 h-2.5" />5
                  </button>
                )}

                {timer.activeTarget && onCompleteActive && (
                  <button
                    onClick={onCompleteActive}
                    className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/20 transition"
                    title="Complete active task"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={handleStopTimer}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/[0.07] transition"
                  title={
                    timer.mode === 'stopwatch'
                      ? 'Stop & save session'
                      : 'Stop timer (return to compact pill)'
                  }
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>

                {onCycleAmbient && (
                  <button
                    onClick={onCycleAmbient}
                    className={`p-1.5 rounded-lg transition ${
                      ambientPreset !== 'off'
                        ? 'text-indigo-300 bg-indigo-500/20'
                        : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                    }`}
                    title={`Ambient sound: ${ambientPreset}`}
                  >
                    {ambientPreset !== 'off' ? (
                      <Volume2 className="w-3.5 h-3.5" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {onToggleDistractionGuard && (
                  <button
                    onClick={onToggleDistractionGuard}
                    className={`p-1.5 rounded-lg transition ${
                      distractionGuardEnabled
                        ? 'text-rose-300 bg-rose-500/20'
                        : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                    }`}
                    title={`Distraction Blocker: ${
                      distractionGuardEnabled ? `ON (${blockedCount} rules)` : 'OFF'
                    }`}
                  >
                    {distractionGuardEnabled ? (
                      <Shield className="w-3.5 h-3.5" />
                    ) : (
                      <ShieldOff className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}

                {/* Pull-Up Menu Arrow */}
                <button
                  onClick={() => updateExpanded(!expanded)}
                  className={`p-1.5 rounded-lg transition ${
                    expanded
                      ? 'bg-indigo-500/25 text-indigo-300'
                      : 'bg-white/[0.06] hover:bg-white/[0.14] text-slate-200'
                  }`}
                  title={expanded ? 'Collapse menu' : 'Pull up Tasks & Schedule'}
                >
                  {expanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronUp className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Idle Taskbar Pill State */
          <div className="h-full flex items-center gap-2">
            <button
              onClick={() => {
                if (!didDragRef.current) updateExpanded(!expanded);
              }}
              className="flex items-center gap-2 pr-1 text-left"
              title="Toggle Floating Tasks & Schedule"
            >
              <div className="w-7 h-7 rounded-full bg-indigo-500/25 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0">
                <ListTodo className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-semibold text-slate-100">Tasks</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.08] text-slate-200 tabular-nums">
                {openTasks.length}
              </span>
              {overdueCount > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 tabular-nums"
                  title={`${overdueCount} overdue`}
                >
                  {overdueCount}!
                </span>
              )}
              <span className="text-slate-400 pl-0.5">
                {expanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </span>
            </button>

            <div className="w-px h-4 bg-white/[0.1]" />

            <button
              onClick={() => window.electronAPI?.closeTaskbarWidget()}
              className="p-1 rounded-full text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition"
              title="Hide floating widget"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
