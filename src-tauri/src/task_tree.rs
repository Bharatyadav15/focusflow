use std::collections::{HashMap, HashSet};

use crate::types::TaskItem;

pub const MAX_TREE_DEPTH: usize = 3;

fn index_by_id(tasks: &[TaskItem]) -> HashMap<&str, &TaskItem> {
    tasks.iter().map(|t| (t.id.as_str(), t)).collect()
}

pub fn children_of<'a>(tasks: &'a [TaskItem], parent_id: &str) -> Vec<&'a TaskItem> {
    tasks
        .iter()
        .filter(|t| t.parent_id.as_deref() == Some(parent_id))
        .collect()
}

pub fn has_children(tasks: &[TaskItem], task_id: &str) -> bool {
    tasks
        .iter()
        .any(|t| t.parent_id.as_deref() == Some(task_id))
}

pub fn has_open_children(tasks: &[TaskItem], task_id: &str) -> bool {
    tasks
        .iter()
        .any(|t| !t.completed && t.parent_id.as_deref() == Some(task_id))
}

/// Depth of a task (root = 1, child = 2, grandchild = 3). Cycle-safe.
pub fn depth_of(tasks: &[TaskItem], task_id: &str) -> usize {
    let by_id = index_by_id(tasks);
    let mut depth = 0usize;
    let mut cur = Some(task_id);
    let mut seen = HashSet::new();
    while let Some(id) = cur {
        if !seen.insert(id) {
            break;
        }
        let Some(t) = by_id.get(id) else {
            break;
        };
        depth += 1;
        cur = t.parent_id.as_deref();
    }
    depth
}

/// Height of the subtree rooted at `task_id` (leaf = 1). Cycle-safe.
pub fn subtree_height(tasks: &[TaskItem], task_id: &str) -> usize {
    fn walk(
        tasks: &[TaskItem],
        id: &str,
        seen: &mut HashSet<String>,
    ) -> usize {
        if !seen.insert(id.to_string()) {
            return 0;
        }
        let mut max_child = 0usize;
        for c in tasks.iter().filter(|t| t.parent_id.as_deref() == Some(id)) {
            max_child = max_child.max(walk(tasks, &c.id, seen));
        }
        1 + max_child
    }
    walk(tasks, task_id, &mut HashSet::new())
}

/// True if `candidate_id` is `ancestor_id` or any descendant of `ancestor_id`.
pub fn is_descendant(tasks: &[TaskItem], ancestor_id: &str, candidate_id: &str) -> bool {
    if ancestor_id == candidate_id {
        return true;
    }
    let by_id = index_by_id(tasks);
    let mut cur = Some(candidate_id);
    let mut seen = HashSet::new();
    while let Some(id) = cur {
        if !seen.insert(id) {
            break;
        }
        let Some(t) = by_id.get(id) else {
            break;
        };
        if t.parent_id.as_deref() == Some(ancestor_id) {
            return true;
        }
        cur = t.parent_id.as_deref();
    }
    false
}

/// Validates reparenting `task_id` under `new_parent_id` (`None` detaches to root).
pub fn validate_reparent(
    tasks: &[TaskItem],
    task_id: &str,
    new_parent_id: Option<&str>,
) -> Result<(), String> {
    if !tasks.iter().any(|t| t.id == task_id) {
        return Err(format!("Task '{}' not found", task_id));
    }
    let Some(pid) = new_parent_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    if pid == task_id {
        return Err("A task cannot be its own parent".to_string());
    }
    if !tasks.iter().any(|t| t.id == pid) {
        return Err(format!("Parent task '{}' not found", pid));
    }
    if is_descendant(tasks, task_id, pid) {
        return Err("Cannot nest a task under its own descendant (cycle rejected)".to_string());
    }
    let parent_depth = depth_of(tasks, pid);
    let moving_height = subtree_height(tasks, task_id);
    if parent_depth + moving_height > MAX_TREE_DEPTH {
        return Err(format!(
            "Maximum nesting depth is {} (would reach depth {})",
            MAX_TREE_DEPTH,
            parent_depth + moving_height
        ));
    }
    Ok(())
}

/// Validates attaching a brand-new task under `new_parent_id`.
pub fn validate_new_child_parent(
    tasks: &[TaskItem],
    new_parent_id: Option<&str>,
) -> Result<(), String> {
    let Some(pid) = new_parent_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    if !tasks.iter().any(|t| t.id == pid) {
        return Err(format!("Parent task '{}' not found", pid));
    }
    let parent_depth = depth_of(tasks, pid);
    if parent_depth + 1 > MAX_TREE_DEPTH {
        return Err(format!(
            "Maximum nesting depth is {} (parent '{}' is already at depth {})",
            MAX_TREE_DEPTH, pid, parent_depth
        ));
    }
    Ok(())
}

/// Reparents all direct children of `deleted_id` to `deleted_id`'s parent (grandparent).
/// Returns IDs of reparented children.
pub fn reparent_children_on_delete(tasks: &mut [TaskItem], deleted_id: &str) -> Vec<String> {
    let grandparent = tasks
        .iter()
        .find(|t| t.id == deleted_id)
        .and_then(|t| t.parent_id.clone());
    let mut reparented = Vec::new();
    for t in tasks.iter_mut() {
        if t.parent_id.as_deref() == Some(deleted_id) {
            t.parent_id = grandparent.clone();
            reparented.push(t.id.clone());
        }
    }
    reparented
}

/// Clears any `parent_id` pointing to a missing task ID. Returns count fixed.
pub fn heal_orphans(tasks: &mut [TaskItem]) -> usize {
    let ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let mut fixed = 0usize;
    for t in tasks.iter_mut() {
        if let Some(ref pid) = t.parent_id {
            if !ids.contains(pid) || pid == &t.id {
                t.parent_id = None;
                fixed += 1;
            }
        }
    }
    fixed
}

/// Collects all descendant IDs of `root_id` (excluding `root_id`). Cycle-safe.
pub fn descendant_ids(tasks: &[TaskItem], root_id: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut queue = vec![root_id.to_string()];
    let mut seen: HashSet<String> = [root_id.to_string()].into_iter().collect();
    while let Some(cur) = queue.pop() {
        for t in tasks {
            if t.parent_id.as_deref() == Some(cur.as_str()) && seen.insert(t.id.clone()) {
                result.push(t.id.clone());
                queue.push(t.id.clone());
            }
        }
    }
    result
}

/// Returns project_id if set on task, else inherits from nearest ancestor that has one.
pub fn effective_project_id(tasks: &[TaskItem], task: &TaskItem) -> Option<String> {
    if task.project_id.is_some() {
        return task.project_id.clone();
    }
    let by_id = index_by_id(tasks);
    let mut cur = task.parent_id.as_deref();
    let mut seen: HashSet<&str> = [task.id.as_str()].into_iter().collect();
    while let Some(pid) = cur {
        if !seen.insert(pid) {
            break;
        }
        let Some(parent) = by_id.get(pid) else {
            break;
        };
        if parent.project_id.is_some() {
            return parent.project_id.clone();
        }
        cur = parent.parent_id.as_deref();
    }
    None
}

/// Returns due_date if set on task, else inherits from nearest ancestor that has one.
pub fn effective_due_date(tasks: &[TaskItem], task: &TaskItem) -> Option<String> {
    if task.due_date.as_deref().map(str::trim).is_some_and(|s| !s.is_empty()) {
        return task.due_date.clone();
    }
    let by_id = index_by_id(tasks);
    let mut cur = task.parent_id.as_deref();
    let mut seen: HashSet<&str> = [task.id.as_str()].into_iter().collect();
    while let Some(pid) = cur {
        if !seen.insert(pid) {
            break;
        }
        let Some(parent) = by_id.get(pid) else {
            break;
        };
        if parent
            .due_date
            .as_deref()
            .map(str::trim)
            .is_some_and(|s| !s.is_empty())
        {
            return parent.due_date.clone();
        }
        cur = parent.parent_id.as_deref();
    }
    None
}

/// Effective estimate: own `estimated_pomodoros` if leaf or `estimate_explicit`,
/// otherwise sum of direct children's effective estimates.
pub fn effective_estimated_pomodoros(tasks: &[TaskItem], task_id: &str) -> u32 {
    fn walk(tasks: &[TaskItem], id: &str, seen: &mut HashSet<String>) -> u32 {
        if !seen.insert(id.to_string()) {
            return 0;
        }
        let Some(t) = tasks.iter().find(|x| x.id == id) else {
            return 0;
        };
        let kids: Vec<&TaskItem> = children_of(tasks, id);
        if kids.is_empty() || t.estimate_explicit || t.estimated_pomodoros > 1 {
            return t.estimated_pomodoros;
        }
        kids.iter().map(|c| walk(tasks, &c.id, seen)).sum()
    }
    walk(tasks, task_id, &mut HashSet::new())
}

/// Effective completed pomodoros: own `completed_pomodoros` + sum of all descendants'.
pub fn effective_completed_pomodoros(tasks: &[TaskItem], task_id: &str) -> u32 {
    fn walk(tasks: &[TaskItem], id: &str, seen: &mut HashSet<String>) -> u32 {
        if !seen.insert(id.to_string()) {
            return 0;
        }
        let Some(t) = tasks.iter().find(|x| x.id == id) else {
            return 0;
        };
        let kids_sum: u32 = children_of(tasks, id)
            .into_iter()
            .map(|c| walk(tasks, &c.id, seen))
            .sum();
        t.completed_pomodoros.saturating_add(kids_sum)
    }
    walk(tasks, task_id, &mut HashSet::new())
}

/// Returns `"Parent › Child"` (or `"Grandparent › Parent › Child"`).
pub fn breadcrumb(tasks: &[TaskItem], task_id: &str) -> String {
    let by_id = index_by_id(tasks);
    let mut parts = Vec::new();
    let mut cur = Some(task_id);
    let mut seen = HashSet::new();
    while let Some(id) = cur {
        if !seen.insert(id) {
            break;
        }
        let Some(t) = by_id.get(id) else {
            break;
        };
        parts.push(t.title.clone());
        cur = t.parent_id.as_deref();
    }
    parts.reverse();
    parts.join(" › ")
}

pub fn task_has_time_block(task: &TaskItem) -> bool {
    task.scheduled_start
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty())
        && task
            .scheduled_end
            .as_deref()
            .map(str::trim)
            .is_some_and(|s| !s.is_empty())
}

fn intervals_overlap_rfc3339(a_start: &str, a_end: &str, b_start: &str, b_end: &str) -> bool {
    let Ok(as_dt) = chrono::DateTime::parse_from_rfc3339(a_start) else {
        return false;
    };
    let Ok(ae_dt) = chrono::DateTime::parse_from_rfc3339(a_end) else {
        return false;
    };
    let Ok(bs_dt) = chrono::DateTime::parse_from_rfc3339(b_start) else {
        return false;
    };
    let Ok(be_dt) = chrono::DateTime::parse_from_rfc3339(b_end) else {
        return false;
    };
    as_dt < be_dt && bs_dt < ae_dt
}

/// Enforces planner rule:
/// - A child can be time-blocked on its own ONLY when its ancestors have no block.
/// - A parent and its own child must never land in overlapping time blocks.
pub fn validate_time_block_hierarchy(
    tasks: &[TaskItem],
    task_id: &str,
    start_iso: &str,
    end_iso: &str,
) -> Result<(), String> {
    let by_id = index_by_id(tasks);
    let Some(task) = by_id.get(task_id) else {
        return Err(format!("Task '{}' not found", task_id));
    };

    // Check ancestors
    let mut cur = task.parent_id.as_deref();
    let mut seen: HashSet<&str> = [task_id].into_iter().collect();
    while let Some(pid) = cur {
        if !seen.insert(pid) {
            break;
        }
        if let Some(parent) = by_id.get(pid) {
            if task_has_time_block(parent) {
                return Err(format!(
                    "Cannot time-block '{}' because parent '{}' already has a calendar block",
                    task.title, parent.title
                ));
            }
            cur = parent.parent_id.as_deref();
        } else {
            break;
        }
    }

    // Check descendants for overlapping blocks
    for did in descendant_ids(tasks, task_id) {
        if let Some(child) = by_id.get(did.as_str()) {
            if let (Some(cs), Some(ce)) = (&child.scheduled_start, &child.scheduled_end) {
                if intervals_overlap_rfc3339(start_iso, end_iso, cs, ce) {
                    return Err(format!(
                        "Cannot time-block '{}' ({}–{}) because child '{}' already has an overlapping block",
                        task.title, start_iso, end_iso, child.title
                    ));
                }
            }
        }
    }

    Ok(())
}

/// True if `task` is counted as a top-level open work unit (either a root, or an open child
/// whose parent is completed or missing — so open children under an open parent are grouped under the parent).
pub fn is_open_unit_representative(tasks: &[TaskItem], task: &TaskItem) -> bool {
    if task.completed {
        return false;
    }
    let Some(ref pid) = task.parent_id else {
        return true;
    };
    match tasks.iter().find(|t| &t.id == pid) {
        Some(parent) => parent.completed,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(id: &str, parent_id: Option<&str>) -> TaskItem {
        TaskItem {
            id: id.to_string(),
            title: id.to_string(),
            notes: None,
            project_id: None,
            priority: 3,
            completed: false,
            due_date: None,
            parent_id: parent_id.map(str::to_string),
            estimated_pomodoros: 1,
            estimate_explicit: false,
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
            created_at: "2026-11-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn depth_and_max_depth_limit() {
        let tasks = vec![
            mk("root", None),
            mk("child", Some("root")),
            mk("grand", Some("child")),
        ];
        assert_eq!(depth_of(&tasks, "root"), 1);
        assert_eq!(depth_of(&tasks, "child"), 2);
        assert_eq!(depth_of(&tasks, "grand"), 3);

        // Adding a 4th level under `grand` must be rejected
        assert!(validate_new_child_parent(&tasks, Some("grand")).is_err());
        // Adding under `child` (depth 2 -> 3) is allowed
        assert!(validate_new_child_parent(&tasks, Some("child")).is_ok());

        // Moving `branch` (height 2) under `child` (depth 2) -> total depth 4 -> rejected
        let mut tasks2 = tasks.clone();
        tasks2.push(mk("b_root", None));
        tasks2.push(mk("b_leaf", Some("b_root")));
        assert!(validate_reparent(&tasks2, "b_root", Some("child")).is_err());
        // Moving `b_root` (height 2) under `root` (depth 1) -> total depth 3 -> allowed
        assert!(validate_reparent(&tasks2, "b_root", Some("root")).is_ok());
    }

    #[test]
    fn cycle_rejection() {
        let tasks = vec![
            mk("a", None),
            mk("b", Some("a")),
            mk("c", Some("b")),
        ];
        assert!(validate_reparent(&tasks, "a", Some("a")).is_err());
        assert!(validate_reparent(&tasks, "a", Some("b")).is_err());
        assert!(validate_reparent(&tasks, "a", Some("c")).is_err());
        assert!(validate_reparent(&tasks, "c", None).is_ok());
    }

    #[test]
    fn reparent_on_delete_preserves_children() {
        let mut tasks = vec![
            mk("gp", None),
            mk("p", Some("gp")),
            mk("c1", Some("p")),
            mk("c2", Some("p")),
        ];
        let moved = reparent_children_on_delete(&mut tasks, "p");
        tasks.retain(|t| t.id != "p");
        assert_eq!(moved, vec!["c1".to_string(), "c2".to_string()]);
        assert_eq!(
            tasks.iter().find(|t| t.id == "c1").unwrap().parent_id.as_deref(),
            Some("gp")
        );
        assert_eq!(
            tasks.iter().find(|t| t.id == "c2").unwrap().parent_id.as_deref(),
            Some("gp")
        );
    }

    #[test]
    fn orphan_handling_heals_missing_parents() {
        let mut tasks = vec![mk("orphan", Some("missing-id")), mk("self_ref", Some("self_ref"))];
        let fixed = heal_orphans(&mut tasks);
        assert_eq!(fixed, 2);
        assert!(tasks.iter().all(|t| t.parent_id.is_none()));
    }

    #[test]
    fn inheritance_and_rollups() {
        let mut gp = mk("gp", None);
        gp.project_id = Some("proj-1".to_string());
        gp.due_date = Some("2026-11-20".to_string());
        gp.completed_pomodoros = 1;

        let mut p = mk("p", Some("gp"));
        p.due_date = Some("2026-11-18".to_string()); // child overrides parent due date
        p.completed_pomodoros = 2;

        let mut c = mk("c", Some("p"));
        c.estimated_pomodoros = 3;
        c.estimate_explicit = true;
        c.completed_pomodoros = 4;

        let tasks = vec![gp.clone(), p.clone(), c.clone()];
        assert_eq!(effective_project_id(&tasks, &c).as_deref(), Some("proj-1"));
        assert_eq!(effective_due_date(&tasks, &c).as_deref(), Some("2026-11-18"));
        assert_eq!(effective_estimated_pomodoros(&tasks, "gp"), 3);
        assert_eq!(effective_completed_pomodoros(&tasks, "gp"), 7);
        assert_eq!(breadcrumb(&tasks, "c"), "gp › p › c");
    }

    #[test]
    fn time_block_hierarchy_guards() {
        let mut p = mk("p", None);
        p.scheduled_start = Some("2026-11-16T09:00:00+05:30".to_string());
        p.scheduled_end = Some("2026-11-16T10:00:00+05:30".to_string());
        let c = mk("c", Some("p"));
        let tasks = vec![p, c];
        assert!(validate_time_block_hierarchy(
            &tasks,
            "c",
            "2026-11-16T11:00:00+05:30",
            "2026-11-16T11:30:00+05:30"
        )
        .is_err());
    }
}
