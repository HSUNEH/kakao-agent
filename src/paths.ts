import { homedir } from 'node:os';
import { join } from 'node:path';

export function getKakaoAgentHome(): string {
  return process.env.KAKAO_AGENT_HOME ?? join(homedir(), '.kakao-agent');
}

export function getMessagesDbPath(): string {
  return process.env.KAKAO_AGENT_DB ?? join(getKakaoAgentHome(), 'messages.db');
}

export function getWhitelistPath(): string {
  return process.env.KAKAO_AGENT_WHITELIST ?? join(getKakaoAgentHome(), 'whitelist.yaml');
}

export function getRoomsPath(): string {
  return process.env.KAKAO_AGENT_ROOMS ?? join(getKakaoAgentHome(), 'rooms.yaml');
}

export function getBootstrapStatePath(): string {
  return (
    process.env.KAKAO_AGENT_BOOTSTRAP_STATE ?? join(getKakaoAgentHome(), 'bootstrap-state.yaml')
  );
}

export function getExportsDir(): string {
  return process.env.KAKAO_AGENT_EXPORTS_DIR ?? join(getKakaoAgentHome(), 'exports');
}
