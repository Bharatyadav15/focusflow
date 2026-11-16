import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppData,
  AppSettings,
  CalendarEvent,
  EventMetadata,
  IdleReturnPrompt,
  PomodoroSession,
  Priority,
  Project,
  RecurrenceRule,
  SnoozeMinutes,
  TaskItem,
  TaskTemplate,
  UpcomingReminder,
} from '../types';
import { useTimerController } from './useTimerController';
import { extractYmd, localOffsetToDueIso, nextRecurrenceDueIso } from '../utils/time';
import {
  canReparentTask,
  canTimeBlockTask,
  getDescendantIds,
  getEffectiveEstimatedPomodoros,
  reparentChildrenOnDelete,
} from '../utils/taskTree';

const DEFAULT_DATA: AppData = {
  projects: [],
  tasks: [],
  sessions: [],
  settings: {
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    autoLogToCalendar: true,
    autoCompleteTask: false,
    googleClientId: '',
    googleClientSecret: '',
    demoMode: false,
    selectedCalendarIds: [],
    defaultTaskListId: '@default',
    soundOnComplete: true,
    notifyOnComplete: true,
    startWithWindows: false,
    globalHotkeys: true,
    hotkeyTimer: 'Ctrl+Alt+P',
    hotkeyQuickAdd: 'Ctrl+Alt+T',
    autoStartBreaks: false,
    autoStartFocus: false,
    workStartHour: 9,
    workEndHour: 18,
    dailyFocusGoalMinutes: 180,
    preEventReminderMinutes: 5,
    defaultWriteCalendarId: 'primary',
    distractionGuardEnabled: false,
    blockedAppsOrSites: [],
    idlePauseMinutes: 5,
    obsidianVaultPath: '',
    onboardingCompleted: true,
  },
  googleConnected: false,
  taskLists: [],
  calendars: [],
  taskEventLinks: {},
  eventMetadata: {},
  pendingSyncCount: 0,
  templates: [],
};

function normalizeTitle(str: string): string {
  return str
    .toLowerCase()
    .replace(/^focus:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useFocusFlow(isFloating = false) {
  const [data, setData] = useState<AppData>(DEFAULT_DATA);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [parentCompletionPrompt, setParentCompletionPrompt] = useState<{
    parentId: string;
    parentTitle: string;
  } | null>(null);
  const [upcomingReminder, setUpcomingReminder] =
    useState<UpcomingReminder | null>(null);
  const [idleReturnPrompt, setIdleReturnPrompt] =
    useState<IdleReturnPrompt | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const notifyTimerRef = useRef<number | null>(null);
  const snoozeTimerRef = useRef<number | null>(null);
  const api = window.electronAPI;

  const notify = useCallback((msg: string) => {
    if (notifyTimerRef.current !== null) {
      window.clearTimeout(notifyTimerRef.current);
    }
    setStatusMessage(msg);
    notifyTimerRef.current = window.setTimeout(() => {
      setStatusMessage(null);
      notifyTimerRef.current = null;
    }, 4000);
  }, []);

  const loadData = useCallback(async () => {
    if (!api) return;
    const loaded = await api.getAppData();
    setData(loaded);
    setDataLoaded(true);
    if (loaded.lastSyncedAt) {
      setLastSyncedAt(loaded.lastSyncedAt);
    }
    return loaded;
  }, [api]);

  const loadTodayEvents = useCallback(async () => {
    if (!api) return;
    setLoadingEvents(true);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const evts = await api.fetchCalendarEvents(
        start.toISOString(),
        end.toISOString()
      );
      setEvents(evts);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Failed to load calendar events'
      );
    } finally {
      setLoadingEvents(false);
    }
  }, [api, notify]);

  const syncTasksFromGoogle = useCallback(async () => {
    if (!api) return;
    setSyncingTasks(true);
    try {
      const res = await api.syncGoogleTasks();
      setData((d) => ({
        ...d,
        tasks: res.tasks,
        taskLists: res.taskLists,
      }));
      setLastSyncedAt(new Date().toISOString());
      notify('Synced all Google Task lists');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Google Tasks sync failed');
    } finally {
      setSyncingTasks(false);
    }
  }, [api, notify]);

  const syncAll = useCallback(async () => {
    if (!api) return;
    await api.fetchCalendarLists().catch(() => []);
    await Promise.all([loadTodayEvents(), syncTasksFromGoogle()]);
    setLastSyncedAt(new Date().toISOString());
    await loadData();
  }, [api, loadData, loadTodayEvents, syncTasksFromGoogle]);

  useEffect(() => {
    loadData().then((loaded) => {
      if (!isFloating && loaded?.googleConnected) {
        syncAll();
      } else {
        loadTodayEvents();
      }
    });

    if (!api) return;
    api.getTimerState().then((initial) => setTimer(initial));
    const unsubTimer = api.onTimerState((incoming) => setTimer(incoming));
    const unsubUpcoming = api.onUpcomingEvent((evt) => {
      const dur = evt.isAllDay
        ? undefined
        : Math.max(
            0,
            Math.round((new Date(evt.end).getTime() - new Date(evt.start).getTime()) / 60_000)
          ) || undefined;
      setUpcomingReminder({
        kind: 'event',
        id: evt.id,
        title: evt.summary,
        startIso: evt.start,
        durationMinutes: dur,
        projectId: evt.projectId,
        event: evt,
      });
    });
    const unsubUpcomingTask = api.onUpcomingTask?.((task) => {
      if (!task.scheduledStart) return;
      setUpcomingReminder({
        kind: 'task',
        id: task.id,
        title: task.title,
        startIso: task.scheduledStart,
        durationMinutes: task.durationMinutes,
        projectId: task.projectId,
        task,
      });
    });
    const unsubSnoozed = api.onReminderSnoozed?.(({ id, title, minutes }) => {
      setUpcomingReminder((cur) => (cur && cur.id === id ? null : cur));
      notify(`Snoozed "${title}" for ${minutes}m`);
    });
    const unsubDistraction = api.onDistractionAlert((msg) => notify(msg));
    const unsubIdle = api.onIdleReturned?.((payload) =>
      setIdleReturnPrompt(payload)
    );
    const unsubData = api.onDataUpdated(() => {
      loadData();
      loadTodayEvents();
    });
    return () => {
      unsubTimer();
      unsubUpcoming();
      unsubUpcomingTask?.();
      unsubSnoozed?.();
      unsubDistraction();
      unsubIdle?.();
      unsubData();
      if (snoozeTimerRef.current !== null) {
        window.clearTimeout(snoozeTimerRef.current);
      }
    };
  }, [api, isFloating, loadData, loadTodayEvents, notify, syncAll]);

  // Note: Background Google sync runs every 120s in the Rust backend and emits `data:updated`.

  // Compute bidirectional links between Tasks and Calendar Events
  // (manual link via taskEventLinks / calendarEventId OR automatic title match)
  const { linkedTasks, linkedEvents } = useMemo(() => {
    const eventById = new Map(events.map((e) => [e.id, e]));
    const eventByNormTitle = new Map<string, CalendarEvent>();
    for (const e of events) {
      const norm = normalizeTitle(e.summary);
      if (norm && !eventByNormTitle.has(norm)) {
        eventByNormTitle.set(norm, e);
      }
    }

    const taskByLinkedEvent = new Map<string, TaskItem>();

    const enrichedTasks = data.tasks.map((t) => {
      const explicitId = data.taskEventLinks[t.id] || t.linkedEventId || t.calendarEventId;
      let matchedEvent = explicitId ? eventById.get(explicitId) : undefined;
      if (!matchedEvent) {
        matchedEvent = eventByNormTitle.get(normalizeTitle(t.title));
      }
      if (matchedEvent) {
        if (!taskByLinkedEvent.has(matchedEvent.id)) {
          taskByLinkedEvent.set(matchedEvent.id, t);
        }
        return { ...t, linkedEventId: matchedEvent.id };
      }
      return t;
    });

    const enrichedEvents = events.map((e) => {
      const matchedTask = taskByLinkedEvent.get(e.id);
      const meta = data.eventMetadata[e.id];
      return {
        ...e,
        linkedTaskId: matchedTask?.id,
        priority: meta?.priority ?? matchedTask?.priority,
        projectId: meta?.projectId ?? matchedTask?.projectId,
        projectListId: meta?.projectListId ?? matchedTask?.projectListId,
      };
    });

    return { linkedTasks: enrichedTasks, linkedEvents: enrichedEvents };
  }, [data.eventMetadata, data.taskEventLinks, data.tasks, events]);

  const {
    timer,
    setTimer,
    handleSessionComplete,
    toggleRunning,
    switchMode,
    resetTimer,
    finishStopwatch,
    extendTimer,
    startFocusOnTarget,
  } = useTimerController({
    api,
    data,
    linkedTasks,
    linkedEvents,
    isFloating,
    loadData,
    loadTodayEvents,
    notify,
  });

  const saveTasks = useCallback(
    async (tasks: TaskItem[]) => {
      const doneMap = new Map(tasks.map((t) => [t.id, t.completed]));
      setData((d) => ({
        ...d,
        tasks,
        projects: d.projects.map((p) => ({
          ...p,
          milestones: p.milestones.map((m) =>
            m.requiredTaskIds && m.requiredTaskIds.length > 0
              ? {
                  ...m,
                  done: m.requiredTaskIds.every((id) => doneMap.get(id) === true),
                }
              : m
          ),
        })),
      }));
      await api?.saveTasks(tasks);
      api?.notifyDataUpdated();
    },
    [api]
  );

  const saveProjects = useCallback(
    async (projects: Project[]) => {
      const doneMap = new Map(data.tasks.map((t) => [t.id, t.completed]));
      const synced = projects.map((p) => ({
        ...p,
        milestones: p.milestones.map((m) =>
          m.requiredTaskIds && m.requiredTaskIds.length > 0
            ? {
                ...m,
                done: m.requiredTaskIds.every((id) => doneMap.get(id) === true),
              }
            : m
        ),
      }));
      setData((d) => ({ ...d, projects: synced }));
      await api?.saveProjects(synced);
      api?.notifyDataUpdated();
    },
    [api, data.tasks]
  );

  const setTaskMetadata = useCallback(
    async (
      taskId: string,
      meta: {
        priority?: Priority;
        projectId?: string;
        projectListId?: string;
        recurrence?: RecurrenceRule;
        durationMinutes?: number;
        estimatedPomodoros?: number;
        blockedByTaskIds?: string[];
        noteLink?: string;
      }
    ) => {
      const updated = data.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...meta,
              ...(meta.estimatedPomodoros !== undefined ? { estimateExplicit: true } : {}),
            }
          : t
      );
      await saveTasks(updated);
    },
    [data.tasks, saveTasks]
  );

  const moveTask = useCallback(
    async (taskId: string, newParentId?: string | null): Promise<boolean> => {
      const check = canReparentTask(data.tasks, taskId, newParentId);
      if (!check.ok) {
        notify(check.reason);
        return false;
      }
      const nextParent = newParentId?.trim() ? newParentId.trim() : undefined;
      const updated = data.tasks.map((t) =>
        t.id === taskId ? { ...t, parentId: nextParent } : t
      );
      await saveTasks(updated);
      api?.moveGoogleTask(taskId, nextParent ?? null).catch(() => {});
      return true;
    },
    [api, data.tasks, notify, saveTasks]
  );

  const addSubtask = useCallback(
    async (taskId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const updated = data.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: [
                ...(t.subtasks ?? []),
                { id: `sub-${Date.now()}`, title: trimmed, done: false },
              ],
            }
          : t
      );
      await saveTasks(updated);
    },
    [data.tasks, saveTasks]
  );

  const toggleSubtask = useCallback(
    async (taskId: string, subtaskId: string) => {
      const updated = data.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: (t.subtasks ?? []).map((s) =>
                s.id === subtaskId ? { ...s, done: !s.done } : s
              ),
            }
          : t
      );
      await saveTasks(updated);
    },
    [data.tasks, saveTasks]
  );

  const deleteSubtask = useCallback(
    async (taskId: string, subtaskId: string) => {
      const updated = data.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              subtasks: (t.subtasks ?? []).filter((s) => s.id !== subtaskId),
            }
          : t
      );
      await saveTasks(updated);
    },
    [data.tasks, saveTasks]
  );

  const setEventMetadata = useCallback(
    async (eventId: string, meta: EventMetadata) => {
      if (!api) return;
      setData((d) => ({
        ...d,
        eventMetadata: {
          ...d.eventMetadata,
          [eventId]: { ...(d.eventMetadata[eventId] ?? {}), ...meta },
        },
      }));
      await api.saveEventMetadata(eventId, meta);
    },
    [api]
  );

  const rescheduleTask = useCallback(
    async (task: TaskItem, dueIso: string) => {
      const updated = data.tasks.map((t) =>
        t.id === task.id ? { ...t, dueDate: dueIso } : t
      );
      await saveTasks(updated);
      if (task.googleTaskId && task.googleTaskListId && api) {
        try {
          await api.updateGoogleTask(task.googleTaskListId, task.googleTaskId, {
            due: dueIso,
          });
        } catch (err) {
          notify(
            err instanceof Error ? err.message : 'Google Tasks reschedule failed'
          );
          return;
        }
      }
      notify(`Rescheduled "${task.title}"`);
    },
    [api, data.tasks, notify, saveTasks]
  );

  const rescheduleEvent = useCallback(
    async (evt: CalendarEvent, startIso: string, endIso: string) => {
      if (!api) return;
      try {
        await api.updateCalendarEvent({
          calendarId: evt.calendarId || 'primary',
          eventId: evt.id,
          start: startIso,
          end: endIso,
        });
      } catch (err) {
        notify(
          err instanceof Error ? err.message : 'Failed to reschedule event'
        );
        return;
      }
      setEvents((prev) =>
        prev.map((e) =>
          e.id === evt.id ? { ...e, start: startIso, end: endIso } : e
        )
      );
      api.notifyDataUpdated();
      notify(`Rescheduled "${evt.summary}"`);
    },
    [api, notify]
  );

  const fetchEventsForRange = useCallback(
    async (timeMin: string, timeMax: string): Promise<CalendarEvent[]> => {
      if (!api) return [];
      const fetched = await api.fetchCalendarEvents(timeMin, timeMax);
      return fetched.map((e) => {
        const meta = data.eventMetadata[e.id];
        const matchedTask = data.tasks.find(
          (t) =>
            t.linkedEventId === e.id ||
            t.calendarEventId === e.id ||
            data.taskEventLinks[t.id] === e.id
        );
        return {
          ...e,
          linkedTaskId: e.linkedTaskId ?? matchedTask?.id,
          priority: meta?.priority ?? e.priority,
          projectId: meta?.projectId ?? e.projectId ?? matchedTask?.projectId,
          projectListId:
            meta?.projectListId ?? e.projectListId ?? matchedTask?.projectListId,
        };
      });
    },
    [api, data.eventMetadata, data.taskEventLinks, data.tasks]
  );

  const updateTaskDetails = useCallback(
    async (
      taskId: string,
      patch: {
        title?: string;
        notes?: string;
        priority?: Priority;
        projectId?: string;
        projectListId?: string;
        dueDate?: string;
      }
    ) => {
      const target = data.tasks.find((t) => t.id === taskId);
      if (!target) return;
      const updated = data.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.notes !== undefined ? { notes: patch.notes || undefined } : {}),
              ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
              projectId: patch.projectId,
              projectListId: patch.projectListId,
              dueDate: patch.dueDate || undefined,
            }
          : t
      );
      await saveTasks(updated);
      if (target.googleTaskId && target.googleTaskListId && api) {
        api
          .updateGoogleTask(target.googleTaskListId, target.googleTaskId, {
            title: patch.title,
            notes: patch.notes,
            due: patch.dueDate || undefined,
          })
          .catch(() => {});
      }
      notify(`Updated "${patch.title ?? target.title}"`);
    },
    [api, data.tasks, notify, saveTasks]
  );

  const updateEventDetails = useCallback(
    async (
      evt: CalendarEvent,
      patch: {
        summary?: string;
        description?: string;
        priority?: Priority;
        projectId?: string;
        projectListId?: string;
      }
    ) => {
      if (patch.summary !== undefined && patch.summary !== evt.summary && api) {
        try {
          await api.updateCalendarEvent({
            calendarId: evt.calendarId || 'primary',
            eventId: evt.id,
            summary: patch.summary,
          });
        } catch (err) {
          notify(
            err instanceof Error ? err.message : 'Failed to update calendar event'
          );
        }
      }
      await setEventMetadata(evt.id, {
        priority: patch.priority,
        projectId: patch.projectId,
        projectListId: patch.projectListId,
      });
      setEvents((prev) =>
        prev.map((e) =>
          e.id === evt.id
            ? {
                ...e,
                ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
                ...(patch.description !== undefined
                  ? { description: patch.description || undefined }
                  : {}),
                priority: patch.priority,
                projectId: patch.projectId,
                projectListId: patch.projectListId,
              }
            : e
        )
      );
      api?.notifyDataUpdated();
      notify(`Updated "${patch.summary ?? evt.summary}"`);
    },
    [api, notify, setEventMetadata]
  );

  const saveSettings = useCallback(
    async (settings: AppSettings) => {
      setData((d) => ({ ...d, settings }));
      await api?.saveSettings(settings);
      api?.notifyDataUpdated();
      notify('Settings saved');
    },
    [api, notify]
  );

  const toggleTaskCompleted = useCallback(
    async (taskId: string, cascade = true) => {
      const target = data.tasks.find((t) => t.id === taskId);
      if (!target) return;
      const nextCompleted = !target.completed;
      if (nextCompleted && target.blockedByTaskIds?.length) {
        const blockers = data.tasks.filter(
          (t) => target.blockedByTaskIds?.includes(t.id) && !t.completed
        );
        if (blockers.length > 0) {
          notify(
            `Blocked by: ${blockers.map((b) => b.title).slice(0, 2).join(', ')}`
          );
          return;
        }
      }
      const cascadeIds =
        nextCompleted && cascade
          ? new Set(
              getDescendantIds(data.tasks, taskId).filter((did) =>
                data.tasks.some((t) => t.id === did && !t.completed)
              )
            )
          : new Set<string>();
      let updated = data.tasks.map((t) =>
        t.id === taskId || cascadeIds.has(t.id)
          ? { ...t, completed: nextCompleted }
          : t
      );

      // Prompt (without auto-completing) when the last open child of an open parent is completed.
      if (nextCompleted && target.parentId) {
        const parent = updated.find((t) => t.id === target.parentId);
        if (parent && !parent.completed) {
          const remainingOpen = updated.filter(
            (t) => t.parentId === parent.id && !t.completed
          );
          if (remainingOpen.length === 0) {
            setParentCompletionPrompt({
              parentId: parent.id,
              parentTitle: parent.title,
            });
          }
        }
      } else if (!nextCompleted && parentCompletionPrompt?.parentId === target.parentId) {
        setParentCompletionPrompt(null);
      }

      let nextDueForRecurring: string | null = null;
      let spawnedClone: TaskItem | null = null;
      if (
        nextCompleted &&
        target.recurrence &&
        target.recurrence !== 'none'
      ) {
        nextDueForRecurring = nextRecurrenceDueIso(
          target.dueDate,
          target.recurrence
        );
        const clone: TaskItem = {
          ...target,
          id: `task-${Date.now()}`,
          completed: false,
          completedPomodoros: 0,
          dueDate: nextDueForRecurring,
          googleTaskId: undefined,
          googleTaskListId: undefined,
          googleTaskListTitle: undefined,
          calendarEventId: undefined,
          linkedEventId: undefined,
          scheduledStart: undefined,
          scheduledEnd: undefined,
          subtasks: (target.subtasks ?? []).map((s) => ({ ...s, done: false })),
          createdAt: new Date().toISOString(),
        };
        spawnedClone = clone;
        updated = [clone, ...updated];
      }

      await saveTasks(updated);
      for (const cid of cascadeIds) {
        const child = data.tasks.find((t) => t.id === cid);
        if (child?.googleTaskId && child.googleTaskListId && api) {
          api.toggleGoogleTask(child.googleTaskListId, child.googleTaskId, true).catch(() => {});
        }
      }
      if (target.googleTaskId && target.googleTaskListId && api) {
        try {
          await api.toggleGoogleTask(
            target.googleTaskListId,
            target.googleTaskId,
            nextCompleted
          );
          if (spawnedClone && nextDueForRecurring) {
            const gCopy = await api.createGoogleTask(
              spawnedClone.title,
              spawnedClone.notes,
              target.googleTaskListId
            );
            if (gCopy.googleTaskId && gCopy.googleTaskListId) {
              const ymd = extractYmd(nextDueForRecurring);
              const dueIso = ymd ? `${ymd}T00:00:00.000Z` : nextDueForRecurring;
              await api
                .updateGoogleTask(gCopy.googleTaskListId, gCopy.googleTaskId, {
                  due: dueIso,
                })
                .catch(() => {});
            }
            const refreshed = [
              {
                ...spawnedClone,
                id: gCopy.id,
                googleTaskId: gCopy.googleTaskId,
                googleTaskListId: gCopy.googleTaskListId,
                googleTaskListTitle: gCopy.googleTaskListTitle,
              },
              ...updated.filter(
                (t) => t.id !== spawnedClone!.id && t.id !== gCopy.id
              ),
            ];
            await saveTasks(refreshed);
          }
        } catch (err) {
          notify(
            err instanceof Error ? err.message : 'Google Tasks sync failed'
          );
        }
      }
      if (nextDueForRecurring) {
        notify(
          `Completed "${target.title}" · scheduled next (${target.recurrence})`
        );
      }
    },
    [api, data.tasks, notify, parentCompletionPrompt?.parentId, saveTasks]
  );

  const deleteTask = useCallback(
    async (task: TaskItem) => {
      const reparentedIds = data.tasks
        .filter((t) => t.parentId === task.id)
        .map((t) => t.id);
      const updated = reparentChildrenOnDelete(data.tasks, task.id);
      await saveTasks(updated);
      for (const cid of reparentedIds) {
        api?.moveGoogleTask(cid, task.parentId ?? null).catch(() => {});
      }
      if (task.googleTaskId && task.googleTaskListId && api) {
        try {
          await api.deleteGoogleTask(task.googleTaskListId, task.googleTaskId);
        } catch (err) {
          notify(
            err instanceof Error ? err.message : 'Google Tasks delete failed'
          );
          return;
        }
      }
      notify(`Deleted "${task.title}"`);
    },
    [api, data.tasks, notify, saveTasks]
  );

  const deleteCalendarEvent = useCallback(
    async (evt: CalendarEvent) => {
      if (!api) return;
      await api.deleteCalendarEvent(evt.calendarId || 'primary', evt.id);
      setEvents((prev) => prev.filter((e) => e.id !== evt.id));
      notify(`Removed "${evt.summary}" from Calendar`);
    },
    [api, notify]
  );

  const linkTaskToEvent = useCallback(
    async (taskId: string, eventId: string | null) => {
      if (!api) return;
      await api.linkTaskToEvent(taskId, eventId);
      await loadData();
      notify(eventId ? 'Task & Calendar event linked' : 'Unlinked task & event');
    },
    [api, loadData, notify]
  );

  const convertEventToTask = useCallback(
    async (evt: CalendarEvent) => {
      if (!api) return;
      const defaultMins = data.settings.focusMinutes || 25;
      const durationMinutes = evt.isAllDay
        ? defaultMins
        : Math.max(
            1,
            Math.round(
              (new Date(evt.end).getTime() - new Date(evt.start).getTime()) /
                60_000
            )
          );
      const estimatedPomodoros = Math.max(
        1,
        Math.ceil(durationMinutes / defaultMins)
      );

      // Check if a task is already linked to this calendar event
      const existingTask = linkedTasks.find(
        (t) =>
          t.linkedEventId === evt.id ||
          t.calendarEventId === evt.id ||
          data.taskEventLinks[t.id] === evt.id
      );

      if (existingTask) {
        const updated = data.tasks.map((t) =>
          t.id === existingTask.id
            ? {
                ...t,
                durationMinutes,
                estimatedPomodoros,
                scheduledStart: evt.start,
                scheduledEnd: evt.end,
                dueDate: evt.start,
                calendarEventId: evt.id,
                linkedEventId: evt.id,
              }
            : t
        );
        await saveTasks(updated);
        await api.linkTaskToEvent(existingTask.id, evt.id);
        await loadData();
        notify(
          `Updated task "${existingTask.title}" with ${durationMinutes}m calendar timer`
        );
        return;
      }

      if (data.googleConnected) {
        try {
          const created = await api.createGoogleTask(
            evt.summary,
            evt.description
          );
          if (created.googleTaskId && created.googleTaskListId) {
            const d = new Date(evt.start);
            d.setUTCHours(0, 0, 0, 0);
            await api
              .updateGoogleTask(created.googleTaskListId, created.googleTaskId, {
                due: d.toISOString(),
              })
              .catch(() => {});
          }
          await api.linkTaskToEvent(created.id, evt.id);
          const loaded = await loadData();
          if (loaded) {
            const updated = loaded.tasks.map((t) =>
              t.id === created.id
                ? {
                    ...t,
                    priority: evt.priority ?? 3,
                    projectId: evt.projectId,
                    projectListId: evt.projectListId,
                    dueDate: evt.start,
                    scheduledStart: evt.start,
                    scheduledEnd: evt.end,
                    durationMinutes,
                    estimatedPomodoros,
                    calendarEventId: evt.id,
                    linkedEventId: evt.id,
                  }
                : t
            );
            await saveTasks(updated);
          }
          notify(
            `Turned "${evt.summary}" into a task (${durationMinutes}m timer)`
          );
          return;
        } catch {
          // Fall back to local task creation
        }
      }

      const newTask: TaskItem = {
        id: `task-${Date.now()}`,
        title: evt.summary,
        notes: evt.description,
        priority: evt.priority ?? 3,
        projectId: evt.projectId,
        projectListId: evt.projectListId,
        completed: false,
        dueDate: evt.start,
        scheduledStart: evt.start,
        scheduledEnd: evt.end,
        durationMinutes,
        estimatedPomodoros,
        completedPomodoros: 0,
        calendarEventId: evt.id,
        linkedEventId: evt.id,
        createdAt: new Date().toISOString(),
      };

      await api.linkTaskToEvent(newTask.id, evt.id);
      await saveTasks([newTask, ...data.tasks]);
      await loadData();
      notify(`Turned "${evt.summary}" into a task (${durationMinutes}m timer)`);
    },
    [
      api,
      data.googleConnected,
      data.settings.focusMinutes,
      data.taskEventLinks,
      data.tasks,
      linkedTasks,
      loadData,
      notify,
      saveTasks,
    ]
  );

  const timeBlockTask = useCallback(
    async (task: TaskItem, targetDateKey?: string) => {
      if (!api) return;
      const effEst = getEffectiveEstimatedPomodoros(data.tasks, task.id);
      const durationMins =
        task.durationMinutes && task.durationMinutes > 0
          ? task.durationMinutes
          : Math.max(1, effEst) * data.settings.focusMinutes;
      const durationMs = durationMins * 60_000;

      const preCheck = canTimeBlockTask(data.tasks, task.id);
      if (!preCheck.ok) {
        notify(preCheck.reason);
        return;
      }

      const now = new Date();
      const baseDate = targetDateKey
        ? new Date(`${targetDateKey}T09:00:00`)
        : new Date(now);

      const isToday =
        baseDate.getFullYear() === now.getFullYear() &&
        baseDate.getMonth() === now.getMonth() &&
        baseDate.getDate() === now.getDate();

      let candidateStart = new Date(baseDate);
      if (isToday) {
        const rounded = new Date(now);
        rounded.setMinutes(Math.ceil(rounded.getMinutes() / 15) * 15, 0, 0);
        const nineAm = new Date(now);
        nineAm.setHours(9, 0, 0, 0);
        candidateStart = rounded > nineAm ? rounded : nineAm;
      } else {
        candidateStart.setHours(9, 0, 0, 0);
      }

      // Fetch that day's events to find the first free conflict-free gap
      const dayStart = new Date(baseDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(baseDate);
      dayEnd.setHours(23, 59, 59, 999);

      const dayEvents = isToday
        ? events
        : await api
            .fetchCalendarEvents(dayStart.toISOString(), dayEnd.toISOString())
            .catch(() => []);

      const timedIntervals = dayEvents
        .filter((e) => !e.isAllDay)
        .map((e) => ({
          start: new Date(e.start).getTime(),
          end: new Date(e.end).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      let cursorMs = candidateStart.getTime();
      for (const interval of timedIntervals) {
        if (cursorMs + durationMs <= interval.start) {
          break; // Fits before this event!
        }
        if (cursorMs < interval.end) {
          cursorMs = interval.end;
        }
      }

      const start = new Date(cursorMs);
      const end = new Date(cursorMs + durationMs);

      const created = await api.createCalendarEvent({
        calendarId: data.settings.defaultWriteCalendarId || 'primary',
        summary: task.title,
        description: task.notes || 'Time-blocked from FocusFlow',
        start: start.toISOString(),
        end: end.toISOString(),
      });

      if (isToday) {
        setEvents((prev) => [...prev, { ...created, linkedTaskId: task.id }]);
      }
      await api.linkTaskToEvent(task.id, created.id);
      const updatedTasks = data.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              calendarEventId: created.id,
              linkedEventId: created.id,
              scheduledStart: created.start,
              scheduledEnd: created.end,
            }
          : t
      );
      await saveTasks(updatedTasks);
      const timeLabel = start.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      notify(`Scheduled "${task.title}" at ${timeLabel} (${durationMins}m)`);
    },
    [
      api,
      data.settings.defaultWriteCalendarId,
      data.settings.focusMinutes,
      data.tasks,
      events,
      notify,
      saveTasks,
    ]
  );

  const scheduleTaskAtTime = useCallback(
    async (
      task: TaskItem,
      targetDateKey: string,
      hour: number,
      minute = 0
    ) => {
      if (!api) return;
      const effEst = getEffectiveEstimatedPomodoros(data.tasks, task.id);
      const durationMins =
        task.durationMinutes && task.durationMinutes > 0
          ? task.durationMinutes
          : Math.max(1, effEst) * data.settings.focusMinutes;
      const [y, m, d] = targetDateKey.split('-').map(Number);
      const start = new Date(y, (m || 1) - 1, d || 1, hour, minute, 0, 0);
      const end = new Date(start.getTime() + durationMins * 60_000);
      const check = canTimeBlockTask(
        data.tasks,
        task.id,
        start.toISOString(),
        end.toISOString()
      );
      if (!check.ok) {
        notify(check.reason);
        return;
      }

      const created = await api.createCalendarEvent({
        calendarId: data.settings.defaultWriteCalendarId || 'primary',
        summary: task.title,
        description: task.notes || 'Time-blocked from FocusFlow',
        start: start.toISOString(),
        end: end.toISOString(),
      });

      const now = new Date();
      if (
        start.getFullYear() === now.getFullYear() &&
        start.getMonth() === now.getMonth() &&
        start.getDate() === now.getDate()
      ) {
        setEvents((prev) => [...prev, { ...created, linkedTaskId: task.id }]);
      }
      await api.linkTaskToEvent(task.id, created.id);
      const updatedTasks = data.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              calendarEventId: created.id,
              linkedEventId: created.id,
              scheduledStart: created.start,
              scheduledEnd: created.end,
            }
          : t
      );
      await saveTasks(updatedTasks);
      notify(
        `Scheduled "${task.title}" at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${durationMins}m)`
      );
    },
    [
      api,
      data.settings.defaultWriteCalendarId,
      data.settings.focusMinutes,
      data.tasks,
      notify,
      saveTasks,
    ]
  );

  const snoozeUpcomingReminder = useCallback(
    (minutes: SnoozeMinutes) => {
      const item = upcomingReminder;
      if (!item) return;
      if (snoozeTimerRef.current !== null) {
        window.clearTimeout(snoozeTimerRef.current);
      }
      setUpcomingReminder(null);
      const delayMs = minutes * 60_000;
      notify(`Snoozed "${item.title}" for ${minutes}m`);
      snoozeTimerRef.current = window.setTimeout(() => {
        setUpcomingReminder(item);
        api?.showNotification(
          item.kind === 'task' ? 'Upcoming Task' : 'Upcoming Event',
          item.title
        );
        snoozeTimerRef.current = null;
      }, delayMs);
    },
    [api, notify, upcomingReminder]
  );

  const logSessionToCalendar = useCallback(
    async (session: PomodoroSession) => {
      if (!api || session.loggedToCalendar) return;
      await api.createCalendarEvent({
        calendarId: data.settings.defaultWriteCalendarId || 'primary',
        summary: `Focus: ${session.title}`,
        description: `Completed ${session.durationMinutes}m Pomodoro`,
        start: session.startedAt,
        end: session.endedAt,
      });
      await api.markSessionLogged(session.id);
      setData((d) => ({
        ...d,
        sessions: d.sessions.map((s) =>
          s.id === session.id ? { ...s, loggedToCalendar: true } : s
        ),
      }));
      api.notifyDataUpdated();
      await loadTodayEvents();
      notify(`Logged "${session.title}" to Calendar`);
    },
    [api, data.settings.defaultWriteCalendarId, loadTodayEvents, notify]
  );

  const updateSessionNote = useCallback(
    async (sessionId: string, note: string) => {
      if (!api) return;
      const trimmed = note.trim();
      setData((d) => ({
        ...d,
        sessions: d.sessions.map((s) =>
          s.id === sessionId ? { ...s, note: trimmed || undefined } : s
        ),
      }));
      await api.updateSessionNote(sessionId, trimmed || null);
      notify('Session note saved');
    },
    [api, notify]
  );

  const flushSyncQueue = useCallback(async () => {
    if (!api) return;
    const res = await api.flushSyncQueue();
    await loadData();
    await loadTodayEvents();
    notify(
      `Synced ${res.applied} queued change(s)` +
        (res.remaining > 0 ? ` (${res.remaining} pending)` : '')
    );
  }, [api, loadData, loadTodayEvents, notify]);

  const planMyDay = useCallback(
    async (dateKey?: string) => {
      if (!api) return;
      const res = await api.planMyDay(dateKey);
      await loadData();
      await loadTodayEvents();
      notify(res.message || `Auto-planned ${res.scheduledCount} task(s)`);
    },
    [api, loadData, loadTodayEvents, notify]
  );

  const completeActiveTarget = useCallback(async () => {
    const target = timer.activeTarget;
    if (!target) return;
    const taskId = target.type === 'task' ? target.id : target.linkedTaskId;
    if (taskId) {
      const task = data.tasks.find((t) => t.id === taskId);
      if (task && !task.completed) {
        await toggleTaskCompleted(task.id);
      }
    }
    const elapsedSecs =
      timer.mode === 'stopwatch'
        ? timer.secondsLeft
        : timer.totalSeconds - timer.secondsLeft;
    if (elapsedSecs >= 60) {
      await handleSessionComplete({
        ...timer,
        totalSeconds: elapsedSecs,
        secondsLeft: 0,
        isRunning: false,
      });
    }
    resetTimer();
    api?.notifyDataUpdated();
  }, [
    api,
    data.tasks,
    handleSessionComplete,
    resetTimer,
    timer,
    toggleTaskCompleted,
  ]);

  const rescheduleActiveTarget = useCallback(
    async (preset: 'plus1h' | 'tomorrow' | 'plus7d') => {
      const target = timer.activeTarget;
      if (!target || !api) return;

      const now = new Date();
      if (target.type === 'event' && target.id) {
        const durationMs =
          (target.durationMinutes && target.durationMinutes > 0
            ? target.durationMinutes
            : data.settings.focusMinutes) * 60_000;
        const start = new Date(now);
        if (preset === 'plus1h') {
          start.setTime(now.getTime() + 60 * 60_000);
        } else if (preset === 'tomorrow') {
          start.setDate(now.getDate() + 1);
          start.setHours(10, 0, 0, 0);
        } else {
          start.setDate(now.getDate() + 7);
          start.setHours(10, 0, 0, 0);
        }
        const end = new Date(start.getTime() + durationMs);
        await api
          .updateCalendarEvent({
            calendarId: data.settings.defaultWriteCalendarId || 'primary',
            eventId: target.id,
            start: start.toISOString(),
            end: end.toISOString(),
          })
          .catch(() => {});
        resetTimer();
        api.notifyDataUpdated();
        return;
      }

      const taskId = target.type === 'task' ? target.id : target.linkedTaskId;
      if (taskId) {
        const task = data.tasks.find((t) => t.id === taskId);
        if (task) {
          const offset =
            preset === 'tomorrow' ? 1 : preset === 'plus7d' ? 7 : 0;
          await rescheduleTask(task, localOffsetToDueIso(offset));
          resetTimer();
          api.notifyDataUpdated();
        }
      }
    },
    [
      api,
      data.settings.focusMinutes,
      data.tasks,
      rescheduleTask,
      resetTimer,
      timer.activeTarget,
    ]
  );

  const saveTemplates = useCallback(
    async (templates: TaskTemplate[]) => {
      setData((d) => ({ ...d, templates }));
      await api?.saveTemplates(templates);
      api?.notifyDataUpdated();
    },
    [api]
  );

  const applyTemplate = useCallback(
    async (tpl: TaskTemplate) => {
      const nowIso = new Date().toISOString();
      const newTask: TaskItem = {
        id: `task-${Date.now()}`,
        title: tpl.title,
        notes: tpl.notes,
        projectId: tpl.projectId,
        priority: tpl.priority,
        completed: false,
        dueDate: localOffsetToDueIso(0),
        estimatedPomodoros: Math.max(1, tpl.estimatedPomodoros),
        completedPomodoros: 0,
        durationMinutes: tpl.durationMinutes,
        recurrence: tpl.recurrence,
        subtasks: (tpl.subtasks ?? []).map((st, idx) => ({
          id: `sub-${Date.now()}-${idx}`,
          title: st,
          done: false,
        })),
        createdAt: nowIso,
      };
      await saveTasks([newTask, ...data.tasks]);
      notify(`Applied template "${tpl.name}"`);
    },
    [data.tasks, notify, saveTasks]
  );

  const saveTaskAsTemplate = useCallback(
    async (task: TaskItem) => {
      const tpl: TaskTemplate = {
        id: `tpl-${Date.now()}`,
        name: task.title,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        durationMinutes: task.durationMinutes,
        estimatedPomodoros: task.estimatedPomodoros,
        projectId: task.projectId,
        recurrence: task.recurrence,
        subtasks: (task.subtasks ?? []).map((s) => s.title),
        createdAt: new Date().toISOString(),
      };
      await saveTemplates([...(data.templates ?? []), tpl]);
      notify(`Saved template "${tpl.name}"`);
    },
    [data.templates, notify, saveTemplates]
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      const next = (data.templates ?? []).filter((t) => t.id !== templateId);
      await saveTemplates(next);
      notify('Removed template');
    },
    [data.templates, notify, saveTemplates]
  );

  const resolveIdleReturn = useCallback(
    async (action: 'log' | 'resume' | 'discard') => {
      const prompt = idleReturnPrompt;
      setIdleReturnPrompt(null);
      if (!prompt) return;

      if (action === 'resume') {
        if (!timer.isRunning) toggleRunning();
        return;
      }
      if (action === 'log') {
        const secs = Math.max(60, prompt.elapsedMinutes * 60);
        await handleSessionComplete({
          ...timer,
          totalSeconds: secs,
          secondsLeft: 0,
          isRunning: false,
        });
        resetTimer();
        notify(`Logged ${prompt.elapsedMinutes}m from "${prompt.title}"`);
        return;
      }
      resetTimer();
      notify('Discarded paused idle focus block');
    },
    [
      handleSessionComplete,
      idleReturnPrompt,
      notify,
      resetTimer,
      timer,
      toggleRunning,
    ]
  );

  const runShutdownReview = useCallback(
    async (opts: {
      rollUnfinished?: boolean;
      writeObsidian?: boolean;
      dryRun?: boolean;
    }) => {
      if (!api?.shutdownReview) {
        throw new Error('Shutdown review requires desktop mode');
      }
      const res = await api.shutdownReview(opts);
      if (opts.rollUnfinished && !opts.dryRun) {
        await loadData();
        notify(`Rolled ${res.unfinishedCount} task(s) to ${res.tomorrow}`);
      }
      return res;
    },
    [api, loadData, notify]
  );

  return {
    data,
    dataLoaded,
    tasks: linkedTasks,
    events: linkedEvents,
    timer,
    loadingEvents,
    syncingTasks,
    statusMessage,
    lastSyncedAt,
    upcomingReminder,
    dismissUpcomingReminder: () => setUpcomingReminder(null),
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
    saveTemplates,
    applyTemplate,
    saveTaskAsTemplate,
    deleteTemplate,
    setTaskMetadata,
    moveTask,
    parentCompletionPrompt,
    dismissParentCompletionPrompt: () => setParentCompletionPrompt(null),
    addSubtask,
    toggleSubtask,
    deleteSubtask,
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
    updateSessionNote,
  };
}
