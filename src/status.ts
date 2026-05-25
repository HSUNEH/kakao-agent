import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadWhitelist } from './config.js';
import { openMessagesDb } from './database.js';
import { getKeychainStatus } from './keychain.js';
import { getKakaoAgentHome, getMessagesDbPath } from './paths.js';

export interface RuntimeStatus {
  auth: {
    keychainAvailable: boolean;
    credentialStored: boolean;
    account: string | null;
    live: false;
    recoveryReady: boolean;
    reason: string;
  };
  db: {
    path: string;
    exists: boolean;
    permissions: string | null;
    lastMessage: { timestamp: number; logId: number; chatroomId: number } | null;
  };
  whitelist: { path: string; count: number; chatroomIds: number[] };
  daemon: { statePath: string; state: string; pid: number | null; updatedAt: string | null };
  lastError: string | null;
}

const STATE_FILE = 'daemon-state.json';
const LAST_ERROR_FILE = 'last-error.json';

export function ensureRuntimeHome(): void {
  mkdirSync(getKakaoAgentHome(), { recursive: true, mode: 0o700 });
  mkdirSync(getLogsDir(), { recursive: true, mode: 0o700 });
}

export function getLogsDir(): string {
  return join(getKakaoAgentHome(), 'logs');
}

export function getDaemonStatePath(): string {
  return join(getKakaoAgentHome(), STATE_FILE);
}

export function getLastErrorPath(): string {
  return join(getKakaoAgentHome(), LAST_ERROR_FILE);
}

export function getRuntimeStatus(): RuntimeStatus {
  ensureRuntimeHome();
  const whitelist = loadWhitelist();
  const keychain = getKeychainStatus();
  const dbPath = getMessagesDbPath();
  const daemon = readDaemonState();

  return {
    auth: {
      keychainAvailable: keychain.available,
      credentialStored: keychain.accountStored,
      account: keychain.account,
      live: false,
      recoveryReady: keychain.available && keychain.accountStored,
      reason: keychain.accountStored
        ? 'Credentials are present in Keychain; live LOCO session recovery is pending integration.'
        : (keychain.reason ?? 'No credentials stored for recovery.')
    },
    db: {
      path: dbPath,
      exists: existsSync(dbPath),
      permissions: fileMode(dbPath),
      lastMessage: getLastMessage()
    },
    whitelist: {
      path: whitelist.path,
      count: whitelist.chatroomIds.length,
      chatroomIds: whitelist.chatroomIds
    },
    daemon,
    lastError: readLastError()
  };
}

export function writeDaemonState(state: string, pid: number | null = process.pid): void {
  ensureRuntimeHome();
  writeFileSync(
    getDaemonStatePath(),
    `${JSON.stringify({ state, pid, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 }
  );
}

export function writeLastError(error: unknown): void {
  ensureRuntimeHome();
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(
    getLastErrorPath(),
    `${JSON.stringify({ message, at: new Date().toISOString() }, null, 2)}\n`,
    {
      mode: 0o600
    }
  );
}

function getLastMessage(): RuntimeStatus['db']['lastMessage'] {
  const db = openMessagesDb();
  try {
    const row = db
      .prepare<
        [],
        { timestamp: number; logId: number; chatroomId: number }
      >('SELECT timestamp, logId, chatroomId FROM messages ORDER BY timestamp DESC, logId DESC LIMIT 1')
      .get();
    return row ?? null;
  } finally {
    db.close();
  }
}

function readDaemonState(): RuntimeStatus['daemon'] {
  const statePath = getDaemonStatePath();
  if (!existsSync(statePath)) return { statePath, state: 'stopped', pid: null, updatedAt: null };
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<RuntimeStatus['daemon']>;
    return {
      statePath,
      state: parsed.state ?? 'unknown',
      pid: typeof parsed.pid === 'number' ? parsed.pid : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    return { statePath, state: 'invalid-state-file', pid: null, updatedAt: null };
  }
}

function readLastError(): string | null {
  const path = getLastErrorPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message : null;
  } catch {
    return 'last-error.json is not valid JSON';
  }
}

function fileMode(path: string): string | null {
  if (!existsSync(path)) return null;
  return (statSync(path).mode & 0o777).toString(8).padStart(3, '0');
}

export function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}
