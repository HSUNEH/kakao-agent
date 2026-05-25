import { spawnSync } from 'node:child_process';

export const KEYCHAIN_SERVICE = 'kakao-agent';

export interface KeychainStatus {
  available: boolean;
  accountStored: boolean;
  account: string | null;
  reason: string | null;
}

export function getKeychainStatus(): KeychainStatus {
  if (process.platform !== 'darwin') {
    return {
      available: false,
      accountStored: false,
      account: null,
      reason: 'macOS Keychain is only available on darwin.'
    };
  }

  const security = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], {
    encoding: 'utf8'
  });

  if (security.status === 0) {
    return {
      available: true,
      accountStored: true,
      account: parseAccount(security.stderr),
      reason: null
    };
  }

  const message = `${security.stderr}${security.stdout}`.trim();
  if (message.includes('could not be found') || security.status === 44) {
    return {
      available: true,
      accountStored: false,
      account: null,
      reason: 'No kakao-agent Keychain item found.'
    };
  }

  return {
    available: true,
    accountStored: false,
    account: null,
    reason: message || 'Unable to inspect Keychain.'
  };
}

function parseAccount(stderr: string): string | null {
  const match = stderr.match(/^\s*"acct"<blob>="(.+)"/m);
  return match?.[1] ?? null;
}
