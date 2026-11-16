import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FolderKanban,
  Link2,
  ListPlus,
  Lock,
  Pencil,
  Play,
  Plus,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import type {
  CalendarEvent,
  EventMetadata,
  PomodoroSession,
  Priority,
  Project,
  ProjectList,
  TaskItem,
  TimerState,
} from '../types';
import { getPriorityMeta, PRIORITIES } from '../utils/priority';
import {
  canReparentTask,
  flattenTaskTree,
  getEffectiveCompletedPomodoros,
  getEffectiveEstimatedPomodoros,
  getEffectiveProjectId,
} from '../utils/taskTree';
import { extractYmd, formatTime, toLocalYmd } from '../utils/time';
import { TaskEventDetailModal, type DetailModalTarget } from './TaskEventDetailModal';

interface ProjectsViewProps {
  projects: Project[];
  tasks: TaskItem[];
  events?: CalendarEvent[];
  eventMetadata?: Record<string, EventMetadata>;
  sessions?: PomodoroSession[];
  fetchEventsForRange?: (timeMin: string, timeMax: string) => Promise<CalendarEvent[]>;
  onSaveProjects: (projects: Project[]) => void;
  onSaveTasks: (tasks: TaskItem[]) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask?: (task: TaskItem) => void;
  onMoveTask?: (taskId: string, newParentId?: string | null) => Promise<boolean>;
  onSetTaskMetadata?: (
    taskId: string,
    meta: { priority?: Priority; projectId?: string; projectListId?: string }
  ) => void;
  onSetEventMetadata?: (eventId: string, meta: EventMetadata) => void;
  onLinkTaskToEvent?: (taskId: string, eventId: string | null) => void;
  onCreateEvent?: (payload: {
    summary: string;
    startIso: string;
    endIso: string;
    priority: Priority;
    projectId?: string;
    projectListId?: string;
  }) => Promise<void>;
  onStartFocus: (target: TimerState['activeTarget']) => void;
}

const PROJECT_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#38bdf8',
  '#8b5cf6',
  '#f43f5e',
];

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  tasks,
  events = [],
  eventMetadata = {},
  sessions = [],
  fetchEventsForRange,
  onSaveProjects,
  onSaveTasks,
  onToggleTask,
  onDeleteTask,
  onMoveTask,
  onSetTaskMetadata,
  onSetEventMetadata,
  onLinkTaskToEvent,
  onCreateEvent,
  onStartFocus,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id || ''
  );
  const [newProjectName, setNewProjectName] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>(3);
  const [newTaskPomos, setNewTaskPomos] = useState(1);
  const [newTaskDuration, setNewTaskDuration] = useState<number | ''>('');
  const [newMilestone, setNewMilestone] = useState('');

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [rangeEvents, setRangeEvents] = useState<CalendarEvent[]>(events);
  const [sublistParentId, setSublistParentId] = useState<string | null>(null);
  const [sublistTitle, setSublistTitle] = useState('');
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [renameListTitle, setRenameListTitle] = useState('');
  const [collapsedMilestones, setCollapsedMilestones] = useState<Set<string>>(() => new Set());
  const [detailTarget, setDetailTarget] = useState<DetailModalTarget | null>(null);
  const [addingEntryListId, setAddingEntryListId] = useState<string | null>(null);
  const [entryKind, setEntryKind] = useState<'task' | 'event'>('task');
  const [entryTitle, setEntryTitle] = useState('');
  const [entryPriority, setEntryPriority] = useState<Priority>(3);
  const [entryDate, setEntryDate] = useState(() => toLocalYmd(new Date()));
  const [entryStart, setEntryStart] = useState('10:00');
  const [entryEnd, setEntryEnd] = useState('11:00');
  const [linkingTaskId, setLinkingTaskId] = useState<string | null>(null);

  useEffect(() => {
    setRangeEvents(events);
  }, [events]);

  useEffect(() => {
    if (!fetchEventsForRange) return;
    const now = new Date();
    const min = new Date(now);
    min.setDate(min.getDate() - 30);
    const max = new Date(now);
    max.setDate(max.getDate() + 90);
    fetchEventsForRange(min.toISOString(), max.toISOString())
      .then((evts) => {
        if (evts.length > 0) setRangeEvents(evts);
      })
      .catch(() => {});
  }, [fetchEventsForRange, selectedProjectId]);
  const [editColor, setEditColor] = useState(PROJECT_COLORS[0]);
  const [gatingMilestoneId, setGatingMilestoneId] = useState<string | null>(null);

  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0] || null;

  const focusMinutesByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (
        (s.mode === 'focus' || s.mode === 'stopwatch') &&
        s.projectId
      ) {
        map.set(s.projectId, (map.get(s.projectId) ?? 0) + s.durationMinutes);
      }
    }
    return map;
  }, [sessions]);

  const projectTasks = activeProject
    ? tasks
        .filter((t) => getEffectiveProjectId(tasks, t) === activeProject.id)
        .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
    : [];

  const projectTreeNodes = useMemo(
    () => flattenTaskTree(projectTasks, expandedIds, tasks),
    [expandedIds, projectTasks, tasks]
  );

  const enrichedEvents = useMemo(
    () =>
      rangeEvents.map((e) => {
        const meta = eventMetadata[e.id];
        const linkedTask = tasks.find(
          (t) => t.linkedEventId === e.id || t.calendarEventId === e.id
        );
        return {
          ...e,
          linkedTaskId: linkedTask?.id ?? e.linkedTaskId,
          priority: meta?.priority ?? e.priority ?? linkedTask?.priority,
          projectId: meta?.projectId ?? e.projectId ?? linkedTask?.projectId,
          projectListId: meta?.projectListId ?? e.projectListId ?? linkedTask?.projectListId,
        };
      }),
    [eventMetadata, rangeEvents, tasks]
  );

  const projectEvents = useMemo(
    () =>
      activeProject
        ? enrichedEvents
            .filter((e) => e.projectId === activeProject.id)
            .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
        : [],
    [activeProject, enrichedEvents]
  );

  type MilestoneNode = Project['milestones'][number];

  const unifiedMilestones = useMemo<MilestoneNode[]>(() => {
    if (!activeProject) return [];
    const base = [...activeProject.milestones];
    const seen = new Set(base.map((m) => m.id));
    for (const l of activeProject.lists ?? []) {
      if (!seen.has(l.id)) {
        seen.add(l.id);
        base.push({
          id: l.id,
          title: l.title,
          done: false,
          parentId: l.parentListId,
        });
      }
    }
    return base;
  }, [activeProject]);

  const flattenedMilestones = useMemo(() => {
    const byParent = new Map<string | undefined, MilestoneNode[]>();
    for (const m of unifiedMilestones) {
      const pid = m.parentId && unifiedMilestones.some((x) => x.id === m.parentId) ? m.parentId : undefined;
      const arr = byParent.get(pid) ?? [];
      arr.push(m);
      byParent.set(pid, arr);
    }
    const out: { milestone: MilestoneNode; depth: number; hasChildren: boolean }[] = [];
    const walk = (pid: string | undefined, depth: number) => {
      for (const m of byParent.get(pid) ?? []) {
        const kids = byParent.get(m.id) ?? [];
        out.push({ milestone: m, depth, hasChildren: kids.length > 0 });
        if (kids.length > 0 && !collapsedMilestones.has(m.id)) {
          walk(m.id, depth + 1);
        }
      }
    };
    walk(undefined, 0);
    return out;
  }, [unifiedMilestones, collapsedMilestones]);

  const handleRenameMilestone = (milestoneId: string) => {
    if (!activeProject || !renameListTitle.trim()) {
      setRenamingListId(null);
      return;
    }
    const nextTitle = renameListTitle.trim();
    onSaveProjects(
      projects.map((p) => {
        if (p.id !== activeProject.id) return p;
        const inMilestones = p.milestones.some((m) => m.id === milestoneId);
        return {
          ...p,
          milestones: inMilestones
            ? p.milestones.map((m) => (m.id === milestoneId ? { ...m, title: nextTitle } : m))
            : [
                ...p.milestones,
                { id: milestoneId, title: nextTitle, done: false },
              ],
          lists: (p.lists ?? []).map((l) =>
            l.id === milestoneId ? { ...l, title: nextTitle } : l
          ),
        };
      })
    );
    setRenamingListId(null);
  };

  const handleAddEntryToMilestone = async (e: React.FormEvent, milestoneId: string) => {
    e.preventDefault();
    if (!activeProject || !entryTitle.trim()) return;
    if (entryKind === 'task') {
      const created: TaskItem = {
        id: `task-${Date.now()}`,
        title: entryTitle.trim(),
        projectId: activeProject.id,
        projectListId: milestoneId,
        priority: entryPriority,
        completed: false,
        estimatedPomodoros: 1,
        completedPomodoros: 0,
        createdAt: new Date().toISOString(),
      };
      onSaveTasks([created, ...tasks]);
    } else if (onCreateEvent) {
      const startIso = new Date(`${entryDate}T${entryStart}:00`).toISOString();
      const endIso = new Date(`${entryDate}T${entryEnd}:00`).toISOString();
      await onCreateEvent({
        summary: entryTitle.trim(),
        startIso,
        endIso,
        priority: entryPriority,
        projectId: activeProject.id,
        projectListId: milestoneId,
      });
    }
    setEntryTitle('');
    setAddingEntryListId(null);
  };

  const handleAddProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    const created: Project = {
      id: `proj-${Date.now()}`,
      name: newProjectName.trim(),
      color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
      milestones: [],
      createdAt: new Date().toISOString(),
    };
    onSaveProjects([...projects, created]);
    setSelectedProjectId(created.id);
    setNewProjectName('');
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !activeProject) return;
    const created: TaskItem = {
      id: `task-${Date.now()}`,
      title: newTaskTitle.trim(),
      projectId: activeProject.id,
      priority: newTaskPriority,
      completed: false,
      estimatedPomodoros: newTaskPomos,
      completedPomodoros: 0,
      durationMinutes: newTaskDuration ? Number(newTaskDuration) : undefined,
      createdAt: new Date().toISOString(),
    };
    onSaveTasks([created, ...tasks]);
    setNewTaskTitle('');
    setNewTaskDuration('');
  };

  const handleAddMilestone = (e: React.FormEvent, parentId?: string) => {
    e.preventDefault();
    const title = (parentId ? sublistTitle : newMilestone).trim();
    if (!title || !activeProject) return;
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: [
              ...p.milestones,
              {
                id: `m-${Date.now()}`,
                title,
                done: false,
                ...(parentId ? { parentId } : {}),
              },
            ],
          }
        : p
    );
    onSaveProjects(updated);
    if (parentId) {
      setCollapsedMilestones((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      setSublistParentId(null);
      setSublistTitle('');
    } else {
      setNewMilestone('');
    }
  };

  const toggleMilestone = (milestoneId: string) => {
    if (!activeProject) return;
    const ms = activeProject.milestones.find((m) => m.id === milestoneId);
    if (ms?.requiredTaskIds && ms.requiredTaskIds.length > 0) {
      return; // Gated on task completion
    }
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: p.milestones.map((m) =>
              m.id === milestoneId ? { ...m, done: !m.done } : m
            ),
          }
        : p
    );
    onSaveProjects(updated);
  };

  const toggleMilestoneGateTask = (milestoneId: string, taskId: string) => {
    if (!activeProject) return;
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: p.milestones.map((m) => {
              if (m.id !== milestoneId) return m;
              const existing = m.requiredTaskIds ?? [];
              const next = existing.includes(taskId)
                ? existing.filter((id) => id !== taskId)
                : [...existing, taskId];
              return { ...m, requiredTaskIds: next };
            }),
          }
        : p
    );
    onSaveProjects(updated);
  };

  const deleteMilestone = (milestoneId: string) => {
    if (!activeProject) return;
    const target = unifiedMilestones.find((m) => m.id === milestoneId);
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: p.milestones
              .filter((m) => m.id !== milestoneId)
              .map((m) =>
                m.parentId === milestoneId ? { ...m, parentId: target?.parentId } : m
              ),
            lists: (p.lists ?? [])
              .filter((l) => l.id !== milestoneId)
              .map((l) =>
                l.parentListId === milestoneId ? { ...l, parentListId: target?.parentId } : l
              ),
          }
        : p
    );
    onSaveProjects(updated);
    if (tasks.some((t) => t.projectListId === milestoneId)) {
      onSaveTasks(
        tasks.map((t) => (t.projectListId === milestoneId ? { ...t, projectListId: undefined } : t))
      );
    }
  };

  const startEditingProject = (p: Project) => {
    setEditingProjectId(p.id);
    setEditName(p.name);
    setEditDesc(p.description ?? '');
    setEditColor(p.color);
  };

  const saveEditedProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !editName.trim()) return;
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            name: editName.trim(),
            description: editDesc.trim() || undefined,
            color: editColor,
          }
        : p
    );
    onSaveProjects(updated);
    setEditingProjectId(null);
  };

  const updateProjectTaskDuration = (taskId: string, mins?: number) => {
    onSaveTasks(
      tasks.map((t) =>
        t.id === taskId ? { ...t, durationMinutes: mins } : t
      )
    );
  };

  const deleteProject = (id: string) => {
    const remaining = projects.filter((p) => p.id !== id);
    onSaveProjects(remaining);
    if (selectedProjectId === id) {
      setSelectedProjectId(remaining[0]?.id || '');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Sidebar: Projects List */}
      <div className="lg:col-span-4 rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
        <div className="flex items-center gap-2 mb-4">
          <FolderKanban className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-200">Projects</h3>
        </div>

        <form onSubmit={handleAddProject} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project name..."
            className="flex-1 rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>

        <div className="space-y-2">
          {projects.map((p) => {
            const count = tasks.filter(
              (t) => t.projectId === p.id && !t.completed
            ).length;
            const projMins = focusMinutesByProject.get(p.id) ?? 0;
            const selected = activeProject?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`flex items-center justify-between p-3 rounded-xl cursor-pointer border transition ${
                  selected
                    ? 'bg-surface-700 border-indigo-500/50'
                    : 'bg-surface-900/60 border-surface-700/70 hover:border-surface-600'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-slate-100 truncate">
                      {p.name}
                    </span>
                    {projMins > 0 && (
                      <span className="text-[10px] text-indigo-300">
                        {Math.floor(projMins / 60)}h {projMins % 60}m logged
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{count} open</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(p.id);
                    }}
                    className="text-slate-500 hover:text-rose-400 p-1"
                    title="Delete project"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Project Detail */}
      <div className="lg:col-span-8 space-y-6">
        {!activeProject ? (
          <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-10 text-center text-slate-400">
            Create a project on the left to organize tasks and milestones.
          </div>
        ) : (
          <>
            {/* Milestones */}
            <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: activeProject.color }}
                    />
                    <h2 className="text-base font-semibold text-slate-100">
                      {activeProject.name} — Milestones
                    </h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {focusMinutesByProject.get(activeProject.id) ?? 0}m logged
                    </span>
                  </div>
                  {activeProject.description && (
                    <p className="text-xs text-slate-400">
                      {activeProject.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    editingProjectId === activeProject.id
                      ? setEditingProjectId(null)
                      : startEditingProject(activeProject)
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-300 transition"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </div>

              {editingProjectId === activeProject.id && (
                <form
                  onSubmit={saveEditedProject}
                  className="mb-4 p-3 rounded-xl bg-surface-900/80 border border-surface-600 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Project name..."
                      className="flex-1 min-w-[160px] rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <div className="flex items-center gap-1.5">
                      {PROJECT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition ${
                            editColor === c
                              ? 'border-white scale-110'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Project description or goal..."
                    className="w-full rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingProjectId(null)}
                      className="px-2.5 py-1 rounded-lg bg-surface-700 text-xs text-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs text-white font-medium"
                    >
                      <Check className="w-3 h-3" /> Save
                    </button>
                  </div>
                </form>
              )}

              <form onSubmit={(e) => handleAddMilestone(e)} className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newMilestone}
                  onChange={(e) => setNewMilestone(e.target.value)}
                  placeholder="Add milestone / list..."
                  className="flex-1 rounded-xl bg-surface-900 border border-surface-600 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Milestone
                </button>
              </form>

              {flattenedMilestones.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  No milestones yet. Add a milestone above to organize sublists, tasks, and calendar events.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {flattenedMilestones.map(({ milestone: m, depth, hasChildren }) => {
                    const reqIds = m.requiredTaskIds ?? [];
                    const isGated = reqIds.length > 0;
                    const doneCount = reqIds.filter((tid) =>
                      tasks.find((t) => t.id === tid)?.completed
                    ).length;
                    const listTasks = projectTasks.filter((t) => t.projectListId === m.id);
                    const listEvents = projectEvents.filter((e) => e.projectListId === m.id);
                    const isExpanded = !collapsedMilestones.has(m.id);

                    return (
                      <div
                        key={m.id}
                        style={{ marginLeft: depth * 20 }}
                        className="rounded-xl bg-surface-900/60 border border-surface-700/80 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedMilestones((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(m.id)) next.delete(m.id);
                                    else next.add(m.id);
                                    return next;
                                  })
                                }
                                className="text-slate-400 hover:text-slate-200 shrink-0"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            ) : (
                              <span className="w-4 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() => toggleMilestone(m.id)}
                              disabled={isGated}
                              className={`shrink-0 ${
                                isGated ? 'cursor-not-allowed' : ''
                              }`}
                              title={
                                isGated
                                  ? `Auto-completed when all ${reqIds.length} linked task(s) finish`
                                  : 'Toggle milestone'
                              }
                            >
                              {m.done ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : isGated ? (
                                <Lock className="w-4 h-4 text-amber-400" />
                              ) : (
                                <Circle className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                            {renamingListId === m.id ? (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  handleRenameMilestone(m.id);
                                }}
                                className="flex items-center gap-1.5"
                              >
                                <input
                                  autoFocus
                                  value={renameListTitle}
                                  onChange={(e) => setRenameListTitle(e.target.value)}
                                  className="rounded bg-surface-800 border border-indigo-500 px-2 py-0.5 text-xs text-slate-100"
                                />
                                <button
                                  type="submit"
                                  className="text-xs px-2 py-0.5 rounded bg-indigo-500 text-white"
                                >
                                  Save
                                </button>
                              </form>
                            ) : (
                              <span
                                className={`text-sm font-semibold truncate ${
                                  m.done
                                    ? 'line-through text-slate-500'
                                    : 'text-slate-100'
                                }`}
                              >
                                {m.title}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {listTasks.length} tasks · {listEvents.length} events
                            </span>
                            {isGated && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                                Gated: {doneCount}/{reqIds.length} tasks
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {depth < 2 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSublistParentId(sublistParentId === m.id ? null : m.id);
                                  setSublistTitle('');
                                }}
                                className="px-2 py-1 rounded-lg bg-surface-800 hover:bg-surface-700 text-[11px] text-slate-300"
                              >
                                + Sublist
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setAddingEntryListId(addingEntryListId === m.id ? null : m.id);
                                setEntryKind('task');
                                setEntryTitle('');
                              }}
                              className="px-2 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-[11px] text-indigo-300 hover:text-white"
                            >
                              + Entry
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setGatingMilestoneId(
                                  gatingMilestoneId === m.id ? null : m.id
                                )
                              }
                              className={`px-2 py-1 rounded-lg text-[11px] flex items-center gap-1 transition ${
                                gatingMilestoneId === m.id || isGated
                                  ? 'bg-indigo-500/20 text-indigo-300'
                                  : 'bg-surface-800 text-slate-400 hover:text-slate-200'
                              }`}
                              title="Link tasks that must be completed for this milestone"
                            >
                              <Lock className="w-3 h-3" />
                              Gate
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingListId(m.id);
                                setRenameListTitle(m.title);
                              }}
                              className="p-1 text-slate-400 hover:text-slate-200"
                              title="Rename milestone"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteMilestone(m.id)}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Delete milestone"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {sublistParentId === m.id && (
                          <form
                            onSubmit={(e) => handleAddMilestone(e, m.id)}
                            className="flex items-center gap-2 pl-6"
                          >
                            <input
                              autoFocus
                              value={sublistTitle}
                              onChange={(e) => setSublistTitle(e.target.value)}
                              placeholder={`New sublist under "${m.title}"...`}
                              className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2.5 py-1 text-xs text-slate-100"
                            />
                            <button
                              type="submit"
                              className="px-2.5 py-1 rounded-lg bg-indigo-500 text-white text-xs"
                            >
                              Add Sublist
                            </button>
                          </form>
                        )}

                        {addingEntryListId === m.id && (
                          <form
                            onSubmit={(e) => handleAddEntryToMilestone(e, m.id)}
                            className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-surface-800 border border-surface-600"
                          >
                            <select
                              value={entryKind}
                              onChange={(e) => setEntryKind(e.target.value as 'task' | 'event')}
                              className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                            >
                              <option value="task">Task</option>
                              {onCreateEvent && <option value="event">Calendar Event</option>}
                            </select>
                            <input
                              autoFocus
                              value={entryTitle}
                              onChange={(e) => setEntryTitle(e.target.value)}
                              placeholder={
                                entryKind === 'task' ? 'Task title...' : 'Calendar event summary...'
                              }
                              className="flex-1 min-w-[160px] rounded-lg bg-surface-900 border border-surface-600 px-2.5 py-1 text-xs text-slate-100"
                            />
                            <select
                              value={entryPriority}
                              onChange={(e) => setEntryPriority(Number(e.target.value) as Priority)}
                              className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                            >
                              {PRIORITIES.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.short}
                                </option>
                              ))}
                            </select>
                            {entryKind === 'event' && (
                              <>
                                <input
                                  type="date"
                                  value={entryDate}
                                  onChange={(e) => setEntryDate(e.target.value)}
                                  className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                                />
                                <input
                                  type="time"
                                  value={entryStart}
                                  onChange={(e) => setEntryStart(e.target.value)}
                                  className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                                />
                                <input
                                  type="time"
                                  value={entryEnd}
                                  onChange={(e) => setEntryEnd(e.target.value)}
                                  className="rounded-lg bg-surface-900 border border-surface-600 px-2 py-1 text-xs text-slate-200"
                                />
                              </>
                            )}
                            <button
                              type="submit"
                              className="px-3 py-1 rounded-lg bg-indigo-500 text-white text-xs font-medium"
                            >
                              Add
                            </button>
                          </form>
                        )}

                        {gatingMilestoneId === m.id && (
                          <div className="pl-6 pt-1 border-t border-surface-700/70 space-y-1">
                            <div className="text-[11px] text-slate-400">
                              Select project tasks required to unlock this milestone:
                            </div>
                            {projectTasks.length === 0 ? (
                              <div className="text-[11px] text-slate-500">
                                Add tasks to this project below first.
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {projectTasks.map((pt) => {
                                  const linked = reqIds.includes(pt.id);
                                  return (
                                    <button
                                      key={pt.id}
                                      type="button"
                                      onClick={() =>
                                        toggleMilestoneGateTask(m.id, pt.id)
                                      }
                                      className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                                        linked
                                          ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                                          : 'bg-surface-900 border-surface-600 text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      {pt.completed ? '✓ ' : ''}
                                      {pt.title}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {onSetEventMetadata && enrichedEvents.some((e) => e.projectListId !== m.id) && (
                          <div className="flex items-center gap-2 pl-6">
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                onSetEventMetadata(e.target.value, {
                                  ...(eventMetadata[e.target.value] ?? {}),
                                  projectId: activeProject.id,
                                  projectListId: m.id,
                                });
                              }}
                              className="rounded-lg bg-surface-800 border border-surface-700 px-2 py-1 text-[11px] text-slate-300"
                            >
                              <option value="">+ Assign existing calendar event to this milestone...</option>
                              {enrichedEvents
                                .filter((ev) => ev.projectListId !== m.id)
                                .map((ev) => (
                                  <option key={ev.id} value={ev.id}>
                                    {ev.isAllDay ? extractYmd(ev.start) : `${extractYmd(ev.start)} ${formatTime(ev.start)}`} · {ev.summary}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}

                        {(listEvents.length > 0 || listTasks.length > 0) && (
                          <div className="space-y-1.5 pl-4">
                            {listEvents.map((evt) => {
                              const pMeta = getPriorityMeta(evt.priority);
                              return (
                                <div
                                  key={evt.id}
                                  onClick={() => setDetailTarget({ kind: 'event', event: evt })}
                                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-800/80 border border-surface-700 hover:border-indigo-500/50 cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Calendar className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                    <span className="text-[11px] text-sky-300 shrink-0">
                                      {evt.isAllDay ? extractYmd(evt.start) : `${extractYmd(evt.start).slice(5)} ${formatTime(evt.start)}`}
                                    </span>
                                    <span className="text-xs font-medium text-slate-100 truncate">
                                      {evt.summary}
                                    </span>
                                    {evt.linkedTaskId && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1 shrink-0">
                                        <Link2 className="w-2.5 h-2.5" /> Linked
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    {onSetEventMetadata && (
                                      <select
                                        value={evt.priority ?? 3}
                                        onChange={(e) =>
                                          onSetEventMetadata(evt.id, {
                                            ...(eventMetadata[evt.id] ?? {}),
                                            projectId: activeProject.id,
                                            projectListId: m.id,
                                            priority: Number(e.target.value) as Priority,
                                          })
                                        }
                                        className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-semibold ${pMeta.badgeClass}`}
                                      >
                                        {PRIORITIES.map((p) => (
                                          <option key={p.value} value={p.value} className="bg-surface-900">
                                            {p.short}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    <button
                                      onClick={() =>
                                        onStartFocus({
                                          type: 'event',
                                          id: evt.id,
                                          title: evt.summary,
                                          calendarEventId: evt.id,
                                          projectId: activeProject.id,
                                        })
                                      }
                                      className="px-2 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[11px]"
                                    >
                                      Focus
                                    </button>
                                    {onSetEventMetadata && (
                                      <button
                                        onClick={() =>
                                          onSetEventMetadata(evt.id, {
                                            ...(eventMetadata[evt.id] ?? {}),
                                            projectListId: undefined,
                                          })
                                        }
                                        className="p-1 text-slate-500 hover:text-rose-400"
                                        title="Remove event from this milestone"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            {listTasks.map((t) => {
                              const pMeta = getPriorityMeta(t.priority);
                              return (
                                <div
                                  key={t.id}
                                  onClick={() => setDetailTarget({ kind: 'task', task: t })}
                                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-800/80 border border-surface-700 hover:border-indigo-500/50 cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleTask(t.id);
                                      }}
                                      className="text-slate-400 hover:text-indigo-400 shrink-0"
                                    >
                                      {t.completed ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                      ) : (
                                        <Circle className="w-4 h-4" />
                                      )}
                                    </button>
                                    <span
                                      className={`text-xs font-medium truncate ${
                                        t.completed ? 'line-through text-slate-500' : 'text-slate-100'
                                      }`}
                                    >
                                      {t.title}
                                    </span>
                                    {t.linkedEventId && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1 shrink-0">
                                        <Link2 className="w-2.5 h-2.5" /> Linked
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    {onSetTaskMetadata && (
                                      <select
                                        value={t.priority ?? 3}
                                        onChange={(e) =>
                                          onSetTaskMetadata(t.id, {
                                            priority: Number(e.target.value) as Priority,
                                          })
                                        }
                                        className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-semibold ${pMeta.badgeClass}`}
                                      >
                                        {PRIORITIES.map((p) => (
                                          <option key={p.value} value={p.value} className="bg-surface-900">
                                            {p.short}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {!t.completed && (
                                      <button
                                        onClick={() =>
                                          onStartFocus({
                                            type: 'task',
                                            id: t.id,
                                            title: t.title,
                                            projectId: activeProject.id,
                                            durationMinutes: t.durationMinutes,
                                          })
                                        }
                                        className="px-2 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[11px]"
                                      >
                                        Focus
                                      </button>
                                    )}
                                    {onDeleteTask && (
                                      <button
                                        onClick={() => onDeleteTask(t)}
                                        className="p-1 text-slate-500 hover:text-rose-400"
                                        title="Delete task"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Project Tasks & Calendar Events */}
            <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">
                Project Tasks
              </h3>

              <form
                onSubmit={handleAddTask}
                className="flex flex-wrap gap-2 mb-4"
              >
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add task to project..."
                  className="flex-1 min-w-[200px] rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <select
                  value={newTaskPriority}
                  onChange={(e) =>
                    setNewTaskPriority(Number(e.target.value) as Priority)
                  }
                  className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={newTaskPomos}
                  onChange={(e) =>
                    setNewTaskPomos(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-16 rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
                  title="Estimated Pomodoros"
                />
                <select
                  value={newTaskDuration}
                  onChange={(e) =>
                    setNewTaskDuration(e.target.value ? Number(e.target.value) : '')
                  }
                  className="rounded-xl bg-surface-900 border border-surface-600 px-2.5 py-2 text-xs text-slate-200"
                  title="Optional focus duration"
                >
                  <option value="">Auto duration</option>
                  {[15, 25, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m}m
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium"
                >
                  Add Task
                </button>
              </form>

              <div className="space-y-2">
                {projectTreeNodes.length === 0 && (
                  <p className="text-sm text-slate-500 py-4 text-center">
                    No tasks in this project yet.
                  </p>
                )}
                {projectTreeNodes.map(({ task, depth, hasChildren, childCount, openChildCount }) => {
                  const effEst = getEffectiveEstimatedPomodoros(tasks, task.id);
                  const effDone = getEffectiveCompletedPomodoros(tasks, task.id);
                  const isExpanded = expandedIds.has(task.id);
                  const dropValid =
                    draggedTaskId && dropTargetId === task.id
                      ? canReparentTask(tasks, draggedTaskId, task.id).ok
                      : null;

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
                          setExpandedIds((prev) => new Set(prev).add(task.id));
                        }
                      }
                    }}
                    style={{ marginLeft: depth * 18 }}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition ${
                      dropValid === true
                        ? 'bg-indigo-500/15 border-indigo-400 ring-2 ring-indigo-400/50'
                        : dropValid === false
                        ? 'bg-rose-500/10 border-rose-500/50'
                        : 'bg-surface-900/60 border-surface-700/80'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {hasChildren ? (
                        <button
                          onClick={() =>
                            setExpandedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(task.id)) next.delete(task.id);
                              else next.add(task.id);
                              return next;
                            })
                          }
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
                        className="text-slate-400 hover:text-indigo-400"
                      >
                        {task.completed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <Circle className="w-5 h-5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p
                          onClick={() => setDetailTarget({ kind: 'task', task })}
                          className={`text-sm font-medium truncate cursor-pointer hover:text-indigo-300 ${
                            task.completed
                              ? 'line-through text-slate-500'
                              : 'text-slate-100'
                          }`}
                        >
                          {task.title}
                        </p>
                        <span className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                          {onSetTaskMetadata ? (
                            <select
                              value={task.priority ?? 3}
                              onChange={(e) =>
                                onSetTaskMetadata(task.id, {
                                  priority: Number(e.target.value) as Priority,
                                })
                              }
                              className={`px-1.5 py-0.5 rounded border bg-transparent text-[10px] font-semibold ${getPriorityMeta(task.priority).badgeClass}`}
                            >
                              {PRIORITIES.map((p) => (
                                <option key={p.value} value={p.value} className="bg-surface-900 text-slate-100">
                                  {p.short}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${getPriorityMeta(task.priority).badgeClass}`}
                            >
                              {getPriorityMeta(task.priority).short}
                            </span>
                          )}
                          {effDone}/{effEst} pomos
                          {hasChildren ? ` (${openChildCount}/${childCount} open)` : ''}
                          {onSetTaskMetadata && unifiedMilestones.length > 0 && (
                            <select
                              value={task.projectListId ?? ''}
                              onChange={(e) =>
                                onSetTaskMetadata(task.id, {
                                  projectListId: e.target.value || undefined,
                                })
                              }
                              className="px-1.5 py-0.5 rounded border border-surface-600 bg-transparent text-[10px] text-slate-300"
                              title="Assign to milestone / sublist"
                            >
                              <option value="" className="bg-surface-900">No milestone</option>
                              {flattenedMilestones.map(({ milestone: m, depth }) => (
                                <option key={m.id} value={m.id} className="bg-surface-900">
                                  {'— '.repeat(depth)}{m.title}
                                </option>
                              ))}
                            </select>
                          )}
                          {task.linkedEventId && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1 text-[10px]">
                              <Link2 className="w-2.5 h-2.5" /> Event linked
                            </span>
                          )}
                          <select
                            value={task.durationMinutes ?? ''}
                            onChange={(e) =>
                              updateProjectTaskDuration(
                                task.id,
                                e.target.value ? Number(e.target.value) : undefined
                              )
                            }
                            className="px-1.5 py-0.5 rounded border border-surface-600 bg-transparent text-[10px] text-indigo-300"
                            title="Task focus duration"
                          >
                            <option value="" className="bg-surface-900">
                              Auto
                            </option>
                            {[15, 25, 30, 45, 60, 90].map((m) => (
                              <option key={m} value={m} className="bg-surface-900">
                                {m}m
                              </option>
                            ))}
                          </select>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {onLinkTaskToEvent && enrichedEvents.length > 0 && (
                        <button
                          onClick={() => setLinkingTaskId(linkingTaskId === task.id ? null : task.id)}
                          className={`p-1.5 rounded-lg text-xs ${
                            task.linkedEventId
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-surface-800 hover:bg-surface-700 text-slate-300'
                          }`}
                          title="Link to calendar event"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {task.parentId && onMoveTask && (
                        <button
                          onClick={() => onMoveTask(task.id, null)}
                          className="p-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-slate-300"
                          title="Detach from parent to root"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!task.completed && (
                        <button
                          onClick={() =>
                            onStartFocus({
                              type: 'task',
                              id: task.id,
                              title: task.title,
                              projectId: getEffectiveProjectId(tasks, task),
                              durationMinutes: task.durationMinutes,
                            })
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
                        >
                          <Play className="w-3 h-3" /> Focus
                        </button>
                      )}
                      {onDeleteTask && (
                        <button
                          onClick={() => onDeleteTask(task)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 transition"
                          title="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
                {linkingTaskId && onLinkTaskToEvent && (
                  <div className="p-3 rounded-xl bg-surface-900 border border-indigo-500/40 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-300">Link calendar event to task:</span>
                    <select
                      value={tasks.find((t) => t.id === linkingTaskId)?.linkedEventId ?? ''}
                      onChange={(e) => {
                        onLinkTaskToEvent(linkingTaskId, e.target.value || null);
                        setLinkingTaskId(null);
                      }}
                      className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-2 py-1 text-xs text-slate-100"
                    >
                      <option value="">No linked event (unlink)</option>
                      {enrichedEvents.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.isAllDay ? extractYmd(ev.start) : `${extractYmd(ev.start)} ${formatTime(ev.start)}`} · {ev.summary}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setLinkingTaskId(null)}
                      className="px-2 py-1 rounded bg-surface-700 text-slate-300"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>

              {/* Calendar Events in Project */}
              <div className="mt-6 pt-5 border-t border-surface-700/70 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    Calendar Events ({projectEvents.length})
                  </h4>
                </div>
                {projectEvents.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    No calendar events linked to this project yet.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {projectEvents.map((evt) => {
                      const pMeta = getPriorityMeta(evt.priority);
                      return (
                        <div
                          key={evt.id}
                          onClick={() => setDetailTarget({ kind: 'event', event: evt })}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-surface-900/60 border border-surface-700/80 hover:border-indigo-500/50 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
                            <span className="text-[11px] text-sky-300 shrink-0">
                              {evt.isAllDay
                                ? extractYmd(evt.start)
                                : `${extractYmd(evt.start)} ${formatTime(evt.start)}`}
                            </span>
                            <span className="text-xs font-medium text-slate-100 truncate">
                              {evt.summary}
                            </span>
                            {evt.linkedTaskId && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1 shrink-0">
                                <Link2 className="w-2.5 h-2.5" /> Linked
                              </span>
                            )}
                          </div>
                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {onSetEventMetadata && unifiedMilestones.length > 0 && (
                              <select
                                value={evt.projectListId ?? ''}
                                onChange={(e) =>
                                  onSetEventMetadata(evt.id, {
                                    ...(eventMetadata[evt.id] ?? {}),
                                    projectId: activeProject.id,
                                    projectListId: e.target.value || undefined,
                                  })
                                }
                                className="px-1.5 py-0.5 rounded border border-surface-600 bg-transparent text-[10px] text-slate-300"
                                title="Assign to milestone / sublist"
                              >
                                <option value="" className="bg-surface-900">
                                  No milestone
                                </option>
                                {flattenedMilestones.map(({ milestone: m, depth }) => (
                                  <option key={m.id} value={m.id} className="bg-surface-900">
                                    {'— '.repeat(depth)}
                                    {m.title}
                                  </option>
                                ))}
                              </select>
                            )}
                            {onSetEventMetadata && (
                              <select
                                value={evt.priority ?? 3}
                                onChange={(e) =>
                                  onSetEventMetadata(evt.id, {
                                    ...(eventMetadata[evt.id] ?? {}),
                                    projectId: activeProject.id,
                                    priority: Number(e.target.value) as Priority,
                                  })
                                }
                                className={`text-[10px] px-1.5 py-0.5 rounded border bg-transparent font-semibold ${pMeta.badgeClass}`}
                              >
                                {PRIORITIES.map((p) => (
                                  <option key={p.value} value={p.value} className="bg-surface-900">
                                    {p.short}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              onClick={() =>
                                onStartFocus({
                                  type: 'event',
                                  id: evt.id,
                                  title: evt.summary,
                                  calendarEventId: evt.id,
                                  projectId: activeProject.id,
                                })
                              }
                              className="px-2 py-1 rounded bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[11px]"
                            >
                              Focus
                            </button>
                            {onSetEventMetadata && (
                              <button
                                onClick={() =>
                                  onSetEventMetadata(evt.id, {
                                    ...(eventMetadata[evt.id] ?? {}),
                                    projectId: undefined,
                                    projectListId: undefined,
                                  })
                                }
                                className="p-1 text-slate-500 hover:text-rose-400"
                                title="Remove event from project"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <TaskEventDetailModal
        target={detailTarget}
        tasks={tasks}
        projects={projects}
        onClose={() => setDetailTarget(null)}
        onStartFocus={onStartFocus}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
      />
    </div>
  );
};
