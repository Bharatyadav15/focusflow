import React, { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import type { TaskItem } from '../../types';
import { getPriorityMeta } from '../../utils/priority';
import { flattenTaskTree } from '../../utils/taskTree';

interface UnscheduledSidebarProps {
  unscheduledTasks: TaskItem[];
  selectedDayKey: string;
  onTimeBlockTask: (task: TaskItem, targetDateKey: string) => Promise<void>;
  onReloadRange: () => Promise<void>;
}

export const UnscheduledSidebar: React.FC<UnscheduledSidebarProps> = ({
  unscheduledTasks,
  selectedDayKey,
  onTimeBlockTask,
  onReloadRange,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const treeNodes = useMemo(
    () => flattenTaskTree(unscheduledTasks, expandedIds, unscheduledTasks),
    [expandedIds, unscheduledTasks]
  );

  return (
    <div className="lg:col-span-3 rounded-2xl bg-surface-800 border border-surface-600/70 p-4 flex flex-col max-h-[640px]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Unscheduled Tasks
        </h3>
        <span className="text-[11px] text-indigo-300">
          Target: {selectedDayKey}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mb-3">
        Click a day to select it, then click <strong>Auto-Block</strong> to
        schedule into the next free calendar gap.
      </p>
      <div className="space-y-2 overflow-y-auto pr-1 flex-1">
        {treeNodes.length === 0 && (
          <p className="text-xs text-slate-500 py-6 text-center">
            All open tasks are time-blocked!
          </p>
        )}
        {treeNodes.map(({ task: t, depth, hasChildren, childCount }) => {
          const pMeta = getPriorityMeta(t.priority);
          const isExpanded = expandedIds.has(t.id);
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/focusflow-task-id', t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              style={{ marginLeft: depth * 12 }}
              className="p-2.5 rounded-xl bg-surface-900/70 border border-surface-700 space-y-1.5 cursor-grab active:cursor-grabbing hover:border-indigo-500/50 transition"
              title="Drag onto a day column or click Auto-Block"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1">
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        });
                      }}
                      className="text-slate-400 hover:text-slate-200"
                      title={isExpanded ? 'Collapse subtasks' : `Expand (${childCount})`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <GripVertical className="w-3 h-3 text-slate-500 shrink-0" />
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${pMeta.badgeClass}`}
                  >
                    {pMeta.short}
                  </span>
                  {hasChildren && (
                    <span className="text-[10px] text-slate-400">
                      ({childCount})
                    </span>
                  )}
                </div>
                {t.googleTaskListTitle && (
                  <span className="text-[10px] text-sky-300 truncate">
                    {t.googleTaskListTitle}
                  </span>
                )}
              </div>
              <p className="text-xs font-medium text-slate-100 line-clamp-2">
                {t.title}
              </p>
              <button
                onClick={async () => {
                  await onTimeBlockTask(t, selectedDayKey);
                  await onReloadRange();
                }}
                className="w-full flex items-center justify-center gap-1 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white text-[11px] font-medium transition"
              >
                <CalendarClock className="w-3 h-3" /> Auto-Block on{' '}
                {selectedDayKey.slice(5)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
