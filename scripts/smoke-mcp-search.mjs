#!/usr/bin/env node
/* global process, console */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const home = mkdtempSync(join(tmpdir(), 'kakao-agent-smoke-'));
const dbPath = join(home, 'messages.db');
writeFileSync(join(home, 'whitelist.yaml'), 'chatroomIds:\n  - 1001\n', { mode: 0o600 });

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
db.close();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/mcp-server.js'],
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
  if (!Array.isArray(search) || search.length !== 1) {
    throw new Error(`Expected one whitelisted search result, got ${JSON.stringify(search)}`);
  }
  if (search[0].chatroomId !== 1001 || search[0].speaker !== '민수') {
    throw new Error(`Search attribution/whitelist failed: ${JSON.stringify(search[0])}`);
  }

  const summary = await callJsonTool('summarize_room', {
    roomId: 1001,
    periodFrom: 1_699_999_999_999,
    periodTo: 1_700_000_000_001
  });
  if (!Array.isArray(summary) || summary.length !== 1 || summary[0].roomName !== '개발방') {
    throw new Error(`summarize_room failed: ${JSON.stringify(summary)}`);
  }

  const crossRoom = await callJsonTool('cross_room_query', { query: '테스트' });
  if (!Array.isArray(crossRoom) || crossRoom.some((row) => row.chatroomId !== 1001)) {
    throw new Error(`cross_room_query leaked non-whitelisted rows: ${JSON.stringify(crossRoom)}`);
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
    JSON.stringify({ ok: true, home, search, summary, crossRoom, validationError: true }, null, 2)
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
