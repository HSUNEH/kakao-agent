import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { getMessagesDbPath } from './paths.js';
import { resolveRoomDisplayName } from './rooms.js';

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
  `);
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

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('limit must be a positive integer.');
  return Math.min(limit, MAX_LIMIT);
}

function escapeLike(query: string): string {
  return query.replace(/[\\%_]/g, (match) => `\\${match}`);
}
