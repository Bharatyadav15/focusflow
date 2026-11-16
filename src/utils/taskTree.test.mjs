import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReparentTask,
  canTimeBlockTask,
  flattenTaskTree,
  getEffectiveCompletedPomodoros,
  getEffectiveDueDate,
  getEffectiveEstimatedPomodoros,
  getEffectiveProjectId,
  getTaskBreadcrumb,
  reparentChildrenOnDelete,
} from './taskTree.ts';

function mk(id, parentId) {
  return {
    id,
    title: id,
    priority: 3,
    completed: false,
    parentId,
    estimatedPomodoros: 1,
    completedPomodoros: 0,
    subtasks: [],
    createdAt: '2026-11-16T00:00:00Z',
  };
}

test('canReparentTask enforces cycle rejection and max depth 3', () => {
  const tasks = [mk('root'), mk('child', 'root'), mk('grand', 'child')];
  assert.equal(canReparentTask(tasks, 'root', 'root').ok, false);
  assert.equal(canReparentTask(tasks, 'root', 'child').ok, false);
  assert.equal(canReparentTask(tasks, 'root', 'grand').ok, false);
  assert.equal(canReparentTask(tasks, 'grand', null).ok, true);

  const extra = [...tasks, mk('b1'), mk('b2', 'b1')];
  assert.equal(canReparentTask(extra, 'b1', 'child').ok, false);
  assert.equal(canReparentTask(extra, 'b1', 'root').ok, true);
});

test('reparentChildrenOnDelete promotes children to grandparent', () => {
  const tasks = [mk('gp'), mk('p', 'gp'), mk('c1', 'p'), mk('c2', 'p')];
  const next = reparentChildrenOnDelete(tasks, 'p');
  assert.equal(next.length, 3);
  assert.equal(next.find((t) => t.id === 'c1')?.parentId, 'gp');
  assert.equal(next.find((t) => t.id === 'c2')?.parentId, 'gp');
});

test('inheritance, rollups, breadcrumb, and flattenTaskTree', () => {
  const gp = { ...mk('gp'), projectId: 'proj-1', dueDate: '2026-11-20', completedPomodoros: 1 };
  const p = { ...mk('p', 'gp'), dueDate: '2026-11-18', completedPomodoros: 2 };
  const c = { ...mk('c', 'p'), estimatedPomodoros: 3, estimateExplicit: true, completedPomodoros: 4 };
  const tasks = [gp, p, c];

  assert.equal(getEffectiveProjectId(tasks, c), 'proj-1');
  assert.equal(getEffectiveDueDate(tasks, c), '2026-11-18');
  assert.equal(getEffectiveEstimatedPomodoros(tasks, 'gp'), 3);
  assert.equal(getEffectiveCompletedPomodoros(tasks, 'gp'), 7);
  assert.equal(getTaskBreadcrumb(tasks, 'c'), 'gp › p › c');

  const collapsed = flattenTaskTree(tasks, new Set());
  assert.deepEqual(collapsed.map((n) => [n.task.id, n.depth, n.hasChildren]), [['gp', 0, true]]);

  const expanded = flattenTaskTree(tasks, new Set(['gp', 'p']));
  assert.deepEqual(
    expanded.map((n) => [n.task.id, n.depth]),
    [['gp', 0], ['p', 1], ['c', 2]]
  );
});

test('canTimeBlockTask blocks child if parent is scheduled', () => {
  const p = {
    ...mk('p'),
    scheduledStart: '2026-11-16T09:00:00Z',
    scheduledEnd: '2026-11-16T10:00:00Z',
  };
  const c = mk('c', 'p');
  assert.equal(canTimeBlockTask([p, c], 'c').ok, false);
});
