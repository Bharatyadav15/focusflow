import React, { useEffect, useState } from 'react';
import {
  CalendarCheck,
  Command,
  FolderKanban,
  PanelBottom,
  RefreshCw,
  Settings,
  Timer,
} from 'lucide-react';
import { useFocusFlow } from './hooks/useFocusFlow';
import {
  CommandPalette,
  type PaletteMode,
} from './components/CommandPalette';
import { FirstRunWizard } from './components/FirstRunWizard';
import { FloatingWidget } from './components/FloatingWidget';
import { computeFocusSummary } from './utils/focusStats';
import { TodayView, type DayViewMode } from './components/TodayView';
import { PlannerView } from './components/PlannerView';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';
import type { Priority, RecurrenceRule } from './types';
import { ambientEngine, type AmbientPreset } from './utils/ambientSound';
import { extractYmd, formatTime } from './utils/time';

type Tab = 'day' | 'projects' | 'settings';
const AMBIENT_ORDER: AmbientPreset[] = ['off', 'brown', 'rain', 'warm'];

export function App() {
  const winLabel =
    window.__FOCUSFLOW_WINDOW__ ||
    window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  const isFloating =
    winLabel === 'floating' || window.location.hash === '#/floating';
  const isTaskbar =
    winLabel === 'taskbar' || window.location.hash === '#/taskbar';
  const [tab, setTab] = useState<Tab>('day');
  const [dayMode, setDayMode] = useState<DayViewMode>('plan');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('commands');
  const [tokenPath, setTokenPath] = useState('');
  const [ambientPreset, setAmbientPreset] = useState<AmbientPreset>('off');

  const handleSetAmbient = (preset: AmbientPreset) => {
    setAmbientPreset(preset);
    window.electronAPI?.setAmbientPreset(preset);
  };

  const handleCycleAmbient = () => {
    const idx = AMBIENT_ORDER.indexOf(ambientPreset);
    const next = AMBIENT_ORDER[(idx + 1) % AMBIENT_ORDER.length];
    handleSetAmbient(next);
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api
      .getAmbientPreset()
      .then((p) => {
        if (AMBIENT_ORDER.includes(p as AmbientPreset)) {
          setAmbientPreset(p as AmbientPreset);
        }
      })
      .catch(() => {});
    return api.onAmbientPreset((p) => {
      if (AMBIENT_ORDER.includes(p as AmbientPreset)) {
        setAmbientPreset(p as AmbientPreset);
      }
    });
  }, []);

  useEffect(() => {
    if (isFloating || isTaskbar) return;
    if (ambientPreset === 'off') ambientEngine.stop();
    else ambientEngine.start(ambientPreset);
  }, [ambientPreset, isFloating, isTaskbar]);

  useEffect(() => {
    if (isFloating || isTaskbar) return;
    window.electronAPI
      ?.getSecurityInfo()
      .then((info) => setTokenPath(info.tokenPath))
      .catch(() => {});
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteMode('commands');
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFloating, isTaskbar]);

  const {
    data,
    dataLoaded,
    tasks,
    events,
    timer,
    loadingEvents,
    syncingTasks,
    statusMessage,
    lastSyncedAt,
    upcomingReminder,
    dismissUpcomingReminder,
    snoozeUpcomingReminder,
    idleReturnPrompt,
    resolveIdleReturn,
    runShutdownReview,
    notify,
    loadData,
    loadTodayEvents,
    syncTasksFromGoogle,
    syncAll,
    flushSyncQueue,
    planMyDay,
    toggleRunning,
    switchMode,
    resetTimer,
    finishStopwatch,
    extendTimer,
    startFocusOnTarget,
    completeActiveTarget,
    rescheduleActiveTarget,
    saveTasks,
    saveProjects,
    applyTemplate,
    saveTaskAsTemplate,
    deleteTemplate,
    setTaskMetadata,
    moveTask,
    parentCompletionPrompt,
    dismissParentCompletionPrompt,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    updateSessionNote,
    setEventMetadata,
    updateTaskDetails,
    updateEventDetails,
    rescheduleTask,
    rescheduleEvent,
    fetchEventsForRange,
    saveSettings,
    toggleTaskCompleted,
    deleteTask,
    deleteCalendarEvent,
    linkTaskToEvent,
    convertEventToTask,
    timeBlockTask,
    scheduleTaskAtTime,
    logSessionToCalendar,
  } = useFocusFlow(isFloating || isTaskbar);

  const handleQuickAddTask = async (
    title: string,
    taskListId?: string,
    priority: Priority = 3,
    projectId?: string,
    dueDate?: string,
    recurrence?: RecurrenceRule,
    durationMinutes?: number,
    parentId?: string
  ) => {
    const cleanRecurrence =
      recurrence && recurrence !== 'none' ? recurrence : undefined;
    if (data.googleConnected && window.electronAPI) {
      try {
        const created = await window.electronAPI.createGoogleTask(
          title,
          undefined,
          taskListId
        );
        if (dueDate && created.googleTaskId && created.googleTaskListId) {
          await window.electronAPI.updateGoogleTask(
            created.googleTaskListId,
            created.googleTaskId,
            { due: new Date(`${extractYmd(dueDate)}T00:00:00.000Z`).toISOString() }
          );
        }
        const loaded = await loadData();
        if (loaded) {
          const updated = loaded.tasks.map((t) =>
            t.id === created.id
              ? {
                  ...t,
                  priority,
                  projectId,
                  parentId: parentId || t.parentId,
                  dueDate: dueDate ?? t.dueDate,
                  recurrence: cleanRecurrence ?? t.recurrence,
                  durationMinutes: durationMinutes ?? t.durationMinutes,
                }
              : t
          );
          await saveTasks(updated);
          if (parentId) {
            await window.electronAPI.moveGoogleTask(created.id, parentId).catch(() => {});
          }
        }
        notify('Added to Google Tasks');
        return;
      } catch {
        // Fallback to local
      }
    }
    const newId = `task-${Date.now()}`;
    await saveTasks([
      {
        id: newId,
        title,
        priority,
        projectId,
        parentId: parentId || undefined,
        dueDate,
        recurrence: cleanRecurrence,
        durationMinutes,
        completed: false,
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        createdAt: new Date().toISOString(),
      },
      ...data.tasks,
    ]);
    if (parentId) {
      window.electronAPI?.moveGoogleTask(newId, parentId).catch(() => {});
    }
  };

  if (isFloating || isTaskbar) {
    return (
      <FloatingWidget
        focusStats={computeFocusSummary(
          data.sessions ?? [],
          data.settings.dailyFocusGoalMinutes ?? 120
        )}
        onSwitchMode={switchMode}
        tasks={tasks}
        events={events}
        timer={timer}
        syncing={syncingTasks || loadingEvents}
        googleConnected={data.googleConnected}
        lastSyncedAt={lastSyncedAt}
        defaultFocusMinutes={data.settings.focusMinutes || 25}
        distractionGuardEnabled={Boolean(data.settings.distractionGuardEnabled)}
        blockedCount={data.settings.blockedAppsOrSites?.length ?? 0}
        onToggleDistractionGuard={() =>
          saveSettings({
            ...data.settings,
            distractionGuardEnabled: !data.settings.distractionGuardEnabled,
          })
        }
        ambientPreset={ambientPreset}
        onCycleAmbient={handleCycleAmbient}
        onToggleTimer={toggleRunning}
        onResetTimer={resetTimer}
        onExtend5m={() => extendTimer(5)}
        onFinishStopwatch={finishStopwatch}
        onCompleteActive={completeActiveTarget}
        onRescheduleActive={rescheduleActiveTarget}
        onSync={syncAll}
        onAddTask={(title, dueDate, priority, durationMinutes) =>
          handleQuickAddTask(
            title,
            undefined,
            priority ?? 3,
            undefined,
            dueDate,
            undefined,
            durationMinutes
          )
        }
        onToggleTask={toggleTaskCompleted}
        onUpdateTask={async (taskId, patch) => {
          const target = data.tasks.find((t) => t.id === taskId);
          if (!target) return;
          const updated = data.tasks.map((t) =>
            t.id === taskId ? { ...t, ...patch } : t
          );
          await saveTasks(updated);
          if (
            data.googleConnected &&
            target.googleTaskId &&
            target.googleTaskListId &&
            window.electronAPI
          ) {
            try {
              await window.electronAPI.updateGoogleTask(
                target.googleTaskListId,
                target.googleTaskId,
                {
                  title: patch.title,
                  due: patch.dueDate
                    ? (() => {
                        const ymd = extractYmd(patch.dueDate);
                        return ymd ? `${ymd}T00:00:00.000Z` : undefined;
                      })()
                    : undefined,
                }
              );
            } catch {
              // Keep local update
            }
          }
        }}
        onDeleteTask={deleteTask}
        onConvertEventToTask={convertEventToTask}
        onStartFocus={(target) => startFocusOnTarget(target)}
      />
    );
  }

  const handleConnectGoogle = async () => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.connectGoogle();
    if (res.ok) {
      await syncAll();
      notify('Google account connected & synced!');
    } else {
      notify(res.error || 'Google sign-in failed');
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.disconnectGoogle();
    await loadData();
    await loadTodayEvents();
    notify('Disconnected Google account');
  };

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'day', label: 'Day', icon: <CalendarCheck className="w-4 h-4" /> },
    {
      id: 'projects',
      label: 'Projects',
      icon: <FolderKanban className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings className="w-4 h-4" />,
    },
  ];

  const plannerContent = (
    <PlannerView
      tasks={tasks}
      projects={data.projects}
      sessions={data.sessions}
      onToggleTask={toggleTaskCompleted}
      onDeleteTask={deleteTask}
      fetchEventsForRange={fetchEventsForRange}
      onStartFocus={(target) => {
        startFocusOnTarget(target);
        setDayMode('plan');
      }}
      onRescheduleTask={rescheduleTask}
      onRescheduleEvent={rescheduleEvent}
      onSetEventPriority={(eventId, priority) =>
        setEventMetadata(eventId, { priority })
      }
      onCreateEvent={async ({ summary, startIso, endIso, priority }) => {
        if (!window.electronAPI) return;
        const created = await window.electronAPI.createCalendarEvent({
          calendarId: data.settings.defaultWriteCalendarId || 'primary',
          summary,
          start: startIso,
          end: endIso,
        });
        await setEventMetadata(created.id, { priority });
        await loadTodayEvents();
        notify(`Created event "${summary}"`);
      }}
      onCreateTask={async ({ title, dueIso, priority, durationMinutes }) => {
        await handleQuickAddTask(
          title,
          undefined,
          priority,
          undefined,
          dueIso,
          undefined,
          durationMinutes
        );
      }}
      onTimeBlockTask={timeBlockTask}
      onScheduleTaskAtTime={scheduleTaskAtTime}
      onConvertEventToTask={convertEventToTask}
      onDeleteEvent={deleteCalendarEvent}
      onLinkTaskToEvent={linkTaskToEvent}
      onPlanMyDay={planMyDay}
      onUpdateTaskDetails={updateTaskDetails}
      onUpdateEventDetails={updateEventDetails}
    />
  );

  return (
    <div className="min-h-screen bg-surface-900 text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-surface-700 bg-surface-900/90 backdrop-blur px-6 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Timer className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">FocusFlow</span>
          </div>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-sm font-medium transition ${
                  tab === item.id
                    ? 'bg-surface-700 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-800'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          {statusMessage && (
            <span className="text-xs px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {statusMessage}
            </span>
          )}
          {data.googleConnected && (
            <button
              onClick={() =>
                (data.pendingSyncCount ?? 0) > 0 ? flushSyncQueue() : syncAll()
              }
              className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition ${
                (data.pendingSyncCount ?? 0) > 0
                  ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/25'
              }`}
              title="Auto-syncs every 2 min in the background · Click to sync now"
            >
              <RefreshCw
                className={`w-3 h-3 ${syncingTasks || loadingEvents ? 'animate-spin' : ''}`}
              />
              {(data.pendingSyncCount ?? 0) > 0
                ? `${data.pendingSyncCount} offline pending`
                : lastSyncedAt
                  ? `Synced ${formatTime(lastSyncedAt)}`
                  : 'Auto-Sync On'}
            </button>
          )}
          <button
            onClick={() => {
              setPaletteMode('commands');
              setPaletteOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 border border-surface-600 text-xs font-medium text-slate-300 transition"
            title="Command Palette, Quick Add & AI Control (Ctrl+K)"
          >
            <Command className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Ctrl+K</span>
          </button>
          <button
            onClick={() => window.electronAPI?.moveToTaskbar()}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-surface-800 hover:bg-surface-700 border border-surface-600 text-xs font-medium text-slate-200 transition"
            title="Hide dashboard to tray and open the morphing Floating Widget"
          >
            <PanelBottom className="w-4 h-4 text-indigo-400" />
            Floating Widget
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 w-full px-6 py-5 flex flex-col overflow-y-auto">
        {idleReturnPrompt && (
          <div className="mb-5 rounded-2xl bg-indigo-500/15 border border-indigo-500/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-100">
              <span className="font-semibold text-indigo-300">
                Welcome back!
              </span>{' '}
              Focus timer paused after {idleReturnPrompt.idleMinutes}m away.{' '}
              <span className="text-slate-300">
                Log {idleReturnPrompt.elapsedMinutes}m spent on &ldquo;
                {idleReturnPrompt.title}&rdquo;?
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void resolveIdleReturn('log')}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition"
              >
                Log {idleReturnPrompt.elapsedMinutes}m
              </button>
              <button
                onClick={() => void resolveIdleReturn('resume')}
                className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold transition"
              >
                Resume
              </button>
              <button
                onClick={() => void resolveIdleReturn('discard')}
                className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-slate-300 text-xs transition"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {tab === 'day' && (
          <TodayView
            tasks={tasks}
            taskLists={data.taskLists}
            projects={data.projects}
            events={events}
            sessions={data.sessions}
            dailyGoalMinutes={data.settings.dailyFocusGoalMinutes ?? 120}
            dayMode={dayMode}
            onChangeDayMode={setDayMode}
            plannerContent={plannerContent}
            onLogToCalendar={logSessionToCalendar}
            onUpdateSessionNote={updateSessionNote}
            timer={timer}
            loadingEvents={loadingEvents}
            syncingTasks={syncingTasks}
            upcomingReminder={upcomingReminder}
            onDismissUpcomingReminder={dismissUpcomingReminder}
            onSnoozeUpcomingReminder={snoozeUpcomingReminder}
            ambientPreset={ambientPreset}
            onChangeAmbient={handleSetAmbient}
            onPlanMyDay={() => planMyDay()}
            onToggleTimer={toggleRunning}
            onResetTimer={resetTimer}
            onExtendTimer={extendTimer}
            onFinishStopwatch={finishStopwatch}
            onSwitchMode={switchMode}
            onStartFocus={startFocusOnTarget}
            onCompleteActiveTarget={completeActiveTarget}
            onToggleTask={toggleTaskCompleted}
            onDeleteTask={deleteTask}
            onAddTask={handleQuickAddTask}
            templates={data.templates}
            onApplyTemplate={applyTemplate}
            onSaveAsTemplate={saveTaskAsTemplate}
            onDeleteTemplate={deleteTemplate}
            onSetTaskMetadata={setTaskMetadata}
            onMoveTask={moveTask}
            parentCompletionPrompt={parentCompletionPrompt}
            onDismissParentCompletionPrompt={dismissParentCompletionPrompt}
            onAddSubtask={addSubtask}
            onToggleSubtask={toggleSubtask}
            onDeleteSubtask={deleteSubtask}
            onSetEventMetadata={setEventMetadata}
            onUpdateTaskDetails={updateTaskDetails}
            onUpdateEventDetails={updateEventDetails}
            onRescheduleTask={rescheduleTask}
            onRescheduleEvent={rescheduleEvent}
            onTimeBlockTask={timeBlockTask}
            onLinkTaskToEvent={linkTaskToEvent}
            onConvertEventToTask={convertEventToTask}
            onDeleteEvent={deleteCalendarEvent}
            onRefreshEvents={loadTodayEvents}
            onSyncGoogleTasks={syncTasksFromGoogle}
            obsidianVaultPath={data.settings.obsidianVaultPath}
            onShutdownReview={runShutdownReview}
          />
        )}

        {tab === 'projects' && (
          <ProjectsView
            projects={data.projects}
            tasks={tasks}
            events={events}
            eventMetadata={data.eventMetadata}
            sessions={data.sessions}
            fetchEventsForRange={fetchEventsForRange}
            onSaveProjects={saveProjects}
            onSaveTasks={saveTasks}
            onToggleTask={toggleTaskCompleted}
            onDeleteTask={deleteTask}
            onMoveTask={moveTask}
            onSetTaskMetadata={setTaskMetadata}
            onSetEventMetadata={setEventMetadata}
            onUpdateTaskDetails={updateTaskDetails}
            onUpdateEventDetails={updateEventDetails}
            onLinkTaskToEvent={linkTaskToEvent}
            onConvertEventToTask={convertEventToTask}
            onDeleteEvent={deleteCalendarEvent}
            onTimeBlockTask={timeBlockTask}
            onCreateEvent={async ({ summary, startIso, endIso, priority, projectId, projectListId }) => {
              if (!window.electronAPI) return;
              const created = await window.electronAPI.createCalendarEvent({
                calendarId: data.settings.defaultWriteCalendarId || 'primary',
                summary,
                start: startIso,
                end: endIso,
              });
              await setEventMetadata(created.id, { priority, projectId, projectListId });
              await loadTodayEvents();
              notify(`Created event "${summary}"`);
            }}
            onStartFocus={(target) => {
              startFocusOnTarget(target);
              setTab('day');
              setDayMode('plan');
            }}
          />
        )}

        {tab === 'settings' && (
          <SettingsView
            settings={data.settings}
            googleConnected={data.googleConnected}
            calendars={data.calendars}
            taskLists={data.taskLists}
            pendingSyncCount={data.pendingSyncCount}
            onSaveSettings={saveSettings}
            onConnectGoogle={handleConnectGoogle}
            onDisconnectGoogle={handleDisconnectGoogle}
            onSyncAll={syncAll}
            onFlushSyncQueue={flushSyncQueue}
            onBackupImported={async () => {
              await loadData();
              await loadTodayEvents();
            }}
            onOpenAiPalette={() => {
              setPaletteMode('ai');
              setPaletteOpen(true);
            }}
          />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        initialMode={paletteMode}
        onClose={() => setPaletteOpen(false)}
        tasks={tasks}
        events={events}
        projects={data.projects}
        ambient={ambientPreset}
        tokenPath={tokenPath}
        onSelectTab={(nextTab) => setTab(nextTab)}
        onSelectDayMode={(m) => setDayMode(m)}
        onQuickAddTask={(title, priority, dueDate, durationMinutes) =>
          handleQuickAddTask(
            title,
            undefined,
            priority ?? 3,
            undefined,
            dueDate,
            undefined,
            durationMinutes
          )
        }
        onStartFocus={(target) => {
          startFocusOnTarget(target);
          setTab('day');
          setDayMode('plan');
        }}
        onToggleTimer={toggleRunning}
        onPlanMyDay={() => planMyDay()}
        onSyncAll={syncAll}
        onSetAmbient={handleSetAmbient}
      />

      <FirstRunWizard
        open={dataLoaded && !data.settings.onboardingCompleted}
        settings={data.settings}
        googleConnected={data.googleConnected}
        calendars={data.calendars}
        onConnectGoogle={handleConnectGoogle}
        onComplete={async (nextSettings) => {
          await saveSettings(nextSettings);
          if (data.googleConnected) {
            await syncAll();
          }
        }}
      />
    </div>
  );
}

export default App;
