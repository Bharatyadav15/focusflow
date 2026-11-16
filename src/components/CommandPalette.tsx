import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Calendar,
  CheckSquare,
  Command,
  FolderKanban,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { AiControlPanel } from './AiControlPanel';
import type {
  CalendarEvent,
  Priority,
  Project,
  TaskItem,
  TimerState,
} from '../types';
import { parseSmartTaskInput } from '../utils/taskParser';
import { getTaskBreadcrumb } from '../utils/taskTree';
import { formatTime } from '../utils/time';
import type { AmbientPreset } from '../utils/ambientSound';

export type PaletteTab = 'day' | 'projects' | 'settings';
export type PaletteMode = 'commands' | 'ai';

interface CommandPaletteProps {
  open: boolean;
  initialMode?: PaletteMode;
  onClose: () => void;
  tasks: TaskItem[];
  events: CalendarEvent[];
  projects: Project[];
  ambient: AmbientPreset;
  tokenPath?: string;
  onSelectTab: (tab: PaletteTab) => void;
  onSelectDayMode?: (mode: 'plan' | 'actual' | 'planner') => void;
  onQuickAddTask?: (
    title: string,
    priority?: Priority,
    dueDate?: string,
    durationMinutes?: number
  ) => void;
  onStartFocus: (target: TimerState['activeTarget']) => void;
  onToggleTimer: () => void;
  onPlanMyDay: () => void;
  onSyncAll: () => void;
  onSetAmbient: (preset: AmbientPreset) => void;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  run: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  initialMode = 'commands',
  onClose,
  tasks,
  events,
  projects,
  ambient,
  tokenPath = '',
  onSelectTab,
  onSelectDayMode,
  onQuickAddTask,
  onStartFocus,
  onToggleTimer,
  onPlanMyDay,
  onSyncAll,
  onSetAmbient,
}) => {
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setQuery('');
      setActiveIndex(0);
      if (initialMode === 'commands') {
        setTimeout(() => inputRef.current?.focus(), 20);
      }
    }
  }, [initialMode, open]);

  const items = useMemo<PaletteItem[]>(() => {
    const raw = query.trim();
    const q = raw.toLowerCase();
    const list: PaletteItem[] = [];

    // Smart natural-language Quick-Add & Focus commands powered by taskParser.ts
    if (raw.length > 0) {
      const strippedAdd = raw.replace(/^(add|task|\+)\s+/i, '').trim();
      if (strippedAdd && onQuickAddTask && !/^focus\s+/i.test(raw)) {
        const parsed = parseSmartTaskInput(strippedAdd);
        const badges = [
          parsed.priority ? `P${parsed.priority}` : null,
          parsed.dueDate ? `Due ${parsed.dueDate}` : null,
          parsed.durationMinutes ? `${parsed.durationMinutes}m` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        list.push({
          id: 'nl-add-task',
          group: 'Quick Add',
          label: `Add Task: "${parsed.title}"`,
          subtitle: badges || 'Creates task (supports p1–p5, today/tomorrow, 30m/1h)',
          icon: <Plus className="w-4 h-4 text-emerald-400" />,
          run: () => {
            onQuickAddTask(
              parsed.title,
              parsed.priority,
              parsed.dueDate,
              parsed.durationMinutes
            );
            onClose();
          },
        });
      }

      const focusMatch = raw.match(/^focus(?:\s+on)?\s+(.+)$/i);
      if (focusMatch && focusMatch[1].trim()) {
        const parsedFocus = parseSmartTaskInput(focusMatch[1].trim());
        list.push({
          id: 'nl-focus-custom',
          group: 'Quick Focus',
          label: `Start Focus: "${parsedFocus.title}"`,
          subtitle: parsedFocus.durationMinutes
            ? `${parsedFocus.durationMinutes}m timer`
            : 'Uses default focus length',
          icon: <Play className="w-4 h-4 text-indigo-400" />,
          run: () => {
            onStartFocus({
              type: 'custom',
              title: parsedFocus.title,
              durationMinutes: parsedFocus.durationMinutes,
            });
            onSelectTab('day');
            onClose();
          },
        });
      }
    }

    const baseActions: PaletteItem[] = [
      {
        id: 'act-ai-panel',
        group: 'AI Control',
        label: 'Open AI Token, Audit Log & Undo',
        subtitle: 'Inspect MCP actions, undo edits, or copy bearer token',
        icon: <Bot className="w-4 h-4 text-violet-400" />,
        run: () => setMode('ai'),
      },
      {
        id: 'act-toggle',
        group: 'Actions',
        label: 'Start / Pause Timer',
        subtitle: 'Toggle shared Pomodoro or Stopwatch timer',
        icon: <Play className="w-4 h-4 text-indigo-400" />,
        run: () => {
          onToggleTimer();
          onClose();
        },
      },
      {
        id: 'act-plan',
        group: 'Actions',
        label: 'Plan My Day (Auto Time-Block)',
        subtitle: 'Schedule top open tasks into free calendar slots',
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        run: () => {
          onPlanMyDay();
          onClose();
        },
      },
      {
        id: 'act-sync',
        group: 'Actions',
        label: 'Sync Google Calendar & Tasks + Flush Queue',
        subtitle: 'Force immediate two-way sync now',
        icon: <RefreshCw className="w-4 h-4 text-emerald-400" />,
        run: () => {
          onSyncAll();
          onClose();
        },
      },
      {
        id: 'act-ambient',
        group: 'Actions',
        label:
          ambient === 'off'
            ? 'Ambient Focus Sound: Turn On Brown Noise'
            : `Ambient Focus Sound: Turn Off (currently ${ambient})`,
        subtitle: 'Procedural focus soundscape',
        icon: <Volume2 className="w-4 h-4 text-sky-400" />,
        run: () => {
          onSetAmbient(ambient === 'off' ? 'brown' : 'off');
          onClose();
        },
      },
      {
        id: 'nav-day-plan',
        group: 'Navigate',
        label: 'Day View: Plan (Today Schedule & Tasks)',
        icon: <Command className="w-4 h-4 text-slate-400" />,
        run: () => {
          onSelectTab('day');
          onSelectDayMode?.('plan');
          onClose();
        },
      },
      {
        id: 'nav-day-actual',
        group: 'Navigate',
        label: 'Day View: Actual (Goal, Timeline & Session Log)',
        icon: <Command className="w-4 h-4 text-slate-400" />,
        run: () => {
          onSelectTab('day');
          onSelectDayMode?.('actual');
          onClose();
        },
      },
      {
        id: 'nav-day-planner',
        group: 'Navigate',
        label: 'Day View: Multi-Day Calendar (Week / Month / Hourly Drop)',
        icon: <Calendar className="w-4 h-4 text-slate-400" />,
        run: () => {
          onSelectTab('day');
          onSelectDayMode?.('planner');
          onClose();
        },
      },
      {
        id: 'nav-projects',
        group: 'Navigate',
        label: 'Go to Projects',
        icon: <FolderKanban className="w-4 h-4 text-slate-400" />,
        run: () => {
          onSelectTab('projects');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        group: 'Navigate',
        label: 'Go to Settings',
        icon: <Command className="w-4 h-4 text-slate-400" />,
        run: () => {
          onSelectTab('settings');
          onClose();
        },
      },
    ];

    const itemPool: PaletteItem[] = [...baseActions];

    for (const t of tasks.filter((x) => !x.completed).slice(0, 40)) {
      itemPool.push({
        id: `task-${t.id}`,
        group: 'Focus on Task',
        label: getTaskBreadcrumb(tasks, t.id),
        subtitle: `P${t.priority}${t.dueDate ? ` · Due ${t.dueDate.slice(0, 10)}` : ''}${t.durationMinutes ? ` · ${t.durationMinutes}m` : ''}`,
        icon: <CheckSquare className="w-4 h-4 text-indigo-300" />,
        run: () => {
          onStartFocus({
            type: 'task',
            id: t.id,
            title: t.title,
            projectId: t.projectId,
            calendarEventId: t.linkedEventId,
            durationMinutes: t.durationMinutes,
          });
          onSelectTab('day');
          onClose();
        },
      });
    }

    for (const e of events.slice(0, 25)) {
      itemPool.push({
        id: `evt-${e.id}`,
        group: 'Focus on Event',
        label: e.summary,
        subtitle: e.isAllDay ? 'All day' : `${formatTime(e.start)} – ${formatTime(e.end)}`,
        icon: <Calendar className="w-4 h-4 text-emerald-300" />,
        run: () => {
          onStartFocus({
            type: 'event',
            id: e.id,
            title: e.summary,
            projectId: e.projectId,
            calendarEventId: e.id,
            linkedTaskId: e.linkedTaskId,
          });
          onSelectTab('day');
          onClose();
        },
      });
    }

    for (const p of projects) {
      itemPool.push({
        id: `proj-${p.id}`,
        group: 'Projects',
        label: p.name,
        subtitle: `${p.milestones.filter((m) => m.done).length}/${p.milestones.length} milestones`,
        icon: <FolderKanban className="w-4 h-4" style={{ color: p.color }} />,
        run: () => {
          onSelectTab('projects');
          onClose();
        },
      });
    }

    if (!q) {
      return [...list, ...itemPool].slice(0, 14);
    }

    const filtered = itemPool
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
          item.group.toLowerCase().includes(q)
      )
      .slice(0, 14);

    return [...list, ...filtered].slice(0, 16);
  }, [
    ambient,
    events,
    onClose,
    onPlanMyDay,
    onQuickAddTask,
    onSelectDayMode,
    onSelectTab,
    onSetAmbient,
    onStartFocus,
    onSyncAll,
    onToggleTimer,
    projects,
    query,
    tasks,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, mode]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface-800 border border-surface-600 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mode Switch Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700 bg-surface-900/60">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMode('commands');
                setTimeout(() => inputRef.current?.focus(), 20);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                mode === 'commands'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-800'
              }`}
            >
              <Command className="w-3.5 h-3.5" />
              Commands &amp; Quick Add
            </button>
            <button
              type="button"
              onClick={() => setMode('ai')}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                mode === 'ai'
                  ? 'bg-indigo-500 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-800'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              AI Activity &amp; Token
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'ai' ? (
          <div className="max-h-[75vh] overflow-y-auto p-4">
            <AiControlPanel tokenPath={tokenPath} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-700">
              <Search className="w-4 h-4 text-indigo-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onClose();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIndex((i) => Math.min(items.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIndex((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter' && items[activeIndex]) {
                    e.preventDefault();
                    items[activeIndex].run();
                  }
                }}
                placeholder='Search commands, type "add Call Alex p1 tomorrow 30m" or "focus Deep Work 45m"...'
                className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
              />
            </div>

            <div className="max-h-96 overflow-y-auto p-2 space-y-1">
              {items.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-500">
                  No matching commands, tasks, or events.
                </div>
              )}
              {items.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={item.run}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                    idx === activeIndex
                      ? 'bg-indigo-500/20 border border-indigo-500/40 text-white'
                      : 'border border-transparent text-slate-200 hover:bg-surface-700/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.icon}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      {item.subtitle && (
                        <div className="text-[11px] text-slate-400 truncate">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-surface-900 text-slate-400 shrink-0">
                    {item.group}
                  </span>
                </button>
              ))}
            </div>

            <div className="px-4 py-2 border-t border-surface-700 bg-surface-900/60 flex items-center justify-between text-[11px] text-slate-500">
              <span>↑↓ to move · Enter to run / quick-add · Esc to close</span>
              <span>Ctrl+K</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
