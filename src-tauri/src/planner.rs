use crate::google_api::{self, CreateEventPayload, UpdateEventPayload, UpdateTaskPatch};
use crate::store::LocalStore;
use crate::types::{AppData, CalendarEvent, TaskItem};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Timelike};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeSlot {
    pub start: String,
    pub end: String,
    pub duration_minutes: u32,
}

pub fn parse_date_key(date_str: Option<&str>) -> NaiveDate {
    let today = Local::now().date_naive();
    let Some(raw) = date_str.map(str::trim).filter(|s| !s.is_empty()) else {
        return today;
    };
    let lower = raw.to_lowercase();
    if lower == "today" {
        return today;
    }
    if lower == "tomorrow" {
        return today + Duration::days(1);
    }
    if lower.starts_with('+') && lower.ends_with('d') {
        if let Ok(days) = lower[1..lower.len() - 1].parse::<i64>() {
            return today + Duration::days(days);
        }
    }
    if let Some(ymd) = raw.get(..10) {
        if let Ok(nd) = NaiveDate::parse_from_str(ymd, "%Y-%m-%d") {
            return nd;
        }
    }
    today
}

fn local_dt_at(date: NaiveDate, hour: u32, min: u32, sec: u32) -> Option<DateTime<Local>> {
    let h = hour.min(23);
    let m = min.min(59);
    let s = sec.min(59);
    let t = NaiveTime::from_hms_opt(h, m, s)?;
    let ndt = date.and_time(t);
    Local.from_local_datetime(&ndt).single().or_else(|| Local.from_local_datetime(&ndt).earliest())
}

pub fn day_bounds_iso(date: NaiveDate) -> (String, String) {
    let start = local_dt_at(date, 0, 0, 0)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();
    let end = local_dt_at(date, 23, 59, 59)
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();
    (start, end)
}

fn compute_free_intervals(
    events: &[CalendarEvent],
    date: NaiveDate,
    start_hour: u32,
    end_hour: u32,
    min_minutes: u32,
) -> Vec<(i64, i64)> {
    let today = Local::now().date_naive();
    let Some(mut win_start) = local_dt_at(date, start_hour.min(22), 0, 0) else {
        return Vec::new();
    };
    let win_end = if end_hour >= 24 {
        local_dt_at(date, 23, 59, 59)
    } else {
        local_dt_at(date, end_hour, 0, 0)
    };
    let Some(win_end) = win_end else {
        return Vec::new();
    };

    if date == today {
        let now = Local::now();
        let mins = now.format("%M").to_string().parse::<i64>().unwrap_or(0);
        let rem = (15 - (mins % 15)) % 15;
        let rounded = now + Duration::minutes(rem) - Duration::seconds(now.timestamp() % 60);
        if rounded > win_start {
            win_start = rounded;
        }
    }

    let win_start_ms = win_start.timestamp_millis();
    let win_end_ms = win_end.timestamp_millis();
    if win_start_ms >= win_end_ms {
        return Vec::new();
    }

    let mut busy: Vec<(i64, i64)> = events
        .iter()
        .filter(|e| !e.is_all_day.unwrap_or(false))
        .filter_map(|e| {
            let s = DateTime::parse_from_rfc3339(&e.start).ok()?.timestamp_millis();
            let en = DateTime::parse_from_rfc3339(&e.end).ok()?.timestamp_millis();
            if en <= win_start_ms || s >= win_end_ms || en <= s {
                None
            } else {
                Some((s.max(win_start_ms), en.min(win_end_ms)))
            }
        })
        .collect();

    busy.sort_by_key(|(s, _)| *s);

    // Merge overlapping busy blocks
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (s, e) in busy {
        if let Some(last) = merged.last_mut() {
            if s <= last.1 {
                last.1 = last.1.max(e);
                continue;
            }
        }
        merged.push((s, e));
    }

    let min_ms = (min_minutes.max(5) as i64) * 60_000;
    let mut free = Vec::new();
    let mut cursor = win_start_ms;
    for (bs, be) in merged {
        if bs > cursor && (bs - cursor) >= min_ms {
            free.push((cursor, bs));
        }
        if be > cursor {
            cursor = be;
        }
    }
    if win_end_ms > cursor && (win_end_ms - cursor) >= min_ms {
        free.push((cursor, win_end_ms));
    }
    free
}

pub async fn find_free_slots_for_day(
    store: &LocalStore,
    date: NaiveDate,
    start_hour: u32,
    end_hour: u32,
    min_minutes: u32,
) -> Vec<FreeSlot> {
    let (start_iso, end_iso) = day_bounds_iso(date);
    let events = google_api::fetch_calendar_events(store, start_iso, end_iso)
        .await
        .unwrap_or_default();

    compute_free_intervals(&events, date, start_hour, end_hour, min_minutes)
        .into_iter()
        .filter_map(|(s_ms, e_ms)| {
            let s = Local.timestamp_millis_opt(s_ms).single()?;
            let e = Local.timestamp_millis_opt(e_ms).single()?;
            Some(FreeSlot {
                start: s.to_rfc3339(),
                end: e.to_rfc3339(),
                duration_minutes: ((e_ms - s_ms) / 60_000) as u32,
            })
        })
        .collect()
}

pub async fn plan_day_tasks(store: &LocalStore, date: NaiveDate) -> Result<Value, String> {
    plan_tasks_with_options(store, date, None, None, false).await
}

pub async fn plan_tasks_with_options(
    store: &LocalStore,
    date: NaiveDate,
    target_task_id: Option<&str>,
    target_title_match: Option<&str>,
    dry_run: bool,
) -> Result<Value, String> {
    let app_data = store.get_app_data();
    let settings = app_data.settings.clone();
    let focus_mins = settings.focus_minutes.max(1);
    let date_ymd = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());

    let (start_iso, end_iso) = day_bounds_iso(date);
    let day_events = google_api::fetch_calendar_events(store, start_iso, end_iso)
        .await
        .unwrap_or_default();

    let single_targeted = target_task_id.is_some() || target_title_match.is_some();
    let mut intervals = compute_free_intervals(
        &day_events,
        date,
        settings.work_start_hour,
        settings.work_end_hour,
        15,
    );
    if intervals.is_empty() && single_targeted {
        intervals = compute_free_intervals(&day_events, date, 0, 24, 15);
    }

    if intervals.is_empty() {
        return Ok(json!({
            "ok": true,
            "dryRun": dry_run,
            "date": date_ymd,
            "scheduledCount": 0,
            "scheduled": [],
            "message": format!("No open slots left on {}.", date_ymd),
        }));
    }

    let scheduled_ids: HashSet<String> = day_events.iter().map(|e| e.id.clone()).collect();
    let completed_task_ids: HashSet<String> = app_data
        .tasks
        .iter()
        .filter(|t| t.completed)
        .map(|t| t.id.clone())
        .collect();

    let mut candidates: Vec<TaskItem> = if single_targeted {
        let mut matched: Option<TaskItem> = None;
        if let Some(tid) = target_task_id.map(str::trim).filter(|s| !s.is_empty()) {
            matched = app_data.tasks.iter().find(|t| t.id == tid).cloned();
        } else if let Some(q) = target_title_match.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
            let exact: Vec<&TaskItem> = app_data
                .tasks
                .iter()
                .filter(|t| t.title.trim().to_lowercase() == q)
                .collect();
            if exact.len() == 1 {
                matched = Some(exact[0].clone());
            } else {
                let subs: Vec<&TaskItem> = app_data
                    .tasks
                    .iter()
                    .filter(|t| t.title.to_lowercase().contains(&q))
                    .collect();
                if subs.len() == 1 {
                    matched = Some(subs[0].clone());
                } else if subs.len() > 1 {
                    return Err(format!(
                        "{} tasks match '{}'. Pass an exact task_id.",
                        subs.len(),
                        q
                    ));
                }
            }
        }
        match matched {
            Some(t) => vec![t],
            None => return Err("No matching task found to schedule".to_string()),
        }
    } else {
        app_data
            .tasks
            .iter()
            .filter(|t| crate::task_tree::is_open_unit_representative(&app_data.tasks, t))
            .filter(|t| {
                t.blocked_by_task_ids
                    .iter()
                    .all(|dep| completed_task_ids.contains(dep))
            })
            .filter(|t| {
                let linked = t
                    .linked_event_id
                    .as_ref()
                    .or(t.calendar_event_id.as_ref())
                    .map(|id| scheduled_ids.contains(id))
                    .unwrap_or(false);
                let same_day_sched = t
                    .scheduled_start
                    .as_deref()
                    .map(|s| s.starts_with(&date_ymd))
                    .unwrap_or(false);
                !linked && !same_day_sched
            })
            .cloned()
            .collect()
    };

    // Sort: due today/overdue first (inheriting from parent if unset), then priority 1..=5
    candidates.sort_by(|a, b| {
        let a_eff_due = crate::task_tree::effective_due_date(&app_data.tasks, a);
        let b_eff_due = crate::task_tree::effective_due_date(&app_data.tasks, b);
        let a_due = a_eff_due
            .as_deref()
            .and_then(|d| d.get(..10))
            .map(|d| d <= date_ymd.as_str())
            .unwrap_or(false);
        let b_due = b_eff_due
            .as_deref()
            .and_then(|d| d.get(..10))
            .map(|d| d <= date_ymd.as_str())
            .unwrap_or(false);
        b_due
            .cmp(&a_due)
            .then_with(|| a.priority.cmp(&b.priority))
            .then_with(|| a.created_at.cmp(&b.created_at))
    });

    let write_cal = google_api::default_write_cal(store);
    let mut scheduled = Vec::new();
    let mut skipped = 0usize;
    let mut all_tasks = store.get_app_data().tasks;
    let prev_tasks_snap: Vec<TaskItem> = all_tasks.clone();

    for task in candidates {
        let eff_est = crate::task_tree::effective_estimated_pomodoros(&all_tasks, &task.id);
        let dur_mins = task
            .duration_minutes
            .filter(|&m| m > 0)
            .unwrap_or_else(|| eff_est.max(1) * focus_mins);
        let dur_ms = (dur_mins as i64) * 60_000;

        let slot_idx = intervals.iter().position(|(s, e)| (*e - *s) >= dur_ms);
        let Some(idx) = slot_idx else {
            skipped += 1;
            continue;
        };

        let slot_start_ms = intervals[idx].0;
        let slot_end_ms = slot_start_ms + dur_ms;
        let Some(s_dt) = Local.timestamp_millis_opt(slot_start_ms).single() else {
            skipped += 1;
            continue;
        };
        let Some(e_dt) = Local.timestamp_millis_opt(slot_end_ms).single() else {
            skipped += 1;
            continue;
        };
        let start_str = s_dt.to_rfc3339();
        let end_str = e_dt.to_rfc3339();
        if let Err(err) = crate::task_tree::validate_time_block_hierarchy(
            &all_tasks,
            &task.id,
            &start_str,
            &end_str,
        ) {
            if single_targeted {
                return Err(err);
            }
            skipped += 1;
            continue;
        }
        // Reserve 5-minute breathing room after each auto-planned block if possible
        intervals[idx].0 = (slot_end_ms + 5 * 60_000).min(intervals[idx].1);
        if intervals[idx].1 - intervals[idx].0 < 15 * 60_000 {
            intervals.remove(idx);
        }

        if dry_run {
            scheduled.push(json!({
                "taskId": task.id,
                "title": task.title,
                "start": start_str,
                "end": end_str,
                "durationMinutes": dur_mins,
            }));
            continue;
        }

        let created = google_api::create_calendar_event(
            store,
            CreateEventPayload {
                calendar_id: Some(write_cal.clone()),
                summary: task.title.clone(),
                description: Some(
                    task.notes
                        .clone()
                        .unwrap_or_else(|| "Auto-planned by FocusFlow".to_string()),
                ),
                start: start_str.clone(),
                end: end_str.clone(),
            },
        )
        .await?;

        store.set_task_event_link(task.id.clone(), Some(created.id.clone()));
        for t in &mut all_tasks {
            if t.id == task.id {
                t.calendar_event_id = Some(created.id.clone());
                t.linked_event_id = Some(created.id.clone());
                t.scheduled_start = Some(start_str.clone());
                t.scheduled_end = Some(end_str.clone());
                if t.due_date.is_none() {
                    t.due_date = Some(format!("{}T00:00:00.000Z", date_ymd));
                }
                break;
            }
        }

        scheduled.push(json!({
            "taskId": task.id,
            "eventId": created.id,
            "calendarId": write_cal.clone(),
            "title": task.title,
            "start": start_str,
            "end": end_str,
            "durationMinutes": dur_mins,
        }));
    }

    if !dry_run && !scheduled.is_empty() {
        store.save_tasks(all_tasks);
    }

    Ok(json!({
        "ok": true,
        "dryRun": dry_run,
        "date": date_ymd,
        "scheduledCount": scheduled.len(),
        "unscheduledRemainingCount": skipped,
        "scheduled": scheduled,
        "previousTasks": if !dry_run && !scheduled.is_empty() { Some(prev_tasks_snap) } else { None },
        "message": if dry_run {
            format!("Previewed {} task block(s) on {} (dry run, no changes saved).", scheduled.len(), date_ymd)
        } else {
            format!("Scheduled {} task(s) into open calendar slots on {}.", scheduled.len(), date_ymd)
        },
    }))
}

pub fn compute_focus_stats(app_data: &AppData) -> Value {
    let today = Local::now().date_naive();
    let week_cutoff = today - Duration::days(6);
    let mut by_day: HashMap<NaiveDate, u32> = HashMap::new();
    let mut by_project: HashMap<String, u32> = HashMap::new();
    let mut weekly_by_project: HashMap<String, u32> = HashMap::new();
    let mut by_hour = [0u32; 24];
    let mut total_mins = 0u32;
    let mut total_blocks = 0u32;

    let valid_task_ids: HashSet<&str> =
        app_data.tasks.iter().map(|t| t.id.as_str()).collect();
    let valid_proj_ids: HashSet<&str> =
        app_data.projects.iter().map(|p| p.id.as_str()).collect();

    let mut valid_sessions = Vec::new();
    for s in &app_data.sessions {
        if s.mode != "focus" && s.mode != "stopwatch" {
            continue;
        }
        // Skip orphaned sessions pointing to missing tasks or projects.
        if let Some(tid) = s.task_id.as_deref() {
            if !valid_task_ids.contains(tid) {
                continue;
            }
        }
        if let Some(pid) = s.project_id.as_deref() {
            if !valid_proj_ids.contains(pid) {
                continue;
            }
        }
        valid_sessions.push(s);
        total_mins += s.duration_minutes;
        total_blocks += 1;

        let proj_name = s
            .project_id
            .as_deref()
            .and_then(|pid| app_data.projects.iter().find(|p| p.id == pid))
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Unassigned".to_string());
        *by_project.entry(proj_name.clone()).or_insert(0) += s.duration_minutes;

        if let Ok(dt) = DateTime::parse_from_rfc3339(&s.started_at) {
            let local_dt = dt.with_timezone(&Local);
            let local_d = local_dt.date_naive();
            *by_day.entry(local_d).or_insert(0) += s.duration_minutes;
            if local_d >= week_cutoff && local_d <= today {
                *weekly_by_project.entry(proj_name).or_insert(0) += s.duration_minutes;
            }
            let h = local_dt.hour() as usize;
            if h < 24 {
                by_hour[h] += s.duration_minutes;
            }
        }
    }

    let today_mins = *by_day.get(&today).unwrap_or(&0);
    let last_7_days_mins: u32 = (0..7)
        .filter_map(|offset| by_day.get(&(today - Duration::days(offset))))
        .sum();

    // Streak: count backwards from today (or yesterday if today isn't finished yet).
    let mut active_streak = 0u32;
    let mut check_day = if by_day.get(&today).copied().unwrap_or(0) > 0 {
        today
    } else {
        today - Duration::days(1)
    };
    while by_day.get(&check_day).copied().unwrap_or(0) > 0 {
        active_streak += 1;
        check_day -= Duration::days(1);
    }

    // Longest streak across all recorded sessions.
    let mut longest_streak = active_streak;
    let mut active_days: Vec<NaiveDate> =
        by_day.iter().filter(|(_, &m)| m > 0).map(|(&d, _)| d).collect();
    active_days.sort();
    let mut run = 0u32;
    let mut prev_day: Option<NaiveDate> = None;
    for d in active_days {
        if prev_day.map(|p| d - p == Duration::days(1)).unwrap_or(false) {
            run += 1;
        } else {
            run = 1;
        }
        if run > longest_streak {
            longest_streak = run;
        }
        prev_day = Some(d);
    }

    let goal_mins = app_data.settings.daily_focus_goal_minutes.max(1);
    let goal_progress_pct = ((today_mins as f64 / goal_mins as f64) * 100.0).round() as u32;

    let mut project_breakdown: Vec<Value> = by_project
        .into_iter()
        .map(|(name, minutes)| json!({ "project": name, "minutes": minutes }))
        .collect();
    project_breakdown.sort_by(|a, b| {
        b["minutes"]
            .as_u64()
            .unwrap_or(0)
            .cmp(&a["minutes"].as_u64().unwrap_or(0))
    });

    let mut weekly_project_hours: Vec<Value> = weekly_by_project
        .into_iter()
        .map(|(name, minutes)| {
            let hours = (minutes as f64 / 60.0 * 10.0).round() / 10.0;
            json!({ "project": name, "minutes": minutes, "hours": hours })
        })
        .collect();
    weekly_project_hours.sort_by(|a, b| {
        b["minutes"]
            .as_u64()
            .unwrap_or(0)
            .cmp(&a["minutes"].as_u64().unwrap_or(0))
    });

    let best_hours_heatmap: Vec<Value> = by_hour
        .iter()
        .enumerate()
        .filter(|(_, &minutes)| minutes > 0)
        .map(|(hour, &minutes)| json!({ "hour": hour, "minutes": minutes }))
        .collect();
    let peak_hour = by_hour
        .iter()
        .enumerate()
        .max_by_key(|(_, &m)| m)
        .filter(|(_, &m)| m > 0)
        .map(|(h, _)| h);

    let est_vs_actual: Vec<Value> = app_data
        .tasks
        .iter()
        .filter(|t| t.completed_pomodoros > 0 || (t.completed && t.estimated_pomodoros > 0))
        .take(15)
        .map(|t| {
            json!({
                "taskId": t.id,
                "title": t.title,
                "estimatedPomodoros": t.estimated_pomodoros,
                "actualPomodoros": t.completed_pomodoros,
                "completed": t.completed,
            })
        })
        .collect();

    json!({
        "todayFocusMinutes": today_mins,
        "dailyGoalMinutes": goal_mins,
        "dailyGoalPercent": goal_progress_pct,
        "last7DaysMinutes": last_7_days_mins,
        "totalFocusMinutes": total_mins,
        "totalFocusBlocks": total_blocks,
        "currentStreakDays": active_streak,
        "longestStreakDays": longest_streak,
        "projectBreakdown": project_breakdown,
        "weeklyProjectHours": weekly_project_hours,
        "bestHoursHeatmap": best_hours_heatmap,
        "peakHour": peak_hour,
        "estimateVsActual": est_vs_actual,
        "recentSessions": valid_sessions.into_iter().take(15).collect::<Vec<_>>(),
    })
}

/// Shifts later time-blocks forward when an active time-blocked task overruns by `delay_minutes`.
pub async fn shift_following_blocks(
    store: &LocalStore,
    anchor_event_id: &str,
    delay_minutes: i64,
) -> Result<Vec<Value>, String> {
    if delay_minutes <= 0 {
        return Ok(Vec::new());
    }
    let today = Local::now().date_naive();
    let (start_iso, end_iso) = day_bounds_iso(today);
    let mut events = google_api::fetch_calendar_events(store, start_iso, end_iso)
        .await
        .unwrap_or_else(|_| store.get_local_events());

    let Some(anchor) = events.iter().find(|e| e.id == anchor_event_id).cloned() else {
        return Ok(Vec::new());
    };
    let Ok(anchor_end) = DateTime::parse_from_rfc3339(&anchor.end) else {
        return Ok(Vec::new());
    };
    let anchor_end_local = anchor_end.with_timezone(&Local);
    let anchor_start_ms = DateTime::parse_from_rfc3339(&anchor.start)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0);

    // Push anchor event end out by delay_minutes first
    let new_anchor_end = anchor_end_local + Duration::minutes(delay_minutes);
    let _ = google_api::update_calendar_event(
        store,
        UpdateEventPayload {
            calendar_id: anchor.calendar_id.clone(),
            event_id: anchor.id.clone(),
            summary: None,
            start: None,
            end: Some(new_anchor_end.to_rfc3339()),
        },
    )
    .await;

    events.sort_by(|a, b| a.start.cmp(&b.start));

    let mut cursor_ms = new_anchor_end.timestamp_millis();
    let mut shifted = Vec::new();
    let mut tasks = store.get_app_data().tasks;
    let mut tasks_dirty = false;

    for evt in events {
        if evt.id == anchor_event_id || evt.is_all_day.unwrap_or(false) {
            continue;
        }
        let Ok(st) = DateTime::parse_from_rfc3339(&evt.start) else {
            continue;
        };
        let Ok(en) = DateTime::parse_from_rfc3339(&evt.end) else {
            continue;
        };
        let st_ms = st.timestamp_millis();
        let en_ms = en.timestamp_millis();
        if st_ms < anchor_start_ms || en_ms <= anchor_start_ms {
            continue;
        }
        if st_ms < cursor_ms {
            let dur_ms = (en_ms - st_ms).max(15 * 60_000);
            let new_st = Local
                .timestamp_millis_opt(cursor_ms)
                .single()
                .unwrap_or_else(|| st.with_timezone(&Local));
            let new_en = Local
                .timestamp_millis_opt(cursor_ms + dur_ms)
                .single()
                .unwrap_or_else(|| en.with_timezone(&Local));
            let new_st_iso = new_st.to_rfc3339();
            let new_en_iso = new_en.to_rfc3339();

            if google_api::update_calendar_event(
                store,
                UpdateEventPayload {
                    calendar_id: evt.calendar_id.clone(),
                    event_id: evt.id.clone(),
                    summary: None,
                    start: Some(new_st_iso.clone()),
                    end: Some(new_en_iso.clone()),
                },
            )
            .await
            .is_ok()
            {
                cursor_ms += dur_ms;
                for t in &mut tasks {
                    if t.linked_event_id.as_deref() == Some(evt.id.as_str())
                        || t.calendar_event_id.as_deref() == Some(evt.id.as_str())
                    {
                        t.scheduled_start = Some(new_st_iso.clone());
                        t.scheduled_end = Some(new_en_iso.clone());
                        tasks_dirty = true;
                    }
                }
                shifted.push(json!({
                    "eventId": evt.id,
                    "summary": evt.summary,
                    "newStart": new_st_iso,
                    "newEnd": new_en_iso,
                }));
            }
        }
    }

    if tasks_dirty {
        store.save_tasks(tasks);
    }
    Ok(shifted)
}

/// End-of-day shutdown review: compares planned vs done, optionally rolls unfinished tasks to tomorrow,
/// and optionally writes a Markdown daily review note to the configured Obsidian vault.
pub async fn run_shutdown_review(
    store: &LocalStore,
    date: NaiveDate,
    roll_unfinished: bool,
    write_obsidian: bool,
    dry_run: bool,
) -> Result<Value, String> {
    let app_data = store.get_app_data();
    let date_ymd = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());
    let next_day = date + Duration::days(1);
    let tomorrow_ymd = format!("{:04}-{:02}-{:02}", next_day.year(), next_day.month(), next_day.day());
    let tomorrow_iso = format!("{}T00:00:00.000Z", tomorrow_ymd);

    let is_for_day = |t: &TaskItem| -> bool {
        let due_match = t
            .due_date
            .as_deref()
            .and_then(|s| s.get(..10))
            .map(|d| d <= date_ymd.as_str())
            .unwrap_or(false);
        let sched_match = t
            .scheduled_start
            .as_deref()
            .map(|s| s.starts_with(&date_ymd))
            .unwrap_or(false);
        due_match || sched_match
    };

    let today_sessions: Vec<_> = app_data
        .sessions
        .iter()
        .filter(|s| s.mode == "focus" || s.mode == "stopwatch")
        .filter(|s| {
            chrono::DateTime::parse_from_rfc3339(&s.started_at)
                .map(|dt| dt.with_timezone(&Local).date_naive() == date)
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    let focus_minutes: u32 = today_sessions.iter().map(|s| s.duration_minutes).sum();

    let mut completed_tasks: Vec<Value> = Vec::new();
    let mut unfinished_tasks: Vec<Value> = Vec::new();
    let mut rolled_ids: Vec<String> = Vec::new();

    for t in &app_data.tasks {
        if !t.completed && is_for_day(t) {
            rolled_ids.push(t.id.clone());
            unfinished_tasks.push(json!({
                "id": t.id,
                "title": t.title,
                "priority": t.priority,
                "estimatedPomodoros": t.estimated_pomodoros,
                "completedPomodoros": t.completed_pomodoros,
            }));
        } else if t.completed && (is_for_day(t) || today_sessions.iter().any(|s| s.task_id.as_deref() == Some(t.id.as_str()))) {
            completed_tasks.push(json!({
                "id": t.id,
                "title": t.title,
                "completedPomodoros": t.completed_pomodoros,
            }));
        }
    }

    let mut rolled_prev: Option<Vec<TaskItem>> = None;
    if roll_unfinished && !dry_run && !rolled_ids.is_empty() {
        let rolled_set: HashSet<String> = rolled_ids.iter().cloned().collect();
        let mut all_tasks = app_data.tasks.clone();
        rolled_prev = Some(all_tasks.clone());
        let mut google_updates: Vec<(String, String)> = Vec::new();
        for t in &mut all_tasks {
            if rolled_set.contains(&t.id) {
                t.due_date = Some(tomorrow_iso.clone());
                if let (Some(gid), Some(lid)) = (&t.google_task_id, &t.google_task_list_id) {
                    google_updates.push((lid.clone(), gid.clone()));
                }
            }
        }
        store.save_tasks(all_tasks);
        for (lid, gid) in google_updates {
            let _ = google_api::update_google_task(
                store,
                lid,
                gid,
                UpdateTaskPatch {
                    title: None,
                    notes: None,
                    completed: None,
                    due: Some(tomorrow_iso.clone()),
                },
            )
            .await;
        }
    }

    let mut md = format!("# FocusFlow Shutdown Review — {}\n\n", date_ymd);
    md.push_str(&format!(
        "- **Focus Time**: {} min ({} sessions)\n- **Completed Tasks**: {}\n- **{} Tasks**: {}\n\n",
        focus_minutes,
        today_sessions.len(),
        completed_tasks.len(),
        if roll_unfinished && !dry_run { "Rolled to Tomorrow" } else { "Unfinished" },
        unfinished_tasks.len(),
    ));
    if !completed_tasks.is_empty() {
        md.push_str("## Completed\n");
        for item in &completed_tasks {
            let title = item["title"].as_str().unwrap_or("Untitled");
            let poms = item["completedPomodoros"].as_u64().unwrap_or(0);
            md.push_str(&format!("- [x] {} ({} pom)\n", title, poms));
        }
        md.push('\n');
    }
    if !unfinished_tasks.is_empty() {
        let heading = if roll_unfinished && !dry_run {
            format!("## Rolled to {}\n", tomorrow_ymd)
        } else {
            "## Unfinished\n".to_string()
        };
        md.push_str(&heading);
        for item in &unfinished_tasks {
            let title = item["title"].as_str().unwrap_or("Untitled");
            md.push_str(&format!("- [ ] {}\n", title));
        }
        md.push('\n');
    }
    if !today_sessions.is_empty() {
        md.push_str("## Focus Sessions\n");
        for s in &today_sessions {
            let note = s.note.as_deref().map(|n| format!(" — {}", n)).unwrap_or_default();
            md.push_str(&format!("- {} ({}m){}\n", s.title, s.duration_minutes, note));
        }
    }

    let mut obsidian_written_path: Option<String> = None;
    let mut obsidian_error: Option<String> = None;
    if write_obsidian && !dry_run {
        if let Some(vault_raw) = app_data.settings.obsidian_vault_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let note_path = std::path::PathBuf::from(vault_raw).join(format!("{}.md", date_ymd));
            if let Some(parent) = note_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let write_res = if note_path.exists() {
                use std::io::Write;
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&note_path)
                    .and_then(|mut f| write!(f, "\n\n{}", md))
            } else {
                std::fs::write(&note_path, &md)
            };
            match write_res {
                Ok(()) => obsidian_written_path = Some(note_path.to_string_lossy().to_string()),
                Err(e) => obsidian_error = Some(format!("Failed writing Obsidian note: {}", e)),
            }
        } else {
            obsidian_error = Some("Obsidian vault path is not configured in Settings".to_string());
        }
    }

    Ok(json!({
        "ok": true,
        "dryRun": dry_run,
        "date": date_ymd,
        "tomorrow": tomorrow_ymd,
        "focusMinutes": focus_minutes,
        "sessionsCount": today_sessions.len(),
        "completedCount": completed_tasks.len(),
        "completedTasks": completed_tasks,
        "unfinishedCount": unfinished_tasks.len(),
        "unfinishedTasks": unfinished_tasks,
        "rolledToTomorrow": roll_unfinished && !dry_run,
        "obsidianNotePath": obsidian_written_path,
        "obsidianError": obsidian_error,
        "markdown": md,
        "previousTasks": rolled_prev,
    }))
}

/// Formats focus sessions as CSV or Markdown for export & MCP analytics.
pub fn export_focus_logs(app_data: &AppData, format: &str) -> String {
    let proj_names: HashMap<&str, &str> = app_data
        .projects
        .iter()
        .map(|p| (p.id.as_str(), p.name.as_str()))
        .collect();
    if format.eq_ignore_ascii_case("csv") {
        let mut out = String::from("id,title,mode,project,startedAt,endedAt,durationMinutes,note\n");
        for s in &app_data.sessions {
            let esc = |val: &str| format!("\"{}\"", val.replace('"', "\"\""));
            let pname = s
                .project_id
                .as_deref()
                .and_then(|pid| proj_names.get(pid).copied())
                .unwrap_or("");
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{}\n",
                esc(&s.id),
                esc(&s.title),
                esc(&s.mode),
                esc(pname),
                esc(&s.started_at),
                esc(&s.ended_at),
                s.duration_minutes,
                esc(s.note.as_deref().unwrap_or(""))
            ));
        }
        return out;
    }

    let mut md = String::from("# FocusFlow Session Logs\n\n| Date | Session | Mode | Project | Minutes | Note |\n| --- | --- | --- | --- | ---: | --- |\n");
    for s in &app_data.sessions {
        let pname = s
            .project_id
            .as_deref()
            .and_then(|pid| proj_names.get(pid).copied())
            .unwrap_or("—");
        let date_str = s.started_at.get(..10).unwrap_or(&s.started_at);
        let note = s.note.as_deref().unwrap_or("—").replace('|', "\\|");
        let title = s.title.replace('|', "\\|");
        md.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} |\n",
            date_str, title, s.mode, pname, s.duration_minutes, note
        ));
    }
    md
}
