import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Circle,
  Clock,
  FolderKanban,
  Lock,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  PomodoroSession,
  Priority,
  Project,
  TaskItem,
  TimerState,
} from '../types';
import { getPriorityMeta, PRIORITIES } from '../utils/priority';

interface ProjectsViewProps {
  projects: Project[];
  tasks: TaskItem[];
  sessions?: PomodoroSession[];
  onSaveProjects: (projects: Project[]) => void;
  onSaveTasks: (tasks: TaskItem[]) => void;
  onToggleTask: (taskId: string) => void;
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
  sessions = [],
  onSaveProjects,
  onSaveTasks,
  onToggleTask,
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
        .filter((t) => t.projectId === activeProject.id)
        .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
    : [];

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

  const handleAddMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMilestone.trim() || !activeProject) return;
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: [
              ...p.milestones,
              { id: `m-${Date.now()}`, title: newMilestone.trim(), done: false },
            ],
          }
        : p
    );
    onSaveProjects(updated);
    setNewMilestone('');
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
    const updated = projects.map((p) =>
      p.id === activeProject.id
        ? {
            ...p,
            milestones: p.milestones.filter((m) => m.id !== milestoneId),
          }
        : p
    );
    onSaveProjects(updated);
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

              <form onSubmit={handleAddMilestone} className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newMilestone}
                  onChange={(e) => setNewMilestone(e.target.value)}
                  placeholder="Add milestone..."
                  className="flex-1 rounded-xl bg-surface-900 border border-surface-600 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-200"
                >
                  Add
                </button>
              </form>

              <div className="space-y-1.5">
                {activeProject.milestones.map((m) => {
                  const reqIds = m.requiredTaskIds ?? [];
                  const isGated = reqIds.length > 0;
                  const doneCount = reqIds.filter((tid) =>
                    tasks.find((t) => t.id === tid)?.completed
                  ).length;

                  return (
                    <div
                      key={m.id}
                      className="rounded-lg hover:bg-surface-700/40 transition p-2 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleMilestone(m.id)}
                          disabled={isGated}
                          className={`flex items-center gap-2.5 text-left flex-1 min-w-0 ${
                            isGated ? 'cursor-not-allowed' : ''
                          }`}
                          title={
                            isGated
                              ? `Auto-completed when all ${reqIds.length} linked task(s) finish`
                              : 'Toggle milestone'
                          }
                        >
                          {m.done ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : isGated ? (
                            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span
                            className={`text-sm truncate ${
                              m.done
                                ? 'line-through text-slate-500'
                                : 'text-slate-200'
                            }`}
                          >
                            {m.title}
                          </span>
                          {isGated && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                              Gated: {doneCount}/{reqIds.length} tasks
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setGatingMilestoneId(
                                gatingMilestoneId === m.id ? null : m.id
                              )
                            }
                            className={`px-2 py-0.5 rounded text-[11px] flex items-center gap-1 transition ${
                              gatingMilestoneId === m.id || isGated
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : 'bg-surface-700 text-slate-400 hover:text-slate-200'
                            }`}
                            title="Link tasks that must be completed for this milestone"
                          >
                            <Lock className="w-3 h-3" />
                            Gate
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMilestone(m.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                            title="Delete milestone"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

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
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Project Tasks */}
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
                {projectTasks.length === 0 && (
                  <p className="text-sm text-slate-500 py-4 text-center">
                    No tasks in this project yet.
                  </p>
                )}
                {projectTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-900/60 border border-surface-700/80"
                  >
                    <div className="flex items-center gap-3 min-w-0">
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
                          className={`text-sm font-medium truncate ${
                            task.completed
                              ? 'line-through text-slate-500'
                              : 'text-slate-100'
                          }`}
                        >
                          {task.title}
                        </p>
                        <span className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${getPriorityMeta(task.priority).badgeClass}`}
                          >
                            {getPriorityMeta(task.priority).short}
                          </span>
                          {task.completedPomodoros}/{task.estimatedPomodoros} pomos
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

                    {!task.completed && (
                      <button
                        onClick={() =>
                          onStartFocus({
                            type: 'task',
                            id: task.id,
                            title: task.title,
                            projectId: task.projectId,
                            durationMinutes: task.durationMinutes,
                          })
                        }
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-xs font-medium transition"
                      >
                        <Play className="w-3 h-3" /> Focus
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
