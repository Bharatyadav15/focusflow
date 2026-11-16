#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub(crate) mod ai_audit;
mod ai_server;
pub(crate) mod ai_tools;
mod google_api;
mod google_auth;
mod planner;
mod store;
pub(crate) mod task_tree;
mod types;

use chrono::{Local, Utc};
use google_api::{CreateEventPayload, SyncTasksResult, UpdateEventPayload, UpdateTaskPatch};
use google_auth::AuthResult;
use std::sync::{Arc, Mutex};
use store::LocalStore;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::{Action, ActionType, NotificationExt};
use types::{
    ActiveTarget, AppData, AppSettings, CalendarEvent, EventMetadata, GoogleCalendarInfo,
    PomodoroSession, Project, TaskItem, TaskTemplate, TimerState,
};

const FLOATING_WIN_WIDTH: f64 = 368.0;
const FLOATING_WIN_HEIGHT: f64 = 580.0;
const IDLE_PILL_HIT_W: f64 = 240.0;
const IDLE_PILL_HIT_H: f64 = 66.0;
const ACTIVE_CAPSULE_HIT_W: f64 = 360.0;
const ACTIVE_CAPSULE_HIT_H: f64 = 84.0;
/// How close (logical px) the pill must be dropped to a screen edge to dock there.
const DOCK_SNAP_PX: f64 = 14.0;
/// Length of the thin docked bar (must match the web UI).
const DOCK_BAR_LEN: f64 = 96.0;

pub struct AppState {
    pub store: Arc<LocalStore>,
    pub timer: Arc<Mutex<TimerState>>,
    pub cached_events: Arc<Mutex<Vec<CalendarEvent>>>,
    pub is_taskbar_expanded: Arc<Mutex<bool>>,
    pub is_taskbar_interactive: Arc<Mutex<bool>>,
    pub is_taskbar_dragging: Arc<Mutex<bool>>,
    pub taskbar_custom_pos: Arc<Mutex<Option<(f64, f64)>>>,
    /// Docked screen edge: "left" | "right" | "top" | "bottom".
    pub taskbar_dock: Arc<Mutex<Option<String>>>,
    /// Pill rect reported by the web UI: (x, y, w, h, hit_slop), in window-relative logical px.
    pub taskbar_rect: Arc<Mutex<Option<(f64, f64, f64, f64, f64)>>>,
    pub taskbar_hover: Arc<Mutex<bool>>,
    pub is_quitting: Arc<Mutex<bool>>,
    pub ambient_preset: Arc<Mutex<String>>,
    pub mcp_status: Arc<Mutex<(bool, String)>>,
    pub last_google_sync: Arc<Mutex<Option<String>>>,
}

pub(crate) fn ensure_main_window(app: &AppHandle) {
    ensure_main_window_with(app, true);
}

/// Creates (or reveals) the main window. `visible = false` creates it hidden,
/// used when Windows launches FocusFlow at sign-in so it starts in the tray.
fn ensure_main_window_with(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window("main") {
        if visible {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("FocusFlow")
        .inner_size(1220.0, 820.0)
        .min_inner_size(1220.0, 820.0)
        .disable_drag_drop_handler()
        .visible(visible)
        .build();
}

// ---------- Quick wins: completion alert, start with Windows, global hotkeys ----------

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(psz_sound: *const u16, hmod: isize, fdw_sound: u32) -> i32;
}

/// Plays the Windows "Alarm01" sound (falls back to the system exclamation sound).
/// Returns true if Windows accepted the request.
fn play_completion_sound() -> bool {
    #[cfg(windows)]
    {
        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }
        const SND_ASYNC: u32 = 0x0001;
        const SND_NODEFAULT: u32 = 0x0002;
        const SND_ALIAS: u32 = 0x0001_0000;
        const SND_FILENAME: u32 = 0x0002_0000;
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let file = format!("{}\\Media\\Alarm01.wav", root);
        if std::path::Path::new(&file).exists() {
            let w = wide(&file);
            // SAFETY: `w` is a valid NUL-terminated UTF-16 string that outlives the call.
            if unsafe { PlaySoundW(w.as_ptr(), 0, SND_FILENAME | SND_ASYNC | SND_NODEFAULT) } != 0 {
                return true;
            }
        }
        let w = wide("SystemExclamation");
        // SAFETY: as above.
        unsafe { PlaySoundW(w.as_ptr(), 0, SND_ALIAS | SND_ASYNC) != 0 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

const AUTOSTART_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_NAME: &str = "FocusFlow";

/// Adds or removes the per-user "start with Windows" registry entry (no admin needed).
fn apply_autostart(enabled: bool) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = std::process::Command::new("reg");
        if enabled {
            let Ok(exe) = std::env::current_exe() else {
                return false;
            };
            cmd.args(["add", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/t", "REG_SZ", "/d"])
                .arg(format!("\"{}\" --autostart", exe.display()))
                .arg("/f");
        } else {
            cmd.args(["delete", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/f"]);
        }
        cmd.creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success() || !enabled)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        false
    }
}

/// Windows only shows toast notifications from apps that have a registered
/// AppUserModelID. A plain .exe has none, so its notifications are silently
/// dropped. This registers the app's identifier (per-user, no admin needed).
fn register_notification_identity(identifier: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let key = format!(r"HKCU\Software\Classes\AppUserModelId\{}", identifier);
        let _ = std::process::Command::new("reg")
            .args(["add", &key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "FocusFlow", "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = identifier;
    }
}

/// Start/pause the timer (shared by the tray menu and the global hotkey).
fn toggle_timer(app: &AppHandle) {
    let Some(s) = app.try_state::<AppState>() else {
        return;
    };
    let next_state = {
        let mut t = s.timer.lock().unwrap();
        let starting = !t.is_running;
        t.is_running = starting;
        let now_ms = Utc::now().timestamp_millis();
        if starting && t.session_started_at.is_none() {
            t.session_started_at = Some(Utc::now().to_rfc3339());
        }
        if t.mode == "stopwatch" {
            t.stopwatch_started_at = if starting { Some(now_ms) } else { None };
            t.stopwatch_accumulated_secs = Some(t.seconds_left);
        } else {
            if starting && t.seconds_left == 0 {
                t.seconds_left = t.total_seconds.max(60);
            }
            t.target_end_time = if starting {
                Some(now_ms + (t.seconds_left as i64) * 1000)
            } else {
                None
            };
        }
        t.clone()
    };
    ensure_taskbar_window(app);
    rebuild_tray_menu(app);
    let _ = app.emit("timer:sync", next_state);
}

/// Set when quick-add was requested; the widget clears it once it has acted on it.
/// This covers the case where the widget window is still loading (or was just
/// created) when the hotkey fires and would otherwise miss the event.
static PENDING_QUICK_ADD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Problems registering the hotkeys, shown in Settings.
static HOTKEY_ERRORS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Opens the taskbar widget and tells it to focus the "add task" box.
fn open_quick_add(app: &AppHandle) {
    PENDING_QUICK_ADD.store(true, std::sync::atomic::Ordering::SeqCst);
    ensure_taskbar_window(app);
    let _ = app.emit("taskbar:visibility", true);
    let _ = app.emit("taskbar:quick-add", ());
}

/// A usable combo has at least one modifier plus a key (e.g. "Ctrl+Alt+P").
fn hotkey_is_valid(combo: &str) -> bool {
    let parts: Vec<String> = combo
        .split('+')
        .map(|p| p.trim().to_ascii_lowercase())
        .collect();
    if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
        return false;
    }
    let is_mod = |p: &str| matches!(p, "ctrl" | "control" | "alt" | "shift" | "super" | "win" | "cmd" | "meta");
    let (mods, keys): (Vec<&String>, Vec<&String>) = parts.iter().partition(|p| is_mod(p));
    !mods.is_empty() && keys.len() == 1
}

/// Registers (or removes) the global hotkeys from the saved settings. Problems
/// (invalid combo, taken by another app) are recorded in HOTKEY_ERRORS.
fn apply_hotkeys(app: &AppHandle) {
    let cfg = match app.try_state::<AppState>() {
        Some(s) => s.store.get_settings(),
        None => return,
    };
    let mut errors: Vec<String> = Vec::new();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if cfg.global_hotkeys {
        let timer_combo = cfg.hotkey_timer.trim().to_string();
        let quick_combo = cfg.hotkey_quick_add.trim().to_string();

        if timer_combo.eq_ignore_ascii_case(&quick_combo) {
            errors.push("The two hotkeys must be different.".to_string());
        } else {
            if !hotkey_is_valid(&timer_combo) {
                errors.push(format!("\"{}\" is not a valid hotkey (use e.g. Ctrl+Alt+P).", timer_combo));
            } else if let Err(e) = gs.on_shortcut(timer_combo.as_str(), |app, _sc, ev| {
                if ev.state == ShortcutState::Pressed {
                    toggle_timer(app);
                }
            }) {
                errors.push(format!("Could not register {} (maybe another app uses it): {}", timer_combo, e));
            }
            if !hotkey_is_valid(&quick_combo) {
                errors.push(format!("\"{}\" is not a valid hotkey (use e.g. Ctrl+Alt+T).", quick_combo));
            } else if let Err(e) = gs.on_shortcut(quick_combo.as_str(), |app, _sc, ev| {
                if ev.state == ShortcutState::Pressed {
                    open_quick_add(app);
                }
            }) {
                errors.push(format!("Could not register {} (maybe another app uses it): {}", quick_combo, e));
            }
        }
    }

    for e in &errors {
        eprintln!("FocusFlow: {}", e);
    }
    *HOTKEY_ERRORS.lock().unwrap_or_else(|e| e.into_inner()) = errors;
}

// ---------- Only one FocusFlow at a time ----------

#[cfg(windows)]
mod single_instance {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attrs: *mut core::ffi::c_void, initial_owner: i32, name: *const u16) -> isize;
        fn GetLastError() -> u32;
    }

    /// Returns true if this is the first running copy. The mutex handle is
    /// deliberately kept open for the life of the process.
    pub fn acquire() -> bool {
        const ERROR_ALREADY_EXISTS: u32 = 183;
        let name: Vec<u16> = "Local\\FocusFlow.SingleInstance"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: name is a valid NUL-terminated UTF-16 string for the call.
        unsafe {
            let handle = CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr());
            if handle == 0 {
                return true; // could not check; do not block startup
            }
            GetLastError() != ERROR_ALREADY_EXISTS
        }
    }
}

#[cfg(not(windows))]
mod single_instance {
    pub fn acquire() -> bool {
        true
    }
}

/// Asks the already-running copy to show its window (skipped for --autostart).
fn tell_running_instance_to_show() {
    use std::io::{Read, Write};
    if std::env::args().any(|a| a == "--autostart") {
        return;
    }
    let token = std::fs::read_to_string(ai_server::token_path()).unwrap_or_default();
    let token = token.trim();
    if token.is_empty() {
        return;
    }
    let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", ai_server::AI_SERVER_PORT).parse() {
        Ok(a) => a,
        Err(_) => return,
    };
    if let Ok(mut s) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(1200)) {
        let _ = s.set_read_timeout(Some(std::time::Duration::from_millis(1500)));
        let req = format!(
            "POST /api/show HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ai_server::AI_SERVER_PORT, token
        );
        let _ = s.write_all(req.as_bytes());
        let mut sink = [0u8; 256];
        let _ = s.read(&mut sink);
    }
}

/// Sound + notification when a timer reaches zero.
fn announce_completion(app: &AppHandle, mode: &str, title: Option<String>, total_secs: u32) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let settings = state.store.get_settings();
    let is_focus = mode == "focus";
    if settings.sound_on_complete {
        let ok = play_completion_sound();
        eprintln!("FocusFlow: completion sound requested, accepted={}", ok);
    }
    if settings.notify_on_complete {
        let (heading, body) = if is_focus {
            (
                "Focus session complete".to_string(),
                format!(
                    "Finished \"{}\" ({} min). Time for a break.",
                    title.unwrap_or_else(|| "Focus Block".to_string()),
                    (total_secs / 60).max(1)
                ),
            )
        } else {
            (
                "Break finished".to_string(),
                "Ready for your next focus block?".to_string(),
            )
        };
        let _ = app.notification().builder().title(heading).body(body).show();
        eprintln!("FocusFlow: completion notification sent");
    }
}

fn monitor_work_area_for(app: &AppHandle, pos: Option<(f64, f64)>) -> (f64, f64, f64, f64) {
    let to_logical_wa = |mon: &tauri::Monitor| -> (f64, f64, f64, f64) {
        let scale = mon.scale_factor();
        let wa = mon.work_area();
        (
            wa.position.x as f64 / scale,
            wa.position.y as f64 / scale,
            wa.size.width as f64 / scale,
            wa.size.height as f64 / scale,
        )
    };

    if let Some((px, py)) = pos {
        if let Ok(monitors) = app.available_monitors() {
            let areas: Vec<(f64, f64, f64, f64)> = monitors.iter().map(to_logical_wa).collect();
            if let Some(hit) = areas
                .iter()
                .find(|&&(x, y, w, h)| px >= x && px <= x + w && py >= y && py <= y + h)
            {
                return *hit;
            }
            if let Some(nearest) = areas.into_iter().min_by(|a, b| {
                let da = (px - (a.0 + a.2 / 2.0)).hypot(py - (a.1 + a.3 / 2.0));
                let db = (px - (b.0 + b.2 / 2.0)).hypot(py - (b.1 + b.3 / 2.0));
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            }) {
                return nearest;
            }
        }
    }

    if let Ok(Some(mon)) = app.primary_monitor() {
        return to_logical_wa(&mon);
    }
    (0.0, 0.0, 1280.0, 720.0)
}

pub(crate) fn ensure_floating_window(app: &AppHandle) {
    ensure_taskbar_window(app);
}

fn get_taskbar_logical(app: &AppHandle, custom_pos: Option<(f64, f64)>) -> (f64, f64) {
    let (wa_x, wa_y, wa_w, wa_h) = monitor_work_area_for(app, custom_pos);

    if let Some((cx, cy)) = custom_pos {
        let clamped_x = cx
            .max(wa_x - 12.0)
            .min(wa_x + wa_w - IDLE_PILL_HIT_W + 12.0);
        let clamped_y = cy
            .max(wa_y - FLOATING_WIN_HEIGHT + IDLE_PILL_HIT_H)
            .min(wa_y + wa_h - IDLE_PILL_HIT_H + 8.0);
        return (clamped_x, clamped_y);
    }

    let default_x = wa_x + 16.0;
    let default_y = wa_y + wa_h - FLOATING_WIN_HEIGHT - 16.0;
    (default_x, default_y)
}

fn ensure_taskbar_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("floating") {
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        return;
    }

    let custom_pos = app
        .try_state::<AppState>()
        .and_then(|s| *s.taskbar_custom_pos.lock().unwrap());
    let (x, y) = get_taskbar_logical(app, custom_pos);

    if let Ok(win) = WebviewWindowBuilder::new(
        app,
        "floating",
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script(
        "window.__FOCUSFLOW_WINDOW__ = 'floating'; window.location.hash = '#/floating';",
    )
    .title("FocusFlow Floating Widget")
    .inner_size(FLOATING_WIN_WIDTH, FLOATING_WIN_HEIGHT)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .shadow(false)
    .build()
    {
        let _ = win.set_ignore_cursor_events(true);
        let app_clone = app.clone();
        win.on_window_event(move |evt| {
            if let WindowEvent::Focused(false) = evt {
                let _ = app_clone.emit("taskbar:blur", ());
            }
        });
    }
}

pub(crate) fn calc_event_mins(evt: &CalendarEvent, default_mins: u32) -> u32 {
    if evt.is_all_day.unwrap_or(false) {
        return default_mins;
    }
    if let (Ok(s), Ok(e)) = (
        chrono::DateTime::parse_from_rfc3339(&evt.start),
        chrono::DateTime::parse_from_rfc3339(&evt.end),
    ) {
        let diff = (e.timestamp() - s.timestamp()) / 60;
        if diff > 0 {
            return diff as u32;
        }
    }
    default_mins
}

fn format_event_time_short(evt: &CalendarEvent) -> String {
    if evt.is_all_day.unwrap_or(false) {
        return "All day".to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&evt.start) {
        let local_dt = dt.with_timezone(&Local);
        return local_dt.format("%H:%M").to_string();
    }
    String::new()
}

fn resolve_task_duration_mins(
    task: &TaskItem,
    events: &[CalendarEvent],
    app_data: &AppData,
    default_mins: u32,
) -> u32 {
    if let Some(dm) = task.duration_minutes {
        if dm > 0 {
            return dm;
        }
    }
    if let (Some(ref s), Some(ref e)) = (&task.scheduled_start, &task.scheduled_end) {
        if let (Ok(st), Ok(en)) = (
            chrono::DateTime::parse_from_rfc3339(s),
            chrono::DateTime::parse_from_rfc3339(e),
        ) {
            let diff = (en.timestamp() - st.timestamp()) / 60;
            if diff > 0 {
                return diff as u32;
            }
        }
    }
    let linked_id = app_data
        .task_event_links
        .get(&task.id)
        .or(task.linked_event_id.as_ref())
        .or(task.calendar_event_id.as_ref());
    if let Some(eid) = linked_id {
        if let Some(evt) = events.iter().find(|e| &e.id == eid) {
            return calc_event_mins(evt, default_mins);
        }
    }
    if task.estimated_pomodoros > 1 {
        return task.estimated_pomodoros * default_mins;
    }
    default_mins
}

fn get_upcoming_tray_events(events: &[CalendarEvent]) -> Vec<CalendarEvent> {
    let now_ts = Utc::now().timestamp();
    let mut upcoming: Vec<CalendarEvent> = events
        .iter()
        .filter(|e| {
            if e.is_all_day.unwrap_or(false) {
                return true;
            }
            chrono::DateTime::parse_from_rfc3339(&e.end)
                .map(|dt| dt.timestamp() >= now_ts)
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    if upcoming.is_empty() {
        upcoming = events.to_vec();
    }
    upcoming.sort_by(|a, b| a.start.cmp(&b.start));
    upcoming.truncate(3);
    upcoming
}

fn get_upcoming_tray_tasks(app_data: &AppData) -> Vec<TaskItem> {
    let mut upcoming: Vec<TaskItem> = app_data
        .tasks
        .iter()
        .filter(|t| !t.completed)
        .cloned()
        .collect();
    upcoming.sort_by_key(|t| t.priority);
    upcoming.truncate(3);
    upcoming
}

pub(crate) fn rebuild_tray_menu(app: &AppHandle) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return,
    };

    let app_data = state.store.get_app_data();
    let default_mins = app_data.settings.focus_minutes.max(1);
    let mut events = state.cached_events.lock().unwrap().clone();
    if events.is_empty() {
        events = state.store.get_local_events();
    }

    let upcoming_events = get_upcoming_tray_events(&events);
    let upcoming_tasks = get_upcoming_tray_tasks(&app_data);
    let timer_snapshot = state.timer.lock().unwrap().clone();

    let Ok(menu) = Menu::new(app) else { return };

    if let Ok(hdr) = MenuItem::with_id(
        app,
        "hdr_events",
        "Upcoming Calendar Events (Click to Focus)",
        false,
        None::<&str>,
    ) {
        let _ = menu.append(&hdr);
    }

    if upcoming_events.is_empty() {
        if let Ok(empty) = MenuItem::with_id(
            app,
            "no_events",
            "  No upcoming events today",
            false,
            None::<&str>,
        ) {
            let _ = menu.append(&empty);
        }
    } else {
        for (idx, evt) in upcoming_events.iter().enumerate() {
            let mins = calc_event_mins(evt, default_mins);
            let time_str = format_event_time_short(evt);
            let label = if time_str.is_empty() {
                format!("  {} ({}m)", evt.summary, mins)
            } else {
                format!("  {} · {} ({}m)", time_str, evt.summary, mins)
            };
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("evt_{}", idx),
                label,
                true,
                None::<&str>,
            ) {
                let _ = menu.append(&item);
            }
        }
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&sep);
    }

    if let Ok(hdr) = MenuItem::with_id(
        app,
        "hdr_tasks",
        "Upcoming Tasks (Click to Focus)",
        false,
        None::<&str>,
    ) {
        let _ = menu.append(&hdr);
    }

    if upcoming_tasks.is_empty() {
        if let Ok(empty) =
            MenuItem::with_id(app, "no_tasks", "  No open tasks", false, None::<&str>)
        {
            let _ = menu.append(&empty);
        }
    } else {
        for (idx, task) in upcoming_tasks.iter().enumerate() {
            let mins = resolve_task_duration_mins(task, &events, &app_data, default_mins);
            let label = format!("  [P{}] {} ({}m)", task.priority, task.title, mins);
            if let Ok(item) = MenuItem::with_id(
                app,
                format!("task_{}", idx),
                label,
                true,
                None::<&str>,
            ) {
                let _ = menu.append(&item);
            }
        }
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&sep);
    }

    let timer_label = if timer_snapshot.is_running {
        let m = timer_snapshot.seconds_left / 60;
        let s = timer_snapshot.seconds_left % 60;
        format!("Pause Timer ({:02}:{:02})", m, s)
    } else {
        format!("Start {}m Focus Timer", default_mins)
    };
    if let Ok(t_item) = MenuItem::with_id(app, "tray_toggle_timer", timer_label, true, None::<&str>)
    {
        let _ = menu.append(&t_item);
    }
    if let Ok(r_item) = MenuItem::with_id(app, "tray_reset_timer", "Reset Timer", true, None::<&str>)
    {
        let _ = menu.append(&r_item);
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&sep);
    }

    if let Ok(open_item) = MenuItem::with_id(
        app,
        "open_main",
        "Open & Maximize FocusFlow",
        true,
        None::<&str>,
    ) {
        let _ = menu.append(&open_item);
    }
    if let Ok(compact_item) = MenuItem::with_id(
        app,
        "toggle_taskbar",
        "Toggle Floating Widget",
        true,
        None::<&str>,
    ) {
        let _ = menu.append(&compact_item);
    }
    if let Ok(sync_item) = MenuItem::with_id(
        app,
        "sync_now",
        "Sync Google Calendar & Tasks",
        true,
        None::<&str>,
    ) {
        let _ = menu.append(&sync_item);
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&sep);
    }

    let (mcp_ok, mcp_desc) = state.mcp_status.lock().unwrap().clone();
    let mcp_label = if mcp_ok {
        format!("● MCP: {}", mcp_desc)
    } else {
        format!("○ MCP: {}", mcp_desc)
    };
    if let Ok(mcp_item) = MenuItem::with_id(app, "status_mcp", mcp_label, false, None::<&str>) {
        let _ = menu.append(&mcp_item);
    }

    let last_sync = state.last_google_sync.lock().unwrap().clone();
    let sync_label = if !app_data.google_connected {
        "  Google Sync: Not connected".to_string()
    } else if app_data.pending_sync_count > 0 {
        format!("  Google Sync: {} pending offline", app_data.pending_sync_count)
    } else if let Some(ref iso) = last_sync {
        let hhmm = chrono::DateTime::parse_from_rfc3339(iso)
            .map(|d| d.with_timezone(&Local).format("%H:%M").to_string())
            .unwrap_or_else(|_| "ok".to_string());
        format!("  Google Sync: Last synced {}", hhmm)
    } else {
        "  Google Sync: Ready".to_string()
    };
    if let Ok(sync_status_item) =
        MenuItem::with_id(app, "status_sync", sync_label, false, None::<&str>)
    {
        let _ = menu.append(&sync_status_item);
    }

    if let Ok(sep) = PredefinedMenuItem::separator(app) {
        let _ = menu.append(&sep);
    }

    if let Ok(quit_item) = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>) {
        let _ = menu.append(&quit_item);
    }

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_menu(Some(menu));
    }
}

fn start_pomodoro_from_tray(app: &AppHandle, target: ActiveTarget) {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return,
    };
    let mins = target.duration_minutes.unwrap_or(25).max(1);
    let secs = mins * 60;
    let now_ms = Utc::now().timestamp_millis();

    let next_state = {
        let mut t = state.timer.lock().unwrap();
        t.mode = "focus".to_string();
        t.seconds_left = secs;
        t.total_seconds = secs;
        t.is_running = true;
        t.target_end_time = Some(now_ms + (secs as i64) * 1000);
        t.stopwatch_started_at = None;
        t.stopwatch_accumulated_secs = Some(0);
        t.session_started_at = Some(Utc::now().to_rfc3339());
        t.active_target = Some(target);
        t.clone()
    };

    ensure_taskbar_window(app);
    rebuild_tray_menu(app);
    let _ = app.emit("timer:sync", next_state);
}

#[tauri::command]
fn store_get_app_data(state: State<'_, AppState>) -> AppData {
    let mut data = state.store.get_app_data();
    data.last_synced_at = state.last_google_sync.lock().unwrap().clone();
    data
}

#[tauri::command]
fn store_save_projects(app: AppHandle, state: State<'_, AppState>, projects: Vec<Project>) {
    state.store.save_projects(projects);
    rebuild_tray_menu(&app);
}

#[tauri::command]
fn store_save_tasks(app: AppHandle, state: State<'_, AppState>, tasks: Vec<TaskItem>) {
    state.store.save_tasks(tasks);
    rebuild_tray_menu(&app);
}

#[tauri::command]
fn store_save_templates(
    app: AppHandle,
    state: State<'_, AppState>,
    templates: Vec<TaskTemplate>,
) {
    state.store.save_templates(templates);
    let _ = app.emit("data:updated", ());
}

#[tauri::command]
fn store_add_session(state: State<'_, AppState>, session: PomodoroSession) {
    state.store.add_session(session);
}

#[tauri::command]
fn store_mark_session_logged(state: State<'_, AppState>, session_id: String) {
    state.store.mark_session_logged(&session_id);
}

#[tauri::command]
fn store_update_session_note(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    note: Option<String>,
) {
    state.store.update_session_note(&session_id, note);
    let _ = app.emit("data:updated", ());
}

#[tauri::command]
fn store_export_backup(state: State<'_, AppState>) -> Result<String, String> {
    state.store.export_backup_json()
}

#[tauri::command]
fn store_import_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    json: String,
) -> Result<(), String> {
    state.store.import_backup_json(&json)?;
    *state.cached_events.lock().unwrap() = state.store.get_local_events();
    apply_hotkeys(&app);
    rebuild_tray_menu(&app);
    let _ = app.emit("data:updated", ());
    Ok(())
}

#[tauri::command]
async fn google_flush_sync_queue(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (applied, remaining) = google_api::flush_sync_queue(&state.store).await?;
    *state.last_google_sync.lock().unwrap() = Some(Utc::now().to_rfc3339());
    rebuild_tray_menu(&app);
    let _ = app.emit("data:updated", ());
    Ok(serde_json::json!({
        "applied": applied,
        "remaining": remaining
    }))
}

#[tauri::command]
async fn planner_plan_my_day(
    app: AppHandle,
    state: State<'_, AppState>,
    date_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let date = planner::parse_date_key(date_key.as_deref());
    let res = planner::plan_day_tasks(&state.store, date).await?;
    let (s_iso, e_iso) = planner::day_bounds_iso(chrono::Local::now().date_naive());
    if let Ok(evts) = google_api::fetch_calendar_events(&state.store, s_iso, e_iso).await {
        *state.cached_events.lock().unwrap() = evts;
    }
    rebuild_tray_menu(&app);
    let _ = app.emit("data:updated", ());
    Ok(res)
}

#[tauri::command]
fn store_save_settings(app: AppHandle, state: State<'_, AppState>, settings: AppSettings) {
    let previous = state.store.get_settings();
    let hotkeys_changed = previous.global_hotkeys != settings.global_hotkeys
        || previous.hotkey_timer != settings.hotkey_timer
        || previous.hotkey_quick_add != settings.hotkey_quick_add;
    let demo_changed = previous.demo_mode != settings.demo_mode;
    let autostart = settings.start_with_windows;
    state.store.save_settings(settings);
    if demo_changed {
        let mut cached = state.cached_events.lock().unwrap();
        cached.retain(|e| !e.id.starts_with("demo-evt-"));
        if !state.store.get_app_data().google_connected {
            *cached = state.store.get_local_events();
        }
    }
    if hotkeys_changed {
        apply_hotkeys(&app);
    }
    if previous.start_with_windows != autostart && !apply_autostart(autostart) {
        eprintln!("FocusFlow: could not update the start-with-Windows setting");
    }
    rebuild_tray_menu(&app);
}

#[tauri::command]
fn taskbar_take_pending_quick_add() -> bool {
    PENDING_QUICK_ADD.swap(false, std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
async fn planner_shift_following_blocks(
    app: AppHandle,
    state: State<'_, AppState>,
    anchor_event_id: String,
    delay_minutes: i64,
) -> Result<serde_json::Value, String> {
    let shifted =
        planner::shift_following_blocks(&state.store, &anchor_event_id, delay_minutes).await?;
    if !shifted.is_empty() {
        let (s_iso, e_iso) = planner::day_bounds_iso(Local::now().date_naive());
        if let Ok(evts) = google_api::fetch_calendar_events(&state.store, s_iso, e_iso).await {
            *state.cached_events.lock().unwrap() = evts;
        }
        rebuild_tray_menu(&app);
        let _ = app.emit("data:updated", ());
    }
    Ok(serde_json::json!({ "ok": true, "shifted": shifted }))
}

#[tauri::command]
async fn planner_shutdown_review(
    app: AppHandle,
    state: State<'_, AppState>,
    roll_unfinished: bool,
    write_obsidian: bool,
    dry_run: bool,
) -> Result<serde_json::Value, String> {
    let today = Local::now().date_naive();
    let res =
        planner::run_shutdown_review(&state.store, today, roll_unfinished, write_obsidian, dry_run)
            .await?;
    if roll_unfinished && !dry_run {
        rebuild_tray_menu(&app);
        let _ = app.emit("data:updated", ());
    }
    Ok(res)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SecurityInfo {
    vault_active: bool,
    token_path: String,
    hotkey_errors: Vec<String>,
}

#[tauri::command]
fn app_security_info(state: State<'_, AppState>) -> SecurityInfo {
    SecurityInfo {
        vault_active: state.store.vault_active(),
        token_path: ai_server::token_path().display().to_string(),
        hotkey_errors: HOTKEY_ERRORS.lock().unwrap_or_else(|e| e.into_inner()).clone(),
    }
}

#[tauri::command]
fn ai_get_token() -> String {
    ai_server::current_token()
}

#[tauri::command]
fn ai_regenerate_token() -> Result<String, String> {
    ai_server::regenerate_token()
}

#[tauri::command]
fn ai_get_audit(limit: Option<usize>) -> Vec<serde_json::Value> {
    ai_server::read_audit(limit.unwrap_or(30))
}

#[tauri::command]
async fn ai_undo(app: AppHandle, id: i64) -> Result<String, String> {
    ai_server::undo_audit(&app, id).await
}

#[tauri::command]
fn store_save_event_metadata(
    app: AppHandle,
    state: State<'_, AppState>,
    event_id: String,
    meta: EventMetadata,
) {
    state.store.save_event_metadata(event_id, meta);
    rebuild_tray_menu(&app);
}

#[tauri::command]
fn store_link_task_to_event(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    event_id: Option<String>,
) {
    state.store.set_task_event_link(task_id, event_id);
    rebuild_tray_menu(&app);
}

#[tauri::command]
fn window_toggle_floating(app: AppHandle, state: State<'_, AppState>) -> bool {
    window_toggle_taskbar_widget(app, state)
}

#[tauri::command]
fn window_open_floating(app: AppHandle) {
    ensure_floating_window(&app);
}

#[tauri::command]
fn window_close_floating(app: AppHandle, state: State<'_, AppState>) {
    window_close_taskbar_widget(app, state);
}

#[tauri::command]
fn floating_center_top(app: AppHandle, state: State<'_, AppState>) {
    state.store.set_floating_pos(None);
    state.store.set_taskbar_pos(None);
    state.store.set_taskbar_dock(None);
    *state.taskbar_dock.lock().unwrap() = None;
    let _ = app.emit("taskbar:dock", Option::<String>::None);
    *state.taskbar_custom_pos.lock().unwrap() = None;
    ensure_floating_window(&app);
    if let Some(win) = app.get_webview_window("floating") {
        let (x, y) = get_taskbar_logical(&app, None);
        let _ = win.set_position(LogicalPosition::new(x, y));
    }
}

#[tauri::command]
fn floating_move_position(
    app: AppHandle,
    state: State<'_, AppState>,
    screen_x: f64,
    screen_y: f64,
    offset_x: f64,
    offset_y: f64,
) {
    taskbar_move_position(app, state, screen_x, screen_y, offset_x, offset_y);
}

#[tauri::command]
fn floating_set_dragging(app: AppHandle, state: State<'_, AppState>, dragging: bool) {
    taskbar_set_dragging(app, state, dragging);
}

#[tauri::command]
fn window_set_floating_expanded(
    app: AppHandle,
    state: State<'_, AppState>,
    expanded: bool,
    _extra_height: Option<f64>,
) {
    taskbar_set_expanded(app, state, expanded);
}

#[tauri::command]
fn window_toggle_taskbar_widget(app: AppHandle, state: State<'_, AppState>) -> bool {
    if let Some(win) = app.get_webview_window("floating") {
        if win.is_visible().unwrap_or(false) {
            *state.is_taskbar_expanded.lock().unwrap() = false;
            *state.is_taskbar_dragging.lock().unwrap() = false;
            let _ = win.hide();
            return false;
        }
    }
    ensure_taskbar_window(&app);
    true
}

#[tauri::command]
fn window_close_taskbar_widget(app: AppHandle, state: State<'_, AppState>) {
    *state.is_taskbar_expanded.lock().unwrap() = false;
    *state.is_taskbar_dragging.lock().unwrap() = false;
    if let Some(win) = app.get_webview_window("floating") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn window_move_to_taskbar(app: AppHandle) {
    ensure_taskbar_window(&app);
    let _ = app.emit("taskbar:visibility", true);
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.hide();
    }
}

#[tauri::command]
fn taskbar_set_expanded(app: AppHandle, state: State<'_, AppState>, expanded: bool) {
    *state.is_taskbar_expanded.lock().unwrap() = expanded;
    if let Some(win) = app.get_webview_window("floating") {
        let _ = win.set_always_on_top(true);
        if expanded {
            *state.is_taskbar_interactive.lock().unwrap() = true;
            let _ = win.set_ignore_cursor_events(false);
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn taskbar_move_horizontal(
    app: AppHandle,
    state: State<'_, AppState>,
    screen_x: f64,
    offset_x: f64,
) {
    if let Some(win) = app.get_webview_window("floating") {
        let next_x = (screen_x - offset_x).round();
        let current_y = state
            .taskbar_custom_pos
            .lock()
            .unwrap()
            .map(|(_, y)| y)
            .unwrap_or_else(|| get_taskbar_logical(&app, None).1);
        *state.taskbar_custom_pos.lock().unwrap() = Some((next_x, current_y));
        let (clamped_x, clamped_y) = get_taskbar_logical(&app, Some((next_x, current_y)));
        let _ = win.set_position(LogicalPosition::new(clamped_x, clamped_y));
    }
}

#[tauri::command]
fn taskbar_move_position(
    app: AppHandle,
    state: State<'_, AppState>,
    screen_x: f64,
    screen_y: f64,
    offset_x: f64,
    offset_y: f64,
) {
    *state.is_taskbar_dragging.lock().unwrap() = true;
    *state.is_taskbar_interactive.lock().unwrap() = true;
    if let Some(win) = app.get_webview_window("floating") {
        let _ = win.set_ignore_cursor_events(false);
        let next_x = (screen_x - offset_x).round();
        let next_y = (screen_y - offset_y).round();
        let (clamped_x, clamped_y) = get_taskbar_logical(&app, Some((next_x, next_y)));
        *state.taskbar_custom_pos.lock().unwrap() = Some((clamped_x, clamped_y));
        let _ = win.set_position(LogicalPosition::new(clamped_x, clamped_y));
    }
}

#[tauri::command]
fn taskbar_set_dragging(app: AppHandle, state: State<'_, AppState>, dragging: bool) {
    *state.is_taskbar_dragging.lock().unwrap() = dragging;
    if !dragging {
        resolve_taskbar_dock(&app, &state);
        let pos = *state.taskbar_custom_pos.lock().unwrap();
        if pos.is_some() {
            state.store.set_taskbar_pos(pos);
        }
    }
}

/// The web UI reports the on-screen rect of the pill so hover/click hit-testing
/// and edge-docking use its real size instead of hard-coded constants.
#[tauri::command]
fn taskbar_report_rect(state: State<'_, AppState>, x: f64, y: f64, w: f64, h: f64, slop: Option<f64>) {
    if w > 1.0 && h > 1.0 {
        *state.taskbar_rect.lock().unwrap() = Some((x, y, w, h, slop.unwrap_or(0.0).max(0.0)));
    }
}

#[tauri::command]
fn taskbar_get_dock(state: State<'_, AppState>) -> Option<String> {
    state.taskbar_dock.lock().unwrap().clone()
}

/// After a drag ends: snap the pill to the nearest screen edge (or release it from one)
/// and tell the web UI which layout to use.
fn resolve_taskbar_dock(app: &AppHandle, state: &AppState) {
    let Some((rx, ry, rw, rh, _)) = *state.taskbar_rect.lock().unwrap() else {
        return;
    };
    let Some((px, py)) = *state.taskbar_custom_pos.lock().unwrap() else {
        return;
    };
    let (sx, sy) = (px + rx, py + ry);
    let (wa_x, wa_y, wa_w, wa_h) =
        monitor_work_area_for(app, Some((sx + rw / 2.0, sy + rh / 2.0)));

    let distances = [
        ("left", sx - wa_x),
        ("right", wa_x + wa_w - (sx + rw)),
        ("top", sy - wa_y),
        ("bottom", wa_y + wa_h - (sy + rh)),
    ];
    let mut best: Option<(&str, f64)> = None;
    for (side, d) in distances {
        if d <= DOCK_SNAP_PX && best.map(|b| d < b.1).unwrap_or(true) {
            best = Some((side, d));
        }
    }
    let prev = state.taskbar_dock.lock().unwrap().clone();
    let next = best.map(|b| b.0.to_string());
    if prev.is_none() && next.is_none() {
        return;
    }

    let half = DOCK_BAR_LEN / 2.0;
    let clamp_c = |c: f64, lo: f64, hi: f64| c.max(lo + half + 8.0).min(hi - half - 8.0);
    let (new_x, new_y) = match next.as_deref() {
        Some("left") | Some("right") => {
            let cy = clamp_c(sy + rh / 2.0, wa_y, wa_y + wa_h);
            let y = cy - (FLOATING_WIN_HEIGHT - 4.0 - half);
            let x = if next.as_deref() == Some("left") {
                wa_x
            } else {
                wa_x + wa_w - FLOATING_WIN_WIDTH
            };
            (x, y)
        }
        Some("top") | Some("bottom") => {
            let cx = clamp_c(sx + rw / 2.0, wa_x, wa_x + wa_w);
            let x = cx - 4.0 - half;
            let y = if next.as_deref() == Some("top") {
                wa_y
            } else {
                wa_y + wa_h - FLOATING_WIN_HEIGHT
            };
            (x, y)
        }
        // Released from an edge: default layout anchors the pill bottom-left with 4px padding.
        _ => (sx - 4.0, sy + rh - (FLOATING_WIN_HEIGHT - 4.0)),
    };

    *state.taskbar_dock.lock().unwrap() = next.clone();
    state.store.set_taskbar_dock(next.clone());
    *state.taskbar_custom_pos.lock().unwrap() = Some((new_x, new_y));
    if let Some(win) = app.get_webview_window("floating") {
        let (cx, cy) = if next.is_some() {
            (new_x, new_y)
        } else {
            get_taskbar_logical(app, Some((new_x, new_y)))
        };
        *state.taskbar_custom_pos.lock().unwrap() = Some((cx, cy));
        let _ = win.set_position(LogicalPosition::new(cx, cy));
    }
    let _ = app.emit("taskbar:dock", next);
}

#[tauri::command]
fn app_open_external(state: State<'_, AppState>, url: String) {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return;
    }
    let target = if trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("obsidian://")
        || trimmed.starts_with("zotero://")
    {
        trimmed.to_string()
    } else if !trimmed.contains("://") {
        // Treat relative Markdown / Obsidian vault paths as obsidian://open?path=...
        let base = state.store.get_settings().obsidian_vault_path;
        let full = if std::path::Path::new(trimmed).is_absolute() {
            std::path::PathBuf::from(trimmed)
        } else if let Some(vault) = base.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            std::path::PathBuf::from(vault).join(trimmed)
        } else {
            return;
        };
        let encoded = full.to_string_lossy().replace(' ', "%20");
        format!("obsidian://open?path={}", encoded)
    } else {
        return;
    };
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &target])
        .spawn();
}

#[tauri::command]
fn app_notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
fn window_show_main(app: AppHandle) {
    ensure_main_window(&app);
}

#[tauri::command]
fn timer_get(state: State<'_, AppState>) -> TimerState {
    state.timer.lock().unwrap().clone()
}

#[tauri::command]
fn timer_update(app: AppHandle, state: State<'_, AppState>, timer_state: TimerState) {
    *state.timer.lock().unwrap() = timer_state.clone();
    rebuild_tray_menu(&app);
    let _ = app.emit("timer:sync", timer_state);
}

#[tauri::command]
fn ambient_get(state: State<'_, AppState>) -> String {
    state.ambient_preset.lock().unwrap().clone()
}

#[tauri::command]
fn ambient_set(app: AppHandle, state: State<'_, AppState>, preset: String) {
    *state.ambient_preset.lock().unwrap() = preset.clone();
    let _ = app.emit("ambient:sync", preset);
}

#[tauri::command]
fn data_notify_updated(app: AppHandle) {
    rebuild_tray_menu(&app);
    let _ = app.emit("data:updated", ());
}

#[tauri::command]
async fn google_connect(app: AppHandle, state: State<'_, AppState>) -> Result<AuthResult, String> {
    let res = google_auth::start_google_oauth(state.store.clone()).await;
    rebuild_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
fn google_disconnect(app: AppHandle, state: State<'_, AppState>) {
    state.store.set_tokens(None);
    rebuild_tray_menu(&app);
}

#[tauri::command]
async fn google_fetch_calendar_lists(
    state: State<'_, AppState>,
) -> Result<Vec<GoogleCalendarInfo>, String> {
    google_api::fetch_calendar_lists(&state.store).await
}

#[tauri::command]
async fn google_fetch_events(
    app: AppHandle,
    state: State<'_, AppState>,
    time_min: String,
    time_max: String,
) -> Result<Vec<CalendarEvent>, String> {
    let evts = google_api::fetch_calendar_events(&state.store, time_min, time_max).await?;
    *state.cached_events.lock().unwrap() = evts.clone();
    if state.store.get_tokens().is_some() {
        *state.last_google_sync.lock().unwrap() = Some(Utc::now().to_rfc3339());
    }
    rebuild_tray_menu(&app);
    Ok(evts)
}

#[tauri::command]
async fn google_create_event(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CreateEventPayload,
) -> Result<CalendarEvent, String> {
    let created = google_api::create_calendar_event(&state.store, payload).await?;
    state.cached_events.lock().unwrap().push(created.clone());
    rebuild_tray_menu(&app);
    Ok(created)
}

#[tauri::command]
async fn google_update_event(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: UpdateEventPayload,
) -> Result<CalendarEvent, String> {
    let updated = google_api::update_calendar_event(&state.store, payload).await?;
    {
        let mut cached = state.cached_events.lock().unwrap();
        if let Some(existing) = cached.iter_mut().find(|e| e.id == updated.id) {
            *existing = updated.clone();
        }
    }
    rebuild_tray_menu(&app);
    Ok(updated)
}

#[tauri::command]
async fn google_delete_event(
    app: AppHandle,
    state: State<'_, AppState>,
    calendar_id: String,
    event_id: String,
) -> Result<(), String> {
    google_api::delete_calendar_event(&state.store, calendar_id, event_id.clone()).await?;
    state
        .cached_events
        .lock()
        .unwrap()
        .retain(|e| e.id != event_id);
    rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
async fn google_sync_tasks(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncTasksResult, String> {
    let res = google_api::sync_google_tasks(&state.store).await?;
    if state.store.get_tokens().is_some() {
        *state.last_google_sync.lock().unwrap() = Some(Utc::now().to_rfc3339());
    }
    rebuild_tray_menu(&app);
    Ok(res)
}

#[tauri::command]
async fn google_create_task(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    notes: Option<String>,
    task_list_id: Option<String>,
) -> Result<TaskItem, String> {
    let created = google_api::create_google_task(&state.store, title, notes, task_list_id).await?;
    rebuild_tray_menu(&app);
    Ok(created)
}

#[tauri::command]
async fn google_update_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_list_id: String,
    task_id: String,
    patch: UpdateTaskPatch,
) -> Result<(), String> {
    google_api::update_google_task(&state.store, task_list_id, task_id, patch).await?;
    rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
async fn google_delete_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_list_id: String,
    task_id: String,
) -> Result<(), String> {
    google_api::delete_google_task(&state.store, task_list_id, task_id).await?;
    rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
async fn google_toggle_task(
    app: AppHandle,
    state: State<'_, AppState>,
    task_list_id: String,
    task_id: String,
    completed: bool,
) -> Result<(), String> {
    google_api::toggle_google_task(&state.store, task_list_id, task_id, completed).await?;
    rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
async fn google_move_task(
    app: AppHandle,
    state: State<'_, AppState>,
    local_task_id: String,
    parent_local_task_id: Option<String>,
) -> Result<(), String> {
    google_api::sync_task_parent_move(
        &state.store,
        &local_task_id,
        parent_local_task_id.as_deref(),
    )
    .await;
    rebuild_tray_menu(&app);
    Ok(())
}

fn start_background_loops(app: AppHandle) {
    let app_cursor = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(50));
        let Some(state) = app_cursor.try_state::<AppState>() else {
            continue;
        };
        let Ok(cursor) = app_cursor.cursor_position() else {
            continue;
        };

        // Unified morphing Floating Widget hit-testing (idle pill <-> active Pomodoro capsule + pull-up drawer)
        if let Some(twin) = app_cursor.get_webview_window("floating") {
            if twin.is_visible().unwrap_or(false) {
                let is_dragging = *state.is_taskbar_dragging.lock().unwrap();
                if is_dragging {
                    let _ = twin.set_ignore_cursor_events(false);
                } else {
                    let scale = twin.scale_factor().unwrap_or(1.0);
                    if let Ok(pos) = twin.outer_position() {
                        let expanded = *state.is_taskbar_expanded.lock().unwrap();
                        let timer_active = {
                            let t = state.timer.lock().unwrap();
                            t.is_running || t.active_target.is_some()
                        };
                        let win_w = FLOATING_WIN_WIDTH * scale;
                        let win_h = FLOATING_WIN_HEIGHT * scale;
                        let bx = pos.x as f64;
                        let by = pos.y as f64;

                        let inside = if expanded {
                            cursor.x >= bx - 6.0 * scale
                                && cursor.x <= bx + win_w + 6.0 * scale
                                && cursor.y >= by - 6.0 * scale
                                && cursor.y <= by + win_h + 6.0 * scale
                        } else if let Some((rx, ry, rw, rh, slop)) =
                            *state.taskbar_rect.lock().unwrap()
                        {
                            let pill_x = bx + (rx - slop) * scale;
                            let pill_y = by + (ry - slop) * scale;
                            let pill_w = (rw + 2.0 * slop) * scale;
                            let pill_h = (rh + 2.0 * slop) * scale;
                            cursor.x >= pill_x - 4.0 * scale
                                && cursor.x <= pill_x + pill_w + 4.0 * scale
                                && cursor.y >= pill_y - 4.0 * scale
                                && cursor.y <= pill_y + pill_h + 4.0 * scale
                        } else {
                            let (hit_w, hit_h) = if timer_active {
                                (ACTIVE_CAPSULE_HIT_W, ACTIVE_CAPSULE_HIT_H)
                            } else {
                                (IDLE_PILL_HIT_W, IDLE_PILL_HIT_H)
                            };
                            let pill_x = bx;
                            let pill_y = by + win_h - hit_h * scale;
                            cursor.x >= pill_x - 4.0 * scale
                                && cursor.x <= pill_x + hit_w * scale
                                && cursor.y >= pill_y - 4.0 * scale
                                && cursor.y <= by + win_h + 4.0 * scale
                        };

                        {
                            let mut hv = state.taskbar_hover.lock().unwrap();
                            if *hv != inside {
                                *hv = inside;
                                let _ = app_cursor.emit("taskbar:hover", inside);
                            }
                        }

                        let prev_inter = *state.is_taskbar_interactive.lock().unwrap();
                        if inside != prev_inter {
                            *state.is_taskbar_interactive.lock().unwrap() = inside;
                            let _ = twin.set_ignore_cursor_events(!inside);
                        }
                    }
                }
            }
        }
    });

    // 400ms Pomodoro & Stopwatch timer loop
    let app_timer = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let Some(state) = app_timer.try_state::<AppState>() else {
            continue;
        };

        let mut broadcast: Option<TimerState> = None;
        let mut completed_just_now = false;
        let mut completed_info: Option<(String, Option<String>, u32)> = None;
        {
            let mut t = state.timer.lock().unwrap();
            if !t.is_running {
                continue;
            }
            let now_ms = Utc::now().timestamp_millis();

            if t.mode == "stopwatch" {
                if let Some(started_at) = t.stopwatch_started_at {
                    let accum = t.stopwatch_accumulated_secs.unwrap_or(0);
                    let elapsed = accum + ((now_ms - started_at).max(0) / 1000) as u32;
                    if elapsed != t.seconds_left {
                        t.seconds_left = elapsed;
                        broadcast = Some(t.clone());
                    }
                }
            } else if let Some(target_end) = t.target_end_time {
                let remaining = ((target_end - now_ms + 999).max(0) / 1000) as u32;
                if remaining == 0 {
                    t.seconds_left = 0;
                    t.is_running = false;
                    t.target_end_time = None;
                    if t.mode == "focus" {
                        t.completed_focus_count = t.completed_focus_count.saturating_add(1);
                    }
                    t.completed_tick_id = Some(t.completed_tick_id.unwrap_or(0) + 1);
                    completed_just_now = true;
                    completed_info = Some((
                        t.mode.clone(),
                        t.active_target.as_ref().map(|a| a.title.clone()),
                        t.total_seconds,
                    ));
                    broadcast = Some(t.clone());
                } else if remaining != t.seconds_left {
                    t.seconds_left = remaining;
                    broadcast = Some(t.clone());
                }
            }
        }

        if completed_just_now {
            rebuild_tray_menu(&app_timer);
            if let Some((mode, title, total)) = completed_info {
                announce_completion(&app_timer, &mode, title, total);
            }
        }
        if let Some(next_state) = broadcast {
            let _ = app_timer.emit("timer:sync", next_state);
        }
    });

    // 15s Pre-event Windows reminder loop
    let app_gsync = app.clone();
    let app_rem = app;
    std::thread::spawn(move || {
        let mut reminded: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let Some(state) = app_rem.try_state::<AppState>() else {
                continue;
            };
            let settings = state.store.get_settings();
            let now_ts = Utc::now().timestamp();

            for custom_rem in state.store.pop_due_reminders(now_ts) {
                let body = custom_rem
                    .body
                    .clone()
                    .unwrap_or_else(|| "FocusFlow scheduled reminder".to_string());
                store::append_app_log("REMINDER", &format!("Fired reminder '{}'", custom_rem.title));
                let _ = app_rem
                    .notification()
                    .builder()
                    .title(&custom_rem.title)
                    .body(&body)
                    .show();
                let _ = app_rem.emit("reminder:fired", custom_rem);
            }

            if settings.pre_event_reminder_minutes == 0 {
                continue;
            }
            let lead_secs = (settings.pre_event_reminder_minutes as i64) * 60;
            let mut evts = state.cached_events.lock().unwrap().clone();
            for le in state.store.get_local_events() {
                if !evts.iter().any(|e| e.id == le.id) {
                    evts.push(le);
                }
            }
            for evt in evts {
                if evt.is_all_day.unwrap_or(false) {
                    continue;
                }
                let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&evt.start) else {
                    continue;
                };
                let diff = dt.timestamp() - now_ts;
                if diff > 0 && diff <= lead_secs {
                    let key = format!("{}-{}", evt.id, evt.start);
                    if reminded.insert(key) {
                        let mins_away = ((diff + 59) / 60).max(1);
                        let _ = app_rem
                            .notification()
                            .builder()
                            .title(&format!("Starting in {}m: {}", mins_away, evt.summary))
                            .body("Choose Snooze 5m/15m/30m or click to open FocusFlow.")
                            .action_type_id("pre_start_snooze")
                            .extra("itemKind", "event")
                            .extra("itemId", &evt.id)
                            .extra("itemTitle", &evt.summary)
                            .extra("itemStart", &evt.start)
                            .show();
                        let _ = app_rem.emit("event:upcoming", evt);
                    }
                }
            }

            // Also notify for scheduled tasks about to start (without duplicating linked events)
            let app_data_tasks = state.store.get_app_data().tasks;
            for task in app_data_tasks {
                if task.completed || task.linked_event_id.is_some() || task.calendar_event_id.is_some() {
                    continue;
                }
                let Some(ref sched_start) = task.scheduled_start else {
                    continue;
                };
                let Ok(dt) = chrono::DateTime::parse_from_rfc3339(sched_start) else {
                    continue;
                };
                let diff = dt.timestamp() - now_ts;
                if diff > 0 && diff <= lead_secs {
                    let key = format!("task-{}-{}", task.id, sched_start);
                    if reminded.insert(key) {
                        let mins_away = ((diff + 59) / 60).max(1);
                        let _ = app_rem
                            .notification()
                            .builder()
                            .title(&format!("Task starting in {}m: {}", mins_away, task.title))
                            .body("Choose Snooze 5m/15m/30m or click to open FocusFlow.")
                            .action_type_id("pre_start_snooze")
                            .extra("itemKind", "task")
                            .extra("itemId", &task.id)
                            .extra("itemTitle", &task.title)
                            .extra("itemStart", sched_start)
                            .show();
                        let _ = app_rem.emit("task:upcoming", task);
                    }
                }
            }
        }
    });

    // 120s automatic background Google Calendar & Tasks sync loop
    let app_guard = app_gsync.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            let should_sync = app_gsync
                .try_state::<AppState>()
                .map(|s| s.store.get_tokens().is_some())
                .unwrap_or(false);
            if should_sync {
                run_background_google_sync(&app_gsync).await;
            }
        }
    });

    // 2s Distraction Guard + Idle Detection loop
    std::thread::spawn(move || {
        let mut last_blocked_notice: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();
        let mut idle_paused_for_run = false;
        let mut idle_return_pending: Option<(String, u32, u32, Option<String>)> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let Some(state) = app_guard.try_state::<AppState>() else {
                continue;
            };

            if let Some((ref title, elapsed_mins, idle_mins, ref task_id)) = idle_return_pending {
                if win_guard::idle_seconds().unwrap_or(999) < 5 {
                    let payload = serde_json::json!({
                        "title": title,
                        "elapsedMinutes": elapsed_mins,
                        "idleMinutes": idle_mins,
                        "taskId": task_id,
                    });
                    idle_return_pending = None;
                    let _ = app_guard.emit("idle:returned", payload);
                }
            }

            let is_focus_running = {
                let t = state.timer.lock().unwrap();
                t.is_running && (t.mode == "focus" || t.mode == "stopwatch")
            };
            if !is_focus_running {
                idle_paused_for_run = false;
                continue;
            }
            // User manually resumed/restarted before idle detection fired
            idle_return_pending = None;

            let settings = state.store.get_settings();
            if settings.idle_pause_minutes > 0 {
                if let Some(idle_secs) = win_guard::idle_seconds() {
                    let threshold = settings.idle_pause_minutes.saturating_mul(60);
                    if !idle_paused_for_run && idle_secs >= threshold {
                        idle_paused_for_run = true;
                        let (next_state, snap_title, elapsed_mins, snap_tid) = {
                            let mut t = state.timer.lock().unwrap();
                            let elapsed_secs = if t.mode == "stopwatch" {
                                t.seconds_left
                            } else {
                                t.total_seconds.saturating_sub(t.seconds_left)
                            };
                            if t.is_running {
                                t.is_running = false;
                                t.target_end_time = None;
                                if t.mode == "stopwatch" {
                                    t.stopwatch_started_at = None;
                                    t.stopwatch_accumulated_secs = Some(t.seconds_left);
                                }
                            }
                            let ttl = t
                                .active_target
                                .as_ref()
                                .map(|a| a.title.clone())
                                .unwrap_or_else(|| "Focus Session".to_string());
                            let tid = t.active_target.as_ref().and_then(|a| {
                                a.linked_task_id.clone().or_else(|| {
                                    if a.target_type == "task" {
                                        a.id.clone()
                                    } else {
                                        None
                                    }
                                })
                            });
                            (t.clone(), ttl, (elapsed_secs / 60).max(1), tid)
                        };
                        idle_return_pending = Some((
                            snap_title,
                            elapsed_mins,
                            settings.idle_pause_minutes,
                            snap_tid,
                        ));
                        rebuild_tray_menu(&app_guard);
                        let _ = app_guard.emit("timer:sync", next_state);
                        let msg = format!(
                            "Idle detected ({}m) — paused active focus timer",
                            settings.idle_pause_minutes
                        );
                        store::append_app_log("GUARD", &msg);
                        let _ = app_guard.emit("distraction:alert", msg.clone());
                        let _ = app_guard
                            .notification()
                            .builder()
                            .title("FocusFlow Idle Pause")
                            .body(&msg)
                            .show();
                        continue;
                    }
                }
            }

            if settings.distraction_guard_enabled && !settings.blocked_apps_or_sites.is_empty() {
                if let Some(matched) =
                    win_guard::check_and_minimize_distraction(&settings.blocked_apps_or_sites)
                {
                    let now_ts = Utc::now().timestamp();
                    let cooldown_ok = last_blocked_notice
                        .get(&matched)
                        .map(|&ts| now_ts - ts >= 15)
                        .unwrap_or(true);
                    if cooldown_ok {
                        last_blocked_notice.insert(matched.clone(), now_ts);
                        let msg = format!(
                            "Distraction Guard minimized blocked app/site: {}",
                            matched
                        );
                        store::append_app_log("GUARD", &msg);
                        let _ = app_guard.emit("distraction:alert", msg.clone());
                        let _ = app_guard
                            .notification()
                            .builder()
                            .title("FocusFlow Distraction Guard")
                            .body(&msg)
                            .show();
                    }
                }
            }
        }
    });
}

#[cfg(windows)]
mod win_guard {
    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
        fn ShowWindow(hwnd: isize, n_cmd_show: i32) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> isize;
        fn QueryFullProcessImageNameW(
            h_process: isize,
            dw_flags: u32,
            lp_exe_name: *mut u16,
            lpdw_size: *mut u32,
        ) -> i32;
        fn CloseHandle(h_object: isize) -> i32;
    }

    pub fn idle_seconds() -> Option<u32> {
        let mut lii = LastInputInfo {
            cb_size: std::mem::size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        // SAFETY: `lii` is stack-allocated with exact cb_size.
        let ok = unsafe { GetLastInputInfo(&mut lii) };
        if ok == 0 {
            return None;
        }
        let now = unsafe { GetTickCount() };
        Some(now.wrapping_sub(lii.dw_time) / 1000)
    }

    pub fn check_and_minimize_distraction(blocked_terms: &[String]) -> Option<String> {
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        const SW_MINIMIZE: i32 = 6;

        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd == 0 {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32) };
        let title = if len > 0 {
            String::from_utf16_lossy(&title_buf[..len as usize]).to_lowercase()
        } else {
            String::new()
        };

        let mut pid: u32 = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        let mut exe_name = String::new();
        if pid != 0 && pid != std::process::id() {
            let hproc = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
            if hproc != 0 {
                let mut exe_buf = [0u16; 512];
                let mut sz = exe_buf.len() as u32;
                if unsafe { QueryFullProcessImageNameW(hproc, 0, exe_buf.as_mut_ptr(), &mut sz) }
                    != 0
                {
                    exe_name =
                        String::from_utf16_lossy(&exe_buf[..sz as usize]).to_lowercase();
                }
                unsafe {
                    CloseHandle(hproc);
                }
            }
        } else if pid == std::process::id() {
            return None;
        }

        if title.contains("focusflow") {
            return None;
        }

        for raw_term in blocked_terms {
            let term = raw_term.trim().to_lowercase();
            if term.is_empty() {
                continue;
            }
            if term_matches_window(&term, &title, &exe_name) {
                unsafe {
                    ShowWindow(hwnd, SW_MINIMIZE);
                }
                return Some(raw_term.trim().to_string());
            }
        }
        None
    }

    fn term_matches_window(raw_term: &str, title: &str, exe_name: &str) -> bool {
        let stripped = raw_term
            .strip_prefix("https://")
            .or_else(|| raw_term.strip_prefix("http://"))
            .unwrap_or(raw_term);
        let stripped = stripped.strip_prefix("www.").unwrap_or(stripped);
        let clean = stripped.split('/').next().unwrap_or(stripped).trim();
        if clean.is_empty() {
            return false;
        }

        if title.contains(clean) || exe_name.contains(clean) {
            return true;
        }

        if let Some(app_base) = clean.strip_suffix(".exe") {
            if app_base.len() >= 3 && (title.contains(app_base) || exe_name.contains(app_base)) {
                return true;
            }
        }

        // Browsers (including Zen Browser / Firefox) show page titles in HWND text, not URLs.
        match clean {
            "x.com" | "twitter.com" => {
                return title.contains("/ x")
                    || title.contains("x —")
                    || title.contains("x -")
                    || title.contains("twitter");
            }
            "news.ycombinator.com" => {
                return title.contains("hacker news") || title.contains("ycombinator");
            }
            "web.whatsapp.com" => return title.contains("whatsapp") || exe_name.contains("whatsapp"),
            "mail.google.com" => return title.contains("gmail"),
            _ => {}
        }

        if clean.contains('.') {
            let mut parts: Vec<&str> = clean.split('.').collect();
            if matches!(parts.first().copied(), Some("m" | "open" | "app" | "old")) && parts.len() > 2 {
                parts.remove(0);
            }
            if let Some(core) = parts.first() {
                if core.len() >= 4 && (title.contains(core) || exe_name.contains(core)) {
                    return true;
                }
            }
        }

        false
    }
}

#[cfg(not(windows))]
mod win_guard {
    pub fn idle_seconds() -> Option<u32> {
        None
    }
    pub fn check_and_minimize_distraction(_blocked_terms: &[String]) -> Option<String> {
        None
    }
}

pub(crate) async fn run_background_google_sync(app: &AppHandle) {
    let Some(s) = app.try_state::<AppState>() else {
        return;
    };
    let (s_iso, e_iso) = planner::day_bounds_iso(Local::now().date_naive());
    let mut had_error = false;
    match google_api::fetch_calendar_events(&s.store, s_iso, e_iso).await {
        Ok(evts) => {
            *s.cached_events.lock().unwrap() = evts;
        }
        Err(err) => {
            had_error = true;
            store::append_app_log("SYNC", &format!("Calendar sync error: {}", err));
        }
    }
    if let Err(err) = google_api::sync_google_tasks(&s.store).await {
        had_error = true;
        store::append_app_log("SYNC", &format!("Tasks sync error: {}", err));
    }
    if !had_error && s.store.get_tokens().is_some() {
        *s.last_google_sync.lock().unwrap() = Some(Utc::now().to_rfc3339());
    }
    rebuild_tray_menu(app);
    let _ = app.emit("data:updated", ());
}

fn main() {
    // Must run before anything touches the data file or the AI server port.
    if !single_instance::acquire() {
        tell_running_instance_to_show();
        return;
    }
    let store = Arc::new(LocalStore::new());
    let settings = store.get_settings();
    let initial_events = store.get_local_events();
    let initial_taskbar_pos = store.get_taskbar_pos();
    let initial_taskbar_dock = store.get_taskbar_dock();
    let initial_timer = TimerState {
        seconds_left: settings.focus_minutes * 60,
        total_seconds: settings.focus_minutes * 60,
        ..TimerState::default()
    };

    store::append_app_log("APP", "Starting FocusFlow desktop instance");
    let app_state = AppState {
        store,
        timer: Arc::new(Mutex::new(initial_timer)),
        cached_events: Arc::new(Mutex::new(initial_events)),
        is_taskbar_expanded: Arc::new(Mutex::new(false)),
        is_taskbar_interactive: Arc::new(Mutex::new(false)),
        is_taskbar_dragging: Arc::new(Mutex::new(false)),
        taskbar_custom_pos: Arc::new(Mutex::new(initial_taskbar_pos)),
        taskbar_dock: Arc::new(Mutex::new(initial_taskbar_dock)),
        taskbar_rect: Arc::new(Mutex::new(None)),
        taskbar_hover: Arc::new(Mutex::new(false)),
        is_quitting: Arc::new(Mutex::new(false)),
        ambient_preset: Arc::new(Mutex::new("off".to_string())),
        mcp_status: Arc::new(Mutex::new((false, "Starting...".to_string()))),
        last_google_sync: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();
            // Windows launches us with --autostart at sign-in: stay in the tray.
            let launched_at_login = std::env::args().any(|a| a == "--autostart");
            ensure_main_window_with(&handle, !launched_at_login);
            ensure_taskbar_window(&handle);
            register_notification_identity(&handle.config().identifier);

            let _ = handle.notification().register_action_types(vec![
                ActionType::builder("pre_start_snooze")
                    .actions(vec![
                        Action::builder("snooze_5m", "Snooze 5m").build(),
                        Action::builder("snooze_15m", "Snooze 15m").build(),
                        Action::builder("snooze_30m", "Snooze 30m").build(),
                    ])
                    .build(),
            ]);
            let notif_handle = handle.clone();
            let _ = handle.notification().on_action(move |performed| {
                let act_id = performed.action_id();
                let snooze_mins: Option<u64> = match act_id {
                    "snooze_5m" => Some(5),
                    "snooze_15m" => Some(15),
                    "snooze_30m" => Some(30),
                    _ => None,
                };
                if let Some(mins) = snooze_mins {
                    let extra = performed.notification().map(|n| n.extra());
                    let kind = extra
                        .and_then(|m| m.get("itemKind"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("event")
                        .to_string();
                    let item_id = extra
                        .and_then(|m| m.get("itemId"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let title = extra
                        .and_then(|m| m.get("itemTitle"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Upcoming item")
                        .to_string();
                    let start = extra
                        .and_then(|m| m.get("itemStart"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    store::append_app_log(
                        "REMINDER",
                        &format!("Snoozed {} '{}' for {}m from native notification", kind, title, mins),
                    );
                    let _ = notif_handle.emit(
                        "reminder:snoozed",
                        serde_json::json!({
                            "kind": kind,
                            "id": item_id,
                            "title": title,
                            "minutes": mins,
                        }),
                    );
                    let h2 = notif_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(mins * 60));
                        let _ = h2
                            .notification()
                            .builder()
                            .title(&format!("Snoozed reminder: {}", title))
                            .body("Choose Snooze 5m/15m/30m or click to open FocusFlow.")
                            .action_type_id("pre_start_snooze")
                            .extra("itemKind", &kind)
                            .extra("itemId", &item_id)
                            .extra("itemTitle", &title)
                            .extra("itemStart", &start)
                            .show();
                        if let Some(st) = h2.try_state::<AppState>() {
                            if kind == "task" {
                                if let Some(t) = st
                                    .store
                                    .get_app_data()
                                    .tasks
                                    .into_iter()
                                    .find(|t| t.id == item_id && !t.completed)
                                {
                                    let _ = h2.emit("task:upcoming", t);
                                }
                            } else {
                                let mut evts = st.cached_events.lock().unwrap().clone();
                                for le in st.store.get_local_events() {
                                    if !evts.iter().any(|e| e.id == le.id) {
                                        evts.push(le);
                                    }
                                }
                                if let Some(ev) = evts.into_iter().find(|e| e.id == item_id) {
                                    let _ = h2.emit("event:upcoming", ev);
                                }
                            }
                        }
                    });
                } else {
                    ensure_main_window_with(&notif_handle, true);
                }
            });

            if let Some(s) = handle.try_state::<AppState>() {
                let cfg = s.store.get_settings();
                apply_hotkeys(&handle);
                if cfg.start_with_windows {
                    // Keep the registry entry pointing at the current exe path.
                    apply_autostart(true);
                }
            }

            // Close-to-tray behavior on main window
            if let Some(main_win) = app.get_webview_window("main") {
                let h_close = handle.clone();
                let w_close = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let quitting = h_close
                            .try_state::<AppState>()
                            .map(|s| *s.is_quitting.lock().unwrap())
                            .unwrap_or(false);
                        if !quitting {
                            api.prevent_close();
                            let _ = w_close.hide();
                        }
                    }
                });
            }

            // Build system tray icon
            let icon = Image::from_bytes(include_bytes!("../../assets/tray.png"))
                .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

            let _ = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("FocusFlow — Tasks, Calendar & Pomodoro")
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "open_main" => {
                            ensure_main_window(app);
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.maximize();
                            }
                        }
                        "toggle_floating" => {
                            if let Some(s) = app.try_state::<AppState>() {
                                let _ = window_toggle_floating(app.clone(), s);
                            }
                        }
                        "toggle_taskbar" => {
                            if let Some(s) = app.try_state::<AppState>() {
                                let _ = window_toggle_taskbar_widget(app.clone(), s);
                            }
                        }
                        "tray_toggle_timer" => {
                            toggle_timer(app);
                        }
                        "tray_reset_timer" => {
                            if let Some(s) = app.try_state::<AppState>() {
                                let next_state = {
                                    let mut t = s.timer.lock().unwrap();
                                    t.is_running = false;
                                    t.seconds_left = if t.mode == "stopwatch" {
                                        0
                                    } else {
                                        t.total_seconds
                                    };
                                    t.target_end_time = None;
                                    t.stopwatch_started_at = None;
                                    t.stopwatch_accumulated_secs = Some(0);
                                    t.session_started_at = None;
                                    t.clone()
                                };
                                rebuild_tray_menu(app);
                                let _ = app.emit("timer:sync", next_state);
                            }
                        }
                        "sync_now" => {
                            let app_sync = app.clone();
                            tauri::async_runtime::spawn(async move {
                                run_background_google_sync(&app_sync).await;
                            });
                        }
                        "quit" => {
                            if let Some(s) = app.try_state::<AppState>() {
                                *s.is_quitting.lock().unwrap() = true;
                            }
                            app.exit(0);
                        }
                        other if other.starts_with("evt_") => {
                            if let (Ok(idx), Some(s)) = (
                                other.trim_start_matches("evt_").parse::<usize>(),
                                app.try_state::<AppState>(),
                            ) {
                                let mut evts = s.cached_events.lock().unwrap().clone();
                                if evts.is_empty() {
                                    evts = s.store.get_local_events();
                                }
                                let upcoming = get_upcoming_tray_events(&evts);
                                let def_mins = s.store.get_settings().focus_minutes.max(1);
                                if let Some(evt) = upcoming.get(idx) {
                                    let mins = calc_event_mins(evt, def_mins);
                                    start_pomodoro_from_tray(
                                        app,
                                        ActiveTarget {
                                            target_type: "event".to_string(),
                                            id: Some(evt.id.clone()),
                                            title: evt.summary.clone(),
                                            project_id: evt.project_id.clone(),
                                            calendar_event_id: Some(evt.id.clone()),
                                            linked_task_id: evt.linked_task_id.clone(),
                                            duration_minutes: Some(mins),
                                            next_subtask: None,
                                        },
                                    );
                                }
                            }
                        }
                        other if other.starts_with("task_") => {
                            if let (Ok(idx), Some(s)) = (
                                other.trim_start_matches("task_").parse::<usize>(),
                                app.try_state::<AppState>(),
                            ) {
                                let app_data = s.store.get_app_data();
                                let def_mins = app_data.settings.focus_minutes.max(1);
                                let evts = s.cached_events.lock().unwrap().clone();
                                let upcoming_tasks = get_upcoming_tray_tasks(&app_data);
                                if let Some(task) = upcoming_tasks.get(idx) {
                                    let mins = resolve_task_duration_mins(
                                        task, &evts, &app_data, def_mins,
                                    );
                                    start_pomodoro_from_tray(
                                        app,
                                        ActiveTarget {
                                            target_type: "task".to_string(),
                                            id: Some(task.id.clone()),
                                            title: task.title.clone(),
                                            project_id: task.project_id.clone(),
                                            calendar_event_id: task.linked_event_id.clone(),
                                            linked_task_id: Some(task.id.clone()),
                                            duration_minutes: Some(mins),
                                            next_subtask: task
                                                .subtasks
                                                .iter()
                                                .find(|st| !st.done)
                                                .map(|st| st.title.clone()),
                                        },
                                    );
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        ensure_main_window(app);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.maximize();
                        }
                    }
                })
                .build(app);

            rebuild_tray_menu(&handle);

            // Initial background sync of today's events & tasks for the tray menu
            let handle_init = handle.clone();
            tauri::async_runtime::spawn(async move {
                run_background_google_sync(&handle_init).await;
            });

            ai_server::start_ai_control_server(handle.clone());
            start_background_loops(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_get_app_data,
            store_save_projects,
            store_save_tasks,
            store_save_templates,
            store_add_session,
            store_mark_session_logged,
            store_update_session_note,
            store_export_backup,
            store_import_backup,
            store_save_settings,
            store_save_event_metadata,
            store_link_task_to_event,
            google_flush_sync_queue,
            planner_plan_my_day,
            planner_shift_following_blocks,
            planner_shutdown_review,
            taskbar_take_pending_quick_add,
            app_security_info,
            ai_get_token,
            ai_regenerate_token,
            ai_get_audit,
            ai_undo,
            window_toggle_floating,
            window_open_floating,
            window_close_floating,
            floating_center_top,
            floating_move_position,
            floating_set_dragging,
            window_set_floating_expanded,
            window_toggle_taskbar_widget,
            window_close_taskbar_widget,
            window_move_to_taskbar,
            taskbar_set_expanded,
            taskbar_move_horizontal,
            taskbar_move_position,
            taskbar_set_dragging,
            taskbar_report_rect,
            taskbar_get_dock,
            app_open_external,
            app_notify,
            window_show_main,
            timer_get,
            timer_update,
            ambient_get,
            ambient_set,
            data_notify_updated,
            google_connect,
            google_disconnect,
            google_fetch_calendar_lists,
            google_fetch_events,
            google_create_event,
            google_update_event,
            google_delete_event,
            google_sync_tasks,
            google_create_task,
            google_update_task,
            google_delete_task,
            google_toggle_task,
            google_move_task
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusFlow Tauri application");
}
