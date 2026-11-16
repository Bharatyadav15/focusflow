use crate::google_auth::get_valid_access_token;
use crate::store::LocalStore;
use crate::types::{
    CalendarEvent, GoogleCalendarInfo, GoogleTaskListInfo, PendingSyncOp, TaskItem,
};
use chrono::{Local, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use url::Url;

fn parse_ts_any(s: &str, is_end: bool) -> Option<i64> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp());
    }
    if s.len() >= 10 {
        if let Ok(nd) = NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d") {
            let hms = if is_end {
                nd.and_hms_opt(23, 59, 59)
            } else {
                nd.and_hms_opt(0, 0, 0)
            };
            if let Some(ndt) = hms {
                if let Some(ldt) = Local.from_local_datetime(&ndt).single() {
                    return Some(ldt.timestamp());
                }
            }
        }
    }
    None
}

fn event_overlaps_range(evt: &CalendarEvent, min_ts: Option<i64>, max_ts: Option<i64>) -> bool {
    let Some(est) = parse_ts_any(&evt.start, false) else {
        return true;
    };
    let een = parse_ts_any(&evt.end, evt.is_all_day.unwrap_or(false)).unwrap_or(est);
    if let Some(min) = min_ts {
        if een < min {
            return false;
        }
    }
    if let Some(max) = max_ts {
        if est > max {
            return false;
        }
    }
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarListResponse {
    next_page_token: Option<String>,
    items: Option<Vec<CalendarListEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarListEntry {
    id: String,
    summary: Option<String>,
    background_color: Option<String>,
    primary: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct EventsResponse {
    items: Option<Vec<GoogleEventItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEventItem {
    id: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    html_link: Option<String>,
    start: Option<GoogleEventTime>,
    end: Option<GoogleEventTime>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleEventTime {
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskListsResponse {
    next_page_token: Option<String>,
    items: Option<Vec<TaskListEntry>>,
}

#[derive(Debug, Deserialize)]
struct TaskListEntry {
    id: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksResponse {
    next_page_token: Option<String>,
    items: Option<Vec<GoogleTaskEntry>>,
}

#[derive(Debug, Deserialize)]
struct GoogleTaskEntry {
    id: String,
    title: Option<String>,
    notes: Option<String>,
    status: Option<String>,
    due: Option<String>,
    updated: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTasksResult {
    pub tasks: Vec<TaskItem>,
    pub task_lists: Vec<GoogleTaskListInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEventPayload {
    pub calendar_id: Option<String>,
    pub summary: String,
    pub description: Option<String>,
    pub start: String,
    pub end: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEventPayload {
    pub calendar_id: String,
    pub event_id: String,
    pub summary: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub completed: Option<bool>,
    pub due: Option<String>,
}

pub async fn fetch_calendar_lists(store: &LocalStore) -> Result<Vec<GoogleCalendarInfo>, String> {
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => return Ok(store.get_app_data().calendars),
    };

    let client = reqwest::Client::new();
    let mut calendars = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut url =
            Url::parse("https://www.googleapis.com/calendar/v3/users/me/calendarList").unwrap();
        if let Some(ref pt) = page_token {
            url.query_pairs_mut().append_pair("pageToken", pt);
        }

        let resp = client
            .get(url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Google CalendarList error: {}", resp.status()));
        }

        let body: CalendarListResponse = resp.json().await.map_err(|e| e.to_string())?;
        for item in body.items.unwrap_or_default() {
            calendars.push(GoogleCalendarInfo {
                id: item.id,
                summary: item.summary.unwrap_or_else(|| "Calendar".to_string()),
                background_color: item.background_color,
                primary: item.primary,
            });
        }

        if body.next_page_token.is_some() {
            page_token = body.next_page_token;
        } else {
            break;
        }
    }

    store.save_calendars(calendars.clone());
    Ok(calendars)
}

pub async fn fetch_calendar_events(
    store: &LocalStore,
    time_min: String,
    time_max: String,
) -> Result<Vec<CalendarEvent>, String> {
    let min_ts = parse_ts_any(&time_min, false);
    let max_ts = parse_ts_any(&time_max, true);

    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            let mut local: Vec<CalendarEvent> = store
                .get_local_events()
                .into_iter()
                .filter(|e| event_overlaps_range(e, min_ts, max_ts))
                .collect();
            local.sort_by(|a, b| a.start.cmp(&b.start));
            return Ok(local);
        }
    };

    let mut calendars = store.get_app_data().calendars;
    if calendars.is_empty() {
        calendars = fetch_calendar_lists(store).await.unwrap_or_default();
    }
    if calendars.is_empty() {
        calendars.push(GoogleCalendarInfo {
            id: "primary".to_string(),
            summary: "Primary".to_string(),
            background_color: Some("#6366f1".to_string()),
            primary: Some(true),
        });
    }

    let selected_ids = store.get_settings().selected_calendar_ids;
    let active_calendars: Vec<GoogleCalendarInfo> = if selected_ids.is_empty() {
        calendars
    } else {
        calendars
            .into_iter()
            .filter(|c| selected_ids.contains(&c.id))
            .collect()
    };

    let client = reqwest::Client::new();
    let mut all_events = Vec::new();
    let app_data = store.get_app_data();

    for cal in active_calendars {
        let encoded_id = urlencoding::encode(&cal.id);
        let mut url = Url::parse(&format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events",
            encoded_id
        ))
        .unwrap();
        url.query_pairs_mut()
            .append_pair("timeMin", &time_min)
            .append_pair("timeMax", &time_max)
            .append_pair("singleEvents", "true")
            .append_pair("orderBy", "startTime")
            .append_pair("maxResults", "250");

        if let Ok(resp) = client.get(url).bearer_auth(&token).send().await {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<EventsResponse>().await {
                    for item in body.items.unwrap_or_default() {
                        let start_val = item
                            .start
                            .as_ref()
                            .and_then(|s| s.date_time.clone().or_else(|| s.date.clone()));
                        let end_val = item
                            .end
                            .as_ref()
                            .and_then(|s| s.date_time.clone().or_else(|| s.date.clone()));
                        let is_all_day = item
                            .start
                            .as_ref()
                            .map(|s| s.date.is_some() && s.date_time.is_none())
                            .unwrap_or(false);

                        if let (Some(id), Some(start), Some(end)) = (item.id, start_val, end_val) {
                            let meta = app_data.event_metadata.get(&id);
                            all_events.push(CalendarEvent {
                                id,
                                calendar_id: cal.id.clone(),
                                calendar_name: Some(cal.summary.clone()),
                                calendar_color: cal.background_color.clone(),
                                summary: item.summary.unwrap_or_else(|| "(No title)".to_string()),
                                description: item.description,
                                start,
                                end,
                                is_all_day: Some(is_all_day),
                                html_link: item.html_link,
                                linked_task_id: None,
                                priority: meta.and_then(|m| m.priority),
                                project_id: meta.and_then(|m| m.project_id.clone()),
                            });
                        }
                    }
                }
            }
        }
    }

    // Merge any non-demo offline-created local events that fall inside the range.
    let seen_ids: std::collections::HashSet<String> =
        all_events.iter().map(|e| e.id.clone()).collect();
    for local_evt in store.get_local_events() {
        if !local_evt.id.starts_with("demo-evt-")
            && !seen_ids.contains(&local_evt.id)
            && event_overlaps_range(&local_evt, min_ts, max_ts)
        {
            all_events.push(local_evt);
        }
    }

    all_events.sort_by(|a, b| a.start.cmp(&b.start));
    Ok(all_events)
}

pub fn default_write_cal(store: &LocalStore) -> String {
    let cal = store.get_settings().default_write_calendar_id;
    let trimmed = cal.trim();
    if trimmed.is_empty() {
        "primary".to_string()
    } else {
        trimmed.to_string()
    }
}

pub async fn create_calendar_event(
    store: &LocalStore,
    payload: CreateEventPayload,
) -> Result<CalendarEvent, String> {
    let cal_id = payload
        .calendar_id
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| default_write_cal(store));
    let has_google = store.get_tokens().is_some();
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            let local_evt = CalendarEvent {
                id: format!("evt-{}", Utc::now().timestamp_millis()),
                calendar_id: cal_id.clone(),
                calendar_name: Some("Local Calendar".to_string()),
                calendar_color: Some("#6366f1".to_string()),
                summary: payload.summary,
                description: payload.description,
                start: payload.start,
                end: payload.end,
                is_all_day: Some(false),
                html_link: None,
                linked_task_id: None,
                priority: None,
                project_id: None,
            };
            store.add_local_event(local_evt.clone());
            if has_google {
                store.enqueue_sync_op(PendingSyncOp::CreateEvent {
                    local_event_id: local_evt.id.clone(),
                    calendar_id: cal_id,
                    linked_task_id: None,
                });
            }
            return Ok(local_evt);
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        urlencoding::encode(&cal_id)
    );
    let resp = match client
        .post(&url)
        .bearer_auth(&token)
        .json(&json!({
            "summary": payload.summary,
            "description": payload.description,
            "start": { "dateTime": payload.start },
            "end": { "dateTime": payload.end }
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_e) => {
            let local_evt = CalendarEvent {
                id: format!("evt-{}", Utc::now().timestamp_millis()),
                calendar_id: cal_id.clone(),
                calendar_name: Some("Pending Sync".to_string()),
                calendar_color: Some("#6366f1".to_string()),
                summary: payload.summary,
                description: payload.description,
                start: payload.start,
                end: payload.end,
                is_all_day: Some(false),
                html_link: None,
                linked_task_id: None,
                priority: None,
                project_id: None,
            };
            store.add_local_event(local_evt.clone());
            store.enqueue_sync_op(PendingSyncOp::CreateEvent {
                local_event_id: local_evt.id.clone(),
                calendar_id: cal_id,
                linked_task_id: None,
            });
            return Ok(local_evt);
        }
    };

    if !resp.status().is_success() {
        return Err(format!("Failed to create calendar event: {}", resp.status()));
    }

    let created: GoogleEventItem = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CalendarEvent {
        id: created
            .id
            .unwrap_or_else(|| format!("evt-{}", Utc::now().timestamp_millis())),
        calendar_id: cal_id,
        calendar_name: None,
        calendar_color: None,
        summary: created.summary.unwrap_or(payload.summary),
        description: created.description,
        start: created
            .start
            .and_then(|s| s.date_time)
            .unwrap_or(payload.start),
        end: created.end.and_then(|s| s.date_time).unwrap_or(payload.end),
        is_all_day: Some(false),
        html_link: created.html_link,
        linked_task_id: None,
        priority: None,
        project_id: None,
    })
}

pub async fn update_calendar_event(
    store: &LocalStore,
    payload: UpdateEventPayload,
) -> Result<CalendarEvent, String> {
    if payload.event_id.starts_with("evt-") || payload.event_id.starts_with("demo-evt-") {
        if let Some(updated) = store.update_local_event(
            &payload.event_id,
            payload.summary.clone(),
            payload.start.clone(),
            payload.end.clone(),
        ) {
            return Ok(updated);
        }
        return Err(format!("Local event '{}' not found", payload.event_id));
    }

    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            if let Some(updated) = store.update_local_event(
                &payload.event_id,
                payload.summary.clone(),
                payload.start.clone(),
                payload.end.clone(),
            ) {
                return Ok(updated);
            }
            if store.get_tokens().is_some() {
                store.enqueue_sync_op(PendingSyncOp::UpdateEvent {
                    calendar_id: payload.calendar_id.clone(),
                    event_id: payload.event_id.clone(),
                    summary: payload.summary.clone(),
                    start: payload.start.clone(),
                    end: payload.end.clone(),
                });
            }
            return Ok(CalendarEvent {
                id: payload.event_id,
                calendar_id: payload.calendar_id,
                calendar_name: Some("Local Calendar".to_string()),
                calendar_color: Some("#6366f1".to_string()),
                summary: payload.summary.unwrap_or_default(),
                description: None,
                start: payload.start.unwrap_or_default(),
                end: payload.end.unwrap_or_default(),
                is_all_day: Some(false),
                html_link: None,
                linked_task_id: None,
                priority: None,
                project_id: None,
            });
        }
    };

    let mut body = serde_json::Map::new();
    if let Some(ref s) = payload.summary {
        body.insert("summary".to_string(), json!(s));
    }
    if let Some(ref st) = payload.start {
        body.insert("start".to_string(), json!({ "dateTime": st }));
    }
    if let Some(ref en) = payload.end {
        body.insert("end".to_string(), json!({ "dateTime": en }));
    }

    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
        urlencoding::encode(&payload.calendar_id),
        urlencoding::encode(&payload.event_id)
    );
    let resp = client
        .patch(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed to update calendar event: {}", resp.status()));
    }

    let updated: GoogleEventItem = resp.json().await.map_err(|e| e.to_string())?;
    Ok(CalendarEvent {
        id: updated.id.unwrap_or(payload.event_id),
        calendar_id: payload.calendar_id,
        calendar_name: None,
        calendar_color: None,
        summary: updated
            .summary
            .or(payload.summary)
            .unwrap_or_default(),
        description: updated.description,
        start: updated
            .start
            .and_then(|s| s.date_time.or(s.date))
            .or(payload.start)
            .unwrap_or_default(),
        end: updated
            .end
            .and_then(|s| s.date_time.or(s.date))
            .or(payload.end)
            .unwrap_or_default(),
        is_all_day: Some(false),
        html_link: updated.html_link,
        linked_task_id: None,
        priority: None,
        project_id: None,
    })
}

pub async fn delete_calendar_event(
    store: &LocalStore,
    calendar_id: String,
    event_id: String,
) -> Result<(), String> {
    store.delete_local_event(&event_id);
    if event_id.starts_with("evt-") || event_id.starts_with("demo-evt-") {
        return Ok(());
    }
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            if store.get_tokens().is_some() {
                store.enqueue_sync_op(PendingSyncOp::DeleteEvent {
                    calendar_id,
                    event_id,
                });
            }
            return Ok(());
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
        urlencoding::encode(&calendar_id),
        urlencoding::encode(&event_id)
    );
    let resp = match client
        .delete(&url)
        .bearer_auth(&token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            store.enqueue_sync_op(PendingSyncOp::DeleteEvent {
                calendar_id,
                event_id,
            });
            return Ok(());
        }
    };
    let code = resp.status().as_u16();
    if !resp.status().is_success() && code != 404 && code != 410 {
        return Err(format!("Failed to delete calendar event: {}", resp.status()));
    }
    Ok(())
}

pub async fn sync_google_tasks(store: &LocalStore) -> Result<SyncTasksResult, String> {
    let _ = flush_sync_queue(store).await;
    let app_data = store.get_app_data();
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            return Ok(SyncTasksResult {
                tasks: app_data.tasks,
                task_lists: app_data.task_lists,
            })
        }
    };

    let client = reqwest::Client::new();
    let mut task_lists = Vec::new();
    let mut list_page_token: Option<String> = None;

    loop {
        let mut url =
            Url::parse("https://tasks.googleapis.com/tasks/v1/users/@me/lists").unwrap();
        if let Some(ref pt) = list_page_token {
            url.query_pairs_mut().append_pair("pageToken", pt);
        }

        let resp = client
            .get(url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Google Tasks lists error: {}", resp.status()));
        }

        let body: TaskListsResponse = resp.json().await.map_err(|e| e.to_string())?;
        for l in body.items.unwrap_or_default() {
            task_lists.push(GoogleTaskListInfo {
                id: l.id,
                title: l.title.unwrap_or_else(|| "Tasks".to_string()),
            });
        }
        if body.next_page_token.is_some() {
            list_page_token = body.next_page_token;
        } else {
            break;
        }
    }

    store.save_task_lists(task_lists.clone());

    let mut remote_tasks = Vec::new();
    for list in &task_lists {
        let mut task_page_token: Option<String> = None;
        let mut list_ok = true;
        let mut list_items = Vec::new();
        loop {
            let mut url = Url::parse(&format!(
                "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks",
                urlencoding::encode(&list.id)
            ))
            .unwrap();
            url.query_pairs_mut()
                .append_pair("showCompleted", "true")
                .append_pair("showHidden", "false");
            if let Some(ref pt) = task_page_token {
                url.query_pairs_mut().append_pair("pageToken", pt);
            }

            let resp = match client.get(url).bearer_auth(&token).send().await {
                Ok(r) if r.status().is_success() => r,
                _ => {
                    list_ok = false;
                    break;
                }
            };

            let body: TasksResponse = match resp.json().await {
                Ok(b) => b,
                Err(_) => {
                    list_ok = false;
                    break;
                }
            };

            for gt in body.items.unwrap_or_default() {
                let title = match gt.title {
                    Some(ref t) if !t.trim().is_empty() => t.clone(),
                    _ => continue,
                };
                let local_match = app_data
                    .tasks
                    .iter()
                    .find(|t| t.google_task_id.as_deref() == Some(&gt.id));
                let task_id = local_match
                    .map(|t| t.id.clone())
                    .unwrap_or_else(|| format!("gt-{}", gt.id));

                list_items.push(TaskItem {
                    id: task_id.clone(),
                    title,
                    notes: gt.notes,
                    project_id: local_match.and_then(|t| t.project_id.clone()),
                    priority: local_match.map(|t| t.priority).unwrap_or(3),
                    completed: gt.status.as_deref() == Some("completed"),
                    due_date: gt.due,
                    estimated_pomodoros: local_match.map(|t| t.estimated_pomodoros).unwrap_or(1),
                    completed_pomodoros: local_match.map(|t| t.completed_pomodoros).unwrap_or(0),
                    google_task_id: Some(gt.id),
                    google_task_list_id: Some(list.id.clone()),
                    google_task_list_title: Some(list.title.clone()),
                    calendar_event_id: local_match.and_then(|t| t.calendar_event_id.clone()),
                    linked_event_id: app_data
                        .task_event_links
                        .get(&task_id)
                        .cloned()
                        .or_else(|| local_match.and_then(|t| t.linked_event_id.clone())),
                    scheduled_start: local_match.and_then(|t| t.scheduled_start.clone()),
                    scheduled_end: local_match.and_then(|t| t.scheduled_end.clone()),
                    duration_minutes: local_match.and_then(|t| t.duration_minutes),
                    subtasks: local_match.map(|t| t.subtasks.clone()).unwrap_or_default(),
                    recurrence: local_match.and_then(|t| t.recurrence.clone()),
                    blocked_by_task_ids: local_match
                        .map(|t| t.blocked_by_task_ids.clone())
                        .unwrap_or_default(),
                    note_link: local_match.and_then(|t| t.note_link.clone()),
                    created_at: local_match
                        .map(|t| t.created_at.clone())
                        .or(gt.updated)
                        .unwrap_or_else(|| Utc::now().to_rfc3339()),
                });
            }

            if body.next_page_token.is_some() {
                task_page_token = body.next_page_token;
            } else {
                break;
            }
        }
        if list_ok {
            remote_tasks.extend(list_items);
        } else {
            // Preserve previously cached tasks from this list if fetching it temporarily failed.
            for existing in &app_data.tasks {
                if existing.google_task_list_id.as_deref() == Some(list.id.as_str()) {
                    remote_tasks.push(existing.clone());
                }
            }
        }
    }

    // Preserve purely local tasks (created offline or on fallback) so sync never wipes them.
    for existing in app_data.tasks {
        if existing.google_task_id.is_none() {
            remote_tasks.push(existing);
        }
    }

    store.save_tasks(remote_tasks.clone());
    Ok(SyncTasksResult {
        tasks: remote_tasks,
        task_lists,
    })
}

pub async fn create_google_task(
    store: &LocalStore,
    title: String,
    notes: Option<String>,
    task_list_id: Option<String>,
) -> Result<TaskItem, String> {
    let target_list = task_list_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let def = store.get_settings().default_task_list_id;
            if def.is_empty() {
                "@default".to_string()
            } else {
                def
            }
        });

    let has_google = store.get_tokens().is_some();
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            let local = TaskItem {
                id: format!("task-{}", Utc::now().timestamp_millis()),
                title,
                notes,
                project_id: None,
                priority: 3,
                completed: false,
                due_date: None,
                estimated_pomodoros: 1,
                completed_pomodoros: 0,
                google_task_id: None,
                google_task_list_id: None,
                google_task_list_title: None,
                calendar_event_id: None,
                linked_event_id: None,
                scheduled_start: None,
                scheduled_end: None,
                duration_minutes: None,
                subtasks: Vec::new(),
                recurrence: None,
                blocked_by_task_ids: Vec::new(),
                note_link: None,
                created_at: Utc::now().to_rfc3339(),
            };
            let mut tasks = store.get_app_data().tasks;
            tasks.insert(0, local.clone());
            store.save_tasks(tasks);
            if has_google {
                store.enqueue_sync_op(PendingSyncOp::CreateTask {
                    local_task_id: local.id.clone(),
                    task_list_id: target_list,
                });
            }
            return Ok(local);
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks",
        urlencoding::encode(&target_list)
    );
    let resp = match client
        .post(&url)
        .bearer_auth(&token)
        .json(&json!({ "title": title, "notes": notes }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            let local = TaskItem {
                id: format!("task-{}", Utc::now().timestamp_millis()),
                title,
                notes,
                project_id: None,
                priority: 3,
                completed: false,
                due_date: None,
                estimated_pomodoros: 1,
                completed_pomodoros: 0,
                google_task_id: None,
                google_task_list_id: None,
                google_task_list_title: None,
                calendar_event_id: None,
                linked_event_id: None,
                scheduled_start: None,
                scheduled_end: None,
                duration_minutes: None,
                subtasks: Vec::new(),
                recurrence: None,
                blocked_by_task_ids: Vec::new(),
                note_link: None,
                created_at: Utc::now().to_rfc3339(),
            };
            let mut tasks = store.get_app_data().tasks;
            tasks.insert(0, local.clone());
            store.save_tasks(tasks);
            store.enqueue_sync_op(PendingSyncOp::CreateTask {
                local_task_id: local.id.clone(),
                task_list_id: target_list,
            });
            return Ok(local);
        }
    };

    if !resp.status().is_success() {
        return Err(format!("Failed to create Google Task: {}", resp.status()));
    }

    let created: GoogleTaskEntry = resp.json().await.map_err(|e| e.to_string())?;
    let app_data = store.get_app_data();
    let list_info = app_data.task_lists.iter().find(|l| l.id == target_list);

    let item = TaskItem {
        id: format!("gt-{}", created.id),
        title: created.title.unwrap_or(title),
        notes: created.notes.or(notes),
        project_id: None,
        priority: 3,
        completed: false,
        due_date: created.due,
        estimated_pomodoros: 1,
        completed_pomodoros: 0,
        google_task_id: Some(created.id),
        google_task_list_id: Some(target_list.clone()),
        google_task_list_title: list_info.map(|l| l.title.clone()),
        calendar_event_id: None,
        linked_event_id: None,
        scheduled_start: None,
        scheduled_end: None,
        duration_minutes: None,
        subtasks: Vec::new(),
        recurrence: None,
        blocked_by_task_ids: Vec::new(),
        note_link: None,
        created_at: Utc::now().to_rfc3339(),
    };

    let mut tasks = app_data.tasks;
    tasks.insert(0, item.clone());
    store.save_tasks(tasks);
    Ok(item)
}

pub async fn update_google_task(
    store: &LocalStore,
    task_list_id: String,
    task_id: String,
    patch: UpdateTaskPatch,
) -> Result<(), String> {
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            if store.get_tokens().is_some() {
                if let Some(c) = patch.completed {
                    if patch.title.is_none() && patch.notes.is_none() && patch.due.is_none() {
                        store.enqueue_sync_op(PendingSyncOp::ToggleTask {
                            task_list_id,
                            google_task_id: task_id,
                            completed: c,
                        });
                        return Ok(());
                    }
                }
                store.enqueue_sync_op(PendingSyncOp::UpdateTask {
                    task_list_id,
                    google_task_id: task_id,
                    title: patch.title,
                    notes: patch.notes,
                    due: patch.due,
                });
            }
            return Ok(());
        }
    };

    let mut body = serde_json::Map::new();
    if let Some(ref t) = patch.title {
        body.insert("title".to_string(), json!(t));
    }
    if let Some(ref n) = patch.notes {
        body.insert("notes".to_string(), json!(n));
    }
    if let Some(c) = patch.completed {
        body.insert(
            "status".to_string(),
            json!(if c { "completed" } else { "needsAction" }),
        );
    }
    if let Some(ref d) = patch.due {
        body.insert("due".to_string(), json!(d));
    }

    let client = reqwest::Client::new();
    let url = format!(
        "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks/{}",
        urlencoding::encode(&task_list_id),
        urlencoding::encode(&task_id)
    );
    let resp = match client
        .patch(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => {
            store.enqueue_sync_op(PendingSyncOp::UpdateTask {
                task_list_id,
                google_task_id: task_id,
                title: patch.title,
                notes: patch.notes,
                due: patch.due,
            });
            return Ok(());
        }
    };
    let code = resp.status().as_u16();
    if !resp.status().is_success() && code != 404 && code != 410 {
        return Err(format!("Failed to update Google Task: {}", resp.status()));
    }
    Ok(())
}

pub async fn delete_google_task(
    store: &LocalStore,
    task_list_id: String,
    task_id: String,
) -> Result<(), String> {
    let token = match get_valid_access_token(store).await {
        Some(t) => t,
        None => {
            if store.get_tokens().is_some() {
                store.enqueue_sync_op(PendingSyncOp::DeleteTask {
                    task_list_id,
                    google_task_id: task_id,
                });
            }
            return Ok(());
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks/{}",
        urlencoding::encode(&task_list_id),
        urlencoding::encode(&task_id)
    );
    let resp = match client.delete(&url).bearer_auth(&token).send().await {
        Ok(r) => r,
        Err(_) => {
            store.enqueue_sync_op(PendingSyncOp::DeleteTask {
                task_list_id,
                google_task_id: task_id,
            });
            return Ok(());
        }
    };
    let code = resp.status().as_u16();
    if !resp.status().is_success() && code != 404 && code != 410 {
        return Err(format!("Failed to delete Google Task: {}", resp.status()));
    }
    Ok(())
}

pub async fn toggle_google_task(
    store: &LocalStore,
    task_list_id: String,
    task_id: String,
    completed: bool,
) -> Result<(), String> {
    update_google_task(
        store,
        task_list_id,
        task_id,
        UpdateTaskPatch {
            title: None,
            notes: None,
            completed: Some(completed),
            due: None,
        },
    )
    .await
}

/// Replays any queued offline mutations against Google Calendar & Google Tasks.
/// Returns (applied_count, remaining_count).
pub async fn flush_sync_queue(store: &LocalStore) -> Result<(usize, usize), String> {
    let ops = store.get_sync_ops();
    if ops.is_empty() {
        return Ok((0, 0));
    }
    let Some(token) = get_valid_access_token(store).await else {
        return Ok((0, ops.len()));
    };

    let client = reqwest::Client::new();
    let mut remaining = Vec::new();
    let mut applied = 0usize;

    for (idx, op) in ops.iter().enumerate() {
        let mut transport_err = false;
        let ok = match op {
            PendingSyncOp::CreateTask {
                local_task_id,
                task_list_id,
            } => {
                let maybe_task = store
                    .get_app_data()
                    .tasks
                    .into_iter()
                    .find(|t| &t.id == local_task_id);
                if let Some(task) = maybe_task {
                    let url = format!(
                        "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks",
                        urlencoding::encode(task_list_id)
                    );
                    let mut body = serde_json::Map::new();
                    body.insert("title".to_string(), json!(task.title));
                    if let Some(ref n) = task.notes {
                        body.insert("notes".to_string(), json!(n));
                    }
                    if let Some(ref d) = task.due_date {
                        let due_rfc = if d.len() == 10 {
                            format!("{}T00:00:00.000Z", d)
                        } else {
                            d.clone()
                        };
                        body.insert("due".to_string(), json!(due_rfc));
                    }
                    if task.completed {
                        body.insert("status".to_string(), json!("completed"));
                    }
                    match client.post(&url).bearer_auth(&token).json(&body).send().await {
                        Ok(r) if r.status().is_success() => {
                            if let Ok(created) = r.json::<GoogleTaskEntry>().await {
                                let mut tasks = store.get_app_data().tasks;
                                for t in &mut tasks {
                                    if &t.id == local_task_id {
                                        t.google_task_id = Some(created.id.clone());
                                        t.google_task_list_id = Some(task_list_id.clone());
                                        break;
                                    }
                                }
                                store.save_tasks(tasks);
                            }
                            true
                        }
                        Ok(_) => false,
                        Err(_) => {
                            transport_err = true;
                            false
                        }
                    }
                } else {
                    true
                }
            }
            PendingSyncOp::ToggleTask {
                task_list_id,
                google_task_id,
                completed,
            } => {
                let url = format!(
                    "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks/{}",
                    urlencoding::encode(task_list_id),
                    urlencoding::encode(google_task_id)
                );
                let body = json!({
                    "status": if *completed { "completed" } else { "needsAction" }
                });
                match client.patch(&url).bearer_auth(&token).json(&body).send().await {
                    Ok(r) => r.status().is_success() || matches!(r.status().as_u16(), 404 | 410),
                    Err(_) => {
                        transport_err = true;
                        false
                    }
                }
            }
            PendingSyncOp::UpdateTask {
                task_list_id,
                google_task_id,
                title,
                notes,
                due,
            } => {
                let url = format!(
                    "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks/{}",
                    urlencoding::encode(task_list_id),
                    urlencoding::encode(google_task_id)
                );
                let mut body = serde_json::Map::new();
                if let Some(t) = title {
                    body.insert("title".to_string(), json!(t));
                }
                if let Some(n) = notes {
                    body.insert("notes".to_string(), json!(n));
                }
                if let Some(d) = due {
                    body.insert("due".to_string(), json!(d));
                }
                match client.patch(&url).bearer_auth(&token).json(&body).send().await {
                    Ok(r) => r.status().is_success() || matches!(r.status().as_u16(), 404 | 410),
                    Err(_) => {
                        transport_err = true;
                        false
                    }
                }
            }
            PendingSyncOp::DeleteTask {
                task_list_id,
                google_task_id,
            } => {
                let url = format!(
                    "https://tasks.googleapis.com/tasks/v1/lists/{}/tasks/{}",
                    urlencoding::encode(task_list_id),
                    urlencoding::encode(google_task_id)
                );
                match client.delete(&url).bearer_auth(&token).send().await {
                    Ok(r) => r.status().is_success() || matches!(r.status().as_u16(), 404 | 410),
                    Err(_) => {
                        transport_err = true;
                        false
                    }
                }
            }
            PendingSyncOp::CreateEvent {
                local_event_id,
                calendar_id,
                linked_task_id,
            } => {
                let maybe_evt = store
                    .get_local_events()
                    .into_iter()
                    .find(|e| &e.id == local_event_id);
                if let Some(evt) = maybe_evt {
                    let url = format!(
                        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
                        urlencoding::encode(calendar_id)
                    );
                    match client
                        .post(&url)
                        .bearer_auth(&token)
                        .json(&json!({
                            "summary": evt.summary,
                            "description": evt.description,
                            "start": { "dateTime": evt.start },
                            "end": { "dateTime": evt.end }
                        }))
                        .send()
                        .await
                    {
                        Ok(r) if r.status().is_success() => {
                            if let Ok(created) = r.json::<GoogleEventItem>().await {
                                if let Some(remote_id) = created.id {
                                    store.delete_local_event(local_event_id);
                                    if let Some(tid) = linked_task_id {
                                        store.set_task_event_link(tid.clone(), Some(remote_id));
                                    }
                                }
                            }
                            true
                        }
                        Ok(_) => false,
                        Err(_) => {
                            transport_err = true;
                            false
                        }
                    }
                } else {
                    true
                }
            }
            PendingSyncOp::UpdateEvent {
                calendar_id,
                event_id,
                summary,
                start,
                end,
            } => {
                let url = format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
                    urlencoding::encode(calendar_id),
                    urlencoding::encode(event_id)
                );
                let mut body = serde_json::Map::new();
                if let Some(s) = summary {
                    body.insert("summary".to_string(), json!(s));
                }
                if let Some(st) = start {
                    body.insert("start".to_string(), json!({ "dateTime": st }));
                }
                if let Some(en) = end {
                    body.insert("end".to_string(), json!({ "dateTime": en }));
                }
                match client.patch(&url).bearer_auth(&token).json(&body).send().await {
                    Ok(r) => r.status().is_success() || matches!(r.status().as_u16(), 404 | 410),
                    Err(_) => {
                        transport_err = true;
                        false
                    }
                }
            }
            PendingSyncOp::DeleteEvent {
                calendar_id,
                event_id,
            } => {
                let url = format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
                    urlencoding::encode(calendar_id),
                    urlencoding::encode(event_id)
                );
                match client.delete(&url).bearer_auth(&token).send().await {
                    Ok(r) => r.status().is_success() || matches!(r.status().as_u16(), 404 | 410),
                    Err(_) => {
                        transport_err = true;
                        false
                    }
                }
            }
        };

        if ok {
            applied += 1;
        } else {
            remaining.push(op.clone());
            if transport_err {
                remaining.extend_from_slice(&ops[idx + 1..]);
                break;
            }
        }
    }

    let rem_len = remaining.len();
    store.set_sync_ops(remaining);
    Ok((applied, rem_len))
}
