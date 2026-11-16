#!/usr/bin/env node
/**
 * FocusFlow Stdio MCP Bridge for Gemini, Antigravity, Hermes & Claude
 * Forwards Stdio JSON-RPC 2.0 MCP messages to FocusFlow's local AI Control Server
 * at http://127.0.0.1:27182/mcp (auto-starting FocusFlow.exe once if needed).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://127.0.0.1:27182';
const STATUS_URL = `${BASE_URL}/api/status`;
const MCP_URL = `${BASE_URL}/mcp`;
const EXE_PATH = process.env.FOCUSFLOW_EXE || join(__dirname, 'FocusFlow.exe');
const DATA_DIR = join(process.env.APPDATA || '', 'focusflow');
const TOKEN_PATH = join(DATA_DIR, 'ai-token');
const LOG_PATH = join(DATA_DIR, 'mcp-bridge.log');

const HEALTH_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

function logBridge(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(LOG_PATH, line, 'utf8');
  } catch {
    // Non-fatal
  }
}

// Read fresh each time so a regenerated token is picked up automatically.
function readToken() {
  try {
    return readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

let launchAttempted = false;

async function checkHealth(timeoutMs = 500) {
  try {
    const res = await fetch(STATUS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServerRunning() {
  if (await checkHealth(600)) {
    return { ok: true };
  }

  if (launchAttempted) {
    return {
      ok: false,
      reason: `FocusFlow app is not running and did not respond within ${HEALTH_TIMEOUT_MS / 1000}s.`,
    };
  }

  if (!existsSync(EXE_PATH)) {
    const reason = `FocusFlow app is not running and executable was not found at ${EXE_PATH}.`;
    logBridge(`ERROR: ${reason}`);
    return { ok: false, reason };
  }

  launchAttempted = true;
  logBridge(`Spawning ${EXE_PATH} --autostart`);
  try {
    const child = spawn(EXE_PATH, ['--autostart'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    const reason = `Failed to launch ${EXE_PATH}: ${err instanceof Error ? err.message : String(err)}`;
    logBridge(`ERROR: ${reason}`);
    return { ok: false, reason };
  }

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (await checkHealth(500)) {
      logBridge('FocusFlow AI server came online after autostart.');
      return { ok: true };
    }
  }

  const reason = `FocusFlow app is not running (health check timed out after 5s at ${STATUS_URL}). Start FocusFlow.exe manually or check %APPDATA%\\focusflow\\focusflow.log.`;
  logBridge(`ERROR: ${reason}`);
  return { ok: false, reason };
}

function writeJsonRpcError(id, code, message) {
  if (id === undefined || id === null) return;
  process.stdout.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    }) + '\n'
  );
}

const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const health = await ensureServerRunning();
  if (!health.ok) {
    writeJsonRpcError(parsed?.id, -32000, health.reason);
    return;
  }

  try {
    const resp = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readToken()}`,
      },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (resp.status === 202) {
      return;
    }

    if (resp.status === 401 || resp.status === 403) {
      writeJsonRpcError(
        parsed?.id,
        -32001,
        `FocusFlow rejected the request (HTTP ${resp.status}). Check that ${TOKEN_PATH} exists, and reconnect/refresh your MCP client session if FocusFlow was restarted.`
      );
      return;
    }

    const text = await resp.text();
    if (text && text.trim()) {
      const compact = JSON.stringify(JSON.parse(text));
      process.stdout.write(compact + '\n');
    }
  } catch (err) {
    const msg = `FocusFlow AI server unreachable at ${MCP_URL}: ${
      err instanceof Error ? err.message : String(err)
    }. If FocusFlow was restarted, reconnect or refresh your MCP client session.`;
    logBridge(`ERROR: ${msg}`);
    writeJsonRpcError(parsed?.id, -32000, msg);
  }
});
