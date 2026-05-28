import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { getBootstrapStatePath } from '../paths.js';
import type { BootstrapRoomState, BootstrapStateFile } from './types.js';

export function loadBootstrapState(path = getBootstrapStatePath()): BootstrapStateFile {
  if (!existsSync(path)) return { install_time: null, rooms: {} };
  const raw = readFileSync(path, 'utf8');
  const parsed = parse(raw) as unknown;
  if (!isRecord(parsed)) return { install_time: null, rooms: {} };
  const rooms = isRecord(parsed.rooms) ? parsed.rooms : {};
  return {
    install_time: typeof parsed.install_time === 'string' ? parsed.install_time : null,
    rooms: normalizeRooms(rooms)
  };
}

export function saveBootstrapState(
  state: BootstrapStateFile,
  path = getBootstrapStatePath()
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function getOrCreateInstallTime(state: BootstrapStateFile, nowIso: string): string {
  if (state.install_time) return state.install_time;
  state.install_time = nowIso;
  return state.install_time;
}

export function defaultRoomState(): BootstrapRoomState {
  return { bootstrap_state: 'pending', retry_count: 0, last_error: null, completed_at: null };
}

function normalizeRooms(value: Record<string, unknown>): Record<string, BootstrapRoomState> {
  const rooms: Record<string, BootstrapRoomState> = {};
  for (const [roomId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const bootstrapState = normalizeStateValue(raw.bootstrap_state);
    rooms[roomId] = {
      bootstrap_state: bootstrapState,
      retry_count: typeof raw.retry_count === 'number' ? raw.retry_count : 0,
      last_error: typeof raw.last_error === 'string' ? raw.last_error : null,
      completed_at: typeof raw.completed_at === 'string' ? raw.completed_at : null
    };
  }
  return rooms;
}

function normalizeStateValue(value: unknown): BootstrapRoomState['bootstrap_state'] {
  if (value === 'in_progress' || value === 'success' || value === 'failed') return value;
  return 'pending';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
