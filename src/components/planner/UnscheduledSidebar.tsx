import React from 'react';
import { CalendarClock, GripVertical } from 'lucide-react';
import type { TaskItem } from '../../types';
import { getPriorityMeta } from '../../utils/priority';

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
        {unscheduledTasks.length === 0 && (
          <p className="text-xs text-slate-500 py-6 text-center">
            All open tasks are time-blocked!
          </p>
        )}
        {unscheduledTasks.map((t) => {
          const pMeta = getPriorityMeta(t.priority);
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/focusflow-task-id', t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className="p-2.5 rounded-xl bg-surface-900/70 border border-surface-700 space-y-1.5 cursor-grab active:cursor-grabbing hover:border-indigo-500/50 transition"
              title="Drag onto a day column or click Auto-Block"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1">
                  <GripVertical className="w-3 h-3 text-slate-500 shrink-0" />
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${pMeta.badgeClass}`}
                  >
                    {pMeta.short}
                  </span>
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
