import type {
  AiAuditEntry,
  AppData,
  AppSettings,
  CalendarEvent,
  ElectronAPI,
  EventMetadata,
  GoogleCalendarInfo,
  GoogleTaskListInfo,
  IdleReturnPrompt,
  PomodoroSession,
  Project,
  SecurityInfo,
  ShutdownReviewResult,
  TaskItem,
  TaskTemplate,
  TimerState,
} from './types';

interface TauriGlobal {
  core: {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event: {
    listen: <T = unknown>(
      event: string,
      handler: (evt: { payload: T }) => void
    ) => Promise<() => void>;
  };
}

interface TauriInternals {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  metadata?: {
    currentWindow?: {
      label?: string;
    };
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: TauriInternals;
    __FOCUSFLOW_WINDOW__?: string;
  }
}

export function initTauriBridgeIfNeeded() {
  if (window.electronAPI) {
    return;
  }
  if (!window.__TAURI__ && !window.__TAURI_INTERNALS__) {
    return;
  }

  const invoke = <T = unknown>(
    cmd: string,
    args?: Record<string, unknown>
  ): Promise<T> => {
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke<T>(cmd, args);
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
      return window.__TAURI_INTERNALS__.invoke<T>(cmd, args);
    }
    return Promise.reject(new Error('Tauri IPC not available'));
  };

  function subscribeEvent<T>(
    eventName: string,
    cb: (payload: T) => void
  ): () => void {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const listenFn = window.__TAURI__?.event?.listen;
    if (listenFn) {
      listenFn<T>(eventName, (evt) => {
        if (!cancelled) {
          cb(evt.payload);
        }
      }).then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    }

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }

  const tauriApi: ElectronAPI = {
    getAppData: () => invoke<AppData>('store_get_app_data'),
    saveProjects: (projects: Project[]) =>
      invoke<void>('store_save_projects', { projects }),
    saveTasks: (tasks: TaskItem[]) => invoke<void>('store_save_tasks', { tasks }),
    saveTemplates: (templates: TaskTemplate[]) =>
      invoke<void>('store_save_templates', { templates }),
    addSession: (session: PomodoroSession) =>
      invoke<void>('store_add_session', { session }),
    markSessionLogged: (sessionId: string) =>
      invoke<void>('store_mark_session_logged', { sessionId }),
    updateSessionNote: (sessionId: string, note: string | null) =>
      invoke<void>('store_update_session_note', { sessionId, note }),
    exportBackupJson: () => invoke<string>('store_export_backup'),
    importBackupJson: (json: string) =>
      invoke<void>('store_import_backup', { json }),
    flushSyncQueue: () =>
      invoke<{ applied: number; remaining: number }>('google_flush_sync_queue'),
    planMyDay: (dateKey?: string) =>
      invoke<{
        ok?: boolean;
        date?: string;
        scheduledCount: number;
        unscheduledRemainingCount?: number;
        message?: string;
      }>('planner_plan_my_day', { dateKey }),
    saveSettings: (settings: AppSettings) =>
      invoke<void>('store_save_settings', { settings }),
    saveEventMetadata: (eventId: string, meta: EventMetadata) =>
      invoke<void>('store_save_event_metadata', { eventId, meta }),
    linkTaskToEvent: (taskId: string, eventId: string | null) =>
      invoke<void>('store_link_task_to_event', { taskId, eventId }),

    toggleFloatingWindow: () => invoke<boolean>('window_toggle_floating'),
    openFloatingWindow: () => invoke<void>('window_open_floating'),
    closeFloatingWindow: () => invoke<void>('window_close_floating'),
    centerFloatingTop: () => invoke<void>('floating_center_top'),
    moveFloatingWindow: (
      screenX: number,
      screenY: number,
      offsetX: number,
      offsetY: number
    ) => {
      void invoke('floating_move_position', {
        screenX,
        screenY,
        offsetX,
        offsetY,
      });
    },
    setFloatingDragging: (dragging: boolean) => {
      void invoke('floating_set_dragging', { dragging });
    },
    setFloatingExpanded: (expanded: boolean, extraHeight?: number) => {
      void invoke('window_set_floating_expanded', { expanded, extraHeight });
    },
    onFloatingHover: (cb: (hovered: boolean) => void) =>
      subscribeEvent<boolean>('floating:hover', cb),

    toggleTaskbarWidget: () => invoke<boolean>('window_toggle_taskbar_widget'),
    closeTaskbarWidget: () => invoke<void>('window_close_taskbar_widget'),
    moveToTaskbar: () => invoke<void>('window_move_to_taskbar'),
    setTaskbarExpanded: (expanded: boolean) => {
      void invoke('taskbar_set_expanded', { expanded });
    },
    moveTaskbarHorizontal: (screenX: number, offsetX: number) => {
      void invoke('taskbar_move_horizontal', { screenX, offsetX });
    },
    moveTaskbarWindow: (
      screenX: number,
      screenY: number,
      offsetX: number,
      offsetY: number
    ) => {
      void invoke('taskbar_move_position', {
        screenX,
        screenY,
        offsetX,
        offsetY,
      });
    },
    setTaskbarDragging: (dragging: boolean) => {
      void invoke('taskbar_set_dragging', { dragging });
    },
    reportTaskbarRect: (
      x: number,
      y: number,
      w: number,
      h: number,
      slop?: number
    ) => {
      void invoke('taskbar_report_rect', { x, y, w, h, slop });
    },
    getTaskbarDock: () => invoke<string | null>('taskbar_get_dock'),
    onTaskbarDock: (cb: (dock: string | null) => void) =>
      subscribeEvent<string | null>('taskbar:dock', cb),
    onTaskbarHover: (cb: (hovered: boolean) => void) =>
      subscribeEvent<boolean>('taskbar:hover', cb),
    onTaskbarBlur: (cb: () => void) =>
      subscribeEvent<unknown>('taskbar:blur', () => cb()),
    onTaskbarVisibility: (cb: (visible: boolean) => void) =>
      subscribeEvent<boolean>('taskbar:visibility', cb),
    onTaskbarQuickAdd: (cb: () => void) =>
      subscribeEvent<unknown>('taskbar:quick-add', () => cb()),
    takePendingQuickAdd: () => invoke<boolean>('taskbar_take_pending_quick_add'),
    getSecurityInfo: () => invoke<SecurityInfo>('app_security_info'),
    getAiToken: () => invoke<string>('ai_get_token'),
    regenerateAiToken: () => invoke<string>('ai_regenerate_token'),
    getAiAudit: (limit?: number) =>
      invoke<AiAuditEntry[]>('ai_get_audit', { limit }),
    undoAiAction: (id: number) => invoke<string>('ai_undo', { id }),
    openExternalUrl: (url: string) =>
      invoke<void>('app_open_external', { url }),

    showNotification: (title: string, body: string) => {
      void invoke('app_notify', { title, body }).catch(() => {
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
          }
        } catch {
          // Ignore
        }
      });
    },
    showMainWindow: () => invoke<void>('window_show_main'),

    getTimerState: () => invoke<TimerState>('timer_get'),
    broadcastTimerState: (state: TimerState) => {
      void invoke('timer_update', { timerState: state });
    },
    onTimerState: (cb: (state: TimerState) => void) =>
      subscribeEvent<TimerState>('timer:sync', cb),
    getAmbientPreset: () => invoke<string>('ambient_get'),
    setAmbientPreset: (preset: string) => {
      void invoke('ambient_set', { preset });
    },
    onAmbientPreset: (cb: (preset: string) => void) =>
      subscribeEvent<string>('ambient:sync', cb),
    onUpcomingEvent: (cb: (evt: CalendarEvent) => void) =>
      subscribeEvent<CalendarEvent>('event:upcoming', cb),
    onUpcomingTask: (cb: (task: TaskItem) => void) =>
      subscribeEvent<TaskItem>('task:upcoming', cb),
    onReminderSnoozed: (
      cb: (payload: { kind: string; id: string; title: string; minutes: number }) => void
    ) =>
      subscribeEvent<{ kind: string; id: string; title: string; minutes: number }>(
        'reminder:snoozed',
        cb
      ),
    onDistractionAlert: (cb: (msg: string) => void) =>
      subscribeEvent<string>('distraction:alert', cb),
    onIdleReturned: (cb: (payload: IdleReturnPrompt) => void) =>
      subscribeEvent<IdleReturnPrompt>('idle:returned', cb),
    shiftFollowingBlocks: (anchorEventId: string, delayMinutes: number) =>
      invoke<{ ok: boolean; shifted: unknown[] }>('planner_shift_following_blocks', {
        anchorEventId,
        delayMinutes,
      }),
    shutdownReview: (opts: {
      rollUnfinished?: boolean;
      writeObsidian?: boolean;
      dryRun?: boolean;
    }) =>
      invoke<ShutdownReviewResult>('planner_shutdown_review', {
        rollUnfinished: Boolean(opts.rollUnfinished),
        writeObsidian: Boolean(opts.writeObsidian),
        dryRun: Boolean(opts.dryRun),
      }),
    onDataUpdated: (cb: () => void) =>
      subscribeEvent<unknown>('data:updated', () => cb()),
    notifyDataUpdated: () => {
      void invoke('data_notify_updated');
    },

    connectGoogle: () =>
      invoke<{ ok: boolean; error?: string }>('google_connect'),
    disconnectGoogle: () => invoke<void>('google_disconnect'),
    fetchCalendarLists: () =>
      invoke<GoogleCalendarInfo[]>('google_fetch_calendar_lists'),
    fetchCalendarEvents: (timeMin: string, timeMax: string) =>
      invoke<CalendarEvent[]>('google_fetch_events', { timeMin, timeMax }),
    createCalendarEvent: (payload) =>
      invoke<CalendarEvent>('google_create_event', { payload }),
    updateCalendarEvent: (payload) =>
      invoke<CalendarEvent>('google_update_event', { payload }),
    deleteCalendarEvent: (calendarId: string, eventId: string) =>
      invoke<void>('google_delete_event', { calendarId, eventId }),
    syncGoogleTasks: () =>
      invoke<{ tasks: TaskItem[]; taskLists: GoogleTaskListInfo[] }>(
        'google_sync_tasks'
      ),
    createGoogleTask: (title: string, notes?: string, taskListId?: string) =>
      invoke<TaskItem>('google_create_task', { title, notes, taskListId }),
    updateGoogleTask: (taskListId: string, taskId: string, patch) =>
      invoke<void>('google_update_task', { taskListId, taskId, patch }),
    deleteGoogleTask: (taskListId: string, taskId: string) =>
      invoke<void>('google_delete_task', { taskListId, taskId }),
    toggleGoogleTask: (
      taskListId: string,
      taskId: string,
      completed: boolean
    ) => invoke<void>('google_toggle_task', { taskListId, taskId, completed }),
    moveGoogleTask: (localTaskId: string, parentLocalTaskId?: string | null) =>
      invoke<void>('google_move_task', {
        localTaskId,
        parentLocalTaskId: parentLocalTaskId ?? null,
      }),
  };

  window.electronAPI = tauriApi;
}
