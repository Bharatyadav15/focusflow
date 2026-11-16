import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppData,
  CalendarEvent,
  PomodoroSession,
  TaskItem,
  TimerMode,
  TimerState,
} from '../types';

interface UseTimerControllerParams {
  api: typeof window.electronAPI;
  data: AppData;
  linkedTasks: TaskItem[];
  linkedEvents: CalendarEvent[];
  isFloating: boolean;
  loadData: () => Promise<AppData | undefined>;
  loadTodayEvents: () => Promise<void>;
  notify: (msg: string) => void;
}

export function useTimerController({
  api,
  data,
  linkedTasks,
  linkedEvents,
  isFloating,
  loadData,
  loadTodayEvents,
  notify,
}: UseTimerControllerParams) {
  const [timer, setTimer] = useState<TimerState>({
    mode: 'focus',
    secondsLeft: 25 * 60,
    totalSeconds: 25 * 60,
    isRunning: false,
    targetEndTime: null,
    completedTickId: 0,
    activeTarget: null,
  });

  const sessionStartRef = useRef<string | null>(null);
  const lastHandledTickRef = useRef<number>(0);

  const updateAndBroadcastTimer = useCallback(
    (updater: (prev: TimerState) => TimerState) => {
      setTimer((prev) => {
        const next = updater(prev);
        api?.broadcastTimerState(next);
        return next;
      });
    },
    [api]
  );

  const handleSessionComplete = useCallback(
    async (completedTimer: TimerState) => {
      const endedAt = new Date().toISOString();
      const startedAt =
        completedTimer.sessionStartedAt ??
        sessionStartRef.current ??
        new Date(Date.now() - completedTimer.totalSeconds * 1000).toISOString();
      sessionStartRef.current = null;

      const durationMinutes = Math.max(
        1,
        Math.round(completedTimer.totalSeconds / 60)
      );
      const target = completedTimer.activeTarget;
      const effectiveTaskId =
        target?.type === 'task' ? target.id : target?.linkedTaskId;
      const effectiveEventId =
        target?.type === 'event' ? target.id : target?.calendarEventId;

      const isFocusWork =
        completedTimer.mode === 'focus' || completedTimer.mode === 'stopwatch';

      let loggedToCalendar = Boolean(effectiveEventId);
      if (
        isFocusWork &&
        !effectiveEventId &&
        data.settings.autoLogToCalendar &&
        data.googleConnected &&
        api
      ) {
        try {
          await api.createCalendarEvent({
            calendarId: data.settings.defaultWriteCalendarId || 'primary',
            summary: `Focus: ${target?.title || 'Deep Work'}`,
            description: 'Logged automatically by FocusFlow',
            start: startedAt,
            end: endedAt,
          });
          loggedToCalendar = true;
          loadTodayEvents();
        } catch {
          // Non-fatal
        }
      }

      const session: PomodoroSession = {
        id: `sess-${Date.now()}`,
        title: target?.title || (isFocusWork ? 'Focus Block' : 'Break'),
        taskId: effectiveTaskId,
        calendarEventId: effectiveEventId,
        projectId: target?.projectId,
        mode: completedTimer.mode,
        startedAt,
        endedAt,
        durationMinutes,
        loggedToCalendar,
      };

      if (api) {
        await api.addSession(session);
        if (isFocusWork && effectiveTaskId) {
          const matchedTask = data.tasks.find((t) => t.id === effectiveTaskId);
          const updatedTasks = data.tasks.map((t) => {
            if (t.id !== effectiveTaskId) return t;
            return {
              ...t,
              completedPomodoros: t.completedPomodoros + 1,
              completed: data.settings.autoCompleteTask ? true : t.completed,
            };
          });
          await api.saveTasks(updatedTasks);
          if (
            data.settings.autoCompleteTask &&
            matchedTask?.googleTaskId &&
            matchedTask.googleTaskListId
          ) {
            try {
              await api.toggleGoogleTask(
                matchedTask.googleTaskListId,
                matchedTask.googleTaskId,
                true
              );
            } catch {
              // Saved locally; remote sync will reconcile
            }
          }
        }
        api.notifyDataUpdated();
        await loadData();
      }
    },
    [
      api,
      data.googleConnected,
      data.settings,
      data.tasks,
      loadData,
      loadTodayEvents,
    ]
  );

  // React to authoritative completion from Rust timer loop
  useEffect(() => {
    if (isFloating) return;
    const tickId = timer.completedTickId ?? 0;
    if (tickId > 0 && tickId !== lastHandledTickRef.current) {
      lastHandledTickRef.current = tickId;
      handleSessionComplete(timer);
      let nextMode: TimerMode = 'focus';
      if (timer.mode === 'focus') {
        const count = timer.completedFocusCount ?? 0;
        nextMode = count > 0 && count % 4 === 0 ? 'longBreak' : 'shortBreak';
      }
      const nextSecs =
        (nextMode === 'focus'
          ? data.settings.focusMinutes
          : nextMode === 'longBreak'
            ? data.settings.longBreakMinutes
            : data.settings.shortBreakMinutes) * 60;
      const shouldAutoStart =
        timer.mode === 'focus'
          ? Boolean(data.settings.autoStartBreaks)
          : timer.mode === 'shortBreak' || timer.mode === 'longBreak'
            ? Boolean(data.settings.autoStartFocus)
            : false;
      const nowMs = Date.now();
      updateAndBroadcastTimer((prev) => ({
        ...prev,
        mode: nextMode,
        secondsLeft: nextSecs,
        totalSeconds: nextSecs,
        isRunning: shouldAutoStart,
        targetEndTime: shouldAutoStart ? nowMs + nextSecs * 1000 : null,
        sessionStartedAt: shouldAutoStart ? new Date(nowMs).toISOString() : null,
      }));
    }
  }, [
    data.settings.autoStartBreaks,
    data.settings.autoStartFocus,
    data.settings.focusMinutes,
    data.settings.longBreakMinutes,
    data.settings.shortBreakMinutes,
    handleSessionComplete,
    isFloating,
    timer,
    updateAndBroadcastTimer,
  ]);

  const toggleRunning = useCallback(() => {
    updateAndBroadcastTimer((prev) => {
      const starting = !prev.isRunning;
      const startedIso =
        starting && !prev.sessionStartedAt
          ? new Date().toISOString()
          : prev.sessionStartedAt ?? null;
      if (starting && !sessionStartRef.current) {
        sessionStartRef.current = startedIso;
      }
      if (prev.mode === 'stopwatch') {
        return {
          ...prev,
          isRunning: starting,
          targetEndTime: null,
          sessionStartedAt: startedIso,
          stopwatchStartedAt: starting ? Date.now() : null,
          stopwatchAccumulatedSecs: starting
            ? prev.stopwatchAccumulatedSecs ?? prev.secondsLeft
            : prev.secondsLeft,
        };
      }
      const effectiveSeconds =
        starting && prev.secondsLeft <= 0 ? prev.totalSeconds : prev.secondsLeft;
      return {
        ...prev,
        secondsLeft: effectiveSeconds,
        isRunning: starting,
        sessionStartedAt: startedIso,
        targetEndTime: starting ? Date.now() + effectiveSeconds * 1000 : null,
      };
    });
  }, [updateAndBroadcastTimer]);

  const switchMode = useCallback(
    (mode: TimerMode) => {
      sessionStartRef.current = null;
      if (mode === 'stopwatch') {
        updateAndBroadcastTimer((prev) => ({
          ...prev,
          mode: 'stopwatch',
          secondsLeft: 0,
          totalSeconds: data.settings.focusMinutes * 60,
          isRunning: false,
          targetEndTime: null,
          sessionStartedAt: null,
          stopwatchStartedAt: null,
          stopwatchAccumulatedSecs: 0,
        }));
        return;
      }
      const mins =
        mode === 'focus'
          ? data.settings.focusMinutes
          : mode === 'shortBreak'
            ? data.settings.shortBreakMinutes
            : data.settings.longBreakMinutes;
      updateAndBroadcastTimer((prev) => ({
        ...prev,
        mode,
        secondsLeft: mins * 60,
        totalSeconds: mins * 60,
        isRunning: false,
        targetEndTime: null,
        sessionStartedAt: null,
        stopwatchStartedAt: null,
        stopwatchAccumulatedSecs: 0,
      }));
    },
    [
      data.settings.focusMinutes,
      data.settings.longBreakMinutes,
      data.settings.shortBreakMinutes,
      updateAndBroadcastTimer,
    ]
  );

  const resetTimer = useCallback(() => {
    sessionStartRef.current = null;
    updateAndBroadcastTimer((prev) => ({
      ...prev,
      secondsLeft: prev.mode === 'stopwatch' ? 0 : prev.totalSeconds,
      isRunning: false,
      targetEndTime: null,
      sessionStartedAt: null,
      stopwatchStartedAt: null,
      stopwatchAccumulatedSecs: 0,
      activeTarget: null,
    }));
  }, [updateAndBroadcastTimer]);

  const finishStopwatch = useCallback(() => {
    if (timer.mode !== 'stopwatch') return;
    if (timer.secondsLeft < 10) {
      sessionStartRef.current = null;
      updateAndBroadcastTimer((prev) => ({
        ...prev,
        secondsLeft: 0,
        isRunning: false,
        sessionStartedAt: null,
        stopwatchStartedAt: null,
        stopwatchAccumulatedSecs: 0,
        activeTarget: null,
      }));
      notify('Stopwatch under 10s not logged');
      return;
    }
    const elapsedSecs = timer.secondsLeft;
    handleSessionComplete({
      ...timer,
      totalSeconds: elapsedSecs,
      secondsLeft: 0,
      isRunning: false,
    });
    sessionStartRef.current = null;
    updateAndBroadcastTimer((prev) => ({
      ...prev,
      secondsLeft: 0,
      isRunning: false,
      sessionStartedAt: null,
      stopwatchStartedAt: null,
      stopwatchAccumulatedSecs: 0,
      activeTarget: null,
    }));
  }, [handleSessionComplete, notify, timer, updateAndBroadcastTimer]);

  const extendTimer = useCallback(
    (minutes: number) => {
      const addSecs = minutes * 60;
      const target = timer.activeTarget;
      const anchorEventId =
        target?.calendarEventId ||
        (target?.type === 'event' ? target.id : undefined);
      updateAndBroadcastTimer((prev) => ({
        ...prev,
        secondsLeft: prev.secondsLeft + addSecs,
        totalSeconds: prev.totalSeconds + addSecs,
        targetEndTime: prev.targetEndTime
          ? prev.targetEndTime + addSecs * 1000
          : null,
      }));
      if (anchorEventId && api?.shiftFollowingBlocks) {
        void api.shiftFollowingBlocks(anchorEventId, minutes).then((res) => {
          if (res?.shifted && res.shifted.length > 0) {
            notify(
              `Extended +${minutes}m & auto-shifted ${res.shifted.length} following block(s)`
            );
            void loadTodayEvents();
          }
        });
      }
    },
    [api, loadTodayEvents, notify, timer.activeTarget, updateAndBroadcastTimer]
  );

  const startFocusOnTarget = useCallback(
    (target: TimerState['activeTarget'], asStopwatch = false) => {
      const startedIso = new Date().toISOString();
      sessionStartRef.current = startedIso;

      let resolvedMins = target?.durationMinutes;
      let resolvedNextSubtask = target?.nextSubtask;
      const lookupTaskId =
        target?.type === 'task' ? target.id : target?.linkedTaskId;
      if (lookupTaskId) {
        const matchedTask = linkedTasks.find((t) => t.id === lookupTaskId);
        if (matchedTask) {
          if (!resolvedNextSubtask) {
            resolvedNextSubtask = matchedTask.subtasks?.find(
              (st) => !st.done
            )?.title;
          }
          if (!resolvedMins || resolvedMins <= 0) {
            if (matchedTask.durationMinutes && matchedTask.durationMinutes > 0) {
              resolvedMins = matchedTask.durationMinutes;
            } else if (matchedTask.scheduledStart && matchedTask.scheduledEnd) {
              const diff = Math.round(
                (new Date(matchedTask.scheduledEnd).getTime() -
                  new Date(matchedTask.scheduledStart).getTime()) /
                  60_000
              );
              if (diff > 0) resolvedMins = diff;
            } else if (matchedTask.linkedEventId) {
              const evt = linkedEvents.find(
                (e) => e.id === matchedTask.linkedEventId
              );
              if (evt && !evt.isAllDay) {
                const diff = Math.round(
                  (new Date(evt.end).getTime() -
                    new Date(evt.start).getTime()) /
                    60_000
                );
                if (diff > 0) resolvedMins = diff;
              }
            }
          }
        }
      }

      const effectiveMins =
        resolvedMins && resolvedMins > 0
          ? resolvedMins
          : data.settings.focusMinutes;

      if (asStopwatch) {
        updateAndBroadcastTimer((prev) => ({
          ...prev,
          mode: 'stopwatch',
          secondsLeft: 0,
          totalSeconds: effectiveMins * 60,
          isRunning: true,
          targetEndTime: null,
          sessionStartedAt: startedIso,
          stopwatchStartedAt: Date.now(),
          stopwatchAccumulatedSecs: 0,
          activeTarget: target
            ? {
                ...target,
                durationMinutes: effectiveMins,
                nextSubtask: resolvedNextSubtask,
              }
            : null,
        }));
        api?.openFloatingWindow();
        return;
      }

      const secs = effectiveMins * 60;
      updateAndBroadcastTimer((prev) => ({
        ...prev,
        mode: 'focus',
        secondsLeft: secs,
        totalSeconds: secs,
        isRunning: true,
        targetEndTime: Date.now() + secs * 1000,
        sessionStartedAt: startedIso,
        stopwatchStartedAt: null,
        stopwatchAccumulatedSecs: 0,
        activeTarget: target
          ? {
              ...target,
              durationMinutes: effectiveMins,
              nextSubtask: resolvedNextSubtask,
            }
          : null,
      }));
      api?.openFloatingWindow();
    },
    [
      api,
      data.settings.focusMinutes,
      linkedEvents,
      linkedTasks,
      updateAndBroadcastTimer,
    ]
  );

  return {
    timer,
    setTimer,
    handleSessionComplete,
    toggleRunning,
    switchMode,
    resetTimer,
    finishStopwatch,
    extendTimer,
    startFocusOnTarget,
  };
}
