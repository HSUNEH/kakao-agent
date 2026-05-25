#!/usr/bin/env node
/* global process, console */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const home = mkdtempSync(join(tmpdir(), 'kakao-agent-cli-'));
const env = { ...process.env, KAKAO_AGENT_HOME: home };

try {
  const setup = runJson(['dist/cli.js', 'setup']);
  assert(setup.ok === true, 'setup failed');
  assert(existsSync(join(home, 'rooms.yaml')), 'setup must create rooms.yaml');

  const whitelistAdd = runJson(['dist/cli.js', 'whitelist', 'add', '1001']);
  assert(whitelistAdd.chatroomIds.includes(1001), 'whitelist add failed');
  const whitelistList = runJson(['dist/cli.js', 'whitelist', 'list']);
  assert(whitelistList.chatroomIds.length === 1, 'whitelist list failed');
  const whitelistRemove = runJson(['dist/cli.js', 'whitelist', 'remove', '1001']);
  assert(!whitelistRemove.chatroomIds.includes(1001), 'whitelist remove failed');

  const alias = runJson(['dist/cli.js', 'rooms', 'alias', '1001', '개발', '별칭']);
  assert(alias.aliases['1001'] === '개발 별칭', 'rooms alias failed');

  seedRoom(home);
  const rooms = runJson(['dist/cli.js', 'rooms', 'list']);
  const room = rooms.rooms.find((item) => item.chatroomId === 1001);
  assert(room?.displayName === '개발 별칭', 'rooms list did not apply alias');
  assert(room?.memberCount === 2, 'rooms list missing member count');
  const unalias = runJson(['dist/cli.js', 'rooms', 'unalias', '1001']);
  assert(!('1001' in unalias.aliases), 'rooms unalias failed');

  const status = runJson(['dist/cli.js', 'status']);
  assert(status.db.path.endsWith('messages.db'), 'status missing DB path');
  assert(status.whitelist.count === 0, 'default whitelist must be empty after remove');
  assert(status.auth.live === false, 'live auth should be false without LOCO integration');

  const auth = runJson(['dist/cli.js', 'auth', 'status']);
  assert(auth.live === false, 'auth status must report live=false');

  const whoami = runJson(['dist/cli.js', 'whoami']);
  assert(whoami.live === false, 'whoami must report live=false');

  const doctor = runJson(['dist/cli.js', 'doctor']);
  assert(doctor.ok === true, 'doctor should pass with live_auth warning only');
  assert(
    doctor.checks.some((check) => check.name === 'live_auth' && check.severity === 'warn'),
    'doctor missing live_auth warning'
  );
  assert(
    doctor.checks.some((check) => check.name === 'room_aliases'),
    'doctor missing room aliases check'
  );

  const ingest = runJson(['dist/cli.js', 'ingest', 'once']);
  assert(ingest.collected === 0, 'ingest once should be safe no-op until LOCO integration');

  execFileSync(process.execPath, ['dist/cli.js', 'daemon', '--once'], { env, stdio: 'pipe' });
  const logPath = join(home, 'logs', 'daemon.log');
  assert(existsSync(logPath), 'daemon log missing');
  assert(readFileSync(logPath, 'utf8').includes('"event":"health"'), 'daemon health log missing');

  console.log(
    JSON.stringify(
      {
        ok: true,
        home,
        commands: [
          'setup',
          'rooms alias',
          'rooms list',
          'rooms unalias',
          'whitelist add/list/remove',
          'status',
          'auth status',
          'whoami',
          'doctor',
          'ingest once',
          'daemon --once'
        ]
      },
      null,
      2
    )
  );
} finally {
  rmSync(home, { recursive: true, force: true });
}

function seedRoom(root) {
  const db = new Database(join(root, 'messages.db'));
  const insert = db.prepare(`
    INSERT INTO messages (
      logId, chatroomId, roomDisplayName, senderId, senderName, messageType,
      content, timestamp, isDeleted, collectedAt
    ) VALUES (?, ?, ?, ?, ?, 'text', ?, ?, 0, ?)
  `);
  insert.run(1, 1001, '', 'u1', '민수', '테스트', 1_700_000_000_000, Date.now());
  insert.run(2, 1001, '', 'u2', '지영', '테스트', 1_700_000_000_001, Date.now());
  db.close();
}

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, args, { env, encoding: 'utf8' }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
