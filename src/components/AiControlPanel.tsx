import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  History,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import type { AiAuditEntry } from '../types';

interface Props {
  tokenPath: string;
}

function describe(entry: AiAuditEntry): string {
  if (entry.summary) return entry.summary;
  const target =
    (entry.args?.title as string) ||
    (entry.args?.summary as string) ||
    (entry.args?.name as string) ||
    '';
  return target ? `${entry.tool}: ${target}` : entry.tool;
}

export const AiControlPanel: React.FC<Props> = ({ tokenPath }) => {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entries, setEntries] = useState<AiAuditEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const flash = (msg: string) => {
    setMessage(msg);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setMessage(null);
      flashTimerRef.current = null;
    }, 4000);
  };

  const loadAudit = useCallback(async () => {
    try {
      const list = await window.electronAPI?.getAiAudit(30);
      setEntries(list ?? []);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const reveal = async () => {
    if (token) {
      setToken(null);
      return;
    }
    setToken((await window.electronAPI?.getAiToken()) ?? null);
  };

  const copyToken = async () => {
    const t = token ?? (await window.electronAPI?.getAiToken());
    if (!t) return;
    await navigator.clipboard?.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = async () => {
    if (
      !window.confirm(
        'Create a new access token? Anything using the old one (Hermes scripts, custom clients) will stop working until you give it the new token. The bundled MCP bridge reads the new token automatically.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const t = await window.electronAPI?.regenerateAiToken();
      if (token && t) setToken(t);
      flash('New token created');
    } catch (err) {
      flash(typeof err === 'string' ? err : 'Could not create a new token');
    } finally {
      setBusy(false);
    }
  };

  const undo = async (entry: AiAuditEntry) => {
    setBusy(true);
    try {
      const msg = await window.electronAPI?.undoAiAction(entry.id);
      flash(msg ?? 'Restored');
    } catch (err) {
      flash(typeof err === 'string' ? err : 'Could not undo');
    } finally {
      setBusy(false);
      void loadAudit();
    }
  };

  return (
    <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 space-y-5">
      <div className="flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-indigo-400" />
        <h3 className="text-base font-semibold text-slate-100">
          AI Access Token &amp; Activity
        </h3>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        Every request to the AI server (including <code>/api/tools</code>) needs
        this token as <code>Authorization: Bearer &lt;token&gt;</code>. The bundled
        MCP bridge reads it from the file automatically. Requests from web pages
        are always refused.
      </p>

      <div className="space-y-2">
        <div className="text-xs text-slate-400">Token file</div>
        <div className="font-mono text-[11px] text-indigo-300 select-all break-all">
          {tokenPath || '%APPDATA%\\focusflow\\ai-token'}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[220px] rounded-xl bg-surface-900 border border-surface-600 px-3 py-2 font-mono text-[11px] text-slate-200 break-all select-all">
            {token ?? '•'.repeat(32)}
          </div>
          <button
            type="button"
            onClick={reveal}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
          >
            {token ? (
              <>
                <EyeOff className="w-3.5 h-3.5" /> Hide
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" /> Show
              </>
            )}
          </button>
          <button
            type="button"
            onClick={copyToken}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy
              </>
            )}
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-surface-700 hover:bg-rose-500/20 hover:text-rose-300 text-xs text-slate-200 transition disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Regenerate
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-indigo-400" />
            Recent AI actions
          </span>
          <button
            type="button"
            onClick={() => void loadAudit()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {message && (
          <div className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {message}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="text-xs text-slate-500 py-3">
            No AI changes yet. Anything an AI agent adds, edits or deletes will
            be listed here, and deletions can be undone.
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-900 border border-surface-600/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-xs text-slate-200 truncate flex items-center gap-1.5">
                    {!e.ok && (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                    <span className={e.undone ? 'line-through text-slate-500' : ''}>
                      {describe(e)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {new Date(e.time).toLocaleString()} · {e.tool}
                    {e.undone ? ' · undone' : ''}
                  </div>
                </div>
                {e.canUndo && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void undo(e)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-medium transition shrink-0 disabled:opacity-50"
                  >
                    <Undo2 className="w-3 h-3" /> Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
