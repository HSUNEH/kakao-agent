import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { getKakaoAgentHome, getWhitelistPath } from './paths.js';
import { ensureRoomsConfig } from './rooms.js';

const DEFAULT_WHITELIST = `# kakao-agent whitelist
# Privacy default: empty/off. Add chatroom IDs only after explicit consent.
chatroomIds: []
`;

export interface WhitelistConfig {
  chatroomIds: number[];
  path: string;
}

export function ensureConfigFiles(): void {
  const home = getKakaoAgentHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const whitelistPath = getWhitelistPath();
  mkdirSync(dirname(whitelistPath), { recursive: true, mode: 0o700 });
  if (!existsSync(whitelistPath)) {
    writeFileSync(whitelistPath, DEFAULT_WHITELIST, { mode: 0o600 });
  }
  ensureRoomsConfig();
}

export function loadWhitelist(): WhitelistConfig {
  ensureConfigFiles();
  const path = getWhitelistPath();
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid whitelist.yaml at ${path}: ${message}`);
  }

  const numericValues = extractChatroomIds(parsed).map(normalizeChatroomId);
  return { chatroomIds: [...new Set(numericValues)], path };
}

export function saveWhitelist(chatroomIds: number[]): WhitelistConfig {
  ensureConfigFiles();
  const normalized = [...new Set(chatroomIds.map(normalizeChatroomId))].sort((a, b) => a - b);
  writeFileSync(getWhitelistPath(), stringify({ chatroomIds: normalized }), { mode: 0o600 });
  return loadWhitelist();
}

export function addWhitelistRoom(chatroomId: string | number): WhitelistConfig {
  const current = loadWhitelist();
  return saveWhitelist([...current.chatroomIds, normalizeChatroomId(chatroomId)]);
}

export function removeWhitelistRoom(chatroomId: string | number): WhitelistConfig {
  const target = normalizeChatroomId(chatroomId);
  const current = loadWhitelist();
  return saveWhitelist(current.chatroomIds.filter((id) => id !== target));
}

export function normalizeChatroomId(value: unknown): number {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(numeric)) {
    throw new Error('Expected integer chatroom ID.');
  }
  return numeric;
}

function extractChatroomIds(parsed: unknown): unknown[] {
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== 'object') {
    throw new Error('whitelist.yaml must be a YAML object or list of chatroom IDs.');
  }

  const object = parsed as Record<string, unknown>;
  const candidate = object.chatroomIds ?? object.rooms ?? object.whitelist;
  if (candidate == null) return [];
  if (!Array.isArray(candidate)) {
    throw new Error('whitelist.yaml chatroomIds must be a list of integer room IDs.');
  }
  return candidate;
}
