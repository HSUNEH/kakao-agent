import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'yaml';
import { getKakaoAgentHome, getWhitelistPath } from './paths.js';

const DEFAULT_WHITELIST = `# kakao-agent whitelist\n# Privacy default: empty/off. Add chatroom IDs only after explicit consent.\nchatroomIds: []\n`;

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
}

export function loadWhitelist(): WhitelistConfig {
  ensureConfigFiles();
  const path = getWhitelistPath();
  const raw = readFileSync(path, 'utf8');
  const parsed = parse(raw) as unknown;
  const values = extractChatroomIds(parsed);
  const numericValues = values.map((value) => Number(value));
  if (!numericValues.every((value) => Number.isSafeInteger(value))) {
    throw new Error(`Invalid whitelist entries in ${path}; expected integer chatroom IDs.`);
  }

  return { chatroomIds: [...new Set(numericValues)], path };
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
