use crate::types::{
    AppData, AppSettings, CalendarEvent, EventMetadata, GoogleCalendarInfo, GoogleTaskListInfo,
    GoogleTokens, PendingSyncOp, PomodoroSession, Project, ScheduledReminder, TaskItem,
    TaskTemplate,
};
use chrono::{TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredState {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub tasks: Vec<TaskItem>,
    #[serde(default)]
    pub local_events: Vec<CalendarEvent>,
    #[serde(default)]
    pub sessions: Vec<PomodoroSession>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub google_tokens: Option<GoogleTokens>,
    #[serde(default)]
    pub task_lists: Vec<GoogleTaskListInfo>,
    #[serde(default)]
    pub calendars: Vec<GoogleCalendarInfo>,
    #[serde(default)]
    pub task_event_links: HashMap<String, String>,
    #[serde(default)]
    pub event_metadata: HashMap<String, EventMetadata>,
    #[serde(default)]
    pub taskbar_pos: Option<(f64, f64)>,
    #[serde(default)]
    pub taskbar_dock: Option<String>,
    #[serde(default)]
    pub floating_pos: Option<(f64, f64)>,
    #[serde(default)]
    pub pending_sync_ops: Vec<PendingSyncOp>,
    #[serde(default)]
    pub templates: Vec<TaskTemplate>,
    #[serde(default)]
    pub reminders: Vec<ScheduledReminder>,
}

pub fn default_demo_events_for_today() -> Vec<CalendarEvent> {
    let now = chrono::Local::now();
    let make_iso = |hour: u32, min: u32| -> String {
        now.date_naive()
            .and_hms_opt(hour, min, 0)
            .and_then(|ndt| chrono::Local.from_local_datetime(&ndt).single())
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| Utc::now().to_rfc3339())
    };

    let base_hour = now.hour();
    let h1 = (base_hour + 1).min(21);
    let h2 = (base_hour + 3).min(22);

    vec![
        CalendarEvent {
            id: "demo-evt-1".to_string(),
            calendar_id: "primary".to_string(),
            calendar_name: Some("FocusFlow Demo".to_string()),
            calendar_color: Some("#6366f1".to_string()),
            summary: "Deep Work: Architecture & Sprint Review".to_string(),
            description: Some("Sample calendar block — click 'To Task' or 'Focus' to test!".to_string()),
            start: make_iso(h1, 0),
            end: make_iso(h1, 45),
            is_all_day: Some(false),
            html_link: None,
            linked_task_id: None,
            priority: Some(1),
            project_id: None,
            project_list_id: None,
        },
        CalendarEvent {
            id: "demo-evt-2".to_string(),
            calendar_id: "primary".to_string(),
            calendar_name: Some("FocusFlow Demo".to_string()),
            calendar_color: Some("#10b981".to_string()),
            summary: "Product Design Sync".to_string(),
            description: Some("Review floating icon & tray menu workflow".to_string()),
            start: make_iso(h2, 0),
            end: make_iso((h2 + 1).min(23), 0),
            is_all_day: Some(false),
            html_link: None,
            linked_task_id: None,
            priority: Some(2),
            project_id: None,
            project_list_id: None,
        },
    ]
}

impl Default for StoredState {
    fn default() -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            projects: Vec::new(),
            tasks: Vec::new(),
            local_events: Vec::new(),
            sessions: Vec::new(),
            settings: AppSettings::default(),
            google_tokens: None,
            task_lists: Vec::new(),
            calendars: Vec::new(),
            task_event_links: HashMap::new(),
            event_metadata: HashMap::new(),
            taskbar_pos: None,
            taskbar_dock: None,
            floating_pos: None,
            pending_sync_ops: Vec::new(),
            reminders: Vec::new(),
            templates: vec![
                TaskTemplate {
                    id: "tpl-deep-work".to_string(),
                    name: "Deep Work Sprint".to_string(),
                    title: "Deep Work Session".to_string(),
                    notes: Some("Uninterrupted focus block".to_string()),
                    priority: 1,
                    duration_minutes: Some(50),
                    estimated_pomodoros: 2,
                    project_id: None,
                    recurrence: None,
                    subtasks: vec![
                        "Define crisp deliverable".to_string(),
                        "Silence notifications & complete core work".to_string(),
                        "Write quick session wrap-up note".to_string(),
                    ],
                    created_at: now.clone(),
                },
                TaskTemplate {
                    id: "tpl-weekly-review".to_string(),
                    name: "Weekly Review".to_string(),
                    title: "Weekly Review & Planning".to_string(),
                    notes: Some("Clean up inbox, review completed pomodoros, plan next week".to_string()),
                    priority: 2,
                    duration_minutes: Some(30),
                    estimated_pomodoros: 1,
                    project_id: None,
                    recurrence: Some("weekly".to_string()),
                    subtasks: vec![
                        "Clear overdue tasks".to_string(),
                        "Review weekly project hours".to_string(),
                    ],
                    created_at: now,
                },
            ],
        }
    }
}


// ---------- Windows Credential Manager ("vault") for secrets ----------

const VAULT_TOKENS: &str = "google_tokens";
const VAULT_SECRET: &str = "google_client_secret";

fn vault_service() -> String {
    std::env::var("FOCUSFLOW_VAULT_SERVICE").unwrap_or_else(|_| "FocusFlow".to_string())
}

fn vault_get(name: &str) -> Result<Option<String>, ()> {
    let entry = keyring::Entry::new(&vault_service(), name).map_err(|_| ())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(()),
    }
}

/// Saves a value and reads it back to be sure it really landed.
fn vault_set(name: &str, value: &str) -> Result<(), ()> {
    let entry = keyring::Entry::new(&vault_service(), name).map_err(|_| ())?;
    entry.set_password(value).map_err(|_| ())?;
    match entry.get_password() {
        Ok(back) if back == value => Ok(()),
        _ => Err(()),
    }
}

fn vault_delete(name: &str) -> Result<(), ()> {
    let entry = keyring::Entry::new(&vault_service(), name).map_err(|_| ())?;
    match entry.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(()),
    }
}

/// Copy of the state with secrets removed, for writing to disk.
fn sanitized(state: &StoredState) -> StoredState {
    let mut c = state.clone();
    c.google_tokens = None;
    c.settings.google_client_secret = String::new();
    c
}

fn sibling_path(path: &std::path::Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

fn try_read_state(path: &std::path::Path) -> Option<StoredState> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<StoredState>(&raw).ok()
}

/// Loads saved data. If the main file is unreadable, tries the backup, and
/// never overwrites a damaged file: it is renamed aside so nothing is lost.
fn load_state_safely(path: &std::path::Path) -> StoredState {
    if !path.exists() {
        // Main file missing: recover from the backup if one exists.
        if let Some(st) = try_read_state(&sibling_path(path, ".bak")) {
            eprintln!("FocusFlow: data file missing, restored from backup");
            return st;
        }
        return StoredState::default();
    }
    if let Some(st) = try_read_state(path) {
        return st;
    }
    let stamp = Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let corrupt = sibling_path(path, &format!(".corrupt-{}", stamp));
    eprintln!("FocusFlow: data file unreadable, moving it to {:?}", corrupt);
    let _ = fs::rename(path, &corrupt);
    if let Some(st) = try_read_state(&sibling_path(path, ".bak")) {
        eprintln!("FocusFlow: restored from backup");
        return st;
    }
    StoredState::default()
}

/// Writes the whole file to a temporary name first, then swaps it in, so the
/// real file is always either the old version or the new one, never half-written.
/// The previous good version is kept as a .bak file.
fn write_atomically(path: &std::path::Path, state: &StoredState) {
    use std::io::Write;
    let json = match serde_json::to_string_pretty(state) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("FocusFlow: could not serialise data: {}", e);
            return;
        }
    };
    let tmp = sibling_path(path, ".tmp");
    let write_tmp = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
        Ok(())
    };
    if let Err(e) = write_tmp() {
        eprintln!("FocusFlow: could not write temp data file: {}", e);
        let _ = fs::remove_file(&tmp);
        return;
    }
    // Keep the previous version only if it was itself valid.
    if path.exists() && try_read_state(path).is_some() {
        let _ = fs::copy(path, sibling_path(path, ".bak"));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        eprintln!("FocusFlow: could not replace data file: {}", e);
        let _ = fs::remove_file(&tmp);
    }
}

pub struct LocalStore {
    file_path: PathBuf,
    state: Mutex<StoredState>,
    /// True when the Windows Credential Manager works; secrets then live there
    /// and are blanked out of the JSON file.
    vault_ok: std::sync::atomic::AtomicBool,
}

impl LocalStore {
    pub fn new() -> Self {
        let app_data_dir = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("focusflow");
        let file_path = app_data_dir.join("focusflow-data.json");

        let mut state = load_state_safely(&file_path);

        if let Some(parent) = file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // Move secrets into the Windows vault (or load them from it).
        let mut vault_ok = vault_get(VAULT_TOKENS).is_ok() && vault_get(VAULT_SECRET).is_ok();
        let mut migrated = false;
        if vault_ok {
            // Google tokens
            match vault_get(VAULT_TOKENS) {
                Ok(Some(json)) => {
                    if let Ok(t) = serde_json::from_str::<GoogleTokens>(&json) {
                        state.google_tokens = Some(t);
                    }
                }
                Ok(None) => {
                    if let Some(t) = state.google_tokens.clone() {
                        match serde_json::to_string(&t).ok().map(|j| vault_set(VAULT_TOKENS, &j)) {
                            Some(Ok(())) => migrated = true,
                            _ => vault_ok = false,
                        }
                    }
                }
                Err(_) => vault_ok = false,
            }
            // Client secret
            match vault_get(VAULT_SECRET) {
                Ok(Some(sec)) => {
                    if !sec.is_empty() {
                        state.settings.google_client_secret = sec;
                    }
                }
                Ok(None) => {
                    if !state.settings.google_client_secret.is_empty() {
                        match vault_set(VAULT_SECRET, &state.settings.google_client_secret) {
                            Ok(()) => migrated = true,
                            Err(_) => vault_ok = false,
                        }
                    }
                }
                Err(_) => vault_ok = false,
            }
        }
        if !vault_ok {
            eprintln!("FocusFlow: Windows vault unavailable, keeping secrets in the data file");
        }

        // Remove orphaned demo/stale references (e.g. sessions pointing to missing projects or tasks).
        if prune_orphaned_refs_locked(&mut state) {
            migrated = true;
        }
        if !state.settings.onboarding_completed
            && (!state.tasks.is_empty()
                || !state.sessions.is_empty()
                || state.google_tokens.is_some())
        {
            state.settings.onboarding_completed = true;
            migrated = true;
        }
        sync_gated_milestones_locked(&mut state);

        let to_write = if vault_ok { sanitized(&state) } else { state.clone() };
        write_atomically(&file_path, &to_write);
        if migrated {
            // Second write replaces the .bak (which still holds the old plaintext copy).
            write_atomically(&file_path, &to_write);
        }

        Self {
            file_path,
            state: Mutex::new(state),
            vault_ok: std::sync::atomic::AtomicBool::new(vault_ok),
        }
    }

    /// True when secrets are stored in the Windows Credential Manager.
    pub fn vault_active(&self) -> bool {
        self.vault_enabled()
    }

    fn vault_enabled(&self) -> bool {
        self.vault_ok.load(std::sync::atomic::Ordering::Relaxed)
    }

    fn disable_vault(&self) {
        eprintln!("FocusFlow: vault write failed, falling back to the data file for secrets");
        self.vault_ok.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    /// Locks the state; if another thread panicked while holding the lock,
    /// keep going with the data instead of crashing the whole app.
    fn lock(&self) -> std::sync::MutexGuard<'_, StoredState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn persist(&self, state: &StoredState) {
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if self.vault_enabled() {
            write_atomically(&self.file_path, &sanitized(state));
        } else {
            write_atomically(&self.file_path, state);
        }
    }

    pub fn get_app_data(&self) -> AppData {
        let s = self.lock();
        AppData {
            projects: s.projects.clone(),
            tasks: s.tasks.clone(),
            sessions: s.sessions.clone(),
            settings: s.settings.clone(),
            google_connected: s
                .google_tokens
                .as_ref()
                .map(|t| !t.access_token.is_empty())
                .unwrap_or(false),
            task_lists: s.task_lists.clone(),
            calendars: s.calendars.clone(),
            task_event_links: s.task_event_links.clone(),
            event_metadata: s.event_metadata.clone(),
            pending_sync_count: s.pending_sync_ops.len(),
            last_synced_at: None,
            templates: s.templates.clone(),
        }
    }

    pub fn get_local_events(&self) -> Vec<CalendarEvent> {
        let s = self.lock();
        let meta_map = s.event_metadata.clone();
        s.local_events
            .iter()
            .map(|e| {
                let mut cloned = e.clone();
                if let Some(meta) = meta_map.get(&cloned.id) {
                    if meta.priority.is_some() {
                        cloned.priority = meta.priority;
                    }
                    if meta.project_id.is_some() {
                        cloned.project_id = meta.project_id.clone();
                    }
                }
                cloned
            })
            .collect()
    }

    pub fn add_local_event(&self, event: CalendarEvent) {
        let mut s = self.lock();
        s.local_events.push(event);
        self.persist(&s);
    }

    pub fn update_local_event(
        &self,
        event_id: &str,
        summary: Option<String>,
        start: Option<String>,
        end: Option<String>,
    ) -> Option<CalendarEvent> {
        let mut s = self.lock();
        let mut updated_evt = None;
        for evt in &mut s.local_events {
            if evt.id == event_id {
                if let Some(ref sum) = summary {
                    evt.summary = sum.clone();
                }
                if let Some(ref st) = start {
                    evt.start = st.clone();
                }
                if let Some(ref en) = end {
                    evt.end = en.clone();
                }
                updated_evt = Some(evt.clone());
                break;
            }
        }
        if updated_evt.is_some() {
            self.persist(&s);
        }
        updated_evt
    }

    pub fn delete_local_event(&self, event_id: &str) {
        let mut s = self.lock();
        s.local_events.retain(|e| e.id != event_id);
        self.persist(&s);
    }

    pub fn get_settings(&self) -> AppSettings {
        self.lock().settings.clone()
    }

    pub fn get_tokens(&self) -> Option<GoogleTokens> {
        self.lock().google_tokens.clone()
    }

    pub fn set_tokens(&self, tokens: Option<GoogleTokens>) {
        let mut s = self.lock();
        if self.vault_enabled() {
            let res = match &tokens {
                Some(t) => serde_json::to_string(t).map_err(|_| ()).and_then(|j| vault_set(VAULT_TOKENS, &j)),
                None => vault_delete(VAULT_TOKENS),
            };
            if res.is_err() {
                self.disable_vault();
            }
        }
        s.google_tokens = tokens;
        self.persist(&s);
    }

    pub fn save_projects(&self, projects: Vec<Project>) {
        let mut s = self.lock();
        let valid_ids: std::collections::HashSet<&str> =
            projects.iter().map(|p| p.id.as_str()).collect();
        for t in &mut s.tasks {
            if let Some(ref pid) = t.project_id {
                if !valid_ids.contains(pid.as_str()) {
                    t.project_id = None;
                }
            }
        }
        for meta in s.event_metadata.values_mut() {
            if let Some(ref pid) = meta.project_id {
                if !valid_ids.contains(pid.as_str()) {
                    meta.project_id = None;
                }
            }
        }
        s.projects = projects;
        prune_orphaned_refs_locked(&mut s);
        sync_gated_milestones_locked(&mut s);
        self.persist(&s);
    }

    pub fn save_tasks(&self, tasks: Vec<TaskItem>) {
        let mut s = self.lock();
        s.tasks = tasks;
        prune_orphaned_refs_locked(&mut s);
        sync_gated_milestones_locked(&mut s);
        self.persist(&s);
    }

    pub fn save_templates(&self, templates: Vec<TaskTemplate>) {
        let mut s = self.lock();
        s.templates = templates;
        self.persist(&s);
    }

    pub fn save_task_lists(&self, lists: Vec<GoogleTaskListInfo>) {
        let mut s = self.lock();
        s.task_lists = lists;
        self.persist(&s);
    }

    pub fn save_calendars(&self, calendars: Vec<GoogleCalendarInfo>) {
        let mut s = self.lock();
        s.calendars = calendars;
        self.persist(&s);
    }

    pub fn set_task_event_link(&self, task_id: String, event_id: Option<String>) {
        let mut s = self.lock();
        if let Some(eid) = event_id {
            s.task_event_links.insert(task_id, eid);
        } else {
            s.task_event_links.remove(&task_id);
        }
        self.persist(&s);
    }

    pub fn save_event_metadata(&self, event_id: String, meta: EventMetadata) {
        let mut s = self.lock();
        let entry = s.event_metadata.entry(event_id).or_default();
        if meta.priority.is_some() {
            entry.priority = meta.priority;
        }
        if meta.project_id.is_some() {
            entry.project_id = meta.project_id;
        }
        self.persist(&s);
    }

    pub fn add_session(&self, session: PomodoroSession) {
        let mut s = self.lock();
        s.sessions.insert(0, session);
        self.persist(&s);
    }

    pub fn mark_session_logged(&self, session_id: &str) {
        let mut s = self.lock();
        if let Some(sess) = s.sessions.iter_mut().find(|sess| sess.id == session_id) {
            sess.logged_to_calendar = true;
            self.persist(&s);
        }
    }

    pub fn update_session_note(&self, session_id: &str, note: Option<String>) {
        let mut s = self.lock();
        if let Some(sess) = s.sessions.iter_mut().find(|sess| sess.id == session_id) {
            sess.note = note.and_then(|n| {
                let t = n.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            });
            self.persist(&s);
        }
    }

    pub fn enqueue_sync_op(&self, op: PendingSyncOp) {
        let mut s = self.lock();
        s.pending_sync_ops.push(op);
        self.persist(&s);
    }

    pub fn get_sync_ops(&self) -> Vec<PendingSyncOp> {
        self.lock().pending_sync_ops.clone()
    }

    pub fn set_sync_ops(&self, ops: Vec<PendingSyncOp>) {
        let mut s = self.lock();
        s.pending_sync_ops = ops;
        self.persist(&s);
    }

    pub fn export_backup_json(&self) -> Result<String, String> {
        let s = self.lock();
        serde_json::to_string_pretty(&sanitized(&s)).map_err(|e| e.to_string())
    }

    pub fn import_backup_json(&self, json: &str) -> Result<(), String> {
        let mut imported: StoredState =
            serde_json::from_str(json).map_err(|e| format!("Invalid backup JSON: {}", e))?;
        let mut s = self.lock();
        // Preserve existing OAuth tokens and OAuth client credentials if omitted in backup.
        imported.google_tokens = s.google_tokens.clone();
        if imported.settings.google_client_id.trim().is_empty() {
            imported.settings.google_client_id = s.settings.google_client_id.clone();
        }
        if imported.settings.google_client_secret.trim().is_empty() {
            imported.settings.google_client_secret = s.settings.google_client_secret.clone();
        }
        let valid_ids: std::collections::HashSet<&str> =
            imported.projects.iter().map(|p| p.id.as_str()).collect();
        for t in &mut imported.tasks {
            if let Some(ref pid) = t.project_id {
                if !valid_ids.contains(pid.as_str()) {
                    t.project_id = None;
                }
            }
        }
        for meta in imported.event_metadata.values_mut() {
            if let Some(ref pid) = meta.project_id {
                if !valid_ids.contains(pid.as_str()) {
                    meta.project_id = None;
                }
            }
        }
        prune_orphaned_refs_locked(&mut imported);
        sync_gated_milestones_locked(&mut imported);
        *s = imported;
        self.persist(&s);
        Ok(())
    }

    pub fn get_taskbar_pos(&self) -> Option<(f64, f64)> {
        self.lock().taskbar_pos
    }

    pub fn set_taskbar_pos(&self, pos: Option<(f64, f64)>) {
        let mut s = self.lock();
        s.taskbar_pos = pos;
        self.persist(&s);
    }

    pub fn get_taskbar_dock(&self) -> Option<String> {
        self.lock().taskbar_dock.clone()
    }

    pub fn set_taskbar_dock(&self, dock: Option<String>) {
        let mut s = self.lock();
        s.taskbar_dock = dock;
        self.persist(&s);
    }

    pub fn get_floating_pos(&self) -> Option<(f64, f64)> {
        self.lock().floating_pos
    }

    pub fn set_floating_pos(&self, pos: Option<(f64, f64)>) {
        let mut s = self.lock();
        s.floating_pos = pos;
        self.persist(&s);
    }

    pub fn save_settings(&self, settings: AppSettings) {
        let mut s = self.lock();
        if self.vault_enabled() {
            let sec = settings.google_client_secret.trim();
            let res = if sec.is_empty() {
                vault_delete(VAULT_SECRET)
            } else {
                vault_set(VAULT_SECRET, &settings.google_client_secret)
            };
            if res.is_err() {
                self.disable_vault();
            }
        }
        let was_demo = s.settings.demo_mode;
        if !settings.demo_mode {
            s.local_events.retain(|e| !e.id.starts_with("demo-evt-"));
        } else if !was_demo && s.local_events.is_empty() {
            s.local_events = default_demo_events_for_today();
        }
        s.settings = settings;
        self.persist(&s);
    }

    pub fn add_reminder(&self, rem: ScheduledReminder) {
        let mut s = self.lock();
        s.reminders.push(rem);
        self.persist(&s);
    }

    pub fn get_reminders(&self) -> Vec<ScheduledReminder> {
        self.lock().reminders.clone()
    }

    pub fn pop_due_reminders(&self, now_ts: i64) -> Vec<ScheduledReminder> {
        let mut s = self.lock();
        let mut due = Vec::new();
        for rem in &mut s.reminders {
            if !rem.fired {
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&rem.fire_at) {
                    if dt.timestamp() <= now_ts {
                        rem.fired = true;
                        due.push(rem.clone());
                    }
                }
            }
        }
        if !due.is_empty() {
            // Keep unfired reminders and the most recent 25 fired reminders
            let mut fired_kept = 0usize;
            s.reminders.retain(|r| {
                if !r.fired {
                    true
                } else if fired_kept < 25 {
                    fired_kept += 1;
                    true
                } else {
                    false
                }
            });
            self.persist(&s);
        }
        due
    }

    pub fn delete_reminder(&self, id: &str) -> bool {
        let mut s = self.lock();
        let prev = s.reminders.len();
        s.reminders.retain(|r| r.id != id);
        let removed = s.reminders.len() != prev;
        if removed {
            self.persist(&s);
        }
        removed
    }
}

/// Removes orphaned focus sessions (pointing to deleted/missing tasks or projects)
/// and strips stale task IDs from dependencies and task-event links. Returns true if changed.
fn prune_orphaned_refs_locked(s: &mut StoredState) -> bool {
    let task_ids: std::collections::HashSet<String> =
        s.tasks.iter().map(|t| t.id.clone()).collect();
    let proj_ids: std::collections::HashSet<String> =
        s.projects.iter().map(|p| p.id.clone()).collect();

    let prev_sess_len = s.sessions.len();
    s.sessions.retain(|sess| {
        let task_ok = sess
            .task_id
            .as_deref()
            .map(|tid| task_ids.contains(tid))
            .unwrap_or(true);
        let proj_ok = sess
            .project_id
            .as_deref()
            .map(|pid| proj_ids.contains(pid))
            .unwrap_or(true);
        task_ok && proj_ok
    });
    let mut changed = s.sessions.len() != prev_sess_len;

    let prev_links = s.task_event_links.len();
    s.task_event_links.retain(|tid, _| task_ids.contains(tid.as_str()));
    if s.task_event_links.len() != prev_links {
        changed = true;
    }

    for t in &mut s.tasks {
        let before = t.blocked_by_task_ids.len();
        t.blocked_by_task_ids
            .retain(|dep| dep != &t.id && task_ids.contains(dep.as_str()));
        if t.blocked_by_task_ids.len() != before {
            changed = true;
        }
    }
    changed
}

/// Automatically gates project milestones that declare `required_task_ids`:
/// a gated milestone is marked `done = true` iff all linked tasks are completed.
fn sync_gated_milestones_locked(s: &mut StoredState) {
    let completed_map: HashMap<&str, bool> =
        s.tasks.iter().map(|t| (t.id.as_str(), t.completed)).collect();
    for proj in &mut s.projects {
        for ms in &mut proj.milestones {
            if !ms.required_task_ids.is_empty() {
                ms.done = ms
                    .required_task_ids
                    .iter()
                    .all(|tid| completed_map.get(tid.as_str()).copied().unwrap_or(false));
            }
        }
    }
}

/// Appends a diagnostic line to %APPDATA%\focusflow\focusflow.log (rotating past 1 MB).
pub fn append_app_log(category: &str, message: &str) {
    use std::io::Write;
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = base.join("focusflow");
    let path = dir.join("focusflow.log");
    let _ = fs::create_dir_all(&dir);
    if fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::rename(&path, path.with_extension("log.1"));
    }
    let now = chrono::Utc::now().to_rfc3339();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] [{}] {}", now, category, message);
    }
}
