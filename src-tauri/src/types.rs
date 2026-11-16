use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: String,
    pub title: String,
    pub done: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectList {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_list_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub milestones: Vec<Milestone>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lists: Vec<ProjectList>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarInfo {
    pub id: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTaskListInfo {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_list_id: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: u8,
    #[serde(default)]
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default = "default_one")]
    pub estimated_pomodoros: u32,
    #[serde(default, skip_serializing_if = "is_false")]
    pub estimate_explicit: bool,
    #[serde(default)]
    pub completed_pomodoros: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_task_list_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_task_list_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtasks: Vec<Subtask>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by_task_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_link: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTemplate {
    pub id: String,
    pub name: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u32>,
    #[serde(default = "default_one")]
    pub estimated_pomodoros: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtasks: Vec<String>,
    pub created_at: String,
}

fn default_priority() -> u8 {
    3
}

fn default_one() -> u32 {
    1
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_color: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub start: String,
    pub end: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_all_day: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSession {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub mode: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_minutes: u32,
    pub logged_to_calendar: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub focus_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub auto_log_to_calendar: bool,
    pub auto_complete_task: bool,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub demo_mode: bool,
    #[serde(default)]
    pub selected_calendar_ids: Vec<String>,
    #[serde(default = "default_task_list_id")]
    pub default_task_list_id: String,
    /// Play a sound when a focus or break session ends.
    #[serde(default = "default_true")]
    pub sound_on_complete: bool,
    /// Show a Windows notification when a focus or break session ends.
    #[serde(default = "default_true")]
    pub notify_on_complete: bool,
    /// Launch FocusFlow (hidden in the tray) when you sign in to Windows.
    #[serde(default)]
    pub start_with_windows: bool,
    /// Ctrl+Alt+P starts/pauses the timer, Ctrl+Alt+T opens quick-add.
    #[serde(default = "default_true")]
    pub global_hotkeys: bool,
    /// Key combo that starts/pauses the timer.
    #[serde(default = "default_hotkey_timer")]
    pub hotkey_timer: String,
    /// Key combo that opens quick-add.
    #[serde(default = "default_hotkey_quick_add")]
    pub hotkey_quick_add: String,
    /// Automatically start the next break after a focus block ends.
    #[serde(default)]
    pub auto_start_breaks: bool,
    /// Automatically start the next focus block after a break ends.
    #[serde(default)]
    pub auto_start_focus: bool,
    /// Working day start hour (0-23) used by Smart Day Planner & free slot finder.
    #[serde(default = "default_work_start_hour")]
    pub work_start_hour: u32,
    /// Working day end hour (1-24) used by Smart Day Planner & free slot finder.
    #[serde(default = "default_work_end_hour")]
    pub work_end_hour: u32,
    /// Daily focus goal in minutes for Timeline streak & progress bar.
    #[serde(default = "default_daily_goal_mins")]
    pub daily_focus_goal_minutes: u32,
    /// Minutes before a calendar event to fire a reminder (0 disables).
    #[serde(default = "default_pre_reminder_mins")]
    pub pre_event_reminder_minutes: u32,
    /// Target Google Calendar ID used when time-blocking or auto-logging sessions.
    #[serde(default = "default_write_calendar_id")]
    pub default_write_calendar_id: String,
    /// Enable distraction guard to detect/minimize blocked apps or sites during active focus.
    #[serde(default)]
    pub distraction_guard_enabled: bool,
    /// App/site keywords (case-insensitive) guarded while focus timer runs.
    #[serde(default)]
    pub blocked_apps_or_sites: Vec<String>,
    /// Auto-pause active focus timer after this many idle minutes (0 disables).
    #[serde(default = "default_idle_pause_mins")]
    pub idle_pause_minutes: u32,
    /// Optional Obsidian vault folder path for Shutdown Review Markdown daily notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_path: Option<String>,
    /// True once the user completes or dismisses the First-Run Setup Wizard.
    #[serde(default)]
    pub onboarding_completed: bool,
}

fn default_idle_pause_mins() -> u32 {
    5
}

fn default_true() -> bool {
    true
}

fn default_hotkey_timer() -> String {
    "Ctrl+Alt+P".to_string()
}

fn default_hotkey_quick_add() -> String {
    "Ctrl+Alt+T".to_string()
}

fn default_task_list_id() -> String {
    "@default".to_string()
}

fn default_work_start_hour() -> u32 {
    9
}

fn default_work_end_hour() -> u32 {
    18
}

fn default_daily_goal_mins() -> u32 {
    180
}

fn default_pre_reminder_mins() -> u32 {
    5
}

fn default_write_calendar_id() -> String {
    "primary".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            auto_log_to_calendar: true,
            auto_complete_task: false,
            google_client_id: String::new(),
            google_client_secret: String::new(),
            demo_mode: false,
            selected_calendar_ids: Vec::new(),
            default_task_list_id: "@default".to_string(),
            sound_on_complete: true,
            notify_on_complete: true,
            start_with_windows: false,
            global_hotkeys: true,
            hotkey_timer: default_hotkey_timer(),
            hotkey_quick_add: default_hotkey_quick_add(),
            auto_start_breaks: false,
            auto_start_focus: false,
            work_start_hour: default_work_start_hour(),
            work_end_hour: default_work_end_hour(),
            daily_focus_goal_minutes: default_daily_goal_mins(),
            pre_event_reminder_minutes: default_pre_reminder_mins(),
            default_write_calendar_id: default_write_calendar_id(),
            distraction_guard_enabled: false,
            blocked_apps_or_sites: Vec::new(),
            idle_pause_minutes: default_idle_pause_mins(),
            obsidian_vault_path: None,
            onboarding_completed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledReminder {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub fire_at: String,
    #[serde(default)]
    pub fired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "op")]
pub enum PendingSyncOp {
    CreateTask {
        local_task_id: String,
        task_list_id: String,
    },
    ToggleTask {
        task_list_id: String,
        google_task_id: String,
        completed: bool,
    },
    UpdateTask {
        task_list_id: String,
        google_task_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        notes: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        due: Option<String>,
    },
    DeleteTask {
        task_list_id: String,
        google_task_id: String,
    },
    MoveTask {
        local_task_id: String,
        task_list_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_local_task_id: Option<String>,
    },
    CreateEvent {
        local_event_id: String,
        calendar_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        linked_task_id: Option<String>,
    },
    UpdateEvent {
        calendar_id: String,
        event_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        start: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        end: Option<String>,
    },
    DeleteEvent {
        calendar_id: String,
        event_id: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_list_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleTokens {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expiry_date: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub projects: Vec<Project>,
    pub tasks: Vec<TaskItem>,
    pub sessions: Vec<PomodoroSession>,
    pub settings: AppSettings,
    pub google_connected: bool,
    #[serde(default)]
    pub task_lists: Vec<GoogleTaskListInfo>,
    #[serde(default)]
    pub calendars: Vec<GoogleCalendarInfo>,
    #[serde(default)]
    pub task_event_links: HashMap<String, String>,
    #[serde(default)]
    pub event_metadata: HashMap<String, EventMetadata>,
    #[serde(default)]
    pub pending_sync_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(default)]
    pub templates: Vec<TaskTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTarget {
    #[serde(rename = "type")]
    pub target_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_subtask: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub mode: String,
    pub seconds_left: u32,
    pub total_seconds: u32,
    pub is_running: bool,
    pub target_end_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopwatch_started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopwatch_accumulated_secs: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_tick_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_started_at: Option<String>,
    #[serde(default)]
    pub completed_focus_count: u32,
    pub active_target: Option<ActiveTarget>,
}

impl Default for TimerState {
    fn default() -> Self {
        Self {
            mode: "focus".to_string(),
            seconds_left: 25 * 60,
            total_seconds: 25 * 60,
            is_running: false,
            target_end_time: None,
            stopwatch_started_at: None,
            stopwatch_accumulated_secs: Some(0),
            completed_tick_id: Some(0),
            session_started_at: None,
            completed_focus_count: 0,
            active_target: None,
        }
    }
}
