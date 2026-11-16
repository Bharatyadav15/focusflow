import type { TaskItem } from '../types';

export const MAX_TREE_DEPTH = 3;

export function getChildren(tasks: TaskItem[], parentId: string): TaskItem[] {
  return tasks.filter((t) => t.parentId === parentId);
}

export function getTaskDepth(tasks: TaskItem[], taskId: string): number {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let depth = 0;
  let cur: string | undefined = taskId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const t = byId.get(cur);
    if (!t) break;
    depth += 1;
    cur = t.parentId;
  }
  return depth;
}

export function getSubtreeHeight(tasks: TaskItem[], taskId: string): number {
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let maxChild = 0;
    for (const c of tasks) {
      if (c.parentId === id) {
        maxChild = Math.max(maxChild, walk(c.id));
      }
    }
    return 1 + maxChild;
  };
  return walk(taskId);
}

export function isDescendant(
  tasks: TaskItem[],
  ancestorId: string,
  candidateId: string
): boolean {
  if (ancestorId === candidateId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur: string | undefined = candidateId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const t = byId.get(cur);
    if (!t) break;
    if (t.parentId === ancestorId) return true;
    cur = t.parentId;
  }
  return false;
}

export function canReparentTask(
  tasks: TaskItem[],
  taskId: string,
  newParentId?: string | null
): { ok: true } | { ok: false; reason: string } {
  if (!tasks.some((t) => t.id === taskId)) {
    return { ok: false, reason: `Task '${taskId}' not found` };
  }
  const pid = newParentId?.trim();
  if (!pid) return { ok: true };
  if (pid === taskId) {
    return { ok: false, reason: 'A task cannot be its own parent' };
  }
  if (!tasks.some((t) => t.id === pid)) {
    return { ok: false, reason: `Parent task '${pid}' not found` };
  }
  if (isDescendant(tasks, taskId, pid)) {
    return { ok: false, reason: 'Cannot nest a task under its own descendant' };
  }
  const nextDepth = getTaskDepth(tasks, pid) + getSubtreeHeight(tasks, taskId);
  if (nextDepth > MAX_TREE_DEPTH) {
    return {
      ok: false,
      reason: `Maximum nesting depth is ${MAX_TREE_DEPTH}`,
    };
  }
  return { ok: true };
}

export function reparentChildrenOnDelete(
  tasks: TaskItem[],
  deletedId: string
): TaskItem[] {
  const deleted = tasks.find((t) => t.id === deletedId);
  const grandparentId = deleted?.parentId;
  return tasks
    .filter((t) => t.id !== deletedId)
    .map((t) =>
      t.parentId === deletedId ? { ...t, parentId: grandparentId } : t
    );
}

export function getDescendantIds(tasks: TaskItem[], rootId: string): string[] {
  const out: string[] = [];
  const queue = [rootId];
  const seen = new Set([rootId]);
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const t of tasks) {
      if (t.parentId === cur && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t.id);
        queue.push(t.id);
      }
    }
  }
  return out;
}

export function getEffectiveProjectId(
  tasks: TaskItem[],
  task: TaskItem
): string | undefined {
  if (task.projectId) return task.projectId;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur = task.parentId;
  const seen = new Set([task.id]);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    if (parent.projectId) return parent.projectId;
    cur = parent.parentId;
  }
  return undefined;
}

export function getEffectiveDueDate(
  tasks: TaskItem[],
  task: TaskItem
): string | undefined {
  if (task.dueDate?.trim()) return task.dueDate;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur = task.parentId;
  const seen = new Set([task.id]);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    if (parent.dueDate?.trim()) return parent.dueDate;
    cur = parent.parentId;
  }
  return undefined;
}

export function getEffectiveEstimatedPomodoros(
  tasks: TaskItem[],
  taskId: string
): number {
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = tasks.find((x) => x.id === id);
    if (!t) return 0;
    const kids = tasks.filter((x) => x.parentId === id);
    if (kids.length === 0 || t.estimateExplicit || t.estimatedPomodoros > 1) {
      return t.estimatedPomodoros;
    }
    return kids.reduce((acc, c) => acc + walk(c.id), 0);
  };
  return walk(taskId);
}

export function getEffectiveCompletedPomodoros(
  tasks: TaskItem[],
  taskId: string
): number {
  const seen = new Set<string>();
  const walk = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = tasks.find((x) => x.id === id);
    if (!t) return 0;
    const kidsSum = tasks
      .filter((x) => x.parentId === id)
      .reduce((acc, c) => acc + walk(c.id), 0);
    return (t.completedPomodoros || 0) + kidsSum;
  };
  return walk(taskId);
}

export function getTaskBreadcrumb(tasks: TaskItem[], taskId: string): string {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const parts: string[] = [];
  let cur: string | undefined = taskId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const t = byId.get(cur);
    if (!t) break;
    parts.push(t.title);
    cur = t.parentId;
  }
  parts.reverse();
  return parts.join(' › ');
}

export function canTimeBlockTask(
  tasks: TaskItem[],
  taskId: string,
  startIso?: string,
  endIso?: string
): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  if (!task) return { ok: false, reason: 'Task not found' };

  let cur = task.parentId;
  const seen = new Set([taskId]);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    if (parent.scheduledStart && parent.scheduledEnd) {
      return {
        ok: false,
        reason: `Cannot time-block "${task.title}" while parent "${parent.title}" has a calendar block.`,
      };
    }
    cur = parent.parentId;
  }

  if (startIso && endIso) {
    const sMs = Date.parse(startIso);
    const eMs = Date.parse(endIso);
    if (Number.isFinite(sMs) && Number.isFinite(eMs)) {
      for (const did of getDescendantIds(tasks, taskId)) {
        const child = byId.get(did);
        if (child?.scheduledStart && child?.scheduledEnd) {
          const cs = Date.parse(child.scheduledStart);
          const ce = Date.parse(child.scheduledEnd);
          if (Number.isFinite(cs) && Number.isFinite(ce) && sMs < ce && cs < eMs) {
            return {
              ok: false,
              reason: `Cannot time-block "${task.title}" overlapping child "${child.title}".`,
            };
          }
        }
      }
    }
  }

  return { ok: true };
}

export interface FlattenedTreeNode {
  task: TaskItem;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  openChildCount: number;
}

export function flattenTaskTree(
  visibleTasks: TaskItem[],
  expandedIds: Set<string>,
  allTasks: TaskItem[] = visibleTasks
): FlattenedTreeNode[] {
  const visibleIds = new Set(visibleTasks.map((t) => t.id));
  const childrenByParent = new Map<string, TaskItem[]>();
  const roots: TaskItem[] = [];

  for (const t of visibleTasks) {
    if (t.parentId && visibleIds.has(t.parentId)) {
      const list = childrenByParent.get(t.parentId) ?? [];
      list.push(t);
      childrenByParent.set(t.parentId, list);
    } else {
      roots.push(t);
    }
  }

  const out: FlattenedTreeNode[] = [];
  const seen = new Set<string>();
  const walk = (task: TaskItem, depth: number) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    const visibleKids = childrenByParent.get(task.id) ?? [];
    const allKids = allTasks.filter((x) => x.parentId === task.id);
    out.push({
      task,
      depth,
      hasChildren: visibleKids.length > 0,
      childCount: allKids.length,
      openChildCount: allKids.filter((c) => !c.completed).length,
    });
    if (visibleKids.length > 0 && expandedIds.has(task.id)) {
      for (const kid of visibleKids) {
        walk(kid, depth + 1);
      }
    }
  };

  for (const r of roots) {
    walk(r, 0);
  }
  return out;
}
