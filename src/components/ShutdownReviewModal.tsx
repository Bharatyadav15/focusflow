import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  Moon,
  X,
} from 'lucide-react';
import type { ShutdownReviewResult } from '../types';

interface ShutdownReviewModalProps {
  open: boolean;
  onClose: () => void;
  obsidianVaultPath?: string;
  onRunReview: (opts: {
    rollUnfinished?: boolean;
    writeObsidian?: boolean;
    dryRun?: boolean;
  }) => Promise<ShutdownReviewResult>;
}

export const ShutdownReviewModal: React.FC<ShutdownReviewModalProps> = ({
  open,
  onClose,
  obsidianVaultPath,
  onRunReview,
}) => {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ShutdownReviewResult | null>(null);
  const [rollUnfinished, setRollUnfinished] = useState(true);
  const [writeObsidian, setWriteObsidian] = useState(
    Boolean(obsidianVaultPath && obsidianVaultPath.trim().length > 0)
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    onRunReview({ dryRun: true })
      .then((res) => setPreview(res))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load review')
      )
      .finally(() => setLoading(false));
  }, [open, onRunReview]);

  if (!open) return null;

  const hasVault = Boolean(obsidianVaultPath && obsidianVaultPath.trim());

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await onRunReview({
        rollUnfinished,
        writeObsidian: writeObsidian && hasVault,
        dryRun: false,
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Shutdown failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!preview?.markdown) return;
    navigator.clipboard.writeText(preview.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface-800 border border-surface-600 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-surface-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                End-of-Day Shutdown Review
              </h2>
              <p className="text-xs text-slate-400">
                Planned vs done summary, task rollover &amp; Obsidian daily log
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surface-700 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {loading && !preview ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Preparing today&apos;s review…
            </div>
          ) : (
            preview && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-3">
                    <div className="text-[11px] text-slate-400">Focus Logged</div>
                    <div className="text-lg font-bold text-indigo-300">
                      {preview.focusMinutes}m
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {preview.sessionsCount} sessions
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-3">
                    <div className="text-[11px] text-slate-400">Completed</div>
                    <div className="text-lg font-bold text-emerald-300">
                      {preview.completedCount}
                    </div>
                    <div className="text-[11px] text-slate-500">tasks done</div>
                  </div>
                  <div className="rounded-xl bg-surface-900/70 border border-surface-700 p-3">
                    <div className="text-[11px] text-slate-400">Remaining</div>
                    <div className="text-lg font-bold text-amber-300">
                      {preview.unfinishedCount}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {preview.rolledToTomorrow
                        ? `rolled to ${preview.tomorrow}`
                        : `rollable to ${preview.tomorrow}`}
                    </div>
                  </div>
                </div>

                {preview.obsidianNotePath && (
                  <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/35 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 shrink-0" />
                    <span>
                      Wrote daily review to{' '}
                      <code className="font-mono">{preview.obsidianNotePath}</code>
                    </span>
                  </div>
                )}

                {preview.obsidianError && (
                  <div className="rounded-xl bg-amber-500/15 border border-amber-500/35 px-3.5 py-2.5 text-xs text-amber-200">
                    {preview.obsidianError}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                    <span>Markdown Summary</span>
                    <button
                      type="button"
                      onClick={handleCopyMarkdown}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-200 text-[11px] transition"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy Markdown
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="rounded-xl bg-surface-950 border border-surface-700 p-3.5 text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
                    {preview.markdown}
                  </pre>
                </div>

                {!preview.rolledToTomorrow && (
                  <div className="space-y-2 pt-2 border-t border-surface-700">
                    <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rollUnfinished}
                        onChange={(e) => setRollUnfinished(e.target.checked)}
                        className="rounded accent-indigo-500"
                      />
                      Roll {preview.unfinishedCount} unfinished today/overdue task(s) to{' '}
                      {preview.tomorrow}
                    </label>
                    <label
                      className={`flex items-center gap-2 text-xs ${
                        hasVault
                          ? 'text-slate-200 cursor-pointer'
                          : 'text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={writeObsidian && hasVault}
                        disabled={!hasVault}
                        onChange={(e) => setWriteObsidian(e.target.checked)}
                        className="rounded accent-indigo-500"
                      />
                      Write daily review Markdown note to Obsidian vault
                      {!hasVault && ' (configure path in Settings first)'}
                    </label>
                  </div>
                )}
              </>
            )
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-surface-700 bg-surface-900/50 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-surface-700 hover:bg-surface-600 text-xs font-medium text-slate-200 transition"
          >
            Close
          </button>
          {(!preview?.rolledToTomorrow || (writeObsidian && !preview?.obsidianNotePath)) && (
            <button
              onClick={handleApply}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white transition disabled:opacity-50"
            >
              <ClipboardCheck className="w-4 h-4" />
              {loading ? 'Running…' : 'Complete Shutdown Review'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
