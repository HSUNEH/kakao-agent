import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { getMessagesDbPath } from './paths.js';
import { resolveRoomDisplayName } from './rooms.js';
import type { MessageSource, ParsedExportMessage, ParseStatus } from './bootstrap/types.js';

export interface MessageResult {
  speaker: string;
  roomName: string;
  chatroomId: number;
  timestamp: number;
  logId: number;
  content: string | null;
}

interface MessageRow {
  senderName: string | null;
  senderId: string | number | null;
  roomDisplayName: string | null;
  chatroomId: number;
  timestamp: number;
  logId: number;
  content: string | null;
  messageType: string | null;
  mediaMeta: string | null;
  systemEventType: string | null;
}

interface MessageColumnRow {
  name: string;
}

interface RoomContext {
  displayName: string;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function openMessagesDb(): Database.Database {
  const dbPath = getMessagesDbPath();
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const existed = existsSync(dbPath);
  const db = new Database(dbPath);
  if (!existed) chmodSync(dbPath, 0o600);
  ensureSchema(db);
  return db;
}

export function searchMessages(options: {
  query: string;
  whitelistedRoomIds: number[];
  limit?: number;
}): MessageResult[] {
  const query = options.query.trim();
  validateQuery(query);

  if (options.whitelistedRoomIds.length === 0) return [];

  const limit = normalizeLimit(options.limit);
  const placeholders = options.whitelistedRoomIds.map(() => '?').join(', ');
  const db = openMessagesDb();
  try {
    const statement = db.prepare<unknown[], MessageRow>(`
      SELECT senderName, senderId, roomDisplayName, chatroomId, timestamp, logId, content,
             messageType, mediaMeta, systemEventType
      FROM messages
      WHERE chatroomId IN (${placeholders})
        AND isDeleted = 0
        AND content IS NOT NULL
        AND content LIKE ? ESCAPE '\\'
      ORDER BY timestamp ASC, logId ASC
      LIMIT ?
    `);
    const likeQuery = `%${escapeLike(query)}%`;
    return toMessageResults(db, statement.all(...options.whitelistedRoomIds, likeQuery, limit));
  } finally {
    db.close();
  }
}

export function summarizeRoom(options: {
  roomId: number;
  periodFrom: number;
  periodTo: number;
  whitelistedRoomIds: number[];
  limit?: number;
}): MessageResult[] {
  validateEpochRange(options.periodFrom, options.periodTo);
  if (!Number.isSafeInteger(options.roomId)) {
    throw new Error('roomId must be an integer chatroom ID.');
  }
  if (!options.whitelistedRoomIds.includes(options.roomId)) return [];

  const limit = normalizeLimit(options.limit);
  const db = openMessagesDb();
  try {
    const statement = db.prepare<unknown[], MessageRow>(`
      SELECT senderName, senderId, roomDisplayName, chatroomId, timestamp, logId, content,
             messageType, mediaMeta, systemEventType
      FROM messages
      WHERE chatroomId = ?
        AND timestamp BETWEEN ? AND ?
        AND isDeleted = 0
      ORDER BY logId ASC
      LIMIT ?
    `);
    return toMessageResults(
      db,
      statement.all(options.roomId, options.periodFrom, options.periodTo, limit)
    );
  } finally {
    db.close();
  }
}

export function crossRoomQuery(options: {
  query: string;
  whitelistedRoomIds: number[];
  periodFrom?: number;
  periodTo?: number;
  limit?: number;
}): MessageResult[] {
  const query = options.query.trim();
  validateQuery(query);
  if (options.whitelistedRoomIds.length === 0) return [];

  const hasPeriod = options.periodFrom !== undefined || options.periodTo !== undefined;
  if (hasPeriod) validateEpochRange(options.periodFrom ?? 0, options.periodTo ?? Date.now());

  const limit = normalizeLimit(options.limit);
  const placeholders = options.whitelistedRoomIds.map(() => '?').join(', ');
  const periodClause = hasPeriod ? 'AND timestamp BETWEEN ? AND ?' : '';
  const db = openMessagesDb();
  try {
    const statement = db.prepare<unknown[], MessageRow>(`
      SELECT senderName, senderId, roomDisplayName, chatroomId, timestamp, logId, content,
             messageType, mediaMeta, systemEventType
      FROM messages
      WHERE chatroomId IN (${placeholders})
        ${periodClause}
        AND isDeleted = 0
        AND content IS NOT NULL
        AND content LIKE ? ESCAPE '\\'
      ORDER BY timestamp ASC, logId ASC
      LIMIT ?
    `);
    const args: unknown[] = [...options.whitelistedRoomIds];
    if (hasPeriod) args.push(options.periodFrom ?? 0, options.periodTo ?? Date.now());
    args.push(`%${escapeLike(query)}%`, limit);
    return toMessageResults(db, statement.all(...args));
  } finally {
    db.close();
  }
}

export function getBootstrapInstallTime(db: Database.Database): string | null {
  ensureSchema(db);
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM bootstrap_meta WHERE key = ?')
    .get('install_time');
  return row?.value ?? null;
}

export function setBootstrapInstallTime(db: Database.Database, installTimeIso: string): void {
  ensureSchema(db);
  validateInstallTime(installTimeIso);
  db.prepare<[string, string]>(
    'INSERT OR IGNORE INTO bootstrap_meta (key, value) VALUES (?, ?)'
  ).run('install_time', installTimeIso);
}

export function insertBackfillMessages(
  db: Database.Database,
  messages: ParsedExportMessage[],
  installTimeIso: string,
  options: { replaceRoomId?: number } = {}
): { inserted: number; skipped: number; replaced: number } {
  ensureSchema(db);
  const installTimeMs = validateInstallTime(installTimeIso);
  const statement = db.prepare(`
    INSERT OR IGNORE INTO messages (
      logId, chatroomId, roomDisplayName, senderId, senderName, messageType,
      content, mediaMeta, replyTargetLogId, systemEventType, timestamp, isDeleted,
      collectedAt, source, parse_status
    ) VALUES (
      @logId, @chatroomId, @roomDisplayName, @senderId, @senderName, @messageType,
      @content, @mediaMeta, NULL, @systemEventType, @timestamp, @isDeleted,
      @collectedAt, @source, @parseStatus
    )
  `);
  const write = db.transaction((rows: ParsedExportMessage[]) => {
    let replaced = 0;
    if (options.replaceRoomId !== undefined) {
      replaced = db
        .prepare<[number]>("DELETE FROM messages WHERE chatroomId = ? AND source = 'export'")
        .run(options.replaceRoomId).changes;
    }
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      assertMessageSourceCutoff(row, installTimeMs);
      const result = statement.run(row);
      if (result.changes > 0) inserted += 1;
      else skipped += 1;
    }
    return { inserted, skipped, replaced };
  });
  return write(messages);
}

/**
 * Provenance/cutoff invariant for every message writer.
 *
 * Future LOCO/live ingestion paths must route writes through this contract (or an equivalent
 * stricter helper) so post-install live rows and pre-install export rows cannot overlap silently.
 */
export function assertMessageSourceCutoff(
  message: { source: MessageSource; parseStatus?: ParseStatus; timestamp: number },
  installTimeMs: number
): void {
  if (!Number.isSafeInteger(message.timestamp))
    throw new Error('message timestamp must be safe integer');
  if (message.source === 'loco' && message.timestamp < installTimeMs) {
    throw new Error('LOCO messages older than install_time must not be inserted by backfill.');
  }
  if (message.source === 'export' && message.timestamp >= installTimeMs) {
    throw new Error('Export backfill messages must be older than install_time.');
  }
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      logId INTEGER NOT NULL,
      chatroomId INTEGER NOT NULL,
      roomDisplayName TEXT NOT NULL,
      senderId TEXT,
      senderName TEXT,
      messageType TEXT NOT NULL DEFAULT 'text',
      content TEXT,
      mediaMeta TEXT,
      replyTargetLogId INTEGER,
      systemEventType TEXT,
      timestamp INTEGER NOT NULL,
      isDeleted INTEGER NOT NULL DEFAULT 0,
      collectedAt INTEGER NOT NULL,
      PRIMARY KEY (chatroomId, logId)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chatroom_timestamp ON messages (chatroomId, timestamp);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_chatroom_logid ON messages (chatroomId, logId);
    CREATE TABLE IF NOT EXISTS bootstrap_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  addColumnIfMissing(db, 'messages', 'source', "TEXT NOT NULL DEFAULT 'loco'");
  addColumnIfMissing(db, 'messages', 'parse_status', "TEXT NOT NULL DEFAULT 'parsed'");
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = db.prepare<[], MessageColumnRow>(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function toMessageResults(db: Database.Database, rows: MessageRow[]): MessageResult[] {
  const roomCache = new Map<number, RoomContext>();
  return rows.map((row) => toMessageResult(row, getRoomContext(db, row, roomCache).displayName));
}

function getRoomContext(
  db: Database.Database,
  row: MessageRow,
  cache: Map<number, RoomContext>
): RoomContext {
  const cached = cache.get(row.chatroomId);
  if (cached) return cached;

  const storedRoomDisplayName = getStoredRoomDisplayName(db, row.chatroomId) ?? row.roomDisplayName;
  const senderIds = getRoomSenderIds(db, row.chatroomId);
  const resolved = resolveRoomDisplayName({
    chatroomId: row.chatroomId,
    storedRoomDisplayName,
    senderIds
  });
  const context = { displayName: resolved.displayName };
  cache.set(row.chatroomId, context);
  return context;
}

function getStoredRoomDisplayName(db: Database.Database, chatroomId: number): string | null {
  const row = db
    .prepare<[number], { roomDisplayName: string | null }>(
      `
        SELECT roomDisplayName
        FROM messages
        WHERE chatroomId = ? AND TRIM(roomDisplayName) <> ''
        ORDER BY timestamp DESC, logId DESC
        LIMIT 1
      `
    )
    .get(chatroomId);
  return row?.roomDisplayName ?? null;
}

function getRoomSenderIds(db: Database.Database, chatroomId: number): string[] {
  return db
    .prepare<[number], { senderId: string | null }>(
      `
        SELECT DISTINCT senderId
        FROM messages
        WHERE chatroomId = ? AND senderId IS NOT NULL AND TRIM(senderId) <> ''
      `
    )
    .all(chatroomId)
    .map((sender) => sender.senderId)
    .filter((sender): sender is string => sender !== null);
}

function toMessageResult(row: MessageRow, roomName: string): MessageResult {
  return {
    speaker: row.senderName ?? String(row.senderId ?? 'unknown'),
    roomName,
    chatroomId: row.chatroomId,
    timestamp: row.timestamp,
    logId: row.logId,
    content: normalizeContent(row)
  };
}

function normalizeContent(row: MessageRow): string | null {
  if (row.content !== null) return row.content;
  if (row.mediaMeta) return null;
  if (row.systemEventType) return null;
  return null;
}

function validateQuery(query: string): void {
  if (query.length === 0) throw new Error('query must not be empty.');
  if (query.length < 2) throw new Error('query is too broad; use at least 2 characters.');
  if (query.length > 200) throw new Error('query is too long; maximum length is 200 characters.');
}

function validateEpochRange(periodFrom: number, periodTo: number): void {
  if (!Number.isSafeInteger(periodFrom) || !Number.isSafeInteger(periodTo)) {
    throw new Error('periodFrom and periodTo must be epoch millisecond integers.');
  }
  if (periodFrom > periodTo) throw new Error('periodFrom must be <= periodTo.');
}

function validateInstallTime(installTimeIso: string): number {
  const value = Date.parse(installTimeIso);
  if (!Number.isSafeInteger(value)) throw new Error('install_time must be an ISO datetime.');
  return value;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer.');
  return Math.min(limit, MAX_LIMIT);
}

function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`);
}
