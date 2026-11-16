import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  BookmarkPlus,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  ExternalLink,
  Link2,
  ListChecks,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import type {
  CalendarEvent,
  GoogleTaskListInfo,
  Priority,
  Project,
  RecurrenceRule,
  TaskItem,
  TaskTemplate,
  TimerState,
} from '../../types';
import { getPriorityMeta, PRIORITIES } from '../../utils/priority';
import { parseSmartTaskInput } from '../../utils/taskParser';
import { extractYmd, formatTime, localOffsetToDueIso } from '../../utils/time';
import {
  canReparentTask,
  flattenTaskTree,
  getEffectiveCompletedPomodoros,
  getEffectiveDueDate,
  getEffectiveEstimatedPomodoros,
  getEffectiveProjectId,
  MAX_TREE_DEPTH,
} from '../../utils/taskTree';

const RECURRENCE_OPTIONS: { value: RecurrenceRule; label: string }[] = [
  { value: 'none', label: 'No Repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
];

function toDateInputValue(iso?: string): string {
  return extractYmd(iso);
}

function getEventDurationMinutes(evt?: CalendarEvent): number | undefined {
  if (!evt || evt.isAllDay) return undefined;
  const diff = Math.round(
    (new Date(evt.end).getTime() - new Date(evt.start).getTime()) / 60_000
  );
  return diff > 0 ? diff : undefined;
}

interface TaskListPanelProps {
  tasks: TaskItem[];
  taskLists: GoogleTaskListInfo[];
  projects: Project[];
  events: CalendarEvent[];
  templates: TaskTemplate[];
  taskMap: Map<string, TaskItem>;
  eventMap: Map<string, CalendarEvent>;
  projectMap: Map<string, Project>;
  timer: TimerState;
  syncingTasks: boolean;
  onStartFocus: (
    target: TimerState['activeTarget'],
    asStopwatch?: boolean
  ) => void;
  onQuickAddTask: (
    title: string,
    taskListId?: string,
    priority?: Priority,
    projectId?: string,
    dueDate?: string,
    recurrence?: RecurrenceRule,
    durationMinutes?: number,
    parentId?: string
  ) => void;
  onApplyTemplate?: (tpl: TaskTemplate) => void;
  onSaveAsTemplate?: (task: TaskItem) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask: (task: TaskItem) => void;
  onSetTaskMetadata: (
    taskId: string,
    meta: {
      priority?: Priority;
      projectId?: string;
      estimatedPomodoros?: number;
      durationMinutes?: number;
      recurrence?: RecurrenceRule;
      blockedByTaskIds?: string[];
      noteLink?: string;
    }
  ) => void;
  onAddSubtask?: (taskId: string, title: string) => void;
  onToggleSubtask?: (taskId: string, subtaskId: string) => void;
  onDeleteSubtask?: (taskId: string, subtaskId: string) => void;
  onRescheduleTask: (task: TaskItem, dueIso: string) => void;
  onTimeBlockTask: (task: TaskItem) => void;
  onLinkTaskToEvent: (taskId: string, eventId: string | null) => void;
  onSyncGoogleTasks: () => void;
  onMoveTask?: (taskId: string, newParentId?: string | null) => Promise<boolean>;
  parentCompletionPrompt?: { parentId: string; parentTitle: string } | null;
  onDismissParentCompletionPrompt?: () => void;
  onSelectTask?: (task: TaskItem) => void;
}

export const TaskListPanel: React.FC<TaskListPanelProps> = ({
  tasks,
  taskLists,
  projects,
  events,
  templates,
  taskMap,
  eventMap,
  projectMap,
  timer,
  syncingTasks,
  onStartFocus,
  onQuickAddTask,
  onApplyTemplate,
  onSaveAsTemplate,
  onToggleTask,
  onDeleteTask,
  onSetTaskMetadata,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onRescheduleTask,
  onTimeBlockTask,
  onLinkTaskToEvent,
  onSyncGoogleTasks,
  onMoveTask,
  parentCompletionPrompt,
  onDismissParentCompletionPrompt,
  onSelectTask,
}) => {
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<Priority>(3);
  const [quickProjectId, setQuickProjectId] = useState<string>('');
  const [quickRecurrence, setQuickRecurrence] = useState<RecurrenceRule>('none');
  const [selectedListId, setSelectedListId] = useState<string>('all');
  const [sortTasksByPriority, setSortTasksByPriority] = useState(true);
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [linkingTaskId, setLinkingTaskId] = useState<string | null>(null);
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null);
  const [expandedTreeIds, setExpandedTreeIds] = useState<Set<string>>(() => new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [addingChildOfId, setAddingChildOfId] = useState<string | null>(null);
  const [childDraftTitle, setChildDraftTitle] = useState('');

  const openTasks = tasks.filter((t) => !t.completed);

  const filteredTasks = useMemo(() => {
    const base =
      selectedListId === 'all'
        ? tasks
        : tasks.filter((t) => t.googleTaskListId === selectedListId);
    if (!sortTasksByPriority) return base;
    return [...base].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return (a.priority ?? 3) - (b.priority ?? 3);
    });
  }, [selectedListId, sortTasksByPriority, tasks]);

  const treeNodes = useMemo(
    () => flattenTaskTree(filteredTasks, expandedTreeIds, tasks),
    [expandedTreeIds, filteredTasks, tasks]
  );

  const toggleTreeExpand = (id: string) => {
    setExpandedTreeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    const parsed = parseSmartTaskInput(quickTitle, localOffsetToDueIso(0));
    const targetList = selectedListId === 'all' ? undefined : selectedListId;
    onQuickAddTask(
      parsed.title,
      targetList,
      parsed.priority ?? quickPriority,
      quickProjectId || undefined,
      parsed.dueDate,
      quickRecurrence,
      parsed.durationMinutes
    );
    setQuickTitle('');
    setQuickRecurrence('none');
  };

  const quickRescheduleDate = (offsetDays: number) => localOffsetToDueIso(offsetDays);

  return (
    <>
        {/* Google Tasks List */}
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Google Tasks ({openTasks.length} open)
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {templates.length > 0 && onApplyTemplate && (
                <select
                  value=""
                  onChange={(e) => {
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) onApplyTemplate(tpl);
                  }}
                  className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-300"
                  title="Create a task from a saved template"
                >
                  <option value="" disabled>
                    + Template ({templates.length})
                  </option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                      {tpl.durationMinutes ? ` (${tpl.durationMinutes}m)` : ''}
                      {tpl.recurrence && tpl.recurrence !== 'none'
                        ? ` ↻ ${tpl.recurrence}`
                        : ''}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setSortTasksByPriority((s) => !s)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition ${
                  sortTasksByPriority
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                    : 'border-surface-600 text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowUpDown className="w-3 h-3" />
                {sortTasksByPriority ? 'Sorted: P1→P5' : 'Sort Priority'}
              </button>
              <button
                onClick={onSyncGoogleTasks}
                disabled={syncingTasks}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-300 transition"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${syncingTasks ? 'animate-spin' : ''}`}
                />
                Sync All Lists
              </button>
            </div>
          </div>

          {taskLists.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3">
              <button
                onClick={() => setSelectedListId('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  selectedListId === 'all'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'bg-surface-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                All Lists
              </button>
              {taskLists.map((list) => (
                <button
                  key={list.id}
                  onClick={() => setSelectedListId(list.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                    selectedListId === list.id
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                      : 'bg-surface-900/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {list.title}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleQuickAdd} className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="Add a task (syncs to Google Tasks)..."
              className="flex-1 min-w-[180px] rounded-xl bg-surface-900 border border-surface-600 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <select
              value={quickPriority}
              onChange={(e) =>
                setQuickPriority(Number(e.target.value) as Priority)
              }
              className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
              title="Priority (1 = Highest, 5 = Lowest)"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {projects.length > 0 && (
              <select
                value={quickProjectId}
                onChange={(e) => setQuickProjectId(e.target.value)}
                className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
              >
                <option value="">No Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={quickRecurrence}
              onChange={(e) =>
                setQuickRecurrence(e.target.value as RecurrenceRule)
              }
              className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
              title="Repeat schedule"
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-surface-700 hover:bg-surface-600 text-slate-200 text-sm font-medium flex items-center gap-1 transition"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </form>

          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
            {parentCompletionPrompt && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                <span className="truncate">
                  All subtasks of <strong>{parentCompletionPrompt.parentTitle}</strong> are done. Complete parent?
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      onToggleTask(parentCompletionPrompt.parentId);
                      onDismissParentCompletionPrompt?.();
                    }}
                    className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => onDismissParentCompletionPrompt?.()}
                    className="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 text-slate-300"
                  >
                    Keep open
                  </button>
                </div>
              </div>
            )}
            {treeNodes.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">
                No tasks found. Add one above or sync your Google Tasks.
              </p>
            )}
            {treeNodes.map(({ task, depth, hasChildren, childCount, openChildCount }) => {
              const linkedEvent = task.linkedEventId
                ? eventMap.get(task.linkedEventId)
                : undefined;
              const effectiveProjId = getEffectiveProjectId(tasks, task);
              const proj = effectiveProjId ? projectMap.get(effectiveProjId) : undefined;
              const effectiveDue = getEffectiveDueDate(tasks, task);
              const effEst = getEffectiveEstimatedPomodoros(tasks, task.id);
              const effDone = getEffectiveCompletedPomodoros(tasks, task.id);
              const pMeta = getPriorityMeta(task.priority);
              const isExpanded = expandedTreeIds.has(task.id);
              const dropValid =
                draggedTaskId && dropTargetId === task.id
                  ? canReparentTask(tasks, draggedTaskId, task.id).ok
                  : null;
              const isActive =
                (timer.activeTarget?.type === 'task' &&
                  timer.activeTarget.id === task.id) ||
                (linkedEvent &&
                  timer.activeTarget?.type === 'event' &&
                  timer.activeTarget.id === linkedEvent.id);

              return (
                <div
                  key={task.id}
                  draggable={Boolean(onMoveTask)}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDraggedTaskId(task.id);
                  }}
                  onDragEnd={() => {
                    setDraggedTaskId(null);
                    setDropTargetId(null);
                  }}
                  onDragOver={(e) => {
                    if (!draggedTaskId || draggedTaskId === task.id) return;
                    e.preventDefault();
                    if (dropTargetId !== task.id) setDropTargetId(task.id);
                  }}
                  onDragLeave={() => {
                    if (dropTargetId === task.id) setDropTargetId(null);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const src = draggedTaskId;
                    setDraggedTaskId(null);
                    setDropTargetId(null);
                    if (src && src !== task.id && onMoveTask) {
                      const moved = await onMoveTask(src, task.id);
                      if (moved) {
                        setExpandedTreeIds((prev) => new Set(prev).add(task.id));
                      }
                    }
                  }}
                  style={{ marginLeft: depth * 18 }}
                  className={`group p-3 rounded-xl border transition ${
                    dropValid === true
                      ? 'bg-indigo-500/15 border-indigo-400 ring-2 ring-indigo-400/50'
                      : dropValid === false
                      ? 'bg-rose-500/10 border-rose-500/50'
                      : isActive
                      ? 'bg-indigo-500/10 border-indigo-500/50'
                      : 'bg-surface-900/60 border-surface-700/80 hover:border-surface-600'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {hasChildren ? (
                      <button
                        onClick={() => toggleTreeExpand(task.id)}
                        className="text-slate-400 hover:text-slate-200 p-0.5 rounded flex-shrink-0"
                        title={isExpanded ? 'Collapse children' : `Expand (${childCount})`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <span className="w-5 flex-shrink-0" />
                    )}
                    <button
                      onClick={() => onToggleTask(task.id)}
                      className="text-slate-400 hover:text-indigo-400 flex-shrink-0"
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p
                        onClick={() => onSelectTask?.(task)}
                        className={`text-sm font-medium truncate ${
                          onSelectTask ? 'cursor-pointer hover:text-indigo-300' : ''
                        } ${
                          task.completed
                            ? 'line-through text-slate-500'
                            : 'text-slate-100'
                        }`}
                      >
                        {task.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {/* Inline Priority Picker (1-5) */}
                        <select
                          value={task.priority ?? 3}
                          onChange={(e) =>
                            onSetTaskMetadata(task.id, {
                              priority: Number(e.target.value) as Priority,
                            })
                          }
                          className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-semibold ${pMeta.badgeClass}`}
                        >
                          {PRIORITIES.map((p) => (
                            <option
                              key={p.value}
                              value={p.value}
                              className="bg-surface-900 text-slate-100"
                            >
                              {p.short}
                            </option>
                          ))}
                        </select>

                        {proj && (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: `${proj.color}22`,
                              color: proj.color,
                            }}
                          >
                            {proj.name}
                          </span>
                        )}

                        {task.googleTaskListTitle && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300">
                            {task.googleTaskListTitle}
                          </span>
                        )}

                        {effectiveDue && (
                          <span className="text-[11px] text-slate-400">
                            Due {toDateInputValue(effectiveDue)}
                            {!task.dueDate && ' (inherited)'}
                          </span>
                        )}
                        {(hasChildren || effDone > 0 || effEst > 1) && (
                          <span
                            className="text-[11px] px-1.5 py-0.5 rounded bg-surface-800 text-slate-300"
                            title="Completed / effective estimated pomodoros"
                          >
                            🍅 {effDone}/{effEst}
                            {hasChildren ? ` · ${openChildCount}/${childCount} open` : ''}
                          </span>
                        )}

                        <select
                          value={task.recurrence ?? 'none'}
                          onChange={(e) =>
                            onSetTaskMetadata(task.id, {
                              recurrence: e.target.value as RecurrenceRule,
                            })
                          }
                          className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-medium ${
                            task.recurrence && task.recurrence !== 'none'
                              ? 'border-violet-500/40 text-violet-300'
                              : 'border-surface-600 text-slate-400'
                          }`}
                          title="Recurrence rule"
                        >
                          {RECURRENCE_OPTIONS.map((opt) => (
                            <option
                              key={opt.value}
                              value={opt.value}
                              className="bg-surface-900 text-slate-100"
                            >
                              {opt.value === 'none' ? 'Once' : `↻ ${opt.label}`}
                            </option>
                          ))}
                        </select>

                        {task.noteLink && (
                          <button
                            type="button"
                            onClick={() =>
                              window.electronAPI?.openExternalUrl(task.noteLink!)
                            }
                            className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/15 hover:bg-violet-500/30 border border-violet-500/30 text-violet-300 flex items-center gap-1 transition"
                            title={`Open linked note: ${task.noteLink}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            {task.noteLink.startsWith('zotero://')
                              ? 'Zotero'
                              : task.noteLink.startsWith('obsidian://') ||
                                  task.noteLink.endsWith('.md')
                                ? 'Obsidian'
                                : 'Note Link'}
                          </button>
                        )}

                        {onAddSubtask && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedSubtaskId(
                                expandedSubtaskId === task.id ? null : task.id
                              );
                              setSubtaskDraft('');
                            }}
                            className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 transition ${
                              (task.subtasks?.length ?? 0) > 0
                                ? 'bg-cyan-500/15 text-cyan-300'
                                : 'bg-surface-700/70 text-slate-400 hover:text-slate-200'
                            }`}
                            title="Expand subtasks checklist"
                          >
                            {expandedSubtaskId === task.id ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            <ListChecks className="w-3 h-3" />
                            {task.subtasks && task.subtasks.length > 0
                              ? `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`
                              : 'Subtasks'}
                          </button>
                        )}

                        <select
                          value={task.durationMinutes ?? ''}
                          onChange={(e) =>
                            onSetTaskMetadata(task.id, {
                              durationMinutes: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            })
                          }
                          className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-medium ${
                            task.durationMinutes ||
                            getEventDurationMinutes(linkedEvent)
                              ? 'border-indigo-500/40 text-indigo-300'
                              : 'border-surface-600 text-slate-400'
                          }`}
                          title="Estimated focus duration (used by Plan Day & Time-Block)"
                        >
                          <option value="" className="bg-surface-900 text-slate-100">
                            {getEventDurationMinutes(linkedEvent)
                              ? `⏱ ${getEventDurationMinutes(linkedEvent)}m`
                              : '⏱ Auto'}
                          </option>
                          {[15, 25, 30, 45, 60, 90].map((m) => (
                            <option
                              key={m}
                              value={m}
                              className="bg-surface-900 text-slate-100"
                            >
                              {m}m
                            </option>
                          ))}
                        </select>

                        {linkedEvent && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
                            <Link2 className="w-3 h-3" />
                            {linkedEvent.isAllDay
                              ? 'Linked (All day)'
                              : `Linked ${formatTime(linkedEvent.start)}`}
                          </span>
                        )}

                        {(() => {
                          const incompleteDeps = (task.blockedByTaskIds ?? [])
                            .map((id) => taskMap.get(id))
                            .filter((d): d is TaskItem => Boolean(d && !d.completed));
                          if (incompleteDeps.length === 0) return null;
                          return (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1"
                              title={`Blocked by: ${incompleteDeps.map((d) => d.title).join(', ')}`}
                            >
                              <Lock className="w-3 h-3" />
                              Blocked ({incompleteDeps.length})
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {!task.completed && (
                      <div className="flex items-center gap-1">
                        {depth + 1 < MAX_TREE_DEPTH && (
                          <button
                            onClick={() => {
                              setAddingChildOfId(addingChildOfId === task.id ? null : task.id);
                              setChildDraftTitle('');
                            }}
                            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs"
                            title="Add nested child task"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {task.parentId && onMoveTask && (
                          <button
                            onClick={() => onMoveTask(task.id, null)}
                            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs"
                            title="Detach from parent to root"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setRescheduleTaskId(
                              rescheduleTaskId === task.id ? null : task.id
                            )
                          }
                          className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs"
                          title="Reschedule task"
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                        </button>
                        {linkedEvent ? (
                          <button
                            onClick={() => onLinkTaskToEvent(task.id, null)}
                            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-emerald-300 text-xs"
                            title="Unlink Calendar Event"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setLinkingTaskId(
                                linkingTaskId === task.id ? null : task.id
                              )
                            }
                            className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs"
                            title="Link to Calendar Event"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => onTimeBlockTask(task)}
                          className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs"
                          title="Time-block onto Google Calendar"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            onStartFocus(
                              {
                                type: 'task',
                                id: task.id,
                                title: task.title,
                                projectId: task.projectId,
                                calendarEventId: linkedEvent?.id,
                                durationMinutes:
                                  task.durationMinutes ??
                                  getEventDurationMinutes(linkedEvent),
                              },
                              timer.mode === 'stopwatch'
                            )
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
                        >
                          <Play className="w-3 h-3" />{' '}
                          {timer.mode === 'stopwatch' ? 'Stopwatch' : 'Focus'}
                        </button>
                        {onSaveAsTemplate && (
                          <button
                            onClick={() => onSaveAsTemplate(task)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 transition"
                            title="Save task & subtasks as a reusable template"
                          >
                            <BookmarkPlus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => onDeleteTask(task)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 transition flex-shrink-0"
                      title="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Add Nested Child Task Row */}
                  {addingChildOfId === task.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = childDraftTitle.trim();
                        if (!trimmed) return;
                        onQuickAddTask(
                          trimmed,
                          task.googleTaskListId,
                          task.priority ?? 3,
                          undefined,
                          undefined,
                          undefined,
                          undefined,
                          task.id
                        );
                        setChildDraftTitle('');
                        setAddingChildOfId(null);
                        setExpandedTreeIds((prev) => new Set(prev).add(task.id));
                      }}
                      className="mt-2 pt-2 border-t border-surface-700 flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={childDraftTitle}
                        onChange={(e) => setChildDraftTitle(e.target.value)}
                        placeholder={`New child under "${task.title}"...`}
                        className="flex-1 bg-surface-900 border border-surface-600 rounded-lg px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium"
                      >
                        Add child
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingChildOfId(null)}
                        className="p-1 text-slate-400 hover:text-slate-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}

                  {/* Reschedule Task Row */}
                  {rescheduleTaskId === task.id && (
                    <div className="mt-2 pt-2 border-t border-surface-700 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-400">
                        Reschedule:
                      </span>
                      <button
                        onClick={() => {
                          onRescheduleTask(task, quickRescheduleDate(0));
                          setRescheduleTaskId(null);
                        }}
                        className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-xs text-slate-200"
                      >
                        Today
                      </button>
                      <button
                        onClick={() => {
                          onRescheduleTask(task, quickRescheduleDate(1));
                          setRescheduleTaskId(null);
                        }}
                        className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-xs text-slate-200"
                      >
                        Tomorrow
                      </button>
                      <button
                        onClick={() => {
                          onRescheduleTask(task, quickRescheduleDate(7));
                          setRescheduleTaskId(null);
                        }}
                        className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-xs text-slate-200"
                      >
                        +7 days
                      </button>
                      <input
                        type="date"
                        value={toDateInputValue(task.dueDate)}
                        onChange={(e) => {
                          if (e.target.value) {
                            onRescheduleTask(
                              task,
                              new Date(`${e.target.value}T00:00:00.000Z`).toISOString()
                            );
                            setRescheduleTaskId(null);
                          }
                        }}
                        className="rounded bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                      />
                    </div>
                  )}

                  {/* Manual Link Selector */}
                  {linkingTaskId === task.id && (
                    <div className="mt-2 pt-2 border-t border-surface-700 flex items-center gap-2">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            onLinkTaskToEvent(task.id, e.target.value);
                            setLinkingTaskId(null);
                          }
                        }}
                        className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-xs text-slate-200"
                      >
                        <option value="" disabled>
                          Select a Calendar event to link...
                        </option>
                        {events.map((evt) => (
                          <option key={evt.id} value={evt.id}>
                            {evt.isAllDay
                              ? '[All day]'
                              : formatTime(evt.start)}{' '}
                            — {evt.summary}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setLinkingTaskId(null)}
                        className="text-xs text-slate-400 hover:text-slate-200 px-2"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Subtasks Checklist Drawer */}
                  {expandedSubtaskId === task.id && onAddSubtask && (
                    <div className="mt-2 pt-2 border-t border-surface-700 space-y-1.5">
                      {(task.subtasks ?? []).map((st) => (
                        <div
                          key={st.id}
                          className="flex items-center justify-between gap-2 pl-2 pr-1 py-1 rounded-lg bg-surface-800/70"
                        >
                          <button
                            type="button"
                            onClick={() => onToggleSubtask?.(task.id, st.id)}
                            className="flex items-center gap-2 min-w-0 text-left flex-1"
                          >
                            {st.done ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Circle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            )}
                            <span
                              className={`text-xs truncate ${
                                st.done
                                  ? 'line-through text-slate-500'
                                  : 'text-slate-200'
                              }`}
                            >
                              {st.title}
                            </span>
                          </button>
                          {onDeleteSubtask && (
                            <button
                              type="button"
                              onClick={() => onDeleteSubtask(task.id, st.id)}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Remove subtask"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!subtaskDraft.trim()) return;
                          onAddSubtask(task.id, subtaskDraft.trim());
                          setSubtaskDraft('');
                        }}
                        className="flex items-center gap-1.5 pt-0.5"
                      >
                        <input
                          type="text"
                          value={subtaskDraft}
                          onChange={(e) => setSubtaskDraft(e.target.value)}
                          placeholder="Add a subtask step..."
                          className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1 text-xs text-slate-100 placeholder-slate-500"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200"
                        >
                          Add
                        </button>
                      </form>
                      <div className="pt-1.5 border-t border-surface-700/60 flex items-center gap-2">
                        <ExternalLink className="w-3 h-3 text-violet-400 shrink-0" />
                        <input
                          type="text"
                          defaultValue={task.noteLink ?? ''}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if ((val || undefined) !== (task.noteLink || undefined)) {
                              onSetTaskMetadata(task.id, {
                                noteLink: val || undefined,
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="Obsidian note (Projects/Spec.md or obsidian://...) or Zotero URI"
                          className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1 text-[11px] text-slate-200 placeholder-slate-500"
                        />
                      </div>

                      {/* Prerequisite Dependencies */}
                      {tasks.some((other) => other.id !== task.id && !other.completed) && (
                        <div className="pt-1.5 space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> Prerequisites (Blocked By):
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {tasks
                              .filter((other) => other.id !== task.id && !other.completed)
                              .slice(0, 10)
                              .map((other) => {
                                const isDep = (task.blockedByTaskIds ?? []).includes(other.id);
                                return (
                                  <button
                                    key={other.id}
                                    type="button"
                                    onClick={() => {
                                      const cur = task.blockedByTaskIds ?? [];
                                      const next = isDep
                                        ? cur.filter((id) => id !== other.id)
                                        : [...cur, other.id];
                                      onSetTaskMetadata(task.id, {
                                        blockedByTaskIds: next,
                                      });
                                    }}
                                    className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                                      isDep
                                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                                        : 'bg-surface-900 border-surface-600 text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    {other.title}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
    </>
  );
};
