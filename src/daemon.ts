import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRuntimeStatus, getLogsDir, writeDaemonState, writeLastError } from './status.js';

export interface DaemonOptions {
  once: boolean;
  intervalMs: number;
}

export async function runDaemon(options: DaemonOptions): Promise<void> {
  writeDaemonState('running');
  try {
    let keepRunning = true;
    while (keepRunning) {
      const status = getRuntimeStatus();
      writeLog('health', {
        authRecoveryReady: status.auth.recoveryReady,
        whitelistCount: status.whitelist.count,
        lastMessage: status.db.lastMessage,
        lastError: status.lastError
      });

      keepRunning = !options.once;
      if (keepRunning) await sleep(options.intervalMs);
    }
    writeDaemonState('stopped', null);
  } catch (error) {
    writeLastError(error);
    writeDaemonState('error', null);
    throw error;
  }
}

function writeLog(event: string, payload: Record<string, unknown>): void {
  appendFileSync(
    join(getLogsDir(), 'daemon.log'),
    `${JSON.stringify({ at: new Date().toISOString(), event, ...payload })}\n`,
    { mode: 0o600 }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
