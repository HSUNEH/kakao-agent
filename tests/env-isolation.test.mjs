/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getKakaoAgentHome,
  getMessagesDbPath,
  getRoomsPath,
  getWhitelistPath
} from '../dist/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const setupPath = join(__dirname, 'setup', 'env-isolation.mjs');

test('test setup scrubs live messaging runtime env unless explicitly allowlisted', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      setupPath,
      '-e',
      'console.log(JSON.stringify({kakao:process.env.KAKAO_LIVE_TOKEN,discord:process.env.DISCORD_ALLOWED_CHANNELS,openclaw:process.env.OPENCLAW_WORKSPACE,keep:process.env.KAKAO_KEEP_ME,isolated:process.env.KAKAO_AGENT_TEST_ENV_ISOLATED,home:process.env.KAKAO_AGENT_HOME,db:process.env.KAKAO_AGENT_DB}))'
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        KAKAO_LIVE_TOKEN: 'secret',
        DISCORD_ALLOWED_CHANNELS: 'live-channel',
        OPENCLAW_WORKSPACE: '/real/openclaw/workspace',
        KAKAO_KEEP_ME: 'allowed',
        KAKAO_AGENT_TEST_ENV_ALLOWLIST: 'KAKAO_KEEP_ME'
      }
    }
  );
  const parsed = JSON.parse(output.split('\n').find((line) => line.startsWith('{')) ?? '{}');
  assert.equal(parsed.kakao, undefined);
  assert.equal(parsed.discord, undefined);
  assert.equal(parsed.openclaw, undefined);
  assert.equal(parsed.keep, 'allowed');
  assert.equal(parsed.isolated, '1');
  assert.match(parsed.home, /kakao-agent-test-/);
  assert.match(parsed.db, /kakao-agent-test-/);
});

test('runtime paths are redirected to per-test temp directories', () => {
  const runtimeDir = process.env.KAKAO_AGENT_TEST_RUNTIME_DIR;
  assert.ok(runtimeDir, 'test runtime dir must be set');
  assert.match(runtimeDir, /kakao-agent-test-/);
  assert.ok(getKakaoAgentHome().startsWith(runtimeDir));
  assert.ok(getMessagesDbPath().startsWith(runtimeDir));
  assert.ok(getWhitelistPath().startsWith(runtimeDir));
  assert.ok(getRoomsPath().startsWith(runtimeDir));
  assert.ok(homedir().startsWith(runtimeDir), `HOME must be temp-isolated; got ${homedir()}`);
});

test('per-test env snapshot prevents fake opt-in values from leaking between tests', () => {
  assert.equal(process.env.KAKAO_FAKE_OPT_IN, undefined);
  process.env.KAKAO_FAKE_OPT_IN = 'only-this-test';
  assert.equal(process.env.KAKAO_FAKE_OPT_IN, 'only-this-test');
});

test('previous test mutations are removed before the next test starts', () => {
  assert.equal(process.env.KAKAO_FAKE_OPT_IN, undefined);
});
