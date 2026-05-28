#!/usr/bin/env node
import { openMessagesDb } from './database.js';
import { startMcpServer } from './mcp-server.js';
import {
  addWhitelistRoom,
  ensureConfigFiles,
  loadWhitelist,
  removeWhitelistRoom
} from './config.js';
import { getKeychainStatus } from './keychain.js';
import { runDaemon } from './daemon.js';
import { getRuntimeStatus } from './status.js';
import {
  loadRoomAliases,
  removeRoomAlias,
  resolveRoomDisplayName,
  updateRoomAlias
} from './rooms.js';
import { runBootstrap, type BootstrapOptions } from './bootstrap/orchestrator.js';

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
    case 'rooms':
      rooms(argv.slice(1));
      return;
    case 'whitelist':
      whitelist(argv.slice(1));
      return;
    case 'ingest':
      if (subcommand === 'once') {
        ingestOnce();
        return;
      }
      throw new Error('Usage: kakao-agent ingest once');
    case 'bootstrap':
      await bootstrap(argv.slice(1));
      return;
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
    { name: 'room_aliases', ok: true, detail: `${loadRoomAliases().path}` },
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

function rooms(args: string[]): void {
  const [subcommand, identifier, ...nameParts] = args;
  switch (subcommand) {
    case 'list':
    case undefined:
      listRooms();
      return;
    case 'alias':
      if (!identifier || nameParts.length === 0) {
        throw new Error('Usage: kakao-agent rooms alias <chatroomId|fingerprint> <name>');
      }
      printJson({ ok: true, ...updateRoomAlias(identifier, nameParts.join(' ')) });
      return;
    case 'unalias':
      if (!identifier) throw new Error('Usage: kakao-agent rooms unalias <chatroomId|fingerprint>');
      printJson({ ok: true, ...removeRoomAlias(identifier) });
      return;
    default:
      throw new Error(
        'Usage: kakao-agent rooms [list] | rooms alias <chatroomId|fingerprint> <name>'
      );
  }
}

function whitelist(args: string[]): void {
  const [subcommand, roomId] = args;
  switch (subcommand) {
    case 'list':
    case undefined:
      printJson(loadWhitelist());
      return;
    case 'add':
      if (!roomId) throw new Error('Usage: kakao-agent whitelist add <chatroomId>');
      printJson({ ok: true, ...addWhitelistRoom(roomId) });
      return;
    case 'remove':
      if (!roomId) throw new Error('Usage: kakao-agent whitelist remove <chatroomId>');
      printJson({ ok: true, ...removeWhitelistRoom(roomId) });
      return;
    default:
      throw new Error('Usage: kakao-agent whitelist [list] | whitelist add/remove <chatroomId>');
  }
}

function listRooms(): void {
  ensureConfigFiles();
  const whitelist = loadWhitelist();
  const aliases = loadRoomAliases();
  const db = openMessagesDb();
  try {
    const rows = db
      .prepare<[], { chatroomId: number; roomDisplayName: string | null; messageCount: number }>(
        `
          SELECT chatroomId, MAX(NULLIF(roomDisplayName, '')) AS roomDisplayName, COUNT(*) AS messageCount
          FROM messages
          GROUP BY chatroomId
          ORDER BY chatroomId ASC
        `
      )
      .all();
    const senderStatement = db.prepare<[number], { senderId: string | null }>(
      `
        SELECT DISTINCT senderId
        FROM messages
        WHERE chatroomId = ? AND senderId IS NOT NULL AND TRIM(senderId) <> ''
      `
    );

    const rooms = rows.map((row) => {
      const senderIds = senderStatement
        .all(row.chatroomId)
        .map((sender) => sender.senderId)
        .filter((sender): sender is string => sender !== null);
      const resolved = resolveRoomDisplayName({
        chatroomId: row.chatroomId,
        storedRoomDisplayName: row.roomDisplayName,
        senderIds
      });
      return {
        chatroomId: row.chatroomId,
        displayName: resolved.displayName,
        source: resolved.source,
        fingerprint: resolved.fingerprint,
        memberCount: resolved.memberCount,
        messageCount: row.messageCount,
        whitelisted: whitelist.chatroomIds.includes(row.chatroomId)
      };
    });

    printJson({
      rooms,
      aliases: aliases.aliases,
      aliasesPath: aliases.path,
      whitelistPath: whitelist.path
    });
  } finally {
    db.close();
  }
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

async function bootstrap(args: string[]): Promise<void> {
  const options = parseBootstrapOptions(args);
  const result = await runBootstrap(options);
  printJson(result);
  if (!result.ok) process.exitCode = 1;
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
  rooms list        Show known rooms, aliases, fingerprints, and whitelist status
  rooms alias       Set alias: rooms alias <chatroomId|fingerprint> <name>
  rooms unalias     Remove alias: rooms unalias <chatroomId|fingerprint>
  whitelist list    Show whitelisted room IDs
  whitelist add     Allow MCP search for a room ID
  whitelist remove  Remove a room ID from MCP search
  ingest once       Safe no-op until live LOCO ingestion is integrated
  bootstrap         Backfill whitelisted rooms from KakaoTalk export text
  daemon [--once]   Run foreground health/recovery observability loop
  mcp | serve       Run stdio MCP server explicitly
`);
}

function parseBootstrapOptions(args: string[]): BootstrapOptions {
  const options: BootstrapOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--fixture-dir':
        options.fixtureDir = readOptionValue(args, ++index, arg);
        break;
      case '--export-file':
        options.exportFile = readOptionValue(args, ++index, arg);
        break;
      case '--room':
        options.roomId = toSafeInteger(readOptionValue(args, ++index, arg), '--room');
        break;
      case '--force':
        options.force = true;
        break;
      case '--retry-base-ms':
        options.retryBaseMs = toSafeInteger(readOptionValue(args, ++index, arg), '--retry-base-ms');
        break;
      case '--max-attempts':
        options.maxAttempts = toSafeInteger(readOptionValue(args, ++index, arg), '--max-attempts');
        break;
      case '--skip-preflight':
        options.skipPreflight = true;
        break;
      case '--install-time':
        options.installTime = readOptionValue(args, ++index, arg);
        break;
      case '--help':
      case '-h':
        console.log(`Usage: kakao-agent bootstrap [options]

Options:
  --fixture-dir <dir>     Read <roomId>.txt export files from a fixture/export directory
  --export-file <path>    Backfill a single room from an explicit KakaoTalk export text file
  --room <chatroomId>     Limit bootstrap to one whitelisted room
  --force                 Re-process rooms already marked success
  --retry-base-ms <ms>    Exponential retry base delay (default: 500)
  --max-attempts <n>      Attempts per room (default: 3)
  --skip-preflight        Skip live macOS Accessibility/KakaoTalk preflight checks
  --install-time <iso>    Test override for captured install_time
`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown bootstrap option: ${arg}`);
    }
  }
  if (options.retryBaseMs !== undefined && options.retryBaseMs < 0) {
    throw new Error('--retry-base-ms must be >= 0');
  }
  if (options.maxAttempts !== undefined && options.maxAttempts < 1) {
    throw new Error('--max-attempts must be >= 1');
  }
  return options;
}

function readOptionValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function toSafeInteger(value: string, name: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error(`${name} must be an integer.`);
  return numeric;
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
