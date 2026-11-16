export type Priority = 1 | 2 | 3 | 4 | 5;
export type TimerMode = 'focus' | 'shortBreak' | 'longBreak' | 'stopwatch';
export type RecurrenceRule = 'none' | 'daily' | 'weekdays' | 'weekly';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  description?: string;
  milestones: {
    id: string;
    title: string;
    done: boolean;
    requiredTaskIds?: string[];
  }[];
  createdAt: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  notes?: string;
  priority: Priority;
  durationMinutes?: number;
  estimatedPomodoros: number;
  projectId?: string;
  recurrence?: RecurrenceRule;
  subtasks?: string[];
  createdAt: string;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export interface GoogleTaskListInfo {
  id: string;
  title: string;
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  projectId?: string;
  priority: Priority;
  completed: boolean;
  dueDate?: string;
  estimatedPomodoros: number;
  completedPomodoros: number;
  googleTaskId?: string;
  googleTaskListId?: string;
  googleTaskListTitle?: string;
  calendarEventId?: string;
  linkedEventId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  durationMinutes?: number;
  subtasks?: Subtask[];
  recurrence?: RecurrenceRule;
  blockedByTaskIds?: string[];
  noteLink?: string;
  createdAt: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName?: string;
  calendarColor?: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  htmlLink?: string;
  linkedTaskId?: string;
  priority?: Priority;
  projectId?: string;
}

export interface PomodoroSession {
  id: string;
  title: string;
  taskId?: string;
  calendarEventId?: string;
  projectId?: string;
  mode: TimerMode;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  loggedToCalendar: boolean;
  note?: string;
}

export interface AppSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  autoLogToCalendar: boolean;
  autoCompleteTask: boolean;
  googleClientId: string;
  googleClientSecret: string;
  demoMode: boolean;
  selectedCalendarIds: string[];
  defaultTaskListId: string;
  soundOnComplete: boolean;
  notifyOnComplete: boolean;
  startWithWindows: boolean;
  globalHotkeys: boolean;
  hotkeyTimer: string;
  hotkeyQuickAdd: string;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  workStartHour: number;
  workEndHour: number;
  dailyFocusGoalMinutes: number;
  preEventReminderMinutes: number;
  defaultWriteCalendarId: string;
  distractionGuardEnabled?: boolean;
  blockedAppsOrSites?: string[];
  idlePauseMinutes?: number;
  obsidianVaultPath?: string;
  onboardingCompleted?: boolean;
}

export interface IdleReturnPrompt {
  title: string;
  elapsedMinutes: number;
  idleMinutes: number;
  taskId?: string;
}

export interface ShutdownReviewResult {
  ok: boolean;
  dryRun: boolean;
  date: string;
  tomorrow: string;
  focusMinutes: number;
  sessionsCount: number;
  completedCount: number;
  completedTasks: { id: string; title: string; completedPomodoros: number }[];
  unfinishedCount: number;
  unfinishedTasks: {
    id: string;
    title: string;
    priority: number;
    estimatedPomodoros: number;
    completedPomodoros: number;
  }[];
  rolledToTomorrow: boolean;
  obsidianNotePath?: string | null;
  obsidianError?: string | null;
  markdown: string;
}

export interface EventMetadata {
  priority?: Priority;
  projectId?: string;
}

export interface AppData {
  projects: Project[];
  tasks: TaskItem[];
  sessions: PomodoroSession[];
  settings: AppSettings;
  googleConnected: boolean;
  taskLists: GoogleTaskListInfo[];
  calendars: GoogleCalendarInfo[];
  taskEventLinks: Record<string, string>;
  eventMetadata: Record<string, EventMetadata>;
  pendingSyncCount?: number;
  lastSyncedAt?: string;
  templates?: TaskTemplate[];
}

export interface TimerState {
  mode: TimerMode;
  secondsLeft: number;
  totalSeconds: number;
  isRunning: boolean;
  targetEndTime?: number | null;
  stopwatchStartedAt?: number | null;
  stopwatchAccumulatedSecs?: number;
  completedTickId?: number;
  sessionStartedAt?: string | null;
  completedFocusCount?: number;
  activeTarget: {
    type: 'task' | 'event' | 'custom';
    id?: string;
    title: string;
    projectId?: string;
    calendarEventId?: string;
    linkedTaskId?: string;
    durationMinutes?: number;
    nextSubtask?: string;
  } | null;
}

export interface SecurityInfo {
  vaultActive: boolean;
  tokenPath: string;
  hotkeyErrors: string[];
}

export interface AiAuditEntry {
  id: number;
  time: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  canUndo: boolean;
  undone: boolean;
}

export interface ElectronAPI {
  getAppData: () => Promise<AppData>;
  saveProjects: (projects: Project[]) => Promise<void>;
  saveTasks: (tasks: TaskItem[]) => Promise<void>;
  saveTemplates: (templates: TaskTemplate[]) => Promise<void>;
  addSession: (session: PomodoroSession) => Promise<void>;
  markSessionLogged: (sessionId: string) => Promise<void>;
  updateSessionNote: (sessionId: string, note: string | null) => Promise<void>;
  exportBackupJson: () => Promise<string>;
  importBackupJson: (json: string) => Promise<void>;
  flushSyncQueue: () => Promise<{ applied: number; remaining: number }>;
  planMyDay: (
    dateKey?: string
  ) => Promise<{
    ok?: boolean;
    date?: string;
    scheduledCount: number;
    unscheduledRemainingCount?: number;
    message?: string;
  }>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  saveEventMetadata: (eventId: string, meta: EventMetadata) => Promise<void>;
  linkTaskToEvent: (taskId: string, eventId: string | null) => Promise<void>;
  toggleFloatingWindow: () => Promise<boolean>;
  openFloatingWindow: () => Promise<void>;
  closeFloatingWindow: () => Promise<void>;
  centerFloatingTop: () => Promise<void>;
  moveFloatingWindow: (
    screenX: number,
    screenY: number,
    offsetX: number,
    offsetY: number
  ) => void;
  setFloatingDragging: (dragging: boolean) => void;
  setFloatingExpanded: (expanded: boolean, extraHeight?: number) => void;
  onFloatingHover: (cb: (hovered: boolean) => void) => () => void;
  toggleTaskbarWidget: () => Promise<boolean>;
  closeTaskbarWidget: () => Promise<void>;
  moveToTaskbar: () => Promise<void>;
  setTaskbarExpanded: (expanded: boolean) => void;
  moveTaskbarHorizontal: (screenX: number, offsetX: number) => void;
  moveTaskbarWindow: (
    screenX: number,
    screenY: number,
    offsetX: number,
    offsetY: number
  ) => void;
  setTaskbarDragging: (dragging: boolean) => void;
  reportTaskbarRect?: (
    x: number,
    y: number,
    w: number,
    h: number,
    slop?: number
  ) => void;
  getTaskbarDock?: () => Promise<string | null>;
  onTaskbarDock?: (cb: (dock: string | null) => void) => () => void;
  onTaskbarHover?: (cb: (hovered: boolean) => void) => () => void;
  onTaskbarBlur: (cb: () => void) => () => void;
  onTaskbarVisibility: (cb: (visible: boolean) => void) => () => void;
  onTaskbarQuickAdd: (cb: () => void) => () => void;
  takePendingQuickAdd: () => Promise<boolean>;
  getSecurityInfo: () => Promise<SecurityInfo>;
  getAiToken: () => Promise<string>;
  regenerateAiToken: () => Promise<string>;
  getAiAudit: (limit?: number) => Promise<AiAuditEntry[]>;
  undoAiAction: (id: number) => Promise<string>;
  openExternalUrl: (url: string) => Promise<void>;
  showNotification: (title: string, body: string) => void;
  showMainWindow: () => Promise<void>;
  getTimerState: () => Promise<TimerState>;
  broadcastTimerState: (state: TimerState) => void;
  onTimerState: (cb: (state: TimerState) => void) => () => void;
  getAmbientPreset: () => Promise<string>;
  setAmbientPreset: (preset: string) => void;
  onAmbientPreset: (cb: (preset: string) => void) => () => void;
  onUpcomingEvent: (cb: (evt: CalendarEvent) => void) => () => void;
  onDistractionAlert: (cb: (msg: string) => void) => () => void;
  onIdleReturned?: (cb: (payload: IdleReturnPrompt) => void) => () => void;
  shiftFollowingBlocks?: (
    anchorEventId: string,
    delayMinutes: number
  ) => Promise<{ ok: boolean; shifted: unknown[] }>;
  shutdownReview?: (opts: {
    rollUnfinished?: boolean;
    writeObsidian?: boolean;
    dryRun?: boolean;
  }) => Promise<ShutdownReviewResult>;
  onDataUpdated: (cb: () => void) => () => void;
  notifyDataUpdated: () => void;
  connectGoogle: () => Promise<{ ok: boolean; error?: string }>;
  disconnectGoogle: () => Promise<void>;
  fetchCalendarLists: () => Promise<GoogleCalendarInfo[]>;
  fetchCalendarEvents: (timeMin: string, timeMax: string) => Promise<CalendarEvent[]>;
  createCalendarEvent: (payload: {
    calendarId?: string;
    summary: string;
    description?: string;
    start: string;
    end: string;
  }) => Promise<CalendarEvent>;
  updateCalendarEvent: (payload: {
    calendarId: string;
    eventId: string;
    summary?: string;
    start?: string;
    end?: string;
  }) => Promise<CalendarEvent>;
  deleteCalendarEvent: (calendarId: string, eventId: string) => Promise<void>;
  syncGoogleTasks: () => Promise<{ tasks: TaskItem[]; taskLists: GoogleTaskListInfo[] }>;
  createGoogleTask: (title: string, notes?: string, taskListId?: string) => Promise<TaskItem>;
  updateGoogleTask: (
    taskListId: string,
    taskId: string,
    patch: { title?: string; notes?: string; completed?: boolean; due?: string }
  ) => Promise<void>;
  deleteGoogleTask: (taskListId: string, taskId: string) => Promise<void>;
  toggleGoogleTask: (taskListId: string, taskId: string, completed: boolean) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
