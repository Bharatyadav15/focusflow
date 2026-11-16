use crate::google_api::{self, CreateEventPayload, UpdateEventPayload, UpdateTaskPatch};
use crate::planner;
use crate::types::{
    ActiveTarget, CalendarEvent, EventMetadata, Milestone, Project, ScheduledReminder, Subtask,
    TaskItem, TaskTemplate,
};
use crate::{ensure_floating_window, rebuild_tray_menu, AppState};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

pub fn get_mcp_tools_schema() -> Value {
    Value::Array(vec![
        json!({
            "name": "get_overview",
            "description": "Get FocusFlow snapshot: active timer, top 10 urgent tasks, today's schedule, project summaries, sync & MCP status. Pass detail=true for all open tasks, full projects, and focus stats.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "detail": {
                        "type": "boolean",
                        "description": "Set true for full open tasks, all events, detailed projects, and focus stats (default false)"
                    }
                }
            }
        }),
        json!({
            "name": "manage_task",
            "description": "Unified task, reminder, dependency & recurring-task tool: list, add, update (including recurrence daily/weekdays/weekly and blocked_by_task_ids), complete, delete, or manage subtasks. (Use plan_my_day with task_id to time-block a single task.)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "add", "update", "complete", "delete", "move", "subtask"],
                        "description": "Operation to perform on tasks"
                    },
                    "task_id": { "type": "string", "description": "Exact task ID (for update/complete/delete/move/subtask)" },
                    "parent_task_id": { "type": ["string", "null"], "description": "Parent task ID (for add/update/move; null detaches to root). Max depth 3." },
                    "include_children": { "type": "boolean", "description": "Include child tasks when action='list' (default true)" },
                    "roots_only": { "type": "boolean", "description": "Return only root tasks (parentId == null) when action='list'" },
                    "cascade": { "type": "boolean", "description": "On complete: cascade-complete open children (default true). On delete: if true, delete descendants; if false/omitted, reparent children to grandparent." },
                    "title_match": { "type": "string", "description": "Task title substring match if task_id is omitted" },
                    "title": { "type": "string", "description": "Task title (required for 'add')" },
                    "new_title": { "type": "string", "description": "Updated title (for 'update')" },
                    "notes": { "type": "string", "description": "Task notes" },
                    "note_link": { "type": "string", "description": "Optional Obsidian note path/URI (e.g. 'Projects/Spec.md' or 'obsidian://open?...') or Zotero item URI ('zotero://select/...')" },
                    "priority": { "type": "integer", "description": "Priority 1 (urgent) to 5 (low), or filter for 'list'" },
                    "due_date": { "type": "string", "description": "Due date: 'today', 'tomorrow', '+3d', 'YYYY-MM-DD', or ISO timestamp" },
                    "duration_minutes": { "type": "integer", "description": "Focus duration in minutes" },
                    "estimated_pomodoros": { "type": "integer", "description": "Estimated number of Pomodoros" },
                    "completed": { "type": "boolean", "description": "Completion state (for update/complete)" },
                    "include_completed": { "type": "boolean", "description": "Include completed tasks when action='list'" },
                    "search": { "type": "string", "description": "Substring search when action='list'" },
                    "project_id": { "type": "string", "description": "Project ID or name" },
                    "recurrence": { "type": "string", "enum": ["none", "daily", "weekdays", "weekly"], "description": "Recurring schedule when completed" },
                    "blocked_by_task_ids": {
                        "type": "array",
                        "description": "Prerequisite task IDs that must finish before this task can be auto-planned",
                        "items": { "type": "string" }
                    },
                    "date": { "type": "string", "description": "Target date for time_block ('today', 'tomorrow', 'YYYY-MM-DD')" },
                    "subtasks": {
                        "type": "array",
                        "description": "Initial subtasks when action='add'",
                        "items": {
                            "type": "object",
                            "properties": { "title": { "type": "string" }, "done": { "type": "boolean" } },
                            "required": ["title"]
                        }
                    },
                    "subtask_action": { "type": "string", "enum": ["add", "toggle", "remove"], "description": "Subtask operation when action='subtask'" },
                    "subtask_title": { "type": "string", "description": "Subtask text (when action='subtask')" },
                    "subtask_id": { "type": "string", "description": "Subtask ID (when action='subtask')" },
                    "dry_run": { "type": "boolean", "description": "Preview task mutation without saving or syncing (default false)" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "manage_event",
            "description": "Unified calendar event tool: list events, find free slots, add, reschedule, delete, or convert an event into a timed task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "add", "reschedule", "delete", "convert_to_task", "find_free_slots"],
                        "description": "Operation to perform on calendar events"
                    },
                    "event_id": { "type": "string", "description": "Exact event ID" },
                    "summary_match": { "type": "string", "description": "Event title substring match if event_id is omitted" },
                    "summary": { "type": "string", "description": "Event title (required for 'add')" },
                    "new_summary": { "type": "string", "description": "New event title (for 'reschedule')" },
                    "start": { "type": "string", "description": "Start time: ISO-8601, 'YYYY-MM-DD HH:MM', or 'HH:MM'" },
                    "end": { "type": "string", "description": "End time: ISO-8601, 'YYYY-MM-DD HH:MM', or 'HH:MM'" },
                    "duration_minutes": { "type": "integer", "description": "Duration in minutes (default 60)" },
                    "description": { "type": "string", "description": "Event description" },
                    "priority": { "type": "integer", "description": "Optional priority 1-5" },
                    "project_id": { "type": "string", "description": "Optional project ID or name" },
                    "time_min": { "type": "string", "description": "Start range for action='list'" },
                    "time_max": { "type": "string", "description": "End range for action='list'" },
                    "date": { "type": "string", "description": "Date for find_free_slots ('today', 'tomorrow', '+2d', 'YYYY-MM-DD')" },
                    "start_hour": { "type": "integer", "description": "Working window start hour 0-23 (find_free_slots)" },
                    "end_hour": { "type": "integer", "description": "Working window end hour 1-24 (find_free_slots)" },
                    "min_minutes": { "type": "integer", "description": "Minimum open slot minutes (find_free_slots, default 25)" },
                    "dry_run": { "type": "boolean", "description": "Preview event mutation without modifying Google Calendar (default false)" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "manage_project",
            "description": "Unified project tool: list projects, create/update a project, delete a project, or manage milestones (supporting required_task_ids to gate milestones on task completion).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "save", "delete", "milestone"],
                        "description": "Operation to perform on projects"
                    },
                    "project_id": { "type": "string", "description": "Exact project ID" },
                    "name_match": { "type": "string", "description": "Project name substring match" },
                    "name": { "type": "string", "description": "Project name (required for action='save')" },
                    "color": { "type": "string", "description": "Hex color code, e.g. '#6366f1'" },
                    "description": { "type": "string", "description": "Project description" },
                    "milestones": {
                        "type": "array",
                        "description": "Milestones list when action='save'",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "done": { "type": "boolean" },
                                "required_task_ids": { "type": "array", "items": { "type": "string" } }
                            },
                            "required": ["title"]
                        }
                    },
                    "milestone_action": { "type": "string", "enum": ["add", "toggle", "remove"], "description": "Milestone operation when action='milestone'" },
                    "milestone_title": { "type": "string", "description": "Milestone title (when action='milestone')" },
                    "milestone_id": { "type": "string", "description": "Milestone ID (when action='milestone')" },
                    "required_task_ids": { "type": "array", "description": "Task IDs that gate this milestone on completion", "items": { "type": "string" } },
                    "dry_run": { "type": "boolean", "description": "Preview project changes without saving (default false)" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "manage_template",
            "description": "Manage reusable task templates (list, save, apply into a new task with subtasks & recurrence, or delete).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "save", "apply", "delete"],
                        "description": "Template operation"
                    },
                    "template_id": { "type": "string", "description": "Exact template ID (for apply/delete)" },
                    "name": { "type": "string", "description": "Template name (required for save, or match for apply/delete)" },
                    "title": { "type": "string", "description": "Task title created when applied" },
                    "notes": { "type": "string" },
                    "priority": { "type": "integer" },
                    "duration_minutes": { "type": "integer" },
                    "recurrence": { "type": "string", "enum": ["none", "daily", "weekdays", "weekly"] },
                    "due_date": { "type": "string", "description": "Optional due date override when applying" },
                    "subtasks": { "type": "array", "items": { "type": "string" }, "description": "Subtask titles in template" },
                    "dry_run": { "type": "boolean", "description": "Preview template action without saving (default false)" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "plan_my_day",
            "description": "Schedule unscheduled priority tasks (or a single task via task_id/title_match) into open calendar gaps within working hours. Use dry_run=true to preview the proposed blocks before writing to Google Calendar.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "date": { "type": "string", "description": "Target date: 'today', 'tomorrow', or 'YYYY-MM-DD' (default today)" },
                    "task_id": { "type": "string", "description": "Optional single task ID to time-block instead of batch planning" },
                    "title_match": { "type": "string", "description": "Optional task title substring to time-block a single task" },
                    "dry_run": { "type": "boolean", "description": "Preview proposed time blocks without creating calendar events (default false)" }
                }
            }
        }),
        json!({
            "name": "control_timer",
            "description": "Read status of, start, pause, resume, reset, or extend the shared FocusFlow Pomodoro or Stopwatch timer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["status", "start", "pause", "resume", "reset", "extend"],
                        "description": "Timer action to perform"
                    },
                    "title": { "type": "string", "description": "Task or event title to focus on (for 'start')" },
                    "duration_minutes": { "type": "integer", "description": "Duration in minutes (for 'start' or 'extend')" },
                    "mode": {
                        "type": "string",
                        "enum": ["focus", "shortBreak", "longBreak", "stopwatch"],
                        "description": "Timer mode (default 'focus')"
                    },
                    "task_id": { "type": "string", "description": "Optional task ID to link" },
                    "event_id": { "type": "string", "description": "Optional calendar event ID to link" },
                    "auto_shift_next": { "type": "boolean", "description": "When action='extend' on a time-blocked session, automatically shift later calendar blocks forward (default true)" },
                    "dry_run": { "type": "boolean", "description": "Preview timer/overrun shift action without mutating timer or calendar (default false)" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "get_focus_stats",
            "description": "Get Pomodoro/Stopwatch analytics (today minutes, daily goal, streak days, weekly project hours, sparse best-hours heatmap, estimate vs actual) or export focus logs as CSV/Markdown.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "format": {
                        "type": "string",
                        "enum": ["summary", "json", "csv", "markdown"],
                        "description": "Output format: 'summary' (default compact analytics without raw session log), 'json' (full stats + recentSessions), 'csv', or 'markdown'"
                    }
                }
            }
        }),
        json!({
            "name": "undo_last",
            "description": "Undo the most recent undoable AI tool mutation (or a specific audit log entry by id).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Optional audit entry id; omit to undo the latest undoable AI action" },
                    "dry_run": { "type": "boolean", "description": "Preview which audit entry would be undone without reverting state (default false)" }
                }
            }
        }),
        json!({
            "name": "shutdown_review",
            "description": "End-of-day review: compares planned vs completed tasks and focus sessions, optionally rolls unfinished tasks to tomorrow, and optionally writes a Markdown daily note to the Obsidian vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "date": { "type": "string", "description": "Review date: 'today' (default), 'yesterday', or 'YYYY-MM-DD'" },
                    "roll_unfinished": { "type": "boolean", "description": "Roll unfinished due/today tasks to tomorrow (default false)" },
                    "write_obsidian": { "type": "boolean", "description": "Write/append daily review note to configured Obsidian vault (default false)" },
                    "dry_run": { "type": "boolean", "description": "Preview shutdown summary without rolling tasks or writing Obsidian files" }
                }
            }
        }),
        json!({
            "name": "set_reminder",
            "description": "Schedule a timed Windows toast notification reminder at a specified time or relative offset (e.g. in_minutes=15 or at='16:30' / '+25m' / ISO-8601).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Reminder title" },
                    "at": { "type": "string", "description": "Target time: 'HH:MM', '+20m', '+2h', or ISO-8601 timestamp" },
                    "in_minutes": { "type": "integer", "description": "Minutes from now to fire if 'at' is omitted" },
                    "body": { "type": "string", "description": "Optional reminder details" },
                    "dry_run": { "type": "boolean", "description": "Preview reminder fire time without scheduling (default false)" }
                },
                "required": ["title"]
            }
        }),
    ])
}

fn ymd_string<T: Datelike>(d: &T) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
}

fn parse_flexible_due_date(raw: &str) -> String {
    let trimmed = raw.trim();
    let lower = trimmed.to_lowercase();
    let now = Local::now();

    if lower == "today" {
        return ymd_string(&now);
    }
    if lower == "tomorrow" {
        return ymd_string(&(now + Duration::days(1)));
    }
    if lower == "next week" {
        return ymd_string(&(now + Duration::days(7)));
    }
    if let Some(days_str) = lower.strip_prefix('+').and_then(|s| s.strip_suffix('d')) {
        if let Ok(days) = days_str.trim().parse::<i64>() {
            return ymd_string(&(now + Duration::days(days)));
        }
    }
    if trimmed.len() >= 10 && NaiveDate::parse_from_str(&trimmed[..10], "%Y-%m-%d").is_ok() {
        return trimmed[..10].to_string();
    }
    trimmed.to_string()
}

fn parse_flexible_datetime(raw: &str, base_date: Option<NaiveDate>) -> Option<chrono::DateTime<Local>> {
    let s = raw.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Local));
    }

    let today = base_date.unwrap_or_else(|| Local::now().date_naive());

    // Try "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM"
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            if let Some(ldt) = Local.from_local_datetime(&ndt).single() {
                return Some(ldt);
            }
        }
    }

    // Try "YYYY-MM-DD"
    if let Ok(nd) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        if let Some(ndt) = nd.and_hms_opt(9, 0, 0) {
            if let Some(ldt) = Local.from_local_datetime(&ndt).single() {
                return Some(ldt);
            }
        }
    }

    // Try "HH:MM" or "HH:MM:SS" on base_date (today)
    for tfmt in ["%H:%M:%S", "%H:%M"] {
        if let Ok(nt) = NaiveTime::parse_from_str(s, tfmt) {
            let ndt = today.and_time(nt);
            if let Some(ldt) = Local.from_local_datetime(&ndt).single() {
                return Some(ldt);
            }
        }
    }

    None
}

fn resolve_project_id(projects: &[Project], raw_project: Option<&str>) -> Result<Option<String>, String> {
    let Some(rp) = raw_project.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if rp.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    if let Some(p) = projects.iter().find(|p| p.id == rp) {
        return Ok(Some(p.id.clone()));
    }
    let lower = rp.to_lowercase();
    let exact: Vec<&Project> = projects
        .iter()
        .filter(|p| p.name.to_lowercase() == lower)
        .collect();
    if exact.len() == 1 {
        return Ok(Some(exact[0].id.clone()));
    }
    let matches: Vec<&Project> = projects
        .iter()
        .filter(|p| p.name.to_lowercase().contains(&lower))
        .collect();
    match matches.len() {
        0 => Err(format!("No project matching '{}' found", rp)),
        1 => Ok(Some(matches[0].id.clone())),
        n => Err(format!(
            "{} projects match '{}'; specify the exact project id",
            n, rp
        )),
    }
}

fn normalize_recurrence_opt(raw: Option<&str>) -> Option<String> {
    match raw.map(str::trim).map(str::to_lowercase).as_deref() {
        Some("daily") => Some("daily".to_string()),
        Some("weekdays") => Some("weekdays".to_string()),
        Some("weekly") => Some("weekly".to_string()),
        _ => None,
    }
}

fn next_recurrence_due_ymd(current_due: Option<&str>, rule: &str) -> String {
    let today = Local::now().date_naive();
    let base = current_due
        .and_then(|s| s.get(..10))
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| if d > today { d } else { today })
        .unwrap_or(today);
    let next = match rule {
        "daily" => base + Duration::days(1),
        "weekly" => base + Duration::days(7),
        "weekdays" => {
            let mut d = base + Duration::days(1);
            while matches!(d.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
                d += Duration::days(1);
            }
            d
        }
        _ => base + Duration::days(1),
    };
    ymd_string(&next)
}

fn parse_subtasks_value(val: Option<&Value>) -> Vec<Subtask> {
    let Some(arr) = val.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .enumerate()
        .filter_map(|(i, item)| {
            let title = item.get("title")?.as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            Some(Subtask {
                id: format!("sub-{}-{}", Utc::now().timestamp_millis(), i),
                title: title.to_string(),
                done: item.get("done").and_then(|d| d.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}

fn event_is_today(evt: &CalendarEvent) -> bool {
    let today = Local::now().date_naive();
    if let Ok(st) = chrono::DateTime::parse_from_rfc3339(&evt.start) {
        let sd = st.with_timezone(&Local).date_naive();
        let en = chrono::DateTime::parse_from_rfc3339(&evt.end)
            .map(|d| d.with_timezone(&Local).date_naive())
            .unwrap_or(sd);
        return sd <= today && en >= today;
    }
    if evt.start.len() >= 10 {
        if let Ok(nd) = NaiveDate::parse_from_str(&evt.start[..10], "%Y-%m-%d") {
            return nd == today;
        }
    }
    false
}

async fn find_event_for_ai(
    state: &AppState,
    event_id: Option<&str>,
    summary_match: Option<&str>,
) -> Result<CalendarEvent, Value> {
    let mut cached = state.cached_events.lock().unwrap().clone();
    if cached.is_empty() {
        cached = state.store.get_local_events();
    }
    match pick_unique(
        &cached,
        event_id,
        summary_match,
        |e| e.id.clone(),
        |e| e.summary.clone(),
        "calendar event",
    ) {
        Ok(i) => return Ok(cached[i].clone()),
        Err(e) if e.get("candidates").is_some() => return Err(e),
        Err(_) => {}
    }

    let now = Local::now();
    let min_iso = (now - Duration::days(7)).to_rfc3339();
    let max_iso = (now + Duration::days(60)).to_rfc3339();
    let wider = google_api::fetch_calendar_events(&state.store, min_iso, max_iso)
        .await
        .unwrap_or_default();
    let idx = pick_unique(
        &wider,
        event_id,
        summary_match,
        |e| e.id.clone(),
        |e| e.summary.clone(),
        "calendar event",
    )?;
    Ok(wider[idx].clone())
}

pub(crate) async fn execute_tool_inner(app: &AppHandle, name: &str, args: &Value) -> Value {
    let state = match app.try_state::<AppState>() {
        Some(s) => s,
        None => return json!({ "ok": false, "error": "AppState unavailable" }),
    };
    let dry_run = args.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false);

    match name {
        "get_overview" => {
            let detail = args.get("detail").and_then(|v| v.as_bool()).unwrap_or(false);
            let app_data = state.store.get_app_data();
            let timer = state.timer.lock().unwrap().clone();
            let mut events = state.cached_events.lock().unwrap().clone();
            if events.is_empty() {
                events = state.store.get_local_events();
            }
            let today_events: Vec<&CalendarEvent> = if detail {
                events.iter().collect()
            } else {
                events.iter().filter(|e| event_is_today(e)).collect()
            };
            let today_ymd = ymd_string(&Local::now());
            // Count a parent with open children as one work unit, not one per child.
            let mut open_tasks: Vec<&TaskItem> = app_data
                .tasks
                .iter()
                .filter(|t| crate::task_tree::is_open_unit_representative(&app_data.tasks, t))
                .collect();
            open_tasks.sort_by(|a, b| {
                let a_due = a.due_date.as_deref().and_then(|s| s.get(..10));
                let b_due = b.due_date.as_deref().and_then(|s| s.get(..10));
                let a_urg = a_due.map(|d| d <= today_ymd.as_str()).unwrap_or(false);
                let b_urg = b_due.map(|d| d <= today_ymd.as_str()).unwrap_or(false);
                b_urg
                    .cmp(&a_urg)
                    .then_with(|| a.priority.cmp(&b.priority))
                    .then_with(|| a_due.unwrap_or("9999-12-31").cmp(b_due.unwrap_or("9999-12-31")))
            });
            let total_open = open_tasks.len();
            let last_synced = state.last_google_sync.lock().unwrap().clone();
            let (mcp_ok, mcp_desc) = state.mcp_status.lock().unwrap().clone();
            if detail {
                json!({
                    "ok": true,
                    "detail": true,
                    "googleConnected": app_data.google_connected,
                    "lastSyncedAt": last_synced,
                    "pendingSyncCount": app_data.pending_sync_count,
                    "mcpStatus": { "ok": mcp_ok, "detail": mcp_desc },
                    "timer": timer,
                    "openTasksCount": total_open,
                    "openTasks": open_tasks,
                    "todayEventsCount": today_events.len(),
                    "todayEvents": today_events,
                    "projects": app_data.projects,
                    "focusStats": planner::compute_focus_stats(&app_data),
                })
            } else {
                let top_tasks: Vec<&TaskItem> = open_tasks.into_iter().take(10).collect();
                let compact_projects: Vec<Value> = app_data
                    .projects
                    .iter()
                    .map(|p| {
                        json!({
                            "id": p.id,
                            "name": p.name,
                            "color": p.color,
                            "milestonesDone": p.milestones.iter().filter(|m| m.done).count(),
                            "milestonesTotal": p.milestones.len(),
                        })
                    })
                    .collect();
                json!({
                    "ok": true,
                    "detail": false,
                    "googleConnected": app_data.google_connected,
                    "lastSyncedAt": last_synced,
                    "pendingSyncCount": app_data.pending_sync_count,
                    "mcpStatus": { "ok": mcp_ok, "detail": mcp_desc },
                    "timer": timer,
                    "openTasksCount": total_open,
                    "openTasksShowing": top_tasks.len(),
                    "openTasks": top_tasks,
                    "todayEventsCount": today_events.len(),
                    "todayEvents": today_events,
                    "projects": compact_projects,
                })
            }
        }

        "list_tasks" => {
            let app_data = state.store.get_app_data();
            let include_completed = args
                .get("include_completed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let prio_filter = args.get("priority").and_then(|v| v.as_u64()).map(|n| n as u8);
            let proj_raw = args.get("project_id").and_then(|v| v.as_str());
            let resolved_proj = match resolve_project_id(&app_data.projects, proj_raw) {
                Ok(p) => p,
                Err(err) => return json!({ "ok": false, "error": err }),
            };
            let search = args
                .get("search")
                .and_then(|v| v.as_str())
                .map(|s| s.to_lowercase());
            let include_children = args
                .get("include_children")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let roots_only = args
                .get("roots_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let tasks: Vec<TaskItem> = app_data
                .tasks
                .into_iter()
                .filter(|t| include_completed || !t.completed)
                .filter(|t| (!roots_only && include_children) || t.parent_id.is_none())
                .filter(|t| prio_filter.map(|p| t.priority == p).unwrap_or(true))
                .filter(|t| {
                    resolved_proj
                        .as_ref()
                        .map(|pid| t.project_id.as_deref() == Some(pid.as_str()))
                        .unwrap_or(true)
                })
                .filter(|t| {
                    search
                        .as_ref()
                        .map(|q| {
                            t.title.to_lowercase().contains(q)
                                || t.notes
                                    .as_ref()
                                    .map(|n| n.to_lowercase().contains(q))
                                    .unwrap_or(false)
                        })
                        .unwrap_or(true)
                })
                .collect();

            json!({
                "ok": true,
                "count": tasks.len(),
                "tasks": tasks
            })
        }

        "add_task" => {
            let title = match args.get("title").and_then(|v| v.as_str()) {
                Some(t) if !t.trim().is_empty() => t.trim().to_string(),
                _ => return json!({ "ok": false, "error": "Missing required parameter 'title'" }),
            };
            let notes = args
                .get("notes")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let priority = args
                .get("priority")
                .and_then(|v| v.as_u64())
                .map(|n| (n as u8).clamp(1, 5))
                .unwrap_or(3);
            let due_date = args
                .get("due_date")
                .and_then(|v| v.as_str())
                .map(parse_flexible_due_date);
            let duration_minutes = args
                .get("duration_minutes")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32);
            let default_mins = state.store.get_settings().focus_minutes.max(1);
            let estimated_pomodoros = args
                .get("estimated_pomodoros")
                .and_then(|v| v.as_u64())
                .map(|n| (n as u32).max(1))
                .unwrap_or_else(|| {
                    duration_minutes
                        .map(|dm| dm.div_ceil(default_mins).max(1))
                        .unwrap_or(1)
                });
            let app_data = state.store.get_app_data();
            let parent_id = args
                .get("parent_task_id")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let Err(err) =
                crate::task_tree::validate_new_child_parent(&app_data.tasks, parent_id.as_deref())
            {
                return json!({ "ok": false, "error": err });
            }
            let estimate_explicit = args.get("estimated_pomodoros").is_some();
            let project_id = match resolve_project_id(
                &app_data.projects,
                args.get("project_id").and_then(|v| v.as_str()),
            ) {
                Ok(p) => p,
                Err(err) => return json!({ "ok": false, "error": err }),
            };

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would add task '{}'", title),
                    "previewTask": {
                        "title": title,
                        "notes": notes,
                        "priority": priority,
                        "dueDate": due_date,
                        "parentId": parent_id,
                        "durationMinutes": duration_minutes,
                        "estimatedPomodoros": estimated_pomodoros,
                        "estimateExplicit": estimate_explicit,
                        "projectId": project_id,
                        "recurrence": normalize_recurrence_opt(args.get("recurrence").and_then(|v| v.as_str())),
                        "noteLink": args.get("note_link").and_then(|v| v.as_str()),
                    }
                });
            }

            let mut created = match google_api::create_google_task(
                &state.store,
                title.clone(),
                notes.clone(),
                None,
            )
            .await
            {
                Ok(t) => t,
                Err(e) => return json!({ "ok": false, "error": e }),
            };

            created.priority = priority;
            created.due_date = due_date.clone();
            created.parent_id = parent_id.clone();
            created.duration_minutes = duration_minutes;
            created.estimated_pomodoros = estimated_pomodoros;
            created.estimate_explicit = estimate_explicit;
            created.project_id = project_id;
            created.recurrence = normalize_recurrence_opt(args.get("recurrence").and_then(|v| v.as_str()));
            created.note_link = args
                .get("note_link")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            created.subtasks = parse_subtasks_value(args.get("subtasks"));
            if let Some(arr) = args.get("blocked_by_task_ids").and_then(|v| v.as_array()) {
                created.blocked_by_task_ids = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }

            let mut tasks = state.store.get_app_data().tasks;
            if let Some(existing) = tasks.iter_mut().find(|t| t.id == created.id) {
                *existing = created.clone();
            } else {
                tasks.insert(0, created.clone());
            }
            state.store.save_tasks(tasks);

            if let (Some(ref due), Some(ref g_id), Some(ref list_id)) = (
                &due_date,
                &created.google_task_id,
                &created.google_task_list_id,
            ) {
                let due_iso = if due.len() == 10 {
                    format!("{}T00:00:00.000Z", due)
                } else {
                    due.clone()
                };
                let _ = google_api::update_google_task(
                    &state.store,
                    list_id.clone(),
                    g_id.clone(),
                    UpdateTaskPatch {
                        title: None,
                        notes: None,
                        completed: None,
                        due: Some(due_iso),
                    },
                )
                .await;
            }
            if parent_id.is_some() {
                google_api::sync_task_parent_move(&state.store, &created.id, parent_id.as_deref())
                    .await;
            }

            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Added task '{}'", created.title),
                "task": created
            })
        }

        "update_task" | "complete_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_str());
            let title_match = args
                .get("title_match")
                .or_else(|| args.get("title"))
                .and_then(|v| v.as_str());

            let app_data = state.store.get_app_data();
            let mut tasks = app_data.tasks.clone();
            let idx = match pick_unique(
                &tasks,
                task_id,
                title_match,
                |t| t.id.clone(),
                |t| t.title.clone(),
                "task",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };

            let previous_snapshot = tasks.clone();
            let previous_task = tasks[idx].clone();
            let mut updated_task = previous_task.clone();
            if let Some(nt) = args.get("new_title").and_then(|v| v.as_str()) {
                if !nt.trim().is_empty() {
                    updated_task.title = nt.trim().to_string();
                }
            }
            if let Some(n) = args.get("notes").and_then(|v| v.as_str()) {
                updated_task.notes = Some(n.to_string());
            }
            if let Some(p) = args.get("priority").and_then(|v| v.as_u64()) {
                updated_task.priority = (p as u8).clamp(1, 5);
            }
            if let Some(d) = args.get("due_date").and_then(|v| v.as_str()) {
                updated_task.due_date = Some(parse_flexible_due_date(d));
            }
            if let Some(dm) = args.get("duration_minutes").and_then(|v| v.as_u64()) {
                updated_task.duration_minutes = Some(dm as u32);
            }
            if let Some(ep) = args.get("estimated_pomodoros").and_then(|v| v.as_u64()) {
                updated_task.estimated_pomodoros = (ep as u32).max(1);
                updated_task.estimate_explicit = true;
            }
            if let Some(parent_val) = args.get("parent_task_id") {
                let new_parent = match parent_val {
                    Value::Null => None,
                    Value::String(s) if s.trim().is_empty() => None,
                    Value::String(s) => Some(s.trim().to_string()),
                    _ => return json!({ "ok": false, "error": "parent_task_id must be a string or null" }),
                };
                if let Err(err) = crate::task_tree::validate_reparent(
                    &tasks,
                    &updated_task.id,
                    new_parent.as_deref(),
                ) {
                    return json!({ "ok": false, "error": err });
                }
                updated_task.parent_id = new_parent;
            }
            if args.get("recurrence").is_some() {
                updated_task.recurrence =
                    normalize_recurrence_opt(args.get("recurrence").and_then(|v| v.as_str()));
            }
            if let Some(nl) = args.get("note_link").and_then(|v| v.as_str()) {
                let t = nl.trim().to_string();
                updated_task.note_link = if t.is_empty() { None } else { Some(t) };
            }
            if let Some(arr) = args.get("blocked_by_task_ids").and_then(|v| v.as_array()) {
                updated_task.blocked_by_task_ids = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }
            if name == "complete_task" {
                updated_task.completed = args
                    .get("completed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
            } else if let Some(c) = args.get("completed").and_then(|v| v.as_bool()) {
                updated_task.completed = c;
            }
            if let Some(proj_raw) = args.get("project_id").and_then(|v| v.as_str()) {
                updated_task.project_id = match resolve_project_id(&app_data.projects, Some(proj_raw))
                {
                    Ok(p) => p,
                    Err(err) => return json!({ "ok": false, "error": err }),
                };
            }

            let became_completed = !previous_task.completed && updated_task.completed;
            let cascade = args
                .get("cascade")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let parent_changed = previous_task.parent_id != updated_task.parent_id;
            let cascade_ids: Vec<String> = if became_completed && cascade {
                crate::task_tree::descendant_ids(&tasks, &updated_task.id)
                    .into_iter()
                    .filter(|did| tasks.iter().any(|t| &t.id == did && !t.completed))
                    .collect()
            } else {
                Vec::new()
            };
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would update task '{}'", updated_task.title),
                    "previewTask": updated_task,
                    "wouldCascadeCompleteCount": cascade_ids.len(),
                    "wouldSpawnNextRecurring": became_completed && updated_task.recurrence.is_some(),
                });
            }
            tasks[idx] = updated_task.clone();
            let mut cascade_google_targets: Vec<(String, String)> = Vec::new();
            for cid in &cascade_ids {
                if let Some(child) = tasks.iter_mut().find(|t| &t.id == cid) {
                    child.completed = true;
                    if let (Some(gid), Some(lid)) = (&child.google_task_id, &child.google_task_list_id) {
                        cascade_google_targets.push((lid.clone(), gid.clone()));
                    }
                }
            }

            let mut next_recurring: Option<TaskItem> = None;
            if became_completed {
                if let Some(ref rule) = updated_task.recurrence {
                    let next_due =
                        next_recurrence_due_ymd(updated_task.due_date.as_deref(), rule);
                    let mut clone_task = updated_task.clone();
                    clone_task.id = format!("task-{}", Utc::now().timestamp_millis());
                    clone_task.completed = false;
                    clone_task.completed_pomodoros = 0;
                    clone_task.due_date = Some(format!("{}T00:00:00.000Z", next_due));
                    clone_task.google_task_id = None;
                    clone_task.google_task_list_id = None;
                    clone_task.google_task_list_title = None;
                    clone_task.calendar_event_id = None;
                    clone_task.linked_event_id = None;
                    clone_task.scheduled_start = None;
                    clone_task.scheduled_end = None;
                    clone_task.created_at = Utc::now().to_rfc3339();
                    for sub in &mut clone_task.subtasks {
                        sub.done = false;
                    }
                    tasks.insert(0, clone_task.clone());
                    next_recurring = Some(clone_task);
                }
            }
            state.store.save_tasks(tasks);

            // Push the spawned recurring copy to Google Tasks so it syncs to other devices.
            if let Some(clone) = next_recurring.as_mut() {
                if updated_task.google_task_id.is_some() {
                    if let Ok(g) = google_api::create_google_task(
                        &state.store,
                        clone.title.clone(),
                        clone.notes.clone(),
                        updated_task.google_task_list_id.clone(),
                    )
                    .await
                    {
                        let local_id = clone.id.clone();
                        let due_iso = clone.due_date.clone();
                        clone.id = g.id.clone();
                        clone.google_task_id = g.google_task_id.clone();
                        clone.google_task_list_id = g.google_task_list_id.clone();
                        clone.google_task_list_title = g.google_task_list_title.clone();
                        let mut all = state.store.get_app_data().tasks;
                        all.retain(|t| t.id != g.id);
                        if let Some(slot) = all.iter_mut().find(|t| t.id == local_id) {
                            *slot = clone.clone();
                        }
                        state.store.save_tasks(all);
                        if let (Some(g_id), Some(list_id)) =
                            (g.google_task_id.clone(), g.google_task_list_id.clone())
                        {
                            let _ = google_api::update_google_task(
                                &state.store,
                                list_id,
                                g_id,
                                UpdateTaskPatch {
                                    title: None,
                                    notes: None,
                                    completed: None,
                                    due: due_iso,
                                },
                            )
                            .await;
                        }
                    }
                }
            }

            if let (Some(ref g_id), Some(ref list_id)) = (
                &updated_task.google_task_id,
                &updated_task.google_task_list_id,
            ) {
                let due_iso = updated_task.due_date.as_ref().map(|d| {
                    if d.len() == 10 {
                        format!("{}T00:00:00.000Z", d)
                    } else {
                        d.clone()
                    }
                });
                let _ = google_api::update_google_task(
                    &state.store,
                    list_id.clone(),
                    g_id.clone(),
                    UpdateTaskPatch {
                        title: Some(updated_task.title.clone()),
                        notes: updated_task.notes.clone(),
                        completed: Some(updated_task.completed),
                        due: due_iso,
                    },
                )
                .await;
            }

            if parent_changed {
                google_api::sync_task_parent_move(
                    &state.store,
                    &updated_task.id,
                    updated_task.parent_id.as_deref(),
                )
                .await;
            }
            for (lid, gid) in cascade_google_targets {
                let _ = google_api::toggle_google_task(&state.store, lid, gid, true).await;
            }

            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Updated task '{}'", updated_task.title),
                "task": updated_task,
                "cascadeCompletedCount": cascade_ids.len(),
                "nextRecurringTask": next_recurring,
                "previousTask": previous_task,
                "previousTasks": if !cascade_ids.is_empty() { Some(previous_snapshot) } else { None },
            })
        }

        "delete_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_str());
            let title_match = args
                .get("title_match")
                .or_else(|| args.get("title"))
                .and_then(|v| v.as_str());
            let cascade = args
                .get("cascade")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let mut tasks = state.store.get_app_data().tasks;
            let idx = match pick_unique(
                &tasks,
                task_id,
                title_match,
                |t| t.id.clone(),
                |t| t.title.clone(),
                "task",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };

            let target_id = tasks[idx].id.clone();
            let direct_children_count = crate::task_tree::children_of(&tasks, &target_id).len();
            let descendant_ids = if cascade {
                crate::task_tree::descendant_ids(&tasks, &target_id)
            } else {
                Vec::new()
            };

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would delete task '{}'", tasks[idx].title),
                    "targetTask": tasks[idx],
                    "cascade": cascade,
                    "wouldReparentChildrenCount": if cascade { 0 } else { direct_children_count },
                    "wouldDeleteDescendantsCount": descendant_ids.len(),
                });
            }

            let previous_snapshot = tasks.clone();
            let mut reparented_ids: Vec<String> = Vec::new();
            let mut extra_google_deletes: Vec<(String, String)> = Vec::new();
            let removed = if cascade {
                let rem = tasks.remove(idx);
                let desc_set: std::collections::HashSet<String> = descendant_ids.iter().cloned().collect();
                for t in &tasks {
                    if desc_set.contains(&t.id) {
                        if let (Some(g), Some(l)) = (&t.google_task_id, &t.google_task_list_id) {
                            extra_google_deletes.push((l.clone(), g.clone()));
                        }
                    }
                }
                tasks.retain(|t| !desc_set.contains(&t.id));
                rem
            } else {
                reparented_ids = crate::task_tree::reparent_children_on_delete(&mut tasks, &target_id);
                let pos = tasks.iter().position(|t| t.id == target_id).unwrap();
                tasks.remove(pos)
            };
            let new_grandparent = removed.parent_id.clone();
            state.store.save_tasks(tasks);

            if let (Some(g_id), Some(list_id)) =
                (removed.google_task_id.clone(), removed.google_task_list_id.clone())
            {
                let _ = google_api::delete_google_task(&state.store, list_id, g_id).await;
            }
            for (lid, gid) in extra_google_deletes {
                let _ = google_api::delete_google_task(&state.store, lid, gid).await;
            }
            for cid in &reparented_ids {
                google_api::sync_task_parent_move(&state.store, cid, new_grandparent.as_deref()).await;
            }

            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            let multi_affected = !reparented_ids.is_empty() || !descendant_ids.is_empty();
            json!({
                "ok": true,
                "message": format!("Deleted task '{}'", removed.title),
                "deletedTask": removed,
                "reparentedChildrenCount": reparented_ids.len(),
                "previousTasks": if multi_affected { Some(previous_snapshot) } else { None },
            })
        }

        "move_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_str());
            let title_match = args
                .get("title_match")
                .or_else(|| args.get("title"))
                .and_then(|v| v.as_str());
            let mut tasks = state.store.get_app_data().tasks;
            let idx = match pick_unique(
                &tasks,
                task_id,
                title_match,
                |t| t.id.clone(),
                |t| t.title.clone(),
                "task",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };

            let new_parent = match args.get("parent_task_id") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) if s.trim().is_empty() => None,
                Some(Value::String(s)) => Some(s.trim().to_string()),
                Some(_) => {
                    return json!({ "ok": false, "error": "parent_task_id must be a string or null" })
                }
            };

            let target_id = tasks[idx].id.clone();
            if let Err(err) =
                crate::task_tree::validate_reparent(&tasks, &target_id, new_parent.as_deref())
            {
                return json!({ "ok": false, "error": err });
            }

            let previous_task = tasks[idx].clone();
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would move '{}' under {:?}", previous_task.title, new_parent),
                    "taskId": target_id,
                    "newParentId": new_parent,
                });
            }

            tasks[idx].parent_id = new_parent.clone();
            let moved_task = tasks[idx].clone();
            state.store.save_tasks(tasks);

            google_api::sync_task_parent_move(&state.store, &target_id, new_parent.as_deref()).await;
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": match &new_parent {
                    Some(pid) => format!("Moved task '{}' under parent '{}'", moved_task.title, pid),
                    None => format!("Detached task '{}' to root", moved_task.title),
                },
                "task": moved_task,
                "previousTask": previous_task,
            })
        }

        "list_calendar_events" => {
            let now = Local::now();
            let default_min = now
                .date_naive()
                .and_hms_opt(0, 0, 0)
                .and_then(|ndt| Local.from_local_datetime(&ndt).single())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();
            let default_max = now
                .date_naive()
                .and_hms_opt(23, 59, 59)
                .and_then(|ndt| Local.from_local_datetime(&ndt).single())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            let time_min = args
                .get("time_min")
                .and_then(|v| v.as_str())
                .and_then(|s| parse_flexible_datetime(s, None))
                .map(|dt| dt.to_rfc3339())
                .unwrap_or(default_min);
            let time_max = args
                .get("time_max")
                .and_then(|v| v.as_str())
                .and_then(|s| parse_flexible_datetime(s, None))
                .map(|dt| dt.to_rfc3339())
                .unwrap_or(default_max);

            let custom_range = args.get("time_min").is_some() || args.get("time_max").is_some();
            match google_api::fetch_calendar_events(&state.store, time_min, time_max).await {
                Ok(evts) => {
                    if !custom_range {
                        *state.cached_events.lock().unwrap() = evts.clone();
                        rebuild_tray_menu(app);
                    }
                    json!({
                        "ok": true,
                        "count": evts.len(),
                        "events": evts
                    })
                }
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }

        "add_calendar_event" => {
            let summary = match args.get("summary").and_then(|v| v.as_str()) {
                Some(s) if !s.trim().is_empty() => s.trim().to_string(),
                _ => return json!({ "ok": false, "error": "Missing required 'summary'" }),
            };
            let start_raw = match args.get("start").and_then(|v| v.as_str()) {
                Some(s) if !s.trim().is_empty() => s,
                _ => return json!({ "ok": false, "error": "Missing required 'start' time" }),
            };
            let Some(start_dt) = parse_flexible_datetime(start_raw, None) else {
                return json!({
                    "ok": false,
                    "error": format!("Could not parse start time '{}'. Use ISO-8601, 'YYYY-MM-DD HH:MM', or 'HH:MM'", start_raw)
                });
            };

            let duration_mins = args
                .get("duration_minutes")
                .and_then(|v| v.as_i64())
                .unwrap_or(60)
                .max(5);
            let end_dt = args
                .get("end")
                .and_then(|v| v.as_str())
                .and_then(|s| parse_flexible_datetime(s, Some(start_dt.date_naive())))
                .unwrap_or_else(|| start_dt + Duration::minutes(duration_mins));

            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let prio = args
                .get("priority")
                .and_then(|v| v.as_u64())
                .map(|n| (n as u8).clamp(1, 5));
            let proj = match resolve_project_id(
                &state.store.get_app_data().projects,
                args.get("project_id").and_then(|v| v.as_str()),
            ) {
                Ok(p) => p,
                Err(err) => return json!({ "ok": false, "error": err }),
            };

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would schedule calendar event '{}'", summary),
                    "previewEvent": {
                        "summary": summary,
                        "description": description,
                        "start": start_dt.to_rfc3339(),
                        "end": end_dt.to_rfc3339(),
                        "priority": prio,
                        "projectId": proj,
                    }
                });
            }

            let created = match google_api::create_calendar_event(
                &state.store,
                CreateEventPayload {
                    calendar_id: args
                        .get("calendar_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    summary,
                    description,
                    start: start_dt.to_rfc3339(),
                    end: end_dt.to_rfc3339(),
                },
            )
            .await
            {
                Ok(e) => e,
                Err(err) => return json!({ "ok": false, "error": err }),
            };

            if prio.is_some() || proj.is_some() {
                state.store.save_event_metadata(
                    created.id.clone(),
                    EventMetadata {
                        priority: prio,
                        project_id: proj,
                    },
                );
            }

            if event_is_today(&created) {
                state.cached_events.lock().unwrap().push(created.clone());
            }
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Scheduled calendar event '{}'", created.summary),
                "event": created
            })
        }

        "reschedule_calendar_event" => {
            let event_id = args.get("event_id").and_then(|v| v.as_str());
            let summary_match = args
                .get("summary_match")
                .or_else(|| args.get("summary"))
                .and_then(|v| v.as_str());

            let target_evt = match find_event_for_ai(&state, event_id, summary_match).await {
                Ok(e) => e,
                Err(err) => return err,
            };

            let orig_dur_mins = crate::calc_event_mins(&target_evt, 60) as i64;
            let new_start_dt = args
                .get("start")
                .and_then(|v| v.as_str())
                .and_then(|s| parse_flexible_datetime(s, None));
            let dur_mins = args
                .get("duration_minutes")
                .and_then(|v| v.as_i64())
                .unwrap_or(orig_dur_mins)
                .max(5);
            let new_end_dt = args
                .get("end")
                .and_then(|v| v.as_str())
                .and_then(|s| {
                    parse_flexible_datetime(
                        s,
                        new_start_dt.map(|dt| dt.date_naive()),
                    )
                })
                .or_else(|| new_start_dt.map(|st| st + Duration::minutes(dur_mins)));

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would reschedule event '{}'", target_evt.summary),
                    "targetEvent": target_evt,
                    "proposedStart": new_start_dt.map(|dt| dt.to_rfc3339()),
                    "proposedEnd": new_end_dt.map(|dt| dt.to_rfc3339()),
                    "proposedSummary": args.get("new_summary").and_then(|v| v.as_str()),
                });
            }

            let updated = match google_api::update_calendar_event(
                &state.store,
                UpdateEventPayload {
                    calendar_id: target_evt.calendar_id.clone(),
                    event_id: target_evt.id.clone(),
                    summary: args
                        .get("new_summary")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    start: new_start_dt.map(|dt| dt.to_rfc3339()),
                    end: new_end_dt.map(|dt| dt.to_rfc3339()),
                },
            )
            .await
            {
                Ok(u) => u,
                Err(e) => return json!({ "ok": false, "error": e }),
            };

            {
                let mut lock = state.cached_events.lock().unwrap();
                if let Some(pos) = lock.iter().position(|e| e.id == updated.id) {
                    if event_is_today(&updated) {
                        lock[pos] = updated.clone();
                    } else {
                        lock.remove(pos);
                    }
                } else if event_is_today(&updated) {
                    lock.push(updated.clone());
                }
            }
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Updated calendar event '{}'", updated.summary),
                "event": updated,
                "previousEvent": target_evt,
            })
        }

        "delete_calendar_event" => {
            let event_id = args.get("event_id").and_then(|v| v.as_str());
            let summary_match = args
                .get("summary_match")
                .or_else(|| args.get("summary"))
                .and_then(|v| v.as_str());

            let target_evt = match find_event_for_ai(&state, event_id, summary_match).await {
                Ok(e) => e,
                Err(err) => return err,
            };

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would delete calendar event '{}'", target_evt.summary),
                    "targetEvent": target_evt,
                });
            }

            if let Err(err) = google_api::delete_calendar_event(
                &state.store,
                target_evt.calendar_id.clone(),
                target_evt.id.clone(),
            )
            .await
            {
                return json!({ "ok": false, "error": err });
            }
            state
                .cached_events
                .lock()
                .unwrap()
                .retain(|e| e.id != target_evt.id);

            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Deleted calendar event '{}'", target_evt.summary),
                "deletedEvent": target_evt
            })
        }

        "convert_event_to_task" => {
            let event_id = args.get("event_id").and_then(|v| v.as_str());
            let summary_match = args
                .get("summary_match")
                .or_else(|| args.get("summary"))
                .and_then(|v| v.as_str());

            let evt = match find_event_for_ai(&state, event_id, summary_match).await {
                Ok(e) => e,
                Err(err) => return err,
            };

            let def_mins = state.store.get_settings().focus_minutes.max(1);
            let duration_mins = crate::calc_event_mins(&evt, def_mins);
            let est_pomos = duration_mins.div_ceil(def_mins).max(1);
            let due_ymd = if evt.start.len() >= 10 {
                format!("{}T00:00:00.000Z", &evt.start[..10])
            } else {
                evt.start.clone()
            };

            let app_data = state.store.get_app_data();
            let existing_idx = app_data.tasks.iter().position(|t| {
                t.linked_event_id.as_deref() == Some(&evt.id)
                    || t.calendar_event_id.as_deref() == Some(&evt.id)
                    || app_data.task_event_links.get(&t.id).map(String::as_str)
                        == Some(&evt.id)
            });

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would convert event '{}' into a {}m task", evt.summary, duration_mins),
                    "event": evt,
                    "durationMinutes": duration_mins,
                    "estimatedPomodoros": est_pomos,
                    "existingLinkedTask": existing_idx.is_some(),
                });
            }

            if let Some(idx) = existing_idx {
                let mut tasks = app_data.tasks;
                tasks[idx].duration_minutes = Some(duration_mins);
                tasks[idx].estimated_pomodoros = est_pomos;
                tasks[idx].scheduled_start = Some(evt.start.clone());
                tasks[idx].scheduled_end = Some(evt.end.clone());
                tasks[idx].due_date = Some(due_ymd);
                tasks[idx].calendar_event_id = Some(evt.id.clone());
                tasks[idx].linked_event_id = Some(evt.id.clone());
                let updated = tasks[idx].clone();
                state.store.set_task_event_link(updated.id.clone(), Some(evt.id.clone()));
                state.store.save_tasks(tasks);
                rebuild_tray_menu(app);
                let _ = app.emit("data:updated", ());
                return json!({
                    "ok": true,
                    "message": format!("Updated linked task '{}' with {}m timer", updated.title, duration_mins),
                    "task": updated
                });
            }

            let mut created = match google_api::create_google_task(
                &state.store,
                evt.summary.clone(),
                evt.description.clone(),
                None,
            )
            .await
            {
                Ok(t) => t,
                Err(e) => return json!({ "ok": false, "error": e }),
            };

            created.priority = evt.priority.unwrap_or(3);
            created.project_id = evt.project_id.clone();
            created.due_date = Some(due_ymd.clone());
            created.scheduled_start = Some(evt.start.clone());
            created.scheduled_end = Some(evt.end.clone());
            created.duration_minutes = Some(duration_mins);
            created.estimated_pomodoros = est_pomos;
            created.calendar_event_id = Some(evt.id.clone());
            created.linked_event_id = Some(evt.id.clone());

            state
                .store
                .set_task_event_link(created.id.clone(), Some(evt.id.clone()));

            let mut tasks = state.store.get_app_data().tasks;
            if let Some(existing) = tasks.iter_mut().find(|t| t.id == created.id) {
                *existing = created.clone();
            } else {
                tasks.insert(0, created.clone());
            }
            state.store.save_tasks(tasks);

            if let (Some(ref g_id), Some(ref list_id)) = (
                &created.google_task_id,
                &created.google_task_list_id,
            ) {
                let _ = google_api::update_google_task(
                    &state.store,
                    list_id.clone(),
                    g_id.clone(),
                    UpdateTaskPatch {
                        title: None,
                        notes: None,
                        completed: None,
                        due: Some(due_ymd),
                    },
                )
                .await;
            }

            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Converted event '{}' into a task with {}m timer", evt.summary, duration_mins),
                "task": created
            })
        }

        "list_projects" => {
            let app_data = state.store.get_app_data();
            json!({
                "ok": true,
                "projects": app_data.projects
            })
        }

        "create_or_update_project" => {
            let proj_name = match args.get("name").and_then(|v| v.as_str()) {
                Some(n) if !n.trim().is_empty() => n.trim().to_string(),
                _ => return json!({ "ok": false, "error": "Missing required project 'name'" }),
            };
            let proj_id = args.get("project_id").and_then(|v| v.as_str());
            let color = args
                .get("color")
                .and_then(|v| v.as_str())
                .unwrap_or("#6366f1")
                .to_string();
            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let milestones: Option<Vec<Milestone>> = args
                .get("milestones")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .enumerate()
                        .filter_map(|(i, m)| {
                            let t = m.get("title")?.as_str()?.trim();
                            if t.is_empty() {
                                return None;
                            }
                            Some(Milestone {
                                id: format!("ms-{}-{}", Utc::now().timestamp_millis(), i),
                                title: t.to_string(),
                                done: m.get("done").and_then(|d| d.as_bool()).unwrap_or(false),
                                required_task_ids: m
                                    .get("required_task_ids")
                                    .or_else(|| m.get("requiredTaskIds"))
                                    .and_then(|v| v.as_array())
                                    .map(|a| {
                                        a.iter()
                                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default(),
                            })
                        })
                        .collect()
                });

            let mut projects = state.store.get_app_data().projects;
            let lower = proj_name.to_lowercase();
            let existing_idx = projects.iter().position(|p| {
                if let Some(id) = proj_id {
                    if p.id == id {
                        return true;
                    }
                }
                p.name.to_lowercase() == lower
            });

            let mut previous_project: Option<Project> = None;
            let saved_project = if let Some(idx) = existing_idx {
                previous_project = Some(projects[idx].clone());
                projects[idx].name = proj_name;
                if args.get("color").is_some() {
                    projects[idx].color = color;
                }
                if description.is_some() {
                    projects[idx].description = description;
                }
                if let Some(ms) = milestones {
                    projects[idx].milestones = ms;
                }
                projects[idx].clone()
            } else {
                let p = Project {
                    id: format!("proj-{}", Utc::now().timestamp_millis()),
                    name: proj_name,
                    color,
                    description,
                    milestones: milestones.unwrap_or_default(),
                    created_at: Utc::now().to_rfc3339(),
                };
                projects.push(p.clone());
                p
            };

            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would save project '{}'", saved_project.name),
                    "previewProject": saved_project,
                });
            }

            state.store.save_projects(projects);
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "project": saved_project,
                "previousProject": previous_project,
            })
        }

        "delete_project" => {
            let proj_id = args.get("project_id").and_then(|v| v.as_str());
            let name_match = args
                .get("name_match")
                .or_else(|| args.get("name"))
                .and_then(|v| v.as_str());

            let mut projects = state.store.get_app_data().projects;
            let idx = match pick_unique(
                &projects,
                proj_id,
                name_match,
                |p| p.id.clone(),
                |p| p.name.clone(),
                "project",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };

            let removed = projects.remove(idx);
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would delete project '{}'", removed.name),
                    "targetProject": removed,
                });
            }

            state.store.save_projects(projects);
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "deletedProject": removed
            })
        }

        "control_timer" => {
            let raw_action = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("start");
            let norm_action = raw_action.trim().to_lowercase();
            let action = match norm_action.as_str() {
                "begin" | "play" => "start",
                "continue" | "unpause" => "resume",
                "stop" | "clear" => "reset",
                other => other,
            };
            if action == "status" {
                let current_timer = state.timer.lock().unwrap().clone();
                return json!({ "ok": true, "timer": current_timer });
            }
            if !matches!(action, "start" | "pause" | "resume" | "reset" | "extend") {
                return json!({
                    "ok": false,
                    "error": format!(
                        "Unknown action '{}' for control_timer; valid actions: status, start, pause, resume, reset, extend",
                        action
                    )
                });
            }
            if dry_run {
                let current_timer = state.timer.lock().unwrap().clone();
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would execute timer action '{}'", action),
                    "action": action,
                    "currentTimer": current_timer,
                });
            }
            let def_mins = state.store.get_settings().focus_minutes.max(1);
            let now_ms = Utc::now().timestamp_millis();

            let next_state = {
                let mut t = state.timer.lock().unwrap();
                match action {
                    "start" => {
                        let mode = args
                            .get("mode")
                            .and_then(|v| v.as_str())
                            .unwrap_or("focus")
                            .to_string();
                        let mins = args
                            .get("duration_minutes")
                            .and_then(|v| v.as_u64())
                            .map(|n| (n as u32).max(1))
                            .unwrap_or(def_mins);
                        let secs = mins * 60;
                        let title = args
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Focus Session")
                            .to_string();

                        t.mode = mode.clone();
                        t.total_seconds = secs;
                        t.is_running = true;
                        t.session_started_at = Some(Utc::now().to_rfc3339());
                        if mode == "stopwatch" {
                            t.seconds_left = 0;
                            t.target_end_time = None;
                            t.stopwatch_started_at = Some(now_ms);
                            t.stopwatch_accumulated_secs = Some(0);
                        } else {
                            t.seconds_left = secs;
                            t.target_end_time = Some(now_ms + (secs as i64) * 1000);
                            t.stopwatch_started_at = None;
                            t.stopwatch_accumulated_secs = Some(0);
                        }
                        t.active_target = Some(ActiveTarget {
                            target_type: if args.get("event_id").is_some() {
                                "event".to_string()
                            } else if args.get("task_id").is_some() {
                                "task".to_string()
                            } else {
                                "custom".to_string()
                            },
                            id: args
                                .get("task_id")
                                .or_else(|| args.get("event_id"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            title,
                            project_id: None,
                            calendar_event_id: args
                                .get("event_id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            linked_task_id: args
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            duration_minutes: Some(mins),
                            next_subtask: args
                                .get("task_id")
                                .and_then(|v| v.as_str())
                                .and_then(|tid| {
                                    state
                                        .store
                                        .get_app_data()
                                        .tasks
                                        .into_iter()
                                        .find(|tk| tk.id == tid)
                                        .and_then(|tk| {
                                            tk.subtasks
                                                .into_iter()
                                                .find(|st| !st.done)
                                                .map(|st| st.title)
                                        })
                                }),
                        });
                    }
                    "pause" => {
                        t.is_running = false;
                        t.target_end_time = None;
                        t.stopwatch_started_at = None;
                        t.stopwatch_accumulated_secs = Some(t.seconds_left);
                    }
                    "resume" => {
                        t.is_running = true;
                        if t.session_started_at.is_none() {
                            t.session_started_at = Some(Utc::now().to_rfc3339());
                        }
                        if t.mode == "stopwatch" {
                            t.stopwatch_started_at = Some(now_ms);
                            t.stopwatch_accumulated_secs = Some(t.seconds_left);
                        } else {
                            if t.seconds_left == 0 {
                                t.seconds_left = t.total_seconds.max(60);
                            }
                            t.target_end_time = Some(now_ms + (t.seconds_left as i64) * 1000);
                        }
                    }
                    "reset" => {
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
                        t.active_target = None;
                    }
                    "extend" => {
                        let add_mins = args
                            .get("duration_minutes")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(5) as u32;
                        let add_secs = add_mins * 60;
                        t.seconds_left += add_secs;
                        t.total_seconds += add_secs;
                        if let Some(end) = t.target_end_time {
                            t.target_end_time = Some(end + (add_secs as i64) * 1000);
                        }
                    }
                    _ => {}
                }
                t.clone()
            };

            let mut shifted_blocks: Vec<Value> = Vec::new();
            if action == "extend"
                && args
                    .get("auto_shift_next")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
            {
                let add_mins = args
                    .get("duration_minutes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(5) as i64;
                let anchor_eid = next_state
                    .active_target
                    .as_ref()
                    .and_then(|a| {
                        a.calendar_event_id.as_deref().or_else(|| {
                            if a.target_type == "event" {
                                a.id.as_deref()
                            } else {
                                None
                            }
                        })
                    })
                    .map(|s| s.to_string());
                if let Some(eid) = anchor_eid {
                    if let Ok(shifted) =
                        planner::shift_following_blocks(&state.store, &eid, add_mins).await
                    {
                        shifted_blocks = shifted;
                        if !shifted_blocks.is_empty() {
                            let (s_iso, e_iso) = planner::day_bounds_iso(Local::now().date_naive());
                            if let Ok(evts) =
                                google_api::fetch_calendar_events(&state.store, s_iso, e_iso).await
                            {
                                *state.cached_events.lock().unwrap() = evts;
                            }
                            let _ = app.emit("data:updated", ());
                        }
                    }
                }
            }

            if action == "start" || action == "resume" {
                ensure_floating_window(app);
            }
            rebuild_tray_menu(app);
            let _ = app.emit("timer:sync", next_state.clone());
            json!({
                "ok": true,
                "shiftedBlocks": shifted_blocks,
                "timer": next_state
            })
        }

        "sync_google" => {
            let now = Local::now();
            let start_iso = now
                .date_naive()
                .and_hms_opt(0, 0, 0)
                .and_then(|ndt| Local.from_local_datetime(&ndt).single())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();
            let end_iso = now
                .date_naive()
                .and_hms_opt(23, 59, 59)
                .and_then(|ndt| Local.from_local_datetime(&ndt).single())
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            let evts = google_api::fetch_calendar_events(&state.store, start_iso, end_iso)
                .await
                .unwrap_or_default();
            *state.cached_events.lock().unwrap() = evts.clone();
            let tasks_res = google_api::sync_google_tasks(&state.store).await;
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());

            json!({
                "ok": true,
                "eventsCount": evts.len(),
                "tasksCount": tasks_res.map(|r| r.tasks.len()).unwrap_or(0)
            })
        }

        "find_free_slots" => {
            let settings = state.store.get_settings();
            let date = planner::parse_date_key(args.get("date").and_then(|v| v.as_str()));
            let start_hour = args
                .get("start_hour")
                .and_then(|v| v.as_u64())
                .map(|n| (n as u32).min(23))
                .unwrap_or(settings.work_start_hour);
            let end_hour = args
                .get("end_hour")
                .and_then(|v| v.as_u64())
                .map(|n| (n as u32).clamp(1, 24))
                .unwrap_or(settings.work_end_hour);
            let min_mins = args
                .get("min_minutes")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)
                .unwrap_or(25);
            let slots = planner::find_free_slots_for_day(
                &state.store,
                date,
                start_hour,
                end_hour,
                min_mins,
            )
            .await;
            json!({
                "ok": true,
                "date": ymd_string(&date),
                "slotsCount": slots.len(),
                "slots": slots,
            })
        }

        "time_block_task" => {
            let task_id = args.get("task_id").and_then(|v| v.as_str());
            let title_match = args
                .get("title_match")
                .or_else(|| args.get("title"))
                .and_then(|v| v.as_str());
            let mut tasks = state.store.get_app_data().tasks;
            let idx = match pick_unique(
                &tasks,
                task_id,
                title_match,
                |t| t.id.clone(),
                |t| t.title.clone(),
                "task",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };
            let task = tasks[idx].clone();
            let settings = state.store.get_settings();
            let date = planner::parse_date_key(args.get("date").and_then(|v| v.as_str()));
            let dur_mins = task
                .duration_minutes
                .filter(|&m| m > 0)
                .unwrap_or_else(|| task.estimated_pomodoros.max(1) * settings.focus_minutes.max(1));

            let mut slots = planner::find_free_slots_for_day(
                &state.store,
                date,
                settings.work_start_hour,
                23,
                dur_mins,
            )
            .await;
            if slots.is_empty() {
                slots = planner::find_free_slots_for_day(&state.store, date, 0, 24, dur_mins).await;
            }
            let Some(slot) = slots.first() else {
                return json!({
                    "ok": false,
                    "error": format!("No open {}-minute slot available on {}", dur_mins, ymd_string(&date))
                });
            };
            let start_dt = chrono::DateTime::parse_from_rfc3339(&slot.start).unwrap();
            let end_dt = start_dt + Duration::minutes(dur_mins as i64);
            if let Err(err) = crate::task_tree::validate_time_block_hierarchy(
                &tasks,
                &task.id,
                &start_dt.to_rfc3339(),
                &end_dt.to_rfc3339(),
            ) {
                return json!({ "ok": false, "error": err });
            }
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would time-block '{}' for {}m on {}", task.title, dur_mins, ymd_string(&date)),
                    "proposedStart": start_dt.to_rfc3339(),
                    "proposedEnd": end_dt.to_rfc3339(),
                    "taskId": task.id,
                });
            }
            let created = match google_api::create_calendar_event(
                &state.store,
                CreateEventPayload {
                    calendar_id: Some(google_api::default_write_cal(&state.store)),
                    summary: task.title.clone(),
                    description: Some(
                        task.notes
                            .clone()
                            .unwrap_or_else(|| "Time-blocked from FocusFlow".to_string()),
                    ),
                    start: start_dt.to_rfc3339(),
                    end: end_dt.to_rfc3339(),
                },
            )
            .await
            {
                Ok(e) => e,
                Err(err) => return json!({ "ok": false, "error": err }),
            };

            state
                .store
                .set_task_event_link(task.id.clone(), Some(created.id.clone()));
            tasks[idx].calendar_event_id = Some(created.id.clone());
            tasks[idx].linked_event_id = Some(created.id.clone());
            tasks[idx].scheduled_start = Some(created.start.clone());
            tasks[idx].scheduled_end = Some(created.end.clone());
            let updated_task = tasks[idx].clone();
            state.store.save_tasks(tasks);

            if event_is_today(&created) {
                state.cached_events.lock().unwrap().push(created.clone());
            }
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Time-blocked '{}' for {}m on {}", updated_task.title, dur_mins, ymd_string(&date)),
                "event": created,
                "task": updated_task,
                "previousTask": task,
            })
        }

        "plan_my_day" => {
            let date = planner::parse_date_key(args.get("date").and_then(|v| v.as_str()));
            let task_id = args.get("task_id").and_then(|v| v.as_str());
            let title_match = args
                .get("title_match")
                .or_else(|| args.get("title"))
                .and_then(|v| v.as_str());
            let dry_run = args.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false);
            match planner::plan_tasks_with_options(&state.store, date, task_id, title_match, dry_run).await {
                Ok(res) => {
                    if !dry_run {
                        let (s_iso, e_iso) = planner::day_bounds_iso(Local::now().date_naive());
                        if let Ok(evts) =
                            google_api::fetch_calendar_events(&state.store, s_iso, e_iso).await
                        {
                            *state.cached_events.lock().unwrap() = evts;
                        }
                        rebuild_tray_menu(app);
                        let _ = app.emit("data:updated", ());
                    }
                    res
                }
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }

        "get_focus_stats" => {
            let app_data = state.store.get_app_data();
            let format = args
                .get("format")
                .and_then(|v| v.as_str())
                .unwrap_or("summary")
                .trim()
                .to_lowercase();
            if format == "csv" || format == "markdown" || format == "md" {
                let norm_fmt = if format == "csv" { "csv" } else { "markdown" };
                let content = planner::export_focus_logs(&app_data, norm_fmt);
                return json!({
                    "ok": true,
                    "format": norm_fmt,
                    "sessionsCount": app_data.sessions.len(),
                    "content": content,
                });
            }
            let mut stats = planner::compute_focus_stats(&app_data);
            if format != "json" && format != "detail" {
                if let Some(obj) = stats.as_object_mut() {
                    obj.remove("recentSessions");
                    obj.remove("projectBreakdown");
                    obj.insert("format".into(), json!("summary"));
                }
            }
            if let Some(obj) = stats.as_object_mut() {
                obj.insert("ok".into(), json!(true));
            }
            stats
        }

        "undo_last" => {
            let target_id = args.get("id").and_then(|v| v.as_i64());
            if dry_run {
                let entries = crate::ai_audit::read_audit(25);
                let target = if let Some(tid) = target_id {
                    entries.into_iter().find(|e| e.get("id").and_then(|v| v.as_i64()) == Some(tid))
                } else {
                    entries.into_iter().find(|e| e.get("canUndo").and_then(|v| v.as_bool()) == Some(true))
                };
                return match target {
                    Some(entry) => json!({
                        "ok": true,
                        "dryRun": true,
                        "message": "Dry run: would undo matching AI audit entry",
                        "wouldUndo": entry,
                    }),
                    None => json!({ "ok": false, "dryRun": true, "error": "No undoable AI actions found in audit log" }),
                };
            }
            match crate::ai_audit::undo_last_audit(app, target_id).await {
                Ok(v) => v,
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }

        "shutdown_review" => {
            let date = planner::parse_date_key(args.get("date").and_then(|v| v.as_str()));
            let roll = args
                .get("roll_unfinished")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let write_obs = args
                .get("write_obsidian")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let dry_run = args
                .get("dry_run")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            match planner::run_shutdown_review(&state.store, date, roll, write_obs, dry_run).await {
                Ok(res) => {
                    if roll && !dry_run {
                        rebuild_tray_menu(app);
                        let _ = app.emit("data:updated", ());
                    }
                    res
                }
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }

        "set_reminder" => {
            let title = match args.get("title").and_then(|v| v.as_str()) {
                Some(t) if !t.trim().is_empty() => t.trim().to_string(),
                _ => return json!({ "ok": false, "error": "Missing required parameter 'title'" }),
            };
            let body = args
                .get("body")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            let now_local = Local::now();
            let fire_dt = if let Some(in_mins) = args.get("in_minutes").and_then(|v| v.as_i64()) {
                now_local + Duration::minutes(in_mins.max(1))
            } else if let Some(raw_at) = args.get("at").and_then(|v| v.as_str()) {
                let s = raw_at.trim();
                let lower = s.to_lowercase();
                if let Some(mins) = lower.strip_prefix('+').and_then(|x| x.strip_suffix('m')).and_then(|x| x.trim().parse::<i64>().ok()) {
                    now_local + Duration::minutes(mins.max(1))
                } else if let Some(hrs) = lower.strip_prefix('+').and_then(|x| x.strip_suffix('h')).and_then(|x| x.trim().parse::<i64>().ok()) {
                    now_local + Duration::hours(hrs.max(1))
                } else if let Some(parsed) = parse_flexible_datetime(s, Some(now_local.date_naive())) {
                    if parsed <= now_local && !s.contains('-') && !s.contains('T') {
                        parsed + Duration::days(1)
                    } else {
                        parsed
                    }
                } else {
                    return json!({ "ok": false, "error": format!("Could not parse reminder time '{}'", s) });
                }
            } else {
                now_local + Duration::minutes(15)
            };

            let rem = ScheduledReminder {
                id: format!("rem-{}", Utc::now().timestamp_millis()),
                title: title.clone(),
                body,
                fire_at: fire_dt.to_rfc3339(),
                fired: false,
            };
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would schedule reminder '{}' for {}", title, fire_dt.format("%Y-%m-%d %H:%M")),
                    "previewReminder": rem
                });
            }
            state.store.add_reminder(rem.clone());
            json!({
                "ok": true,
                "message": format!("Scheduled reminder '{}' for {}", title, fire_dt.format("%Y-%m-%d %H:%M")),
                "reminder": rem
            })
        }

        "manage_subtasks" => {
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            let mut tasks = state.store.get_app_data().tasks;
            let idx = match pick_unique(
                &tasks,
                args.get("task_id").and_then(|v| v.as_str()),
                args.get("title_match").and_then(|v| v.as_str()),
                |t| t.id.clone(),
                |t| t.title.clone(),
                "task",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };

            let prev = tasks[idx].clone();
            let sub_id = args.get("subtask_id").and_then(|v| v.as_str());
            let sub_title = args.get("subtask_title").and_then(|v| v.as_str());
            let sub_hint = |e: Value| -> Value {
                let msg = e.get("error").and_then(|v| v.as_str()).unwrap_or("");
                if msg.starts_with("No matching subtask") {
                    json!({ "ok": false, "error": format!(
                        "No matching subtask on '{}'. Pass subtask_id or subtask_title of an existing one, or use subtask_action='add' (with subtask_title) to create it. Default subtask_action is 'toggle'.",
                        prev.title) })
                } else if msg.starts_with("Provide an id or a title to identify the subtask") {
                    json!({ "ok": false, "error": "Provide 'subtask_id' or 'subtask_title' to identify the subtask (subtask_action: add | toggle | remove)" })
                } else {
                    e
                }
            };
            match action {
                "add" => {
                    let Some(t) = sub_title.map(str::trim).filter(|s| !s.is_empty()) else {
                        return json!({ "ok": false, "error": "Provide 'subtask_title' to add" });
                    };
                    tasks[idx].subtasks.push(Subtask {
                        id: format!("sub-{}", Utc::now().timestamp_millis()),
                        title: t.to_string(),
                        done: false,
                    });
                }
                "toggle" => {
                    let sidx = match pick_unique(
                        &tasks[idx].subtasks,
                        sub_id,
                        sub_title,
                        |s| s.id.clone(),
                        |s| s.title.clone(),
                        "subtask",
                    ) {
                        Ok(i) => i,
                        Err(e) => return sub_hint(e),
                    };
                    tasks[idx].subtasks[sidx].done = !tasks[idx].subtasks[sidx].done;
                }
                "remove" => {
                    let sidx = match pick_unique(
                        &tasks[idx].subtasks,
                        sub_id,
                        sub_title,
                        |s| s.id.clone(),
                        |s| s.title.clone(),
                        "subtask",
                    ) {
                        Ok(i) => i,
                        Err(e) => return sub_hint(e),
                    };
                    tasks[idx].subtasks.remove(sidx);
                }
                _ => {
                    return json!({ "ok": false, "error": "Unknown action (use add, toggle, or remove)" });
                }
            }
            let updated_task = tasks[idx].clone();
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would update subtasks on '{}'", updated_task.title),
                    "previewTask": updated_task,
                });
            }
            state.store.save_tasks(tasks);
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Updated subtasks on '{}'", updated_task.title),
                "task": updated_task,
                "previousTask": prev,
            })
        }

        "manage_project_milestone" => {
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            let mut projects = state.store.get_app_data().projects;
            let idx = match pick_unique(
                &projects,
                args.get("project_id").and_then(|v| v.as_str()),
                args.get("name_match").and_then(|v| v.as_str()),
                |p| p.id.clone(),
                |p| p.name.clone(),
                "project",
            ) {
                Ok(i) => i,
                Err(e) => return e,
            };
            let prev = projects[idx].clone();
            let ms_id = args.get("milestone_id").and_then(|v| v.as_str());
            let ms_title = args.get("milestone_title").and_then(|v| v.as_str());
            match action {
                "add" => {
                    let Some(t) = ms_title.map(str::trim).filter(|s| !s.is_empty()) else {
                        return json!({ "ok": false, "error": "Provide 'milestone_title' to add" });
                    };
                    projects[idx].milestones.push(Milestone {
                        id: format!("ms-{}", Utc::now().timestamp_millis()),
                        title: t.to_string(),
                        done: false,
                        required_task_ids: args
                            .get("required_task_ids")
                            .and_then(|v| v.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                    });
                }
                "toggle" => {
                    let midx = match pick_unique(
                        &projects[idx].milestones,
                        ms_id,
                        ms_title,
                        |m| m.id.clone(),
                        |m| m.title.clone(),
                        "milestone",
                    ) {
                        Ok(i) => i,
                        Err(e) => return e,
                    };
                    if !projects[idx].milestones[midx].required_task_ids.is_empty() {
                        return json!({
                            "ok": false,
                            "error": format!(
                                "Milestone '{}' is gated by {} task(s). Complete the required tasks instead.",
                                projects[idx].milestones[midx].title,
                                projects[idx].milestones[midx].required_task_ids.len()
                            )
                        });
                    }
                    projects[idx].milestones[midx].done = !projects[idx].milestones[midx].done;
                }
                "remove" => {
                    let midx = match pick_unique(
                        &projects[idx].milestones,
                        ms_id,
                        ms_title,
                        |m| m.id.clone(),
                        |m| m.title.clone(),
                        "milestone",
                    ) {
                        Ok(i) => i,
                        Err(e) => return e,
                    };
                    projects[idx].milestones.remove(midx);
                }
                _ => {
                    return json!({ "ok": false, "error": "Unknown action (use add, toggle, or remove)" });
                }
            }
            let updated_project = projects[idx].clone();
            if dry_run {
                return json!({
                    "ok": true,
                    "dryRun": true,
                    "message": format!("Dry run: would update milestones on project '{}'", updated_project.name),
                    "previewProject": updated_project,
                });
            }

            state.store.save_projects(projects);
            rebuild_tray_menu(app);
            let _ = app.emit("data:updated", ());
            json!({
                "ok": true,
                "message": format!("Updated milestones on project '{}'", updated_project.name),
                "project": updated_project,
                "previousProject": prev,
            })
        }

        "manage_template" => {
            let action = match args.get("action").and_then(|v| v.as_str()).unwrap_or("list") {
                "create" | "add" | "update" => "save",
                "instantiate" | "use" => "apply",
                "remove" => "delete",
                other => other,
            };
            let mut templates = state.store.get_app_data().templates;
            match action {
                "list" => json!({ "ok": true, "templates": templates }),
                "save" => {
                    let name = match args.get("name").and_then(|v| v.as_str()) {
                        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
                        _ => return json!({ "ok": false, "error": "Missing required template 'name'" }),
                    };
                    let title = args
                        .get("title")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| name.clone());
                    let tpl = TaskTemplate {
                        id: format!("tpl-{}", Utc::now().timestamp_millis()),
                        name,
                        title,
                        notes: args.get("notes").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        priority: args.get("priority").and_then(|v| v.as_u64()).map(|n| (n as u8).clamp(1, 5)).unwrap_or(3),
                        duration_minutes: args.get("duration_minutes").and_then(|v| v.as_u64()).map(|n| n as u32),
                        estimated_pomodoros: args
                            .get("duration_minutes")
                            .and_then(|v| v.as_u64())
                            .map(|dm| (dm as u32).div_ceil(state.store.get_settings().focus_minutes.max(1)).max(1))
                            .unwrap_or(1),
                        project_id: None,
                        recurrence: normalize_recurrence_opt(args.get("recurrence").and_then(|v| v.as_str())),
                        subtasks: args
                            .get("subtasks")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|x| x.trim().to_string())).filter(|s| !s.is_empty()).collect())
                            .unwrap_or_default(),
                        created_at: Utc::now().to_rfc3339(),
                    };
                    if dry_run {
                        return json!({ "ok": true, "dryRun": true, "message": format!("Dry run: would save template '{}'", tpl.name), "previewTemplate": tpl });
                    }
                    let prev_templates = templates.clone();
                    templates.push(tpl.clone());
                    state.store.save_templates(templates);
                    let _ = app.emit("data:updated", ());
                    json!({ "ok": true, "message": format!("Saved template '{}'", tpl.name), "template": tpl, "previousTemplates": prev_templates })
                }
                "apply" => {
                    let tid = args.get("template_id").and_then(|v| v.as_str());
                    let tname = args.get("name").and_then(|v| v.as_str());
                    let idx = match pick_unique(&templates, tid, tname, |t| t.id.clone(), |t| t.name.clone(), "template") {
                        Ok(i) => i,
                        Err(e) => return e,
                    };
                    let tpl = templates[idx].clone();
                    let due_date = args
                        .get("due_date")
                        .and_then(|v| v.as_str())
                        .map(parse_flexible_due_date)
                        .or_else(|| Some(ymd_string(&Local::now())));
                    if dry_run {
                        return json!({ "ok": true, "dryRun": true, "message": format!("Dry run: would apply template '{}' with due date {:?}", tpl.name, due_date), "template": tpl, "dueDate": due_date });
                    }
                    let mut created = match google_api::create_google_task(&state.store, tpl.title.clone(), tpl.notes.clone(), None).await {
                        Ok(t) => t,
                        Err(e) => return json!({ "ok": false, "error": e }),
                    };
                    created.priority = tpl.priority;
                    created.duration_minutes = tpl.duration_minutes;
                    created.estimated_pomodoros = tpl.estimated_pomodoros.max(1);
                    created.project_id = tpl.project_id.clone();
                    created.recurrence = tpl.recurrence.clone();
                    created.due_date = due_date;
                    created.subtasks = tpl
                        .subtasks
                        .iter()
                        .enumerate()
                        .map(|(i, st)| Subtask {
                            id: format!("sub-{}-{}", Utc::now().timestamp_millis(), i),
                            title: st.clone(),
                            done: false,
                        })
                        .collect();
                    let mut tasks = state.store.get_app_data().tasks;
                    if let Some(ex) = tasks.iter_mut().find(|t| t.id == created.id) {
                        *ex = created.clone();
                    } else {
                        tasks.insert(0, created.clone());
                    }
                    state.store.save_tasks(tasks);
                    rebuild_tray_menu(app);
                    let _ = app.emit("data:updated", ());
                    json!({ "ok": true, "message": format!("Applied template '{}'", tpl.name), "task": created })
                }
                "delete" => {
                    let tid = args.get("template_id").and_then(|v| v.as_str());
                    let tname = args.get("name").and_then(|v| v.as_str());
                    let idx = match pick_unique(&templates, tid, tname, |t| t.id.clone(), |t| t.name.clone(), "template") {
                        Ok(i) => i,
                        Err(e) => return e,
                    };
                    if dry_run {
                        return json!({ "ok": true, "dryRun": true, "message": format!("Dry run: would delete template '{}'", templates[idx].name), "targetTemplate": templates[idx] });
                    }
                    let prev_templates = templates.clone();
                    let removed = templates.remove(idx);
                    state.store.save_templates(templates);
                    let _ = app.emit("data:updated", ());
                    json!({ "ok": true, "message": format!("Deleted template '{}'", removed.name), "previousTemplates": prev_templates })
                }
                _ => json!({ "ok": false, "error": "Unknown manage_template action; valid actions: list, save, apply, delete" }),
            }
        }

        "manage_task" => {
            let act = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "ok": false,
                "error": format!(
                    "Unknown action '{}' for manage_task; valid actions: list, add, update, complete, delete, move, subtask",
                    act
                )
            })
        }

        "manage_event" => {
            let act = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "ok": false,
                "error": format!(
                    "Unknown action '{}' for manage_event; valid actions: list, add, reschedule, delete, convert_to_task, find_free_slots",
                    act
                )
            })
        }

        "manage_project" => {
            let act = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            json!({
                "ok": false,
                "error": format!(
                    "Unknown action '{}' for manage_project; valid actions: list, save, delete, milestone",
                    act
                )
            })
        }

        _ => json!({
            "ok": false,
            "error": format!("Unknown tool '{}'", name)
        }),
    }
}


// ---------- Safe target matching ----------

/// Finds exactly one item. An id must match exactly. A text query first tries an
/// exact (case-insensitive) title match, then a substring match; if several items
/// match, nothing is touched and the candidates are returned so the caller can
/// choose by id.
fn pick_unique<T>(
    items: &[T],
    id: Option<&str>,
    query: Option<&str>,
    get_id: impl Fn(&T) -> String,
    get_label: impl Fn(&T) -> String,
    what: &str,
) -> Result<usize, Value> {
    if let Some(id) = id.map(str::trim).filter(|s| !s.is_empty()) {
        return match items.iter().position(|i| get_id(i) == id) {
            Some(i) => Ok(i),
            None => Err(json!({ "ok": false, "error": format!("No {} with id '{}'", what, id) })),
        };
    }
    let Some(q) = query.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) else {
        return Err(json!({
            "ok": false,
            "error": format!("Provide an id or a title to identify the {}", what)
        }));
    };

    let exact: Vec<usize> = (0..items.len())
        .filter(|&i| get_label(&items[i]).trim().to_lowercase() == q)
        .collect();
    let candidates: Vec<usize> = if exact.len() == 1 {
        return Ok(exact[0]);
    } else if exact.len() > 1 {
        exact
    } else {
        (0..items.len())
            .filter(|&i| get_label(&items[i]).to_lowercase().contains(&q))
            .collect()
    };

    match candidates.len() {
        0 => Err(json!({ "ok": false, "error": format!("No matching {} found", what) })),
        1 => Ok(candidates[0]),
        n => {
            let list: Vec<Value> = candidates
                .iter()
                .take(8)
                .map(|&i| json!({ "id": get_id(&items[i]), "title": get_label(&items[i]) }))
                .collect();
            Err(json!({
                "ok": false,
                "error": format!(
                    "{} {}s match '{}'. Nothing was changed. Repeat the call with the exact id.",
                    n, what, q
                ),
                "candidates": list
            }))
        }
    }
}
