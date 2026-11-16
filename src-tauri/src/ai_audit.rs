use crate::ai_tools::execute_tool_inner;
use crate::google_api::{self, CreateEventPayload, UpdateEventPayload};
use crate::types::{CalendarEvent, Project, TaskItem, TaskTemplate};
use crate::{rebuild_tray_menu, AppState};
use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

fn data_dir() -> std::path::PathBuf {
    crate::ai_server::data_dir()
}

// ---------- Audit log + undo ----------

const AUDITED_TOOLS: &[&str] = &[
    "add_task",
    "update_task",
    "complete_task",
    "delete_task",
    "move_task",
    "add_calendar_event",
    "reschedule_calendar_event",
    "delete_calendar_event",
    "convert_event_to_task",
    "create_or_update_project",
    "delete_project",
    "control_timer",
    "sync_google",
    "time_block_task",
    "plan_my_day",
    "manage_subtasks",
    "manage_project_milestone",
    "manage_project_lists",
    "manage_template",
    "shutdown_review",
    "set_reminder",
];

fn audit_path() -> std::path::PathBuf {
    data_dir().join("ai-audit.log")
}

fn append_audit_line(v: &Value) {
    use std::io::Write;
    let path = audit_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Keep the log small: rotate once it passes ~2 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 2_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", v);
    }
}

/// Maps unified MCP tools (`manage_task`, `manage_event`, `manage_project`)
/// onto their underlying canonical handlers while preserving Undo tracking.
fn normalize_tool_call(name: &str, args: &Value) -> (String, Value) {
    let raw_action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    // Accept common synonyms so a model guessing the verb still lands on the right handler.
    let action = match (name, raw_action.as_str()) {
        ("manage_task", "create" | "new") => "add",
        ("manage_task", "edit" | "patch") => "update",
        ("manage_task", "done" | "finish") => "complete",
        ("manage_task", "remove") => "delete",
        ("manage_task", "reparent") => "move",
        ("manage_task", "subtasks") => "subtask",
        ("manage_event", "create" | "new" | "schedule") => "add",
        ("manage_event", "move") => "reschedule",
        ("manage_event", "edit" | "link") => "update",
        ("manage_event", "remove") => "delete",
        ("manage_project", "create" | "add" | "update") => "save",
        ("manage_project", "remove") => "delete",
        ("manage_project", "milestones") => "milestone",
        ("manage_project", "lists" | "list_item" | "section") => "project_list",
        (_, a) => a,
    }
    .to_string();
    let args_owned = args.clone();
    let args = &args_owned;
    match name {
        "manage_task" => match action.as_str() {
            "list" | "" => ("list_tasks".to_string(), args.clone()),
            "add" => ("add_task".to_string(), args.clone()),
            "update" => ("update_task".to_string(), args.clone()),
            "complete" => ("complete_task".to_string(), args.clone()),
            "delete" => ("delete_task".to_string(), args.clone()),
            "move" => ("move_task".to_string(), args.clone()),
            "time_block" => ("time_block_task".to_string(), args.clone()),
            "subtask" => {
                let mut cloned = args.clone();
                if let Some(obj) = cloned.as_object_mut() {
                    let sub_act = args
                        .get("subtask_action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("toggle");
                    obj.insert("action".into(), json!(sub_act));
                }
                ("manage_subtasks".to_string(), cloned)
            }
            _ => (name.to_string(), args.clone()),
        },
        "manage_event" => match action.as_str() {
            "list" | "" => ("list_calendar_events".to_string(), args.clone()),
            "add" => ("add_calendar_event".to_string(), args.clone()),
            "reschedule" | "update" => ("reschedule_calendar_event".to_string(), args.clone()),
            "delete" => ("delete_calendar_event".to_string(), args.clone()),
            "convert_to_task" => ("convert_event_to_task".to_string(), args.clone()),
            "find_free_slots" => ("find_free_slots".to_string(), args.clone()),
            _ => (name.to_string(), args.clone()),
        },
        "manage_project" => match action.as_str() {
            "list" | "" => ("list_projects".to_string(), args.clone()),
            "save" => ("create_or_update_project".to_string(), args.clone()),
            "delete" => ("delete_project".to_string(), args.clone()),
            "milestone" => {
                let mut cloned = args.clone();
                if let Some(obj) = cloned.as_object_mut() {
                    let ms_act = args
                        .get("milestone_action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("toggle");
                    obj.insert("action".into(), json!(ms_act));
                }
                ("manage_project_milestone".to_string(), cloned)
            }
            "project_list" => ("manage_project_lists".to_string(), args.clone()),
            _ => (name.to_string(), args.clone()),
        },
        _ => (name.to_string(), args.clone()),
    }
}

/// Runs a tool and records every change an AI agent makes.
pub async fn execute_tool(app: &AppHandle, raw_name: &str, raw_args: &Value) -> Value {
    let (canonical_name, canonical_args) = normalize_tool_call(raw_name, raw_args);
    let name = canonical_name.as_str();
    let args = &canonical_args;
    let mut result = execute_tool_inner(app, name, args).await;
    if !result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let err = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        crate::store::append_app_log("MCP", &format!("Tool '{}' failed: {}", raw_name, err));
    }
    let is_dry_run = args.get("dry_run").and_then(|v| v.as_bool()) == Some(true);
    let is_read_only_timer = name == "control_timer"
        && args.get("action").and_then(|v| v.as_str()) == Some("status");
    if AUDITED_TOOLS.contains(&name) && !is_dry_run && !is_read_only_timer {
        let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        let undo = if ok {
            match name {
                "add_task" => result
                    .get("task")
                    .and_then(|t| t.get("id"))
                    .and_then(|v| v.as_str())
                    .map(|id| json!({ "kind": "delete_created_task", "data": { "id": id } })),
                "add_calendar_event" => result
                    .get("event")
                    .and_then(|e| e.get("id").and_then(|v| v.as_str()))
                    .map(|id| {
                        let cid = result
                            .get("event")
                            .and_then(|e| e.get("calendarId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("primary");
                        json!({ "kind": "delete_created_event", "data": { "id": id, "calendarId": cid } })
                    }),
                "manage_template" => {
                    if let Some(id) = result.get("task").and_then(|t| t.get("id")).and_then(|v| v.as_str()) {
                        Some(json!({ "kind": "delete_created_task", "data": { "id": id } }))
                    } else {
                        result
                            .get("previousTemplates")
                            .filter(|p| !p.is_null())
                            .map(|d| json!({ "kind": "templates_snapshot", "data": d }))
                    }
                }
                "set_reminder" => result
                    .get("reminder")
                    .and_then(|r| r.get("id"))
                    .and_then(|v| v.as_str())
                    .map(|id| json!({ "kind": "delete_created_reminder", "data": { "id": id } })),
                "plan_my_day" => result
                    .get("previousTasks")
                    .filter(|p| !p.is_null())
                    .map(|prev_tasks| {
                        let evts = result.get("scheduled").cloned().unwrap_or_else(|| json!([]));
                        json!({
                            "kind": "plan_revert",
                            "data": { "events": evts, "previousTasks": prev_tasks }
                        })
                    }),
                "shutdown_review" => result
                    .get("previousTasks")
                    .filter(|p| !p.is_null())
                    .map(|prev_tasks| json!({ "kind": "tasks_patch_list", "data": prev_tasks })),
                "delete_task" => result
                    .get("previousTasks")
                    .filter(|p| !p.is_null())
                    .map(|prev_tasks| json!({ "kind": "tasks_patch_list", "data": prev_tasks }))
                    .or_else(|| result.get("deletedTask").map(|d| json!({ "kind": "task", "data": d }))),
                "delete_project" => result.get("deletedProject").map(|d| json!({ "kind": "project", "data": d })),
                "delete_calendar_event" => result.get("deletedEvent").map(|d| json!({ "kind": "event", "data": d })),
                "update_task" | "complete_task" | "move_task" | "manage_subtasks" | "time_block_task" => {
                    if let Some(prev_tasks) = result.get("previousTasks").filter(|p| !p.is_null()) {
                        Some(json!({ "kind": "tasks_patch_list", "data": prev_tasks }))
                    } else {
                        // A recurring completion also spawns the next copy; remember it so undo can remove it.
                        let spawned = result
                            .get("nextRecurringTask")
                            .and_then(|t| t.get("id"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        result.get("previousTask").map(|d| {
                            json!({ "kind": "task_patch", "data": d, "spawnedTaskId": spawned })
                        })
                    }
                }
                "reschedule_calendar_event" => {
                    result.get("previousEvent").map(|d| json!({ "kind": "event_patch", "data": d }))
                }
                "create_or_update_project" | "manage_project_milestone" | "manage_project_lists" => {
                    result
                        .get("previousProject")
                        .filter(|p| !p.is_null())
                        .map(|d| json!({ "kind": "project_patch", "data": d }))
                }
                _ => None,
            }
        } else {
            None
        };
        if let Some(obj) = result.as_object_mut() {
            obj.remove("previousTask");
            obj.remove("previousEvent");
            obj.remove("previousProject");
            obj.remove("previousTemplates");
            obj.remove("previousTasks");
        }
        let summary = result
            .get("message")
            .or_else(|| result.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        append_audit_line(&json!({
            "id": Utc::now().timestamp_millis(),
            "time": Utc::now().to_rfc3339(),
            "tool": raw_name,
            "args": raw_args,
            "ok": ok,
            "summary": summary,
            "undo": undo,
        }));
    }
    result
}

fn read_audit_lines() -> Vec<Value> {
    std::fs::read_to_string(audit_path())
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect()
}

/// Newest first. Each entry has `canUndo` and `undone` flags; the (possibly
/// large) undo payload itself is not sent to the UI.
pub fn read_audit(limit: usize) -> Vec<Value> {
    let all = read_audit_lines();
    let undone: std::collections::HashSet<i64> = all
        .iter()
        .filter_map(|e| e.get("undone").and_then(|v| v.as_i64()))
        .collect();
    all.into_iter()
        .filter(|e| e.get("tool").is_some())
        .rev()
        .take(limit.clamp(1, 200))
        .map(|mut e| {
            let id = e.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let has_undo = e.get("undo").map(|u| !u.is_null()).unwrap_or(false);
            let was_undone = undone.contains(&id);
            if let Some(obj) = e.as_object_mut() {
                obj.remove("undo");
                obj.insert("undone".into(), json!(was_undone));
                obj.insert("canUndo".into(), json!(has_undo && !was_undone));
            }
            e
        })
        .collect()
}

/// Restores something an AI agent deleted.
pub async fn undo_audit(app: &AppHandle, id: i64) -> Result<String, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "App not ready".to_string())?;
    let all = read_audit_lines();
    if all.iter().any(|e| e.get("undone").and_then(|v| v.as_i64()) == Some(id)) {
        return Err("This action was already undone".to_string());
    }
    let entry = all
        .iter()
        .find(|e| e.get("id").and_then(|v| v.as_i64()) == Some(id) && e.get("tool").is_some())
        .ok_or_else(|| "Action not found".to_string())?;
    let undo = entry
        .get("undo")
        .filter(|u| !u.is_null())
        .ok_or_else(|| "This action cannot be undone".to_string())?;
    let kind = undo.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let data = undo.get("data").cloned().unwrap_or(Value::Null);

    let message = match kind {
        "task" => {
            let mut task: TaskItem = serde_json::from_value(data).map_err(|e| e.to_string())?;
            // The Google copy was deleted too; restore it as a local task so a
            // later sync does not treat it as a stale remote item.
            task.google_task_id = None;
            task.google_task_list_id = None;
            task.google_task_list_title = None;
            let title = task.title.clone();
            let mut tasks = state.store.get_app_data().tasks;
            if tasks.iter().any(|t| t.id == task.id) {
                return Err("A task with this id already exists".to_string());
            }
            tasks.insert(0, task);
            state.store.save_tasks(tasks);
            format!("Restored task '{}'", title)
        }
        "project" => {
            let project: Project = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let name = project.name.clone();
            let mut projects = state.store.get_app_data().projects;
            if projects.iter().any(|p| p.id == project.id) {
                return Err("A project with this id already exists".to_string());
            }
            projects.push(project);
            state.store.save_projects(projects);
            format!("Restored project '{}'", name)
        }
        "event" => {
            let evt: crate::types::CalendarEvent =
                serde_json::from_value(data).map_err(|e| e.to_string())?;
            let summary = evt.summary.clone();
            let created = google_api::create_calendar_event(
                &state.store,
                CreateEventPayload {
                    calendar_id: Some(evt.calendar_id.clone()),
                    summary: evt.summary,
                    description: evt.description,
                    start: evt.start,
                    end: evt.end,
                },
            )
            .await?;
            state.cached_events.lock().unwrap().push(created);
            format!("Restored calendar event '{}'", summary)
        }
        "task_patch" => {
            let prev: TaskItem = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let title = prev.title.clone();
            let mut tasks = state.store.get_app_data().tasks;
            let Some(slot) = tasks.iter_mut().find(|t| t.id == prev.id) else {
                return Err("Original task no longer exists".to_string());
            };
            let parent_changed = slot.parent_id != prev.parent_id;
            *slot = prev.clone();
            // Remove the recurring copy spawned by the action being undone (also from Google).
            let mut removed_copy = false;
            if let Some(spawn_id) = undo.get("spawnedTaskId").and_then(|v| v.as_str()) {
                if let Some(pos) = tasks.iter().position(|t| t.id == spawn_id) {
                    let copy = tasks.remove(pos);
                    removed_copy = true;
                    if let (Some(gid), Some(lid)) = (&copy.google_task_id, &copy.google_task_list_id) {
                        let _ = google_api::delete_google_task(&state.store, lid.clone(), gid.clone()).await;
                    }
                }
            }
            state.store.save_tasks(tasks);
            // Put the Google copy of the reverted task back in its previous state too.
            if let (Some(gid), Some(lid)) = (&prev.google_task_id, &prev.google_task_list_id) {
                let due_iso = prev.due_date.as_ref().map(|d| {
                    if d.len() == 10 { format!("{}T00:00:00.000Z", d) } else { d.clone() }
                });
                let _ = google_api::update_google_task(
                    &state.store,
                    lid.clone(),
                    gid.clone(),
                    google_api::UpdateTaskPatch {
                        title: Some(prev.title.clone()),
                        notes: prev.notes.clone(),
                        completed: Some(prev.completed),
                        due: due_iso,
                    },
                )
                .await;
            }
            if parent_changed {
                google_api::sync_task_parent_move(&state.store, &prev.id, prev.parent_id.as_deref()).await;
            }
            if removed_copy {
                format!("Reverted changes to task '{}' and removed its recurring copy", title)
            } else {
                format!("Reverted changes to task '{}'", title)
            }
        }
        "event_patch" => {
            let prev: CalendarEvent = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let summary = prev.summary.clone();
            let updated = google_api::update_calendar_event(
                &state.store,
                UpdateEventPayload {
                    calendar_id: prev.calendar_id.clone(),
                    event_id: prev.id.clone(),
                    summary: Some(prev.summary),
                    start: Some(prev.start),
                    end: Some(prev.end),
                },
            )
            .await?;
            let mut lock = state.cached_events.lock().unwrap();
            if let Some(pos) = lock.iter().position(|e| e.id == updated.id) {
                lock[pos] = updated;
            }
            format!("Reverted event '{}'", summary)
        }
        "project_patch" => {
            let prev: Project = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let pname = prev.name.clone();
            let mut projects = state.store.get_app_data().projects;
            if let Some(slot) = projects.iter_mut().find(|p| p.id == prev.id) {
                *slot = prev;
                state.store.save_projects(projects);
                format!("Reverted project '{}'", pname)
            } else {
                return Err("Original project no longer exists".to_string());
            }
        }
        "delete_created_task" => {
            let tid = data
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing task id".to_string())?;
            let mut tasks = state.store.get_app_data().tasks;
            let Some(pos) = tasks.iter().position(|t| t.id == tid) else {
                return Err("Created task no longer exists".to_string());
            };
            let removed = tasks.remove(pos);
            state.store.save_tasks(tasks);
            if let (Some(gid), Some(lid)) = (&removed.google_task_id, &removed.google_task_list_id) {
                let _ = google_api::delete_google_task(&state.store, lid.clone(), gid.clone()).await;
            }
            format!("Removed created task '{}'", removed.title)
        }
        "delete_created_event" => {
            let eid = data
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing event id".to_string())?;
            let cid = data
                .get("calendarId")
                .and_then(|v| v.as_str())
                .unwrap_or("primary");
            google_api::delete_calendar_event(&state.store, cid.to_string(), eid.to_string())
                .await?;
            state
                .cached_events
                .lock()
                .unwrap()
                .retain(|e| e.id != eid);
            format!("Deleted created calendar event '{}'", eid)
        }
        "templates_snapshot" => {
            let prev: Vec<TaskTemplate> = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let count = prev.len();
            state.store.save_templates(prev);
            format!("Restored {} template(s)", count)
        }
        "delete_created_reminder" => {
            let rid = data
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing reminder id".to_string())?;
            if state.store.delete_reminder(rid) {
                format!("Cancelled reminder '{}'", rid)
            } else {
                return Err("Reminder no longer exists".to_string());
            }
        }
        "tasks_patch_list" => {
            let prev: Vec<TaskItem> = serde_json::from_value(data).map_err(|e| e.to_string())?;
            let count = prev.len();
            state.store.save_tasks(prev);
            format!("Restored task list snapshot ({} tasks)", count)
        }
        "plan_revert" => {
            let evts = data
                .get("events")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mut deleted_evts = 0usize;
            for item in evts {
                if let Some(eid) = item.get("eventId").and_then(|v| v.as_str()) {
                    let cid = item
                        .get("calendarId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("primary");
                    if google_api::delete_calendar_event(&state.store, cid.to_string(), eid.to_string())
                        .await
                        .is_ok()
                    {
                        state.cached_events.lock().unwrap().retain(|e| e.id != eid);
                        deleted_evts += 1;
                    }
                }
            }
            if let Some(prev_val) = data.get("previousTasks") {
                if let Ok(prev_tasks) = serde_json::from_value::<Vec<TaskItem>>(prev_val.clone()) {
                    state.store.save_tasks(prev_tasks);
                }
            }
            format!("Reverted planned blocks (removed {} calendar event(s))", deleted_evts)
        }
        _ => return Err("Unknown undo type".to_string()),
    };

    append_audit_line(&json!({ "undone": id, "time": Utc::now().to_rfc3339() }));
    rebuild_tray_menu(app);
    let _ = app.emit("data:updated", ());
    Ok(message)
}

/// Undoes either a specific audit id or the most recent undoable AI action.
pub async fn undo_last_audit(app: &AppHandle, target_id: Option<i64>) -> Result<Value, String> {
    let all = read_audit_lines();
    let undone: std::collections::HashSet<i64> = all
        .iter()
        .filter_map(|e| e.get("undone").and_then(|v| v.as_i64()))
        .collect();

    let (id, tool_name) = if let Some(tid) = target_id {
        let entry = all
            .iter()
            .find(|e| e.get("id").and_then(|v| v.as_i64()) == Some(tid) && e.get("tool").is_some())
            .ok_or_else(|| format!("Audit entry {} not found", tid))?;
        (
            tid,
            entry
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        )
    } else {
        let entry = all
            .iter()
            .rev()
            .find(|e| {
                e.get("tool").is_some()
                    && e.get("undo").map(|u| !u.is_null()).unwrap_or(false)
                    && e.get("id")
                        .and_then(|v| v.as_i64())
                        .map(|id| !undone.contains(&id))
                        .unwrap_or(false)
            })
            .ok_or_else(|| "No undoable AI actions found in audit log".to_string())?;
        (
            entry.get("id").and_then(|v| v.as_i64()).unwrap_or(0),
            entry
                .get("tool")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        )
    };

    let msg = undo_audit(app, id).await?;
    Ok(json!({
        "ok": true,
        "undoneId": id,
        "tool": tool_name,
        "message": msg,
    }))
}

