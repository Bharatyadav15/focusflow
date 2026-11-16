import React from 'react';
import {
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type { TimerMode, TimerState } from '../../types';
import type { AmbientPreset } from '../../utils/ambientSound';
import { formatTimer } from '../../utils/time';

interface PomodoroCardProps {
  timer: TimerState;
  ambientPreset: AmbientPreset;
  onChangeAmbient?: (preset: AmbientPreset) => void;
  onToggleTimer: () => void;
  onSwitchMode: (mode: TimerMode) => void;
  onResetTimer: () => void;
  onFinishStopwatch: () => void;
  onExtendTimer?: (minutes: number) => void;
  onCompleteActiveTarget?: () => void;
}

export const PomodoroCard: React.FC<PomodoroCardProps> = ({
  timer,
  ambientPreset,
  onChangeAmbient,
  onToggleTimer,
  onSwitchMode,
  onResetTimer,
  onFinishStopwatch,
  onExtendTimer,
  onCompleteActiveTarget,
}) => {
  const { mins, secs } = formatTimer(timer.secondsLeft);
  const progress =
    timer.mode === 'stopwatch'
      ? ((timer.secondsLeft % Math.max(60, timer.totalSeconds)) /
          Math.max(60, timer.totalSeconds)) *
        100
      : timer.totalSeconds > 0
        ? ((timer.totalSeconds - timer.secondsLeft) / timer.totalSeconds) * 100
        : 0;

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-6 flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-36 h-36 flex-shrink-0 flex items-center justify-center">
        <svg className="w-36 h-36 -rotate-90" viewBox="0 0 136 136">
          <circle
            cx="68"
            cy="68"
            r={radius}
            stroke="#1a2130"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="68"
            cy="68"
            r={radius}
            stroke={
              timer.mode === 'focus'
                ? '#6366f1'
                : timer.mode === 'stopwatch'
                  ? '#f59e0b'
                  : timer.mode === 'shortBreak'
                    ? '#10b981'
                    : '#38bdf8'
            }
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute text-center">
          <div className="text-3xl font-mono font-bold text-slate-100">
            {mins}:{secs}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            {timer.mode === 'focus'
              ? 'Focus'
              : timer.mode === 'stopwatch'
                ? 'Stopwatch'
                : timer.mode === 'shortBreak'
                  ? 'Short Break'
                  : 'Long Break'}
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 w-full">
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(['focus', 'stopwatch', 'shortBreak', 'longBreak'] as TimerMode[]).map(
            (m) => (
              <button
                key={m}
                onClick={() => onSwitchMode(m)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  timer.mode === m
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-700'
                }`}
              >
                {m === 'focus'
                  ? 'Pomodoro'
                  : m === 'stopwatch'
                    ? 'Stopwatch'
                    : m === 'shortBreak'
                      ? 'Short Break'
                      : 'Long Break'}
              </button>
            )
          )}
        </div>

        <div className="text-xs text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          Up Next
        </div>
        <h2 className="text-lg font-semibold text-slate-100 truncate mt-0.5">
          {timer.activeTarget?.title || 'Pick a Google Task or Calendar event'}
        </h2>

        <div className="flex flex-wrap items-center gap-2.5 mt-4">
          <button
            onClick={onToggleTimer}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold transition shadow-lg shadow-indigo-500/20"
          >
            {timer.isRunning ? (
              <>
                <Pause className="w-4 h-4" /> Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />{' '}
                {timer.mode === 'stopwatch' ? 'Start Stopwatch' : 'Start Focus'}
              </>
            )}
          </button>
          {timer.mode === 'stopwatch' && timer.secondsLeft > 0 && (
            <button
              onClick={onFinishStopwatch}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition"
            >
              <CheckCircle2 className="w-4 h-4" /> Finish & Log
            </button>
          )}
          {onExtendTimer && timer.mode !== 'stopwatch' && (
            <button
              onClick={() => onExtendTimer(5)}
              className="px-3 py-2.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-slate-300 text-sm font-semibold transition"
              title="Add 5 minutes to the timer"
            >
              +5 min
            </button>
          )}
          {onCompleteActiveTarget && timer.activeTarget && (
            <button
              onClick={onCompleteActiveTarget}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 border border-emerald-500/40 text-emerald-200 hover:text-white text-sm font-semibold transition"
              title="Mark current task finished and log session"
            >
              <CheckCircle2 className="w-4 h-4" /> Finish Task
            </button>
          )}
          <button
            onClick={onResetTimer}
            className="p-2.5 rounded-xl bg-surface-700 hover:bg-surface-600 text-slate-300 transition"
            title="Reset Timer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {onChangeAmbient && (
          <div className="mt-3 pt-2.5 border-t border-surface-700/70 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
              Soundscape:
            </span>
            {(
              [
                { id: 'off', label: 'Off' },
                { id: 'brown', label: 'Brown Noise' },
                { id: 'rain', label: 'Rain' },
                { id: 'warm', label: 'Warm Drone' },
              ] as { id: AmbientPreset; label: string }[]
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChangeAmbient(preset.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition ${
                  ambientPreset === preset.id
                    ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40'
                    : 'bg-surface-900/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
