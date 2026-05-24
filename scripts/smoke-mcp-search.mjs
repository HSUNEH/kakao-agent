#!/usr/bin/env node
/* global process, console */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { extractLocoRoomName } from '../dist/rooms.js';

const home = mkdtempSync(join(tmpdir(), 'kakao-agent-smoke-'));
const dbPath = join(home, 'messages.db');
const openChatFingerprint = fingerprint(['u10', 'u20']);
assertName(
  extractLocoRoomName({
    chatInfo: { chatMetas: [{ type: 3, content: '실제 서버 방명' }] },
    display_name: '멤버1, 멤버2'
  }),
  '실제 서버 방명',
  'CHATINFO title must beat display_name member-list fallback'
);
assertName(
  extractLocoRoomName({ ols: [{ ln: '오픈링크 방명' }] }),
  '오픈링크 방명',
  'INFOLINK open-link name extraction failed'
);
writeFileSync(join(home, 'whitelist.yaml'), 'chatroomIds:\n  - 1001\n  - 1003\n', { mode: 0o600 });
writeFileSync(join(home, 'rooms.yaml'), 'aliases:\n  "1001": "개발 별칭"\n', { mode: 0o600 });

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE messages (
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
`);
const insert = db.prepare(`
  INSERT INTO messages (
    logId, chatroomId, roomDisplayName, senderId, senderName, messageType,
    content, timestamp, isDeleted, collectedAt
  ) VALUES (?, ?, ?, ?, ?, 'text', ?, ?, 0, ?)
`);
insert.run(
  1,
  1001,
  '개발방',
  'u1',
  '민수',
  '오늘 테스트 회의 합니다',
  1_700_000_000_000,
  Date.now()
);
insert.run(2, 1002, '비공개방', 'u2', '지영', '테스트 비밀 메시지', 1_700_000_000_100, Date.now());
insert.run(3, 1003, '', 'u10', '준호', '오픈채팅 테스트 공지', 1_700_000_000_200, Date.now());
insert.run(4, 1003, '', 'u20', '서연', '오픈채팅 테스트 답장', 1_700_000_000_300, Date.now());
db.close();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js'],
  env: {
    ...process.env,
    KAKAO_AGENT_HOME: home,
    KAKAO_AGENT_DB: dbPath
  }
});
const client = new Client({ name: 'kakao-agent-search-smoke', version: '0.1.0' });

try {
  await client.connect(transport);
  const search = await callJsonTool('search_messages', { query: '테스트' });
  if (!Array.isArray(search) || search.length !== 3) {
    throw new Error(`Expected three whitelisted search results, got ${JSON.stringify(search)}`);
  }
  const first = search.find((row) => row.chatroomId === 1001);
  if (!first || first.speaker !== '민수' || first.roomName !== '개발 별칭') {
    throw new Error(`Search attribution/alias failed: ${JSON.stringify(first)}`);
  }
  const openChat = search.filter((row) => row.chatroomId === 1003);
  if (
    openChat.length !== 2 ||
    openChat.some((row) => row.roomName !== `[fp:${openChatFingerprint}] 2명 방`)
  ) {
    throw new Error(`Open chat fingerprint fallback failed: ${JSON.stringify(openChat)}`);
  }

  const summary = await callJsonTool('summarize_room', {
    roomId: 1001,
    periodFrom: 1_699_999_999_999,
    periodTo: 1_700_000_000_001
  });
  if (!Array.isArray(summary) || summary.length !== 1 || summary[0].roomName !== '개발 별칭') {
    throw new Error(`summarize_room failed: ${JSON.stringify(summary)}`);
  }

  const crossRoom = await callJsonTool('cross_room_query', { query: '테스트' });
  if (!Array.isArray(crossRoom) || crossRoom.some((row) => row.chatroomId === 1002)) {
    throw new Error(`cross_room_query leaked non-whitelisted rows: ${JSON.stringify(crossRoom)}`);
  }

  writeFileSync(
    join(home, 'rooms.yaml'),
    `aliases:\n  "${openChatFingerprint}": "오픈채팅 별칭"\n`,
    {
      mode: 0o600
    }
  );
  const hotReload = await callJsonTool('summarize_room', {
    roomId: 1003,
    periodFrom: 1_700_000_000_100,
    periodTo: 1_700_000_000_400
  });
  if (!Array.isArray(hotReload) || hotReload.some((row) => row.roomName !== '오픈채팅 별칭')) {
    throw new Error(`rooms.yaml hot reload failed: ${JSON.stringify(hotReload)}`);
  }

  const validationError = await client.callTool({
    name: 'search_messages',
    arguments: { query: ' ' }
  });
  const validationText = textContent(validationError);
  if (!validationError.isError || !validationText.includes('query must not be empty')) {
    throw new Error(`Expected structured validation error, got ${validationText}`);
  }

  console.log(
    JSON.stringify(
      { ok: true, home, search, summary, crossRoom, hotReload, validationError: true },
      null,
      2
    )
  );
} finally {
  await client.close();
  rmSync(home, { recursive: true, force: true });
}

async function callJsonTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = textContent(result);
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
}

function textContent(result) {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

function fingerprint(senderIds) {
  return createHash('sha256')
    .update([...new Set(senderIds)].sort().join(','))
    .digest('hex')
    .slice(0, 12);
}

function assertName(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
