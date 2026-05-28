import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const MIN_KAKAOTALK_VERSION = '4.3.0';

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

export class BootstrapPreflightError extends Error {
  constructor(public readonly result: PreflightResult) {
    super(formatBilingualError(result));
    this.name = 'BootstrapPreflightError';
  }
}

export function checkBootstrapPreflight(options: { skip?: boolean } = {}): PreflightResult {
  if (options.skip || process.env.KAKAO_AGENT_SKIP_PREFLIGHT === '1') {
    return {
      ok: true,
      checks: [{ name: 'preflight_skipped', ok: true, detail: 'skipped by option' }]
    };
  }

  const appPath = process.env.KAKAO_AGENT_KAKAOTALK_APP ?? '/Applications/KakaoTalk.app';
  const version = process.env.KAKAO_AGENT_KAKAOTALK_VERSION ?? readKakaoVersion(appPath);
  const checks: PreflightCheck[] = [
    {
      name: 'macos_platform',
      ok: process.platform === 'darwin',
      detail: process.platform
    },
    {
      name: 'accessibility_permission',
      ok: hasAccessibilityPermission(),
      detail: 'KakaoTalk export automation needs macOS Accessibility permission.'
    },
    {
      name: 'kakaotalk_app',
      ok: existsSync(appPath),
      detail: appPath
    },
    {
      name: 'kakaotalk_version',
      ok: version !== null && compareVersions(version, MIN_KAKAOTALK_VERSION) >= 0,
      detail: version ?? 'unknown'
    }
  ];
  const result = { ok: checks.every((check) => check.ok), checks };
  if (!result.ok) throw new BootstrapPreflightError(result);
  return result;
}

function hasAccessibilityPermission(): boolean {
  if (process.env.KAKAO_AGENT_ACCESSIBILITY_GRANTED === '1') return true;
  if (process.platform !== 'darwin') return false;
  try {
    const output = execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to return UI elements enabled'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return output === 'true';
  } catch {
    return false;
  }
}

function readKakaoVersion(appPath: string): string | null {
  const plist = join(appPath, 'Contents', 'Info.plist');
  try {
    return execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', plist],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim();
  } catch {
    return null;
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function formatBilingualError(result: PreflightResult): string {
  const failed = result.checks
    .filter((check) => !check.ok)
    .map((check) => `${check.name}: ${check.detail}`);
  return [
    '부트스트랩 사전 점검에 실패했습니다. macOS 접근성 권한과 KakaoTalk 설치/버전을 확인하세요.',
    'Bootstrap preflight failed. Check macOS Accessibility permission and KakaoTalk installation/version.',
    ...failed
  ].join('\n');
}
