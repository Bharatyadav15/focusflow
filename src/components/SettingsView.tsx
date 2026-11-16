import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Command,
  Copy,
  Database,
  Download,
  Globe,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  GoogleCalendarInfo,
  GoogleTaskListInfo,
  SecurityInfo,
} from '../types';

/** Turns a key press into a combo like "Ctrl+Alt+P" (needs a modifier). */
function comboFromEvent(e: React.KeyboardEvent): string | null {
  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (mods.length === 0) return null;
  let name = key;
  if (key.length === 1) name = key.toUpperCase();
  else if (key === ' ') name = 'Space';
  else if (key.startsWith('Arrow')) name = key.replace('Arrow', '');
  return [...mods, name].join('+');
}

const HotkeyInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <input
    readOnly
    value={value}
    title="Click, then press the key combination you want"
    onKeyDown={(e) => {
      e.preventDefault();
      const combo = comboFromEvent(e);
      if (combo) onChange(combo);
    }}
    className="w-40 rounded-lg bg-surface-900 border border-surface-600 px-3 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
  />
);

interface SettingsViewProps {
  settings: AppSettings;
  googleConnected: boolean;
  calendars: GoogleCalendarInfo[];
  taskLists: GoogleTaskListInfo[];
  pendingSyncCount?: number;
  onSaveSettings: (settings: AppSettings) => void;
  onConnectGoogle: () => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onFlushSyncQueue?: () => Promise<void>;
  onBackupImported?: () => Promise<void>;
  onOpenAiPalette?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  googleConnected,
  calendars,
  taskLists,
  pendingSyncCount = 0,
  onSaveSettings,
  onConnectGoogle,
  onDisconnectGoogle,
  onSyncAll,
  onFlushSyncQueue,
  onBackupImported,
  onOpenAiPalette,
}) => {
  const [form, setForm] = useState<AppSettings>(settings);
  const [blockDraft, setBlockDraft] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);
  const [security, setSecurity] = useState<SecurityInfo | null>(null);

  const loadSecurity = () => {
    window.electronAPI
      ?.getSecurityInfo()
      .then(setSecurity)
      .catch(() => setSecurity(null));
  };

  useEffect(() => {
    loadSecurity();
  }, []);

  const copySnippet = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const mcpStdioSnippet = JSON.stringify(
    {
      mcpServers: {
        focusflow: {
          command: 'node',
          args: [
            'C:/path/to/focusflow/focusflow-mcp.mjs',
          ],
        },
      },
    },
    null,
    2
  );

  const mcpHttpSnippet = JSON.stringify(
    {
      mcpServers: {
        focusflow: {
          serverUrl: 'http://127.0.0.1:27182/mcp',
          headers: { Authorization: 'Bearer <token from the AI Access Token card>' },
        },
      },
    },
    null,
    2
  );

  const toggleCalendar = (calId: string) => {
    const current = form.selectedCalendarIds;
    if (current.length === 0) {
      // Currently "all" -> switch to all except this one
      const next = calendars.map((c) => c.id).filter((id) => id !== calId);
      setForm({ ...form, selectedCalendarIds: next });
    } else if (current.includes(calId)) {
      setForm({
        ...form,
        selectedCalendarIds: current.filter((id) => id !== calId),
      });
    } else {
      setForm({ ...form, selectedCalendarIds: [...current, calId] });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(form);
    // Hotkey registration happens on save; re-check for conflicts shortly after.
    setTimeout(loadSecurity, 500);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {/* Google Integration Card */}
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-semibold text-slate-100">
              Google Calendar & Tasks Integration
            </h3>
          </div>
          {googleConnected ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected (Two-Way Sync)
            </span>
          ) : (
            <span className="text-xs text-slate-400">Not connected</span>
          )}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Click <strong className="text-slate-200">Sign in with Google</strong>{' '}
          to connect your Google Calendar and Google Tasks. You will only need
          to do this once.
        </p>

        {security && !security.vaultActive && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Windows Credential Manager is not available, so your Google
              sign-in and client secret are being kept in the FocusFlow data
              file instead of the secure vault.
            </span>
          </div>
        )}

        <details className="group rounded-xl border border-surface-600/60 px-4 py-3">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
            Advanced: use your own Google OAuth client (optional)
          </summary>
          <p className="text-xs text-slate-400 leading-relaxed mt-3 mb-3">
            Leave these empty to use FocusFlow's built-in Google sign-in. Fill
            them in only if you created your own{' '}
            <strong className="text-slate-200">OAuth 2.0 Desktop App</strong>{' '}
            client in Google Cloud Console.
          </p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Google OAuth Client ID
            </label>
            <input
              type="text"
              value={form.googleClientId}
              onChange={(e) =>
                setForm({ ...form, googleClientId: e.target.value })
              }
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Google OAuth Client Secret
            </label>
            <input
              type="password"
              value={form.googleClientSecret}
              onChange={(e) =>
                setForm({ ...form, googleClientSecret: e.target.value })
              }
              placeholder="GOCSPX-..."
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        </details>

        <div className="flex items-center gap-3 pt-1">
          {!googleConnected ? (
            <button
              type="button"
              onClick={async () => {
                onSaveSettings(form);
                await onConnectGoogle();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition"
            >
              <Link2 className="w-4 h-4" /> Sign in with Google
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onSyncAll}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition"
              >
                <RefreshCw className="w-4 h-4" /> Sync All Calendars & Lists Now
              </button>
              <button
                type="button"
                onClick={onDisconnectGoogle}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-700 hover:bg-rose-500/20 hover:text-rose-300 text-slate-200 text-sm font-medium transition"
              >
                <Unlink className="w-4 h-4" /> Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Imported Calendars & Task Lists */}
      {googleConnected && (
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-100">
            Imported Calendars & Task Lists
          </h3>

          {calendars.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-2">
                Google Calendars to display (all selected by default):
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {calendars.map((cal) => {
                  const checked =
                    form.selectedCalendarIds.length === 0 ||
                    form.selectedCalendarIds.includes(cal.id);
                  return (
                    <label
                      key={cal.id}
                      className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer p-1.5 rounded-lg hover:bg-surface-700/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCalendar(cal.id)}
                        className="rounded accent-indigo-500"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: cal.backgroundColor || '#6366f1',
                        }}
                      />
                      <span className="truncate">{cal.summary}</span>
                      {cal.primary && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                          Primary
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {taskLists.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Default Google Task List for new tasks
              </label>
              <select
                value={form.defaultTaskListId}
                onChange={(e) =>
                  setForm({ ...form, defaultTaskListId: e.target.value })
                }
                className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
              >
                {taskLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {calendars.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Default Google Calendar for Time-Blocking & Focus Logs
              </label>
              <select
                value={form.defaultWriteCalendarId || 'primary'}
                onChange={(e) =>
                  setForm({ ...form, defaultWriteCalendarId: e.target.value })
                }
                className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
              >
                <option value="primary">Primary Calendar</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary} {cal.primary ? '(Primary)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Timer & Behavior Settings */}
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-100">
          Pomodoro & Automation
        </h3>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Focus (min)
            </label>
            <input
              type="number"
              min={1}
              max={120}
              value={form.focusMinutes}
              onChange={(e) =>
                setForm({ ...form, focusMinutes: Number(e.target.value) || 25 })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Short Break (min)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={form.shortBreakMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  shortBreakMinutes: Number(e.target.value) || 5,
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Long Break (min)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={form.longBreakMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  longBreakMinutes: Number(e.target.value) || 15,
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Work Start Hour (0-23)
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={form.workStartHour ?? 9}
              onChange={(e) =>
                setForm({
                  ...form,
                  workStartHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Work End Hour (1-24)
            </label>
            <input
              type="number"
              min={1}
              max={24}
              value={form.workEndHour ?? 18}
              onChange={(e) =>
                setForm({
                  ...form,
                  workEndHour: Math.max(1, Math.min(24, Number(e.target.value) || 18)),
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Daily Focus Goal (min)
            </label>
            <input
              type="number"
              min={15}
              max={720}
              value={form.dailyFocusGoalMinutes ?? 120}
              onChange={(e) =>
                setForm({
                  ...form,
                  dailyFocusGoalMinutes: Number(e.target.value) || 120,
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Event Reminder (min)
            </label>
            <input
              type="number"
              min={0}
              max={60}
              value={form.preEventReminderMinutes ?? 5}
              onChange={(e) =>
                setForm({
                  ...form,
                  preEventReminderMinutes: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(form.autoStartBreaks)}
            onChange={(e) =>
              setForm({ ...form, autoStartBreaks: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Auto-start break timer when a focus session finishes
        </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(form.autoStartFocus)}
              onChange={(e) =>
                setForm({ ...form, autoStartFocus: e.target.checked })
              }
              className="rounded accent-indigo-500"
            />
            Auto-start next focus timer when a break finishes
          </label>

          {/* Distraction Guard & Idle Detection */}
          <div className="pt-3 mt-2 border-t border-surface-700/70 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Distraction Guard &amp; Idle Detection
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(form.distractionGuardEnabled)}
                  onChange={(e) => {
                    const next = {
                      ...form,
                      distractionGuardEnabled: e.target.checked,
                    };
                    setForm(next);
                    onSaveSettings(next);
                  }}
                  className="rounded accent-indigo-500"
                />
                Enable while focusing
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">
                  Add Website Domain or App (.exe / name)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={blockDraft}
                    onChange={(e) => setBlockDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const items = blockDraft
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        if (items.length === 0) return;
                        const existing = form.blockedAppsOrSites ?? [];
                        const merged = Array.from(new Set([...existing, ...items]));
                        const next = { ...form, blockedAppsOrSites: merged };
                        setForm(next);
                        onSaveSettings(next);
                        setBlockDraft('');
                      }
                    }}
                    placeholder="e.g. youtube.com, reddit.com, discord.exe, x.com"
                    className="flex-1 rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const items = blockDraft
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      if (items.length === 0) return;
                      const existing = form.blockedAppsOrSites ?? [];
                      const merged = Array.from(new Set([...existing, ...items]));
                      const next = { ...form, blockedAppsOrSites: merged };
                      setForm(next);
                      onSaveSettings(next);
                      setBlockDraft('');
                    }}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white transition shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Idle Auto-Pause (min, 0=off)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={form.idlePauseMinutes ?? 5}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      idlePauseMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            {/* Active Blocked Chips */}
            {(form.blockedAppsOrSites ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(form.blockedAppsOrSites ?? []).map((item) => {
                  const isSite = item.includes('.') && !item.toLowerCase().endsWith('.exe');
                  return (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-xs text-rose-200"
                    >
                      <Globe className={`w-3 h-3 ${isSite ? 'text-rose-300' : 'opacity-60'}`} />
                      {item}
                      <button
                        type="button"
                        onClick={() => {
                          const next = {
                            ...form,
                            blockedAppsOrSites: (form.blockedAppsOrSites ?? []).filter(
                              (x) => x !== item
                            ),
                          };
                          setForm(next);
                          onSaveSettings(next);
                        }}
                        className="text-rose-300/80 hover:text-white"
                        title={`Remove ${item}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">Quick add:</span>
              {[
                { label: 'YouTube', value: 'youtube.com' },
                { label: 'Reddit', value: 'reddit.com' },
                { label: 'X / Twitter', value: 'x.com' },
                { label: 'Instagram', value: 'instagram.com' },
                { label: 'Twitch', value: 'twitch.tv' },
                { label: 'Netflix', value: 'netflix.com' },
                { label: 'Discord', value: 'discord.exe' },
                { label: 'Spotify', value: 'spotify.exe' },
                { label: 'Steam', value: 'steam.exe' },
              ].map((preset) => {
                const active = (form.blockedAppsOrSites ?? []).some(
                  (x) => x.toLowerCase() === preset.value
                );
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      const cur = form.blockedAppsOrSites ?? [];
                      const nextList = active
                        ? cur.filter((x) => x.toLowerCase() !== preset.value)
                        : [...cur, preset.value];
                      const next = { ...form, blockedAppsOrSites: nextList };
                      setForm(next);
                      onSaveSettings(next);
                    }}
                    className={`px-2 py-0.5 rounded-full text-[11px] border transition ${
                      active
                        ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                        : 'bg-surface-900/70 border-surface-600 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {active ? `✓ ${preset.label}` : `+ ${preset.label}`}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Every 2s during active focus, FocusFlow inspects the foreground window title and process path and automatically minimizes matching apps or browser tabs (works with Zen Browser, Chrome, Edge, and desktop apps). Background tabs and DNS-level blocking require a browser add-on such as LeechBlock NG.
            </p>

            <div className="pt-2 border-t border-surface-700/60">
              <label className="block text-xs text-slate-400 mb-1">
                Obsidian Vault Daily Notes Folder (optional, for Shutdown Review export)
              </label>
              <input
                type="text"
                value={form.obsidianVaultPath ?? ''}
                onChange={(e) =>
                  setForm({ ...form, obsidianVaultPath: e.target.value })
                }
                placeholder="e.g. C:\Users\you\Documents\MyVault\Daily Notes"
                className="w-full rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
          </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoLogToCalendar}
            onChange={(e) =>
              setForm({ ...form, autoLogToCalendar: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Automatically log completed focus blocks to Google Calendar
        </label>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoCompleteTask}
            onChange={(e) =>
              setForm({ ...form, autoCompleteTask: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Mark linked Google Task completed when a focus block finishes
        </label>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.soundOnComplete}
            onChange={(e) =>
              setForm({ ...form, soundOnComplete: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Play a sound when a focus or break session ends
        </label>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.notifyOnComplete}
            onChange={(e) =>
              setForm({ ...form, notifyOnComplete: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Show a Windows notification when a session ends
        </label>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.startWithWindows}
            onChange={(e) =>
              setForm({ ...form, startWithWindows: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          Start FocusFlow with Windows (runs hidden in the tray)
        </label>

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.globalHotkeys}
            onChange={(e) =>
              setForm({ ...form, globalHotkeys: e.target.checked })
            }
            className="rounded accent-indigo-500"
          />
          <span>Enable global hotkeys</span>
        </label>

        {form.globalHotkeys && (
          <div className="ml-7 space-y-2">
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="w-44">Start / pause the timer</span>
              <HotkeyInput
                value={form.hotkeyTimer}
                onChange={(v) => setForm({ ...form, hotkeyTimer: v })}
              />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="w-44">Add a task (quick-add)</span>
              <HotkeyInput
                value={form.hotkeyQuickAdd}
                onChange={(v) => setForm({ ...form, hotkeyQuickAdd: v })}
              />
            </div>
            <div className="text-[11px] text-slate-500">
              Click a box and press the combination you want (include Ctrl, Alt,
              Shift or Win). Save to apply.
            </div>
            {security && security.hotkeyErrors.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="space-y-0.5">
                  {security.hotkeyErrors.map((msg) => (
                    <div key={msg}>{msg}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.demoMode}
            onChange={(e) => setForm({ ...form, demoMode: e.target.checked })}
            className="rounded accent-indigo-500"
          />
          Show sample calendar events when Google is not connected
        </label>

        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition"
        >
          Save Settings
        </button>
      </div>

      {/* Data Backup & Offline Sync Queue */}
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-semibold text-slate-100">
              Data Backup &amp; Offline Sync
            </h3>
          </div>
          {pendingSyncCount > 0 ? (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {pendingSyncCount} offline change{pendingSyncCount === 1 ? '' : 's'} queued
            </span>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Sync queue empty
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              if (!window.electronAPI) return;
              try {
                const json = await window.electronAPI.exportBackupJson();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `focusflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setBackupMessage('Exported full FocusFlow backup.');
              } catch {
                setBackupMessage('Failed to export backup.');
              }
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-100 transition"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            Export JSON Backup
          </button>

          <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-100 transition cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            Import JSON Backup
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file || !window.electronAPI) return;
                try {
                  const text = await file.text();
                  await window.electronAPI.importBackupJson(text);
                  await onBackupImported?.();
                  setBackupMessage(`Imported backup from ${file.name}.`);
                } catch {
                  setBackupMessage('Invalid backup JSON file.');
                }
              }}
            />
          </label>

          {googleConnected && onFlushSyncQueue && (
            <button
              type="button"
              onClick={onFlushSyncQueue}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-xs font-medium text-indigo-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Flush Offline Queue ({pendingSyncCount})
            </button>
          )}
        </div>

        {backupMessage && (
          <p className="text-xs text-emerald-300">{backupMessage}</p>
        )}
      </div>

      {/* External AI Control (Gemini / Hermes / MCP) Card */}
      <div className="rounded-2xl bg-surface-800 border border-indigo-500/40 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-semibold text-slate-100">
              External AI Control (Gemini, Hermes & MCP)
            </h3>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Active on 127.0.0.1:27182
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          FocusFlow runs a built-in{' '}
          <strong className="text-slate-200">Model Context Protocol (MCP)</strong>{' '}
          and <strong className="text-slate-200">Function-Calling REST Server</strong>{' '}
          so external AI agents like <strong className="text-slate-200">Gemini</strong>{' '}
          or <strong className="text-slate-200">Hermes</strong> can add/remove calendar
          events, tasks, reminders, projects, and control your Pomodoro timer in
          real time.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-surface-900 border border-surface-600 p-3 space-y-1">
            <div className="text-slate-400 font-medium">HTTP MCP Endpoint</div>
            <div className="font-mono text-indigo-300 select-all">
              http://127.0.0.1:27182/mcp
            </div>
          </div>
          <div className="rounded-xl bg-surface-900 border border-surface-600 p-3 space-y-1">
            <div className="text-slate-400 font-medium">
              Hermes / Gemini Tool Schema & Call API
            </div>
            <div className="font-mono text-indigo-300 select-all">
              http://127.0.0.1:27182/api/tools
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              Stdio MCP Config (Gemini CLI / Antigravity / Hermes / Claude)
            </span>
            <button
              type="button"
              onClick={() => copySnippet('stdio', mcpStdioSnippet)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
            >
              {copiedKey === 'stdio' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy JSON
                </>
              )}
            </button>
          </div>
          <pre className="rounded-xl bg-surface-900 border border-surface-600 p-3 text-[11px] font-mono text-slate-300 overflow-x-auto select-all">
            {mcpStdioSnippet}
          </pre>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">
              Streamable HTTP MCP Config
            </span>
            <button
              type="button"
              onClick={() => copySnippet('http', mcpHttpSnippet)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
            >
              {copiedKey === 'http' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy JSON
                </>
              )}
            </button>
          </div>
          <pre className="rounded-xl bg-surface-900 border border-surface-600 p-3 text-[11px] font-mono text-slate-300 overflow-x-auto select-all">
            {mcpHttpSnippet}
          </pre>
        </div>

        <div className="pt-1 space-y-3">
          <div>
            <div className="text-xs font-medium text-slate-300 mb-2">
              8 Consolidated AI Tools &amp; 3 MCP Resources:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                'get_overview',
                'manage_task',
                'manage_event',
                'manage_project',
                'manage_template',
                'plan_my_day',
                'control_timer',
                'get_focus_stats',
              ].map((toolName) => (
                <span
                  key={toolName}
                  className="px-2 py-0.5 rounded-md bg-surface-900 border border-surface-600 text-[11px] font-mono text-indigo-300"
                >
                  {toolName}
                </span>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-surface-700/70 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              AI Access Token, Audit Log &amp; Undo are managed inside{' '}
              <strong className="text-slate-200">Ctrl+K</strong> (Token file:{' '}
              <code className="text-indigo-300">
                {security?.tokenPath || '%APPDATA%\\focusflow\\ai-token'}
              </code>
              )
            </span>
            {onOpenAiPalette && (
              <button
                type="button"
                onClick={onOpenAiPalette}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-xs font-medium text-indigo-200 transition"
              >
                <Command className="w-3.5 h-3.5" />
                Open AI Token &amp; Undo (Ctrl+K)
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
};
