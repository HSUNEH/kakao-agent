/* global process */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'node:test';

const RUNTIME_PREFIXES = [
  'KAKAO_',
  'AGENT_KAKAO_',
  'LOCO_',
  'HERMES_',
  'OPENCLAW_',
  'DISCORD_',
  'TELEGRAM_',
  'SLACK_'
];

const ORIGINAL_ENV = { ...process.env };
const allowlist = new Set(
  (ORIGINAL_ENV.KAKAO_AGENT_TEST_ENV_ALLOWLIST ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
);

let activeRuntimeDir = null;

applyIsolatedEnv();

beforeEach(() => {
  cleanupRuntimeDir();
  restoreOriginalEnvSnapshot();
  applyIsolatedEnv();
});

afterEach(() => {
  cleanupRuntimeDir();
  restoreOriginalEnvSnapshot();
  applyIsolatedEnv();
});

function restoreOriginalEnvSnapshot() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function applyIsolatedEnv() {
  for (const key of Object.keys(process.env)) {
    if (allowlist.has(key)) continue;
    if (RUNTIME_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }

  activeRuntimeDir = mkdtempSync(join(tmpdir(), 'kakao-agent-test-'));
  const home = join(activeRuntimeDir, 'home');
  const logs = join(activeRuntimeDir, 'logs');
  const config = join(activeRuntimeDir, 'config');
  const cache = join(activeRuntimeDir, 'cache');
  const state = join(activeRuntimeDir, 'state');

  Object.assign(process.env, {
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_STATE_HOME: state,
    KAKAO_AGENT_HOME: home,
    KAKAO_AGENT_DB: join(home, 'messages.db'),
    KAKAO_AGENT_WHITELIST: join(home, 'whitelist.yaml'),
    KAKAO_AGENT_ROOMS: join(home, 'rooms.yaml'),
    KAKAO_AGENT_LOG_DIR: logs,
    KAKAO_AGENT_TEST_MODE: '1',
    KAKAO_AGENT_TEST_RUNTIME_DIR: activeRuntimeDir,
    KAKAO_AGENT_TEST_ENV_ISOLATED: '1'
  });
}

function cleanupRuntimeDir() {
  if (!activeRuntimeDir) return;
  rmSync(activeRuntimeDir, { recursive: true, force: true });
  activeRuntimeDir = null;
}
