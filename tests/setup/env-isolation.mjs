/* global process */
const RUNTIME_PREFIXES = [
  'KAKAO_',
  'AGENT_KAKAO_',
  'LOCO_',
  'HERMES_',
  'DISCORD_',
  'TELEGRAM_',
  'SLACK_'
];

const allowlist = new Set(
  (process.env.KAKAO_AGENT_TEST_ENV_ALLOWLIST ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
);

for (const key of Object.keys(process.env)) {
  if (allowlist.has(key)) continue;
  if (RUNTIME_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    delete process.env[key];
  }
}

process.env.KAKAO_AGENT_TEST_ENV_ISOLATED = '1';
