import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWhitelist } from '../config.js';
import {
  getBootstrapInstallTime,
  insertBackfillMessages,
  openMessagesDb,
  setBootstrapInstallTime
} from '../database.js';
import { getExportsDir } from '../paths.js';
import { loadRoomAliases } from '../rooms.js';
import { parseKakaoExportText } from './parser.js';
import { checkBootstrapPreflight } from './preflight.js';
import {
  defaultRoomState,
  getOrCreateInstallTime,
  loadBootstrapState,
  saveBootstrapState
} from './state.js';
import type { BootstrapRoomConfig, ParseExportStats } from './types.js';

export interface BootstrapOptions {
  fixtureDir?: string;
  exportFile?: string;
  roomId?: number;
  force?: boolean;
  retryBaseMs?: number;
  maxAttempts?: number;
  skipPreflight?: boolean;
  installTime?: string;
}

export interface BootstrapRoomResult {
  roomId: number;
  roomName: string;
  state: 'skipped' | 'success' | 'failed';
  attempts: number;
  inserted: number;
  skipped: number;
  replaced: number;
  stats: ParseExportStats | null;
  error: string | null;
}

export interface BootstrapResult {
  ok: boolean;
  install_time: string;
  rooms: BootstrapRoomResult[];
}

interface ExportPayload {
  text: string;
  path: string;
}

interface ExportProvider {
  kind: 'fixture-directory' | 'single-file' | 'preexported-directory';
  requiresPreflight: boolean;
  readText(room: BootstrapRoomConfig): ExportPayload;
}

export async function runBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const exportProvider = createExportProvider(options);
  if (exportProvider.requiresPreflight) {
    checkBootstrapPreflight(
      options.skipPreflight === undefined ? {} : { skip: options.skipPreflight }
    );
  }

  const rooms = resolveRooms(options);
  const state = loadBootstrapState();
  let installTime = getOrCreateInstallTime(state, options.installTime ?? new Date().toISOString());
  const db = openMessagesDb();
  try {
    installTime = getBootstrapInstallTime(db) ?? installTime;
    state.install_time = installTime;
    setBootstrapInstallTime(db, installTime);
  } finally {
    db.close();
  }
  saveBootstrapState(state);

  const results: BootstrapRoomResult[] = [];
  const maxAttempts = options.maxAttempts ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 500;

  for (const room of rooms) {
    const key = String(room.roomId);
    const current = state.rooms[key] ?? defaultRoomState();
    if (current.bootstrap_state === 'success' && options.force !== true) {
      results.push({
        roomId: room.roomId,
        roomName: room.roomName ?? `chatroom:${room.roomId}`,
        state: 'skipped',
        attempts: current.retry_count,
        inserted: 0,
        skipped: 0,
        replaced: 0,
        stats: null,
        error: null
      });
      continue;
    }

    let result: BootstrapRoomResult | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      state.rooms[key] = {
        bootstrap_state: 'in_progress',
        retry_count: attempt,
        last_error: null,
        completed_at: null
      };
      saveBootstrapState(state);
      try {
        result = processRoom(room, exportProvider, installTime, options.force === true);
        result.attempts = attempt;
        state.rooms[key] = {
          bootstrap_state: 'success',
          retry_count: attempt,
          last_error: null,
          completed_at: new Date().toISOString()
        };
        saveBootstrapState(state);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          roomId: room.roomId,
          roomName: room.roomName ?? `chatroom:${room.roomId}`,
          state: 'failed',
          attempts: attempt,
          inserted: 0,
          skipped: 0,
          replaced: 0,
          stats: null,
          error: message
        };
        state.rooms[key] = {
          bootstrap_state: 'failed',
          retry_count: attempt,
          last_error: message,
          completed_at: null
        };
        saveBootstrapState(state);
        if (attempt < maxAttempts) await delay(retryBaseMs * 2 ** (attempt - 1));
      }
    }
    if (result) results.push(result);
  }

  return {
    ok: results.every((result) => result.state !== 'failed'),
    install_time: installTime,
    rooms: results
  };
}

function resolveRooms(options: BootstrapOptions): BootstrapRoomConfig[] {
  const whitelist = loadWhitelist();
  const aliases = loadRoomAliases().aliases;
  if (options.roomId !== undefined && !whitelist.chatroomIds.includes(options.roomId)) {
    throw new Error(
      `Room ${options.roomId} is not whitelisted; run kakao-agent whitelist add first.`
    );
  }
  if (options.exportFile && options.roomId === undefined && whitelist.chatroomIds.length !== 1) {
    throw new Error('--export-file requires --room unless exactly one room is whitelisted.');
  }
  const roomIds = options.roomId === undefined ? whitelist.chatroomIds : [options.roomId];
  if (roomIds.length === 0) throw new Error('No whitelisted rooms to bootstrap. Add rooms first.');
  return roomIds.map((roomId) => {
    const roomName = aliases[String(roomId)] ?? `chatroom:${roomId}`;
    const config: BootstrapRoomConfig = { roomId, roomName };
    if (options.exportFile) config.exportFilePath = options.exportFile;
    return config;
  });
}

function processRoom(
  room: BootstrapRoomConfig,
  exportProvider: ExportProvider,
  installTimeIso: string,
  replaceExisting: boolean
): BootstrapRoomResult {
  const payload = exportProvider.readText(room);
  const installTimeMs = Date.parse(installTimeIso);
  const parsed = parseKakaoExportText(payload.text, {
    chatroomId: room.roomId,
    roomDisplayName: room.roomName ?? `chatroom:${room.roomId}`,
    defaultTimestamp: installTimeMs - 1,
    collectedAt: Date.now()
  });
  const db = openMessagesDb();
  try {
    const write = insertBackfillMessages(
      db,
      parsed.messages,
      installTimeIso,
      replaceExisting ? { replaceRoomId: room.roomId } : {}
    );
    return {
      roomId: room.roomId,
      roomName: room.roomName ?? `chatroom:${room.roomId}`,
      state: 'success',
      attempts: 1,
      inserted: write.inserted,
      skipped: write.skipped,
      replaced: write.replaced,
      stats: parsed.stats,
      error: null
    };
  } finally {
    db.close();
  }
}

function createExportProvider(options: BootstrapOptions): ExportProvider {
  if (options.exportFile) return new SingleFileExportProvider(options.exportFile);
  return new DirectoryExportProvider(
    options.fixtureDir ?? getExportsDir(),
    options.fixtureDir ? 'fixture-directory' : 'preexported-directory'
  );
}

class SingleFileExportProvider implements ExportProvider {
  readonly kind = 'single-file' as const;
  readonly requiresPreflight = false;

  constructor(private readonly filePath: string) {}

  readText(): ExportPayload {
    return readExportFile(this.filePath, this.kind);
  }
}

class DirectoryExportProvider implements ExportProvider {
  readonly requiresPreflight: boolean;

  constructor(
    private readonly directoryPath: string,
    readonly kind: 'fixture-directory' | 'preexported-directory'
  ) {
    this.requiresPreflight = kind === 'preexported-directory';
  }

  readText(room: BootstrapRoomConfig): ExportPayload {
    return readExportFile(resolveExportPath(room.roomId, this.directoryPath), this.kind);
  }
}

function readExportFile(filePath: string, providerKind: ExportProvider['kind']): ExportPayload {
  if (!existsSync(filePath)) {
    throw new Error(
      `No KakaoTalk export text file found at ${filePath} via ${providerKind}. ` +
        'Provide --fixture-dir or --export-file; live Accessibility export is intentionally behind a future ExportProvider.'
    );
  }
  return { text: readFileSync(filePath, 'utf8'), path: filePath };
}

function resolveExportPath(roomId: number, fixtureDir: string | undefined): string {
  const baseDir = fixtureDir ?? getExportsDir();
  return join(baseDir, `${roomId}.txt`);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
