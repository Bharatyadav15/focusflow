import React, { useState } from 'react';
import { CalendarCheck, Check, Clock, FolderOpen, Sparkles, Target } from 'lucide-react';
import type { AppSettings, GoogleCalendarInfo } from '../types';

interface FirstRunWizardProps {
  open: boolean;
  settings: AppSettings;
  googleConnected: boolean;
  calendars: GoogleCalendarInfo[];
  onConnectGoogle: () => Promise<void>;
  onComplete: (nextSettings: AppSettings) => Promise<void>;
}

export const FirstRunWizard: React.FC<FirstRunWizardProps> = ({
  open,
  settings,
  googleConnected,
  calendars,
  onConnectGoogle,
  onComplete,
}) => {
  const [selectedCals, setSelectedCals] = useState<string[]>(
    settings.selectedCalendarIds ?? []
  );
  const [writeCal, setWriteCal] = useState<string>(
    settings.defaultWriteCalendarId || 'primary'
  );
  const [goalMinutes, setGoalMinutes] = useState<number>(
    settings.dailyFocusGoalMinutes || 180
  );
  const [workStart, setWorkStart] = useState<number>(
    settings.workStartHour ?? 9
  );
  const [workEnd, setWorkEnd] = useState<number>(settings.workEndHour ?? 18);
  const [obsidianPath, setObsidianPath] = useState<string>(
    settings.obsidianVaultPath ?? ''
  );
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const toggleCalendar = (id: string) => {
    setSelectedCals((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onComplete({
        ...settings,
        selectedCalendarIds: selectedCals,
        defaultWriteCalendarId: writeCal,
        dailyFocusGoalMinutes: Math.max(15, goalMinutes),
        workStartHour: Math.max(0, Math.min(23, workStart)),
        workEndHour: Math.max(1, Math.min(24, workEnd)),
        obsidianVaultPath: obsidianPath.trim() || undefined,
        demoMode: false,
        onboardingCompleted: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <form
        onSubmit={handleFinish}
        className="w-full max-w-xl rounded-2xl bg-surface-800 border border-indigo-500/40 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-5 border-b border-surface-700 flex items-center gap-3 bg-indigo-500/[0.07]">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Welcome to FocusFlow
            </h2>
            <p className="text-xs text-slate-400">
              Configure your schedule window, daily focus goal, and calendars. You&apos;re starting clean with no demo clutter.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* 1. Working Hours & Daily Goal */}
          <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" /> Work Hours &amp; Daily Goal
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Work Start (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={workStart}
                  onChange={(e) => setWorkStart(Number(e.target.value) || 0)}
                  className="w-full rounded-xl bg-surface-800 border border-surface-600 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Work End (1–24)
                </label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={workEnd}
                  onChange={(e) => setWorkEnd(Number(e.target.value) || 18)}
                  className="w-full rounded-xl bg-surface-800 border border-surface-600 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" /> Daily Goal (min)
                </label>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={goalMinutes}
                  onChange={(e) => setGoalMinutes(Number(e.target.value) || 180)}
                  className="w-full rounded-xl bg-surface-800 border border-surface-600 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* 2. Calendars Picker */}
          <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                <CalendarCheck className="w-3.5 h-3.5" /> Calendars
              </div>
              {!googleConnected && (
                <button
                  type="button"
                  onClick={onConnectGoogle}
                  className="px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-medium text-white transition"
                >
                  Connect Google Account
                </button>
              )}
            </div>

            {!googleConnected ? (
              <p className="text-xs text-slate-400">
                Optional: Connect Google in Settings (after entering your OAuth Client ID) or later anytime to pick calendars and sync two-way.
              </p>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-slate-400">
                Google connected! Your primary calendar is active; extra calendars will appear here once synced.
              </p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {calendars.map((cal) => {
                  const checked =
                    selectedCals.length === 0
                      ? Boolean(cal.primary)
                      : selectedCals.includes(cal.id);
                  return (
                    <label
                      key={cal.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 cursor-pointer text-xs text-slate-200"
                    >
                      <span className="flex items-center gap-2 min-w-0 truncate">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCalendar(cal.id)}
                          className="rounded accent-indigo-500"
                        />
                        <span className="truncate">{cal.summary}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setWriteCal(cal.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          writeCal === cal.id
                            ? 'bg-indigo-500/25 text-indigo-300 border border-indigo-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {writeCal === cal.id ? 'Write Target' : 'Set Write'}
                      </button>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Optional Obsidian Vault */}
          <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-4 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-indigo-300 uppercase tracking-wider">
              <FolderOpen className="w-3.5 h-3.5" /> Obsidian Daily Notes Folder (Optional)
            </label>
            <input
              type="text"
              value={obsidianPath}
              onChange={(e) => setObsidianPath(e.target.value)}
              placeholder="C:\Users\you\Documents\MyVault\Daily Notes"
              className="w-full rounded-xl bg-surface-800 border border-surface-600 px-3 py-2 text-xs text-slate-100 placeholder-slate-500"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-surface-700 bg-surface-900/60 flex items-center justify-end gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white transition shadow-lg shadow-indigo-500/25"
          >
            <Check className="w-4 h-4" />
            {saving ? 'Saving…' : 'Start FocusFlow'}
          </button>
        </div>
      </form>
    </div>
  );
};
