#!/usr/bin/env node
/* global process, console */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'kakao-agent-cli-'));
const env = { ...process.env, KAKAO_AGENT_HOME: home };

try {
  const setup = runJson(['dist/cli.js', 'setup']);
  assert(setup.ok === true, 'setup failed');

  const status = runJson(['dist/cli.js', 'status']);
  assert(status.db.path.endsWith('messages.db'), 'status missing DB path');
  assert(status.whitelist.count === 0, 'default whitelist must be empty');
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

function runJson(args) {
  return JSON.parse(execFileSync(process.execPath, args, { env, encoding: 'utf8' }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
