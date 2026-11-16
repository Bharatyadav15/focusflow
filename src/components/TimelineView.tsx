import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarPlus,
  Check,
  Clock,
  Download,
  Flame,
  Pencil,
  Save,
  Target,
  Trophy,
} from 'lucide-react';
import type {
  CalendarEvent,
  PomodoroSession,
  Project,
  TaskItem,
} from '../types';
import { formatTime, toLocalYmd } from '../utils/time';
import {
  getChildren,
  getEffectiveCompletedPomodoros,
  getEffectiveEstimatedPomodoros,
  getTaskBreadcrumb,
} from '../utils/taskTree';

interface TimelineViewProps {
  sessions: PomodoroSession[];
  events: CalendarEvent[];
  projects: Project[];
  tasks?: TaskItem[];
  dailyGoalMinutes: number;
  onLogToCalendar: (session: PomodoroSession) => void;
  onUpdateSessionNote: (sessionId: string, note: string) => void;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  sessions,
  events,
  projects,
  tasks = [],
  dailyGoalMinutes,
  onLogToCalendar,
  onUpdateSessionNote,
}) => {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const focusSessions = useMemo(
    () => sessions.filter((s) => s.mode === 'focus' || s.mode === 'stopwatch'),
    [sessions]
  );
  const todayYmd = toLocalYmd(new Date());

  const {
    totalMinutes,
    todayMinutes,
    streakDays,
    longestStreakDays,
    todayFocusSessions,
    projectBreakdown,
    weeklyProjectHours,
    hourlyHeatmap,
    peakHour,
    estimateVsActual,
  } = useMemo(() => {
    let total = 0;
    let todayMins = 0;
    const byDay = new Map<string, number>();
    const byProj = new Map<string, number>();
    const weeklyByProj = new Map<string, number>();
    const byHour = Array.from({ length: 24 }, () => 0);
    const todaySess: PomodoroSession[] = [];
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartMs = weekStart.getTime();

    for (const s of focusSessions) {
      total += s.durationMinutes;
      const dt = new Date(s.startedAt);
      const dayKey = toLocalYmd(dt);
      byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + s.durationMinutes);
      if (dayKey === todayYmd) {
        todayMins += s.durationMinutes;
        todaySess.push(s);
      }
      const pKey = s.projectId || '__none__';
      byProj.set(pKey, (byProj.get(pKey) ?? 0) + s.durationMinutes);
      if (dt.getTime() >= weekStartMs) {
        weeklyByProj.set(pKey, (weeklyByProj.get(pKey) ?? 0) + s.durationMinutes);
      }
      const hr = dt.getHours();
      if (hr >= 0 && hr < 24) {
        byHour[hr] += s.durationMinutes;
      }
    }

    // Current Streak calculation
    let streak = 0;
    const cursor = new Date();
    if ((byDay.get(todayYmd) ?? 0) === 0) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while ((byDay.get(toLocalYmd(cursor)) ?? 0) > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Longest Streak calculation
    let longest = streak;
    const sortedDays = Array.from(byDay.entries())
      .filter(([, mins]) => mins > 0)
      .map(([d]) => d)
      .sort();
    let run = 0;
    let prevTime: number | null = null;
    for (const ymd of sortedDays) {
      const [yy, mm, dd] = ymd.split('-').map(Number);
      const t = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
      if (prevTime !== null && Math.round((t - prevTime) / 86_400_000) === 1) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > longest) longest = run;
      prevTime = t;
    }

    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const mapProjects = (m: Map<string, number>) =>
      Array.from(m.entries())
        .map(([pid, mins]) => {
          const p = pid === '__none__' ? null : projectMap.get(pid);
          return {
            id: pid,
            name: p?.name ?? 'Unassigned',
            color: p?.color ?? '#64748b',
            minutes: mins,
          };
        })
        .sort((a, b) => b.minutes - a.minutes);

    let bestHr: number | null = null;
    let bestHrMins = 0;
    byHour.forEach((m, hr) => {
      if (m > bestHrMins) {
        bestHrMins = m;
        bestHr = hr;
      }
    });

    const estRows = tasks
      .filter((t) => !t.parentId)
      .filter((t) => {
        const effActual = getEffectiveCompletedPomodoros(tasks, t.id);
        const effEst = getEffectiveEstimatedPomodoros(tasks, t.id);
        return effActual > 0 || (t.completed && effEst > 0);
      })
      .slice(0, 12)
      .map((t) => ({
        id: t.id,
        title: t.title,
        est: Math.max(1, getEffectiveEstimatedPomodoros(tasks, t.id) || 1),
        actual: getEffectiveCompletedPomodoros(tasks, t.id),
        completed: t.completed,
      }));

    return {
      totalMinutes: total,
      todayMinutes: todayMins,
      streakDays: streak,
      longestStreakDays: longest,
      todayFocusSessions: todaySess,
      projectBreakdown: mapProjects(byProj),
      weeklyProjectHours: mapProjects(weeklyByProj),
      hourlyHeatmap: byHour,
      peakHour: bestHr,
      estimateVsActual: estRows,
    };
  }, [focusSessions, projects, tasks, todayYmd]);

  const goal = Math.max(15, dailyGoalMinutes || 180);
  const goalPct = Math.min(100, Math.round((todayMinutes / goal) * 100));

  const todayTimedEvents = useMemo(
    () =>
      events.filter(
        (e) => !e.isAllDay && toLocalYmd(new Date(e.start)) === todayYmd
      ),
    [events, todayYmd]
  );

  // 06:00 -> 22:00 visual day grid (16 hours = 960 mins)
  const dayStartMin = 6 * 60;
  const daySpanMin = 16 * 60;
  const toPctRange = (startIso: string, endIso: string) => {
    const s = new Date(startIso);
    const e = new Date(endIso);
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = Math.max(sMin + 10, e.getHours() * 60 + e.getMinutes());
    const left = Math.max(0, Math.min(100, ((sMin - dayStartMin) / daySpanMin) * 100));
    const right = Math.max(0, Math.min(100, ((eMin - dayStartMin) / daySpanMin) * 100));
    return { left, width: Math.max(2, right - left) };
  };

  const handleExportCsv = () => {
    const header = 'id,title,mode,startedAt,endedAt,durationMinutes,projectId,loggedToCalendar,note\n';
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = sessions
      .map((s) =>
        [
          escape(s.id),
          escape(s.title),
          escape(s.mode),
          escape(s.startedAt),
          escape(s.endedAt),
          s.durationMinutes,
          escape(s.projectId ?? ''),
          s.loggedToCalendar,
          escape(s.note ?? ''),
        ].join(',')
      )
      .join('\n');
    downloadFile(`focusflow-sessions-${todayYmd}.csv`, header + rows, 'text/csv');
  };

  const handleExportJson = () => {
    downloadFile(
      `focusflow-sessions-${todayYmd}.json`,
      JSON.stringify(sessions, null, 2),
      'application/json'
    );
  };

  const handleExportMarkdown = () => {
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const header = `# FocusFlow Session Logs (${todayYmd})\n\n| Date | Session | Mode | Project | Minutes | Note |\n| --- | --- | --- | --- | ---: | --- |\n`;
    const rows = sessions
      .map((s) => {
        const d = s.startedAt.slice(0, 10);
        const pName = (s.projectId && projectMap.get(s.projectId)) || '—';
        const title = s.title.replace(/\|/g, '\\|');
        const note = (s.note || '—').replace(/\|/g, '\\|');
        return `| ${d} | ${title} | ${s.mode} | ${pName} | ${s.durationMinutes} | ${note} |`;
      })
      .join('\n');
    downloadFile(
      `focusflow-sessions-${todayYmd}.md`,
      header + rows + '\n',
      'text/markdown'
    );
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Today&apos;s Goal</span>
            <Target className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-slate-100">
            {todayMinutes}m{' '}
            <span className="text-xs font-normal text-slate-400">
              / {goal}m ({goalPct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-900 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${goalPct}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
          <div className="text-xs text-slate-400">Focus Streak</div>
          <div className="text-2xl font-bold text-slate-100 mt-1 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            {streakDays} {streakDays === 1 ? 'day' : 'days'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Best streak: {longestStreakDays} {longestStreakDays === 1 ? 'day' : 'days'}
          </div>
        </div>

        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
          <div className="text-xs text-slate-400">Total Focus Time</div>
          <div className="text-2xl font-bold text-slate-100 mt-1 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
          </div>
        </div>

        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
          <div className="text-xs text-slate-400">Completed Blocks</div>
          <div className="text-2xl font-bold text-slate-100 mt-1 flex items-center gap-2">
            <Flame className="w-5 h-5 text-emerald-400" />
            {focusSessions.length}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({focusSessions.filter((s) => s.loggedToCalendar).length} synced)
            </span>
          </div>
        </div>
      </div>

      {/* Planned vs Actual Hourly Bar Timeline */}
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">
            Today: Planned Calendar vs. Actual Focus (06:00 – 22:00)
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-sky-500/70 inline-block" /> Planned
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-indigo-500 inline-block" /> Logged Focus
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex justify-between text-[10px] font-mono text-slate-500 px-0.5">
            {['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'].map(
              (h) => (
                <span key={h}>{h}</span>
              )
            )}
          </div>

          <div className="relative h-7 rounded-lg bg-surface-900 border border-surface-700 overflow-hidden">
            {todayTimedEvents.map((e) => {
              const { left, width } = toPctRange(e.start, e.end);
              const linked = tasks.find(
                (t) => t.linkedEventId === e.id || t.calendarEventId === e.id
              );
              const kids = linked ? getChildren(tasks, linked.id) : [];
              const barLabel =
                linked && kids.length > 0
                  ? `${e.summary} (${kids.length} subtasks)`
                  : linked?.parentId
                    ? getTaskBreadcrumb(tasks, linked.id)
                    : e.summary;
              return (
                <div
                  key={e.id}
                  title={`Planned: ${barLabel} (${formatTime(e.start)}–${formatTime(e.end)})`}
                  className="absolute top-1 bottom-1 rounded bg-sky-500/40 border border-sky-400/50 text-[10px] text-sky-100 px-1 truncate flex items-center"
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {barLabel}
                </div>
              );
            })}
          </div>

          <div className="relative h-7 rounded-lg bg-surface-900 border border-surface-700 overflow-hidden">
            {todayFocusSessions.map((s) => {
              const { left, width } = toPctRange(s.startedAt, s.endedAt);
              return (
                <div
                  key={s.id}
                  title={`Actual: ${s.title} (${s.durationMinutes}m)`}
                  className="absolute top-1 bottom-1 rounded bg-indigo-500/70 border border-indigo-400 text-[10px] text-white px-1 truncate flex items-center"
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {s.title}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Weekly Project Hours + Best Hours Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              Weekly Focus Hours by Project (Last 7d)
            </h3>
            <span className="text-xs text-slate-400">
              {(
                weeklyProjectHours.reduce((acc, x) => acc + x.minutes, 0) / 60
              ).toFixed(1)}
              h total
            </span>
          </div>
          {weeklyProjectHours.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              No focus sessions recorded in the past 7 days.
            </p>
          ) : (
            <div className="space-y-2.5">
              {weeklyProjectHours.map((item) => {
                const maxMins = Math.max(1, weeklyProjectHours[0]?.minutes || 1);
                const pct = Math.max(6, Math.round((item.minutes / maxMins) * 100));
                return (
                  <div key={item.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-200 font-medium">{item.name}</span>
                      <span className="text-slate-400">
                        {(item.minutes / 60).toFixed(1)}h ({item.minutes}m)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-900 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              Best Focus Hours Heatmap
            </h3>
            <span className="text-xs text-indigo-300">
              {peakHour !== null
                ? `Peak: ${String(peakHour).padStart(2, '0')}:00 (${hourlyHeatmap[peakHour]}m)`
                : 'No peak data yet'}
            </span>
          </div>
          <div className="grid grid-cols-9 gap-1.5 pt-1">
            {hourlyHeatmap.slice(6, 24).map((mins, idx) => {
              const hr = idx + 6;
              const maxHr = Math.max(1, ...hourlyHeatmap);
              const intensity = mins > 0 ? Math.max(0.2, mins / maxHr) : 0;
              return (
                <div
                  key={hr}
                  title={`${String(hr).padStart(2, '0')}:00 — ${mins}m focused`}
                  className="rounded-lg border border-surface-700 p-1.5 text-center transition"
                  style={{
                    backgroundColor:
                      intensity > 0
                        ? `rgba(99, 102, 241, ${intensity.toFixed(2)})`
                        : 'rgba(15, 23, 42, 0.5)',
                  }}
                >
                  <div className="text-[10px] font-mono text-slate-300">
                    {String(hr).padStart(2, '0')}
                  </div>
                  <div className="text-[9px] text-slate-200/80">
                    {mins > 0 ? `${mins}m` : '·'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Estimate vs Actual Pomodoros */}
      {estimateVsActual.length > 0 && (
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Target className="w-4 h-4 text-sky-400" />
            Estimate vs. Actual Pomodoros
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {estimateVsActual.map((row) => {
              const delta = row.actual - row.est;
              return (
                <div
                  key={row.id}
                  className="p-2.5 rounded-xl bg-surface-900/60 border border-surface-700 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate text-slate-200 font-medium">
                    {row.title}
                  </span>
                  <div className="flex items-center gap-2 shrink-0 font-mono">
                    <span className="text-slate-400">Est {row.est}p</span>
                    <span className="text-indigo-300">Act {row.actual}p</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        delta === 0
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : delta > 0
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-sky-500/20 text-sky-300'
                      }`}
                    >
                      {delta === 0 ? 'Exact' : delta > 0 ? `+${delta}p` : `${delta}p`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time by Project Breakdown (All Time) */}
      {projectBreakdown.length > 0 && (
        <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            Time by Project
          </h3>
          <div className="space-y-2.5">
            {projectBreakdown.map((item) => {
              const pct =
                totalMinutes > 0
                  ? Math.max(4, Math.round((item.minutes / totalMinutes) * 100))
                  : 0;
              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-200 font-medium">{item.name}</span>
                    <span className="text-slate-400">
                      {item.minutes}m ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-900 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: item.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Session Log + Notes + Export */}
      <div className="rounded-2xl bg-surface-800 border border-surface-600/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-slate-200">
            Session Log & Reflections
          </h3>
          {sessions.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCsv}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={handleExportMarkdown}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5" /> Markdown
              </button>
              <button
                onClick={handleExportJson}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-200 transition"
              >
                <Download className="w-3.5 h-3.5" /> JSON
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {sessions.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">
              Complete a Pomodoro block or Stopwatch run to see your timeline here.
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className="p-3.5 rounded-xl bg-surface-900/60 border border-surface-700/80 space-y-2"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-indigo-300">
                      {formatTime(s.startedAt)} – {formatTime(s.endedAt)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-700 text-slate-300">
                      {s.durationMinutes}m · {s.mode}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-100 mt-1 truncate">
                    {s.title}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => {
                      if (editingNoteId === s.id) {
                        setEditingNoteId(null);
                      } else {
                        setEditingNoteId(s.id);
                        setNoteDraft(s.note ?? '');
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs transition"
                    title="Add or edit reflection / distraction note"
                  >
                    <Pencil className="w-3 h-3" /> {s.note ? 'Edit Note' : 'Note'}
                  </button>
                  {(s.mode === 'focus' || s.mode === 'stopwatch') &&
                    !s.loggedToCalendar && (
                      <button
                        onClick={() => onLogToCalendar(s)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-indigo-500 text-slate-200 hover:text-white text-xs font-medium transition"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                        Log to Calendar
                      </button>
                    )}
                  {s.loggedToCalendar && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Logged
                    </span>
                  )}
                </div>
              </div>

              {s.note && editingNoteId !== s.id && (
                <p className="text-xs text-slate-400 italic pl-2 border-l-2 border-indigo-500/40">
                  {s.note}
                </p>
              )}

              {editingNoteId === s.id && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onUpdateSessionNote(s.id, noteDraft);
                        setEditingNoteId(null);
                      }
                    }}
                    placeholder="What went well or distracted you in this session?"
                    className="flex-1 rounded-lg bg-surface-800 border border-surface-600 px-3 py-1.5 text-xs text-slate-100"
                  />
                  <button
                    onClick={() => {
                      onUpdateSessionNote(s.id, noteDraft);
                      setEditingNoteId(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium"
                  >
                    <Save className="w-3 h-3" /> Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
