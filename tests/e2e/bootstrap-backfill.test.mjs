/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const fixtureDir = join(repoRoot, 'tests', 'fixtures', 'export');
const installTime = '2026-05-28T00:00:00.000Z';

test('bootstrap backfills export fixtures and keeps MCP outputs v0.1-compatible', async () => {
  const home = process.env.KAKAO_AGENT_HOME;
  assert.ok(home, 'isolated home must be set');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'whitelist.yaml'), 'chatroomIds:\n  - 2001\n  - 2002\n  - 2003\n', {
    mode: 0o600
  });
  writeFileSync(
    join(home, 'rooms.yaml'),
    'aliases:\n  "2001": "개발방 별칭"\n  "2002": "가족방 별칭"\n  "2003": "오픈채팅 별칭"\n',
    { mode: 0o600 }
  );

  const first = runJson([
    'dist/cli.js',
    'bootstrap',
    '--fixture-dir',
    fixtureDir,
    '--install-time',
    installTime,
    '--retry-base-ms',
    '0',
    '--skip-preflight'
  ]);
  assert.equal(first.ok, true);
  assert.equal(first.install_time, installTime);
  assert.equal(first.rooms.length, 3);
  assert.ok(first.rooms.every((room) => room.state === 'success'));
  assert.ok(first.rooms.reduce((sum, room) => sum + room.inserted, 0) >= 15);
  assert.ok(first.rooms.some((room) => room.stats.rawCount >= 1));

  const state = parse(readFileSync(join(home, 'bootstrap-state.yaml'), 'utf8'));
  assert.equal(state.install_time, installTime);
  assert.equal(state.rooms['2001'].bootstrap_state, 'success');
  assert.equal(state.rooms['2001'].retry_count, 1);

  const second = runJson([
    'dist/cli.js',
    'bootstrap',
    '--fixture-dir',
    fixtureDir,
    '--install-time',
    '2030-01-01T00:00:00.000Z',
    '--retry-base-ms',
    '0',
    '--skip-preflight'
  ]);
  assert.equal(second.install_time, installTime, 'install_time must be captured once');
  assert.ok(second.rooms.every((room) => room.state === 'skipped'));

  const forced = runJson([
    'dist/cli.js',
    'bootstrap',
    '--fixture-dir',
    fixtureDir,
    '--force',
    '--retry-base-ms',
    '0',
    '--skip-preflight'
  ]);
  assert.equal(forced.ok, true);
  assert.ok(forced.rooms.every((room) => room.state === 'success'));
  assert.ok(
    forced.rooms.every((room) => room.replaced > 0),
    'force rebuilds existing export rows'
  );
  assert.equal(
    forced.rooms.reduce((sum, room) => sum + room.inserted, 0),
    first.rooms.reduce((sum, room) => sum + room.inserted, 0),
    'force rebuilds without duplicate rows'
  );

  const db = new Database(join(home, 'messages.db'));
  try {
    const columns = db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .map((row) => row.name);
    assert.ok(columns.includes('source'));
    assert.ok(columns.includes('parse_status'));
    const meta = db.prepare('SELECT value FROM bootstrap_meta WHERE key = ?').get('install_time');
    assert.equal(meta.value, installTime);
    const counts = db
      .prepare(
        'SELECT source, parse_status AS parseStatus, COUNT(*) AS count FROM messages GROUP BY source, parse_status'
      )
      .all();
    assert.ok(counts.some((row) => row.source === 'export' && row.parseStatus === 'parsed'));
    assert.ok(counts.some((row) => row.source === 'export' && row.parseStatus === 'raw'));
  } finally {
    db.close();
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/cli.js'],
    env: { ...process.env }
  });
  const client = new Client({ name: 'kakao-agent-bootstrap-e2e', version: '0.2.0' });
  try {
    await client.connect(transport);
    const search = await callJsonTool(client, 'search_messages', {
      query: '검색키워드',
      limit: 50
    });
    assert.ok(Array.isArray(search));
    assert.ok(search.length >= 8, `expected keyword coverage, got ${search.length}`);
    assert.ok(search.some((row) => row.roomName === '오픈채팅 별칭'));
    assert.ok(search.every((row) => !('source' in row) && !('parse_status' in row)));

    const summary = await callJsonTool(client, 'summarize_room', {
      roomId: 2001,
      periodFrom: Date.parse('2026-05-27T00:00:00.000+09:00'),
      periodTo: Date.parse(installTime),
      limit: 50
    });
    assert.ok(summary.length >= 7);
    assert.ok(summary.every((row) => row.roomName === '개발방 별칭'));

    const cross = await callJsonTool(client, 'cross_room_query', {
      query: '검색키워드',
      limit: 50
    });
    assert.ok(cross.length >= 8);
    assert.ok(cross.every((row) => [2001, 2002, 2003].includes(row.chatroomId)));
  } finally {
    await client.close();
  }
});

test('bootstrap rejects non-whitelisted explicit rooms before ingestion', () => {
  const home = process.env.KAKAO_AGENT_HOME;
  assert.ok(home, 'isolated home must be set');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'whitelist.yaml'), 'chatroomIds:\n  - 2001\n', { mode: 0o600 });

  const failure = runExpectFailure([
    'dist/cli.js',
    'bootstrap',
    '--fixture-dir',
    fixtureDir,
    '--room',
    '9999',
    '--skip-preflight'
  ]);
  assert.match(failure, /not whitelisted/);
});

test('bootstrap requires unambiguous room ownership for a single export file', () => {
  const home = process.env.KAKAO_AGENT_HOME;
  assert.ok(home, 'isolated home must be set');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, 'whitelist.yaml'), 'chatroomIds:\n  - 2001\n  - 2002\n', {
    mode: 0o600
  });

  const failure = runExpectFailure([
    'dist/cli.js',
    'bootstrap',
    '--export-file',
    join(fixtureDir, '2001.txt'),
    '--skip-preflight'
  ]);
  assert.match(failure, /--export-file requires --room/);
});

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, args, { env: process.env, encoding: 'utf8' }));
}

function runExpectFailure(args) {
  try {
    execFileSync(process.execPath, args, { env: process.env, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    return String(error.stderr ?? error.message);
  }
  throw new Error(`Expected command to fail: ${args.join(' ')}`);
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  assert.equal(result.isError, false, text);
  return JSON.parse(text);
}
