# FocusFlow

A Windows desktop focus and productivity app built with **Tauri v2 (Rust) + React + TypeScript + Vite + Tailwind CSS**, featuring a Pomodoro/stopwatch timer, two-way Google Calendar & Google Tasks sync, projects & templates, focus analytics, idle/distraction protection, and a local MCP & HTTP tool server.

---

## Prerequisites & Setup

1. Install **Node.js (LTS)** from https://nodejs.org/ and the **Rust toolchain** from https://rustup.rs/.
2. On Windows, ensure **Microsoft C++ Build Tools** (Desktop development with C++) and **Microsoft Edge WebView2 Runtime** are installed.
3. Install dependencies and build:

   ```powershell
   npm install
   npm run dev              # Frontend Vite dev server (port 5173)
   npm run tauri:build      # Builds dist/, compiles release binary, stops any running FocusFlow.exe, and copies FocusFlow.exe
   npm run package:windows  # Creates release-portable/FocusFlow-Windows-Portable.zip
   ```

   > **First-Run Setup**: Fresh installs start with no demo data (`demoMode: false`) and open a setup wizard to configure work hours (default `9–18`), daily focus goal (default `180` min), Google calendars, and an optional Obsidian daily-notes vault folder.

### Connecting Google Calendar & Google Tasks

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. Enable both **Google Calendar API** and **Google Tasks API**.
3. Configure the **OAuth consent screen** (External) and add your Google account under **Test users**.
4. Go to **Credentials → Create Credentials → OAuth client ID** and choose **Desktop app**.
5. Copy your **Client ID** (and **Client Secret** if provided) into FocusFlow's **Settings** tab and click **Sign in with Google**. Background sync runs automatically every **120 seconds** (with offline mutation queuing) and shows a live sync timestamp in the header and floating drawer.

---

## Floating Widget Behaviour

FocusFlow includes one unified always-on-top floating widget paired with the system tray (`Toggle Floating Widget`) that shares live timer state with the main dashboard:

- **Fill & Color States**:
  - **Focus (`focus`)**: Displays the active task/event title and `MM:SS`, draining the bar from 100% → 0%. Runs in **indigo** (`#6366f1`), turns **amber** (`#f59e0b`) at ≤ 20% left while running, and **red/rose** (`#f43f5e`) during the final 60 seconds while running.
  - **Breaks (`shortBreak` / `longBreak`)**: Fill up from 0% → 100% (`#10b981` emerald for short break, `#38bdf8` sky blue for long break).
  - **Stopwatch (`stopwatch`)**: Cycles an **amber** (`#f59e0b`) fill bar.
  - **Paused**: Applies grayscale dimming to the fill and blinks the `MM:SS` countdown (`ff-blink`).
- **Clicking & Hover Dots (`⋮`)**:
  - Clicking the `MM:SS` readout pauses or resumes the timer.
  - Clicking elsewhere on the pill toggles the expanded Tasks & Schedule drawer.
  - Hovering the compact pill (or peeking a docked bar) reveals the **`⋮`** menu button to open the large drawer view (when expanded while a timer is active, the bottom turns into a full capsule with Play/Pause, `+5`, Complete, Stop, Soundscape, Blocker toggle, and Pull-Up/Down arrow).
- **Auto-Collapse & Keep-Open Rules**:
  - The large drawer automatically collapses **2.5 seconds (`2500ms`)** after the cursor leaves it.
  - Clicking the **Pin** icon (`pin`), having non-empty text in **Quick-Add**, or actively **editing a task title** keeps the drawer open against the leave timer (note: losing window focus collapses unless pinned).
- **Screen-Edge Docking**:
  - Dragging and dropping the pill within **14 logical pixels** of any monitor edge (`left`, `right`, `top`, `bottom`) docks it as a thin **96×8 px** (horizontal) or **8×96 px** (vertical) bar showing only the progress fill.
  - Hovering peeks/expands the compact pill, and the docked edge (`taskbarDock`) is saved in `focusflow-data.json` across restarts. Docked `top` opens the drawer downward; other edges open upward.
- **Session Completion & Break Prompt**:
  - Completing a session flashes green (`ff-celebrate`) for ~3 seconds with `"Session complete!"` and confetti, then prompts **`Stretch — N min break`** with **Start** and **Skip (`×`)** buttons.
- **Drawer Header**:
  - Shows your consecutive-day **`Nd streak`** badge, **`Today Xm / Ym`** focus progress text, and a daily-goal progress bar beneath the `Tasks / Schedule` header.

---

## Local MCP & AI Server (`http://127.0.0.1:27182`)

FocusFlow exposes a Bearer-authenticated HTTP + JSON-RPC 2.0 MCP server at `http://127.0.0.1:27182/mcp` (OpenAI/Gemini declarations at `GET /api/tools`, direct calls at `POST /api/tool`, health at `GET /api/status`), plus three MCP resources:
- `focusflow://today` — active timer, today's events, and open tasks
- `focusflow://projects` — all projects and milestones
- `focusflow://stats` — computed focus statistics JSON

### Consolidated 11-Tool Surface (`src-tauri/src/ai_tools.rs`)

> **Project Model:** **Projects** organize existing **tasks** and **calendar events** (the smallest actionable work items). **Milestones** are optional outcome checkpoints (e.g. *"Publish ten story summaries"*). **Groups/lists** (`project_list`) are optional containers (e.g. *"Summary sessions"*) that organize tasks and events—not tasks themselves, and not required to attach work to a project. Calendar events require an explicit `start` time; when only a day or flexible time is given, use a dated task (`manage_task` with `due_date`) or ask for times instead of fabricating event times.

1. **`get_overview`** — Snapshot of timer, Today or Week tasks and calendar events (with `projectId`, `projectName`, `projectListId`, `groupTitle`), project summaries, sync & MCP status. Supports `range: "today" | "week"`, `date`, and `detail: true`.
   ```json
   { "range": "week", "date": "today", "detail": false }
   ```
2. **`manage_task`** — Actions: `list`, `add`, `update`, `complete`, `delete`, `move`, `subtask` (with `subtask_action`: `add | toggle | remove`), plus `project_id`, optional `project_list_id` (group/list ID validated against `project_id`), `linked_event_id`, `notes`, `recurrence` (`none | daily | weekdays | weekly`), `blocked_by_task_ids`, `note_link`, and `dry_run`.
   ```json
   { "action": "add", "title": "Write Q4 spec", "priority": 1, "due_date": "today", "project_id": "proj-1", "project_list_id": "plist-1", "notes": "Draft outline first" }
   ```
3. **`manage_event`** — Actions: `list`, `add`, `update`, `reschedule`, `delete`, `convert_to_task`, `find_free_slots`, plus `project_id`, optional `project_list_id` (group/list ID validated against `project_id`), `description` (event notes), `priority` (`1`–`5`), `linked_task_id`, and `dry_run`. Requires an explicit `start` time for `add` (never fabricates times).
   ```json
   { "action": "add", "summary": "Add stories 1-2", "start": "2026-11-17 10:00", "duration_minutes": 60, "project_id": "proj-1", "project_list_id": "plist-1", "description": "Focus on folklore motifs" }
   ```
4. **`manage_project`** — Actions: `list` (pass `project_id` or `name_match` to retrieve groups, milestones, tasks, and events), `save` (supports `description` / `notes`), `delete`, `milestone` (`milestone_action`: `add | toggle | remove | update`, optional `required_task_ids` gating), and `project_list` (`list_action`: `add | rename | move | delete`, optional `parent_list_id`; deleting a group safely unassigns its tasks/events without deleting them), plus `dry_run`.
   ```json
   { "action": "project_list", "project_id": "proj-1", "list_action": "add", "list_title": "Summary sessions" }
   ```
5. **`manage_template`** — Actions: `list`, `save`, `apply`, `delete`, plus `dry_run`.
   ```json
   { "action": "apply", "name": "Deep Work Sprint", "due_date": "today" }
   ```
6. **`plan_my_day`** — Batch-schedules unblocked priority tasks into open work-hour gaps, or schedules a single task via `task_id` / `title_match`; supports `dry_run`.
   ```json
   { "date": "today", "dry_run": true }
   ```
7. **`control_timer`** — Actions: `status`, `start`, `pause`, `resume`, `reset`, `extend` (with `auto_shift_next` default `true` to push overflowing following blocks forward), plus `dry_run`. Note: `status` is read-only and does not write an audit entry.
   ```json
   { "action": "status" }
   ```
8. **`get_focus_stats`** — Formats: `summary` (default compact stats with sparse non-zero `bestHoursHeatmap`), `json` (adds `recentSessions` & full `projectBreakdown`), `csv`, `markdown`.
   ```json
   { "format": "summary" }
   ```
9. **`undo_last`** — Reverts the most recent undoable entry in `ai-audit.log` (or a specific `id`), including deleting AI-created tasks/events or removing spawned recurring copies; supports `dry_run`.
   ```json
   { "dry_run": true }
   ```
10. **`shutdown_review`** — Summarizes planned vs. done tasks and focus sessions for `date`, optionally rolls unfinished tasks to tomorrow (`roll_unfinished`), and optionally appends/writes Markdown to the configured Obsidian vault (`write_obsidian`); supports `dry_run`.
    ```json
    { "date": "today", "roll_unfinished": true, "write_obsidian": true, "dry_run": true }
    ```
11. **`set_reminder`** — Schedules a Windows toast notification at `at` (`"HH:MM"`, `"+20m"`, `"+2h"`, ISO-8601) or `in_minutes`; supports `dry_run`.
    ```json
    { "title": "Stand up & stretch", "in_minutes": 45 }
    ```

### Action Synonyms, `dry_run`, `undo_last`, and Recurrence

- **Action Synonyms** (`normalize_tool_call` in `src-tauri/src/ai_audit.rs` & handlers in `src-tauri/src/ai_tools.rs`):
  - `manage_task`: `create` / `new` → `add` · `edit` / `patch` → `update` · `done` / `finish` → `complete` · `remove` → `delete` · `subtasks` → `subtask`
  - `manage_event`: `create` / `new` / `schedule` → `add` · `move` → `reschedule` · `remove` → `delete`
  - `manage_project`: `create` / `add` / `update` → `save` · `remove` → `delete` · `milestones` → `milestone`
  - `manage_template`: `create` / `add` / `update` → `save` · `instantiate` / `use` → `apply` · `remove` → `delete`
  - `control_timer`: `begin` / `play` → `start` · `continue` / `unpause` → `resume` · `stop` / `clear` → `reset`
- **`dry_run` & `undo_last`**: Every mutating MCP tool accepts `dry_run: true` to preview changes without saving or writing to `ai-audit.log`. Live audited mutations record an `undo` payload (reverting task/event/project/template edits, restoring deleted items, cancelling reminders, removing planned blocks, and deleting AI-created tasks/events) so `undo_last` (or the Command Palette **AI Undo**) can roll them back.
- **Recurring Tasks**: Completing a recurring task (via the UI or MCP `manage_task` `complete`) spawns the next local occurrence and—if linked to Google Tasks—creates the next copy in the same Google Task list. Calling `undo_last` restores the original task (locally and on Google) and deletes the spawned recurring copy from both FocusFlow and Google Tasks.

---

## Data, Files & Stdio MCP Bridge

All runtime data and logs live under **`%APPDATA%\focusflow\`**:

| File | Purpose |
| --- | --- |
| `focusflow-data.json` (and `.bak`) | Tasks, projects, templates, sessions, reminders, settings, sync queue, docked edge (`google_tokens` and `google_client_secret` are moved into Windows Credential Manager under service `FocusFlow` when available) |
| `ai-token` | 32-byte random hex Bearer token generated on startup and read fresh on every bridge call |
| `ai-audit.log` (rotates at ~2 MB to `.log.1`) | JSONL trail of audited AI tool calls and undo snapshots |
| `focusflow.log` (rotates at ~1 MB to `.log.1`) | App lifecycle, tray actions, Google sync, idle/distraction guard, reminders, and MCP error logs |
| `mcp-bridge.log` | Stdio bridge autostart and connectivity diagnostics |

### How `focusflow-mcp.mjs` Works

Run `node focusflow-mcp.mjs` as your stdio MCP command (set `FOCUSFLOW_EXE` to override `FocusFlow.exe` next to the script). On incoming JSON-RPC lines, it checks `GET http://127.0.0.1:27182/api/status`. If FocusFlow is not running, it spawns `FocusFlow.exe --autostart` once (detached, tray-only) and polls health for up to **5 seconds** (`HEALTH_TIMEOUT_MS = 5000`); if still unreachable, it immediately returns a JSON-RPC `-32000` error saying FocusFlow is not running rather than hanging, with a **15-second** (`REQUEST_TIMEOUT_MS = 15000`) per-call timeout on `/mcp`.

---

## Idle Detection & Distraction Guard

Configured in **Settings** (with a quick **Blocker** toggle in the Floating Widget):

- **Idle Auto-Pause (`idlePauseMinutes`)**: Default **`5` minutes** (`0` disables). Uses Win32 `GetLastInputInfo` every 2 seconds while a focus or stopwatch timer is running; pauses the timer at the threshold, shows a toast, and prompts **`Log Xm / Resume / Discard`** on return (`idle:returned`).
- **Distraction Guard (`distractionGuardEnabled`)**: Default **`false` (off)**. When enabled alongside `blockedAppsOrSites` (default `[]`), checks the active foreground window title and executable path every 2 seconds (`SW_MINIMIZE` when matched), including domain-to-title matching for active browser tabs in **Zen Browser**, Chrome, and Edge.

---

## Troubleshooting

- **"FocusFlow app is not running" (MCP bridge error)**: Verify `FocusFlow.exe` exists in the project root (or set `FOCUSFLOW_EXE`), check the system tray icon tooltip for MCP port `27182`, and inspect `%APPDATA%\focusflow\mcp-bridge.log` and `focusflow.log`.
- **Locked `FocusFlow.exe` during rebuild**: Run `npm run tauri:build` (which runs `taskkill /IM FocusFlow.exe /F` before copying the release executable) or right-click the tray icon and choose **Quit FocusFlow** before copying `src-tauri\target\release\focusflow.exe`.
- **Stale MCP tool list or 401 after rebuilding/restarting**: Restart or reconnect your MCP client session (e.g. Hermes/Claude/Cursor) so it refreshes `tools/list` and re-reads `%APPDATA%\focusflow\ai-token`.
