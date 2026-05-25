import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { getKakaoAgentHome, getRoomsPath } from './paths.js';

export const DEFAULT_ROOMS_CONFIG = `# kakao-agent room aliases
# Hot-reloaded on each query/CLI call. Use chatroom IDs or member fingerprints as keys.
# aliases:
#   "123456789": "가족방"
#   "a3f9b2c8d1e4": "오픈채팅 별명"
aliases: {}
`;

export interface RoomAliasesConfig {
  aliases: Record<string, string>;
  path: string;
}

export interface RoomFingerprint {
  fingerprint: string | null;
  memberCount: number;
}

export interface ResolvedRoomDisplayName {
  displayName: string;
  source: 'alias:chatroomId' | 'alias:fingerprint' | 'loco' | 'stored' | 'fingerprint' | 'fallback';
  fingerprint: string | null;
  memberCount: number;
}

const META_TYPE_TITLE = 3;

export function ensureRoomsConfig(): void {
  mkdirSync(getKakaoAgentHome(), { recursive: true, mode: 0o700 });
  const path = getRoomsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    writeFileSync(path, DEFAULT_ROOMS_CONFIG, { mode: 0o600 });
  }
}

export function loadRoomAliases(): RoomAliasesConfig {
  ensureRoomsConfig();
  const path = getRoomsPath();
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid rooms.yaml at ${path}: ${message}`);
  }

  return { aliases: normalizeAliasMap(extractAliasMap(parsed), path), path };
}

export function saveRoomAliases(aliases: Record<string, string>): RoomAliasesConfig {
  ensureRoomsConfig();
  const normalized = normalizeAliasMap(aliases, getRoomsPath());
  const sortedAliases = Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right))
  );
  writeFileSync(getRoomsPath(), stringify({ aliases: sortedAliases }), { mode: 0o600 });
  return loadRoomAliases();
}

export function updateRoomAlias(identifier: string, alias: string): RoomAliasesConfig {
  const trimmedAlias = alias.trim();
  if (trimmedAlias.length === 0) throw new Error('room alias must not be empty.');
  const current = loadRoomAliases();
  const key = normalizeAliasKey(identifier, current.path);
  return saveRoomAliases({ ...current.aliases, [key]: trimmedAlias });
}

export function removeRoomAlias(identifier: string): RoomAliasesConfig {
  const current = loadRoomAliases();
  const key = normalizeAliasKey(identifier, current.path);
  const next = { ...current.aliases };
  delete next[key];
  return saveRoomAliases(next);
}

export function computeMemberFingerprint(
  senderIds: Iterable<string | number | null | undefined>
): RoomFingerprint {
  const unique = [...new Set([...senderIds].map(normalizeSenderId).filter(isPresent))].sort();
  if (unique.length === 0) return { fingerprint: null, memberCount: 0 };
  return {
    fingerprint: createHash('sha256').update(unique.join(',')).digest('hex').slice(0, 12),
    memberCount: unique.length
  };
}

export function fingerprintLabel(fingerprint: string, memberCount: number): string {
  return `[fp:${fingerprint}] ${memberCount}명 방`;
}

export function extractLocoRoomName(value: unknown): string | null {
  const titleMeta = extractTitleMeta(value);
  if (titleMeta) return titleMeta;

  const directPaths = [
    ['meta', 'name'],
    ['chatInfo', 'meta', 'name'],
    ['chat', 'meta', 'name'],
    ['chatroom', 'meta', 'name'],
    ['chatRoom', 'meta', 'name'],
    ['openLink', 'name'],
    ['openLink', 'ln'],
    ['openLink', 'linkName'],
    ['openlink', 'name'],
    ['openlink', 'ln'],
    ['openlink', 'linkName'],
    ['openChat', 'name'],
    ['openChat', 'ln'],
    ['openchat', 'name'],
    ['openchat', 'ln'],
    ['link', 'name'],
    ['link', 'ln'],
    ['name'],
    ['title'],
    ['displayName'],
    ['display_name']
  ];

  for (const path of directPaths) {
    const candidate = cleanRoomName(readPath(value, path));
    if (candidate) return candidate;
  }

  const openLinkName = extractOpenLinkName(value);
  if (openLinkName) return openLinkName;

  return null;
}

export function resolveRoomDisplayName(options: {
  chatroomId: number;
  storedRoomDisplayName?: string | null;
  locoChatInfo?: unknown;
  senderIds?: Iterable<string | number | null | undefined>;
}): ResolvedRoomDisplayName {
  const aliases = loadRoomAliases().aliases;
  const fingerprint = computeMemberFingerprint(options.senderIds ?? []);
  const chatroomAlias = aliases[String(options.chatroomId)];
  if (chatroomAlias) {
    return { ...fingerprint, displayName: chatroomAlias, source: 'alias:chatroomId' };
  }

  const fingerprintAlias = fingerprint.fingerprint ? aliases[fingerprint.fingerprint] : undefined;
  if (fingerprintAlias) {
    return { ...fingerprint, displayName: fingerprintAlias, source: 'alias:fingerprint' };
  }

  const locoName = extractLocoRoomName(options.locoChatInfo);
  if (locoName) return { ...fingerprint, displayName: locoName, source: 'loco' };

  const stored = cleanRoomName(options.storedRoomDisplayName);
  if (stored) return { ...fingerprint, displayName: stored, source: 'stored' };

  if (fingerprint.fingerprint) {
    return {
      ...fingerprint,
      displayName: fingerprintLabel(fingerprint.fingerprint, fingerprint.memberCount),
      source: 'fingerprint'
    };
  }

  return {
    ...fingerprint,
    displayName: `chatroom:${options.chatroomId}`,
    source: 'fallback'
  };
}

function extractAliasMap(parsed: unknown): Record<string, unknown> {
  if (parsed == null) return {};
  if (!isPlainRecord(parsed)) {
    throw new Error('rooms.yaml must be a YAML object with an aliases map.');
  }

  const candidate = parsed.aliases ?? parsed.rooms ?? parsed.roomAliases;
  if (candidate === undefined) return parsed;
  if (!isPlainRecord(candidate)) {
    throw new Error('rooms.yaml aliases must be a mapping of chatroom IDs/fingerprints to names.');
  }
  return candidate;
}

function normalizeAliasMap(map: Record<string, unknown>, path: string): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(map)) {
    if (rawValue == null) continue;
    if (typeof rawValue !== 'string') {
      throw new Error(`Invalid room alias value for ${rawKey} in ${path}; expected string.`);
    }
    const value = rawValue.trim();
    if (value.length === 0) continue;
    normalized[normalizeAliasKey(rawKey, path)] = value;
  }
  return normalized;
}

function normalizeAliasKey(identifier: string, path: string): string {
  const trimmed = identifier.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric)) return String(numeric);
  }

  const fingerprint = normalizeFingerprint(trimmed);
  if (fingerprint) return fingerprint;

  throw new Error(
    `Invalid room alias key "${identifier}" in ${path}; use a numeric chatroom ID or 12-char hex fingerprint.`
  );
}

function normalizeFingerprint(value: string): string | null {
  const match = value.match(/^\[?fp:?([a-f0-9]{12})\]?$/i) ?? value.match(/^([a-f0-9]{12})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function extractTitleMeta(value: unknown): string | null {
  const metas = readPath(value, ['chatInfo', 'chatMetas']);
  if (!Array.isArray(metas)) return null;
  for (const meta of metas) {
    if (!isPlainRecord(meta) || meta.type !== META_TYPE_TITLE) continue;
    const content = cleanRoomName(meta.content);
    if (content) return content;
  }
  return null;
}

function extractOpenLinkName(value: unknown): string | null {
  const ols = readPath(value, ['ols']);
  if (!Array.isArray(ols)) return null;
  for (const item of ols) {
    const name = cleanRoomName(readPath(item, ['ln'])) ?? cleanRoomName(readPath(item, ['name']));
    if (name) return name;
  }
  return null;
}

function cleanRoomName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/^(unknown|undefined|null)$/i.test(trimmed)) return null;
  if (/^chatroom:\d+$/i.test(trimmed)) return null;
  return trimmed;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isPlainRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizeSenderId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
