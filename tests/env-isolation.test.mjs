/* global process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const setupPath = join(__dirname, 'setup', 'env-isolation.mjs');

test('test setup scrubs live messaging runtime env unless explicitly allowlisted', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      setupPath,
      '-e',
      'console.log(JSON.stringify({kakao:process.env.KAKAO_LIVE_TOKEN,discord:process.env.DISCORD_ALLOWED_CHANNELS,keep:process.env.KAKAO_KEEP_ME,isolated:process.env.KAKAO_AGENT_TEST_ENV_ISOLATED}))'
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        KAKAO_LIVE_TOKEN: 'secret',
        DISCORD_ALLOWED_CHANNELS: 'live-channel',
        KAKAO_KEEP_ME: 'allowed',
        KAKAO_AGENT_TEST_ENV_ALLOWLIST: 'KAKAO_KEEP_ME'
      }
    }
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.kakao, undefined);
  assert.equal(parsed.discord, undefined);
  assert.equal(parsed.keep, 'allowed');
  assert.equal(parsed.isolated, '1');
});
