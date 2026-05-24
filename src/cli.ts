#!/usr/bin/env node
import { openMessagesDb } from './database.js';
import { startMcpServer } from './mcp-server.js';
import { ensureConfigFiles, loadWhitelist } from './config.js';
import { getKeychainStatus } from './keychain.js';
import { runDaemon } from './daemon.js';
import { getRuntimeStatus } from './status.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, subcommand] = argv;

  if (!command || command === 'mcp' || command === 'serve') {
    await startMcpServer();
    return;
  }

  switch (command) {
    case 'setup':
      setup();
      return;
    case 'status':
      printJson(getRuntimeStatus());
      return;
    case 'doctor':
      doctor();
      return;
    case 'auth':
      if (subcommand === 'status') {
        printJson(getRuntimeStatus().auth);
        return;
      }
      throw new Error('Usage: kakao-agent auth status');
    case 'whoami':
      whoami();
      return;
    case 'ingest':
      if (subcommand === 'once') {
        ingestOnce();
        return;
      }
      throw new Error('Usage: kakao-agent ingest once');
    case 'daemon':
      await runDaemon({ once: argv.includes('--once'), intervalMs: readInterval(argv.slice(1)) });
      return;
    case 'help':
    case '--help':
    case '-h':
      help();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run kakao-agent help.`);
  }
}

function setup(): void {
  ensureConfigFiles();
  const db = openMessagesDb();
  db.close();
  printJson({
    ok: true,
    message: 'Initialized kakao-agent local state. Live Kakao auth is not performed by setup yet.',
    next: ['kakao-agent auth status', 'kakao-agent doctor', 'kakao-agent status']
  });
}

function doctor(): void {
  const status = getRuntimeStatus();
  const keychain = getKeychainStatus();
  const checks = [
    {
      name: 'node_version',
      ok: Number(process.versions.node.split('.')[0]) >= 20,
      detail: process.version
    },
    { name: 'macos_platform', ok: process.platform === 'darwin', detail: process.platform },
    { name: 'keychain_available', ok: keychain.available, detail: keychain.reason },
    {
      name: 'db_permissions',
      ok: status.db.permissions === null || status.db.permissions === '600',
      detail: status.db.permissions
    },
    { name: 'whitelist_config', ok: true, detail: `${status.whitelist.count} whitelisted rooms` },
    { name: 'mcp_binary', ok: true, detail: 'kakao-agent without args starts stdio MCP server' },
    {
      name: 'live_auth',
      ok: false,
      severity: 'warn',
      detail:
        'Live LOCO auth/recovery is not integrated yet; Keychain credential presence is reported only.'
    }
  ];
  printJson({ ok: checks.every((check) => check.ok || check.severity === 'warn'), checks });
}

function whoami(): void {
  const auth = getRuntimeStatus().auth;
  printJson({
    account: auth.account,
    live: auth.live,
    recoveryReady: auth.recoveryReady,
    reason: auth.reason
  });
}

function ingestOnce(): void {
  const whitelist = loadWhitelist();
  printJson({
    ok: true,
    collected: 0,
    whitelistedRooms: whitelist.chatroomIds.length,
    reason: 'Live LOCO ingestion is not integrated yet; no messages were collected.'
  });
}

function help(): void {
  console.log(`kakao-agent

Default: run stdio MCP server.

Commands:
  setup             Initialize local config and DB with restrictive defaults
  auth status       Report Keychain credential presence and live-auth status
  whoami            Show stored account identity if available
  status            Print auth, DB, whitelist, daemon, and last-error status
  doctor            Run local readiness checks
  ingest once       Safe no-op until live LOCO ingestion is integrated
  daemon [--once]   Run foreground health/recovery observability loop
  mcp | serve       Run stdio MCP server explicitly
`);
}

function readInterval(args: string[]): number {
  const index = args.indexOf('--interval-ms');
  if (index === -1) return 30_000;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 100)
    throw new Error('--interval-ms must be an integer >= 100');
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
