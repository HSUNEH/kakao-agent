import { authorizeRoomOperation } from './authorization.js';
import type { RoomMode } from './room-scope.js';

export type RuntimeAction =
  | 'read_local'
  | 'summarize'
  | 'search'
  | 'send_message'
  | 'external_request'
  | 'proactive_message';

export interface SideEffectInput {
  chatroomId: number;
  mode: RoomMode;
  action: RuntimeAction;
  dryRun: boolean;
  confirmed: boolean;
}

export interface SideEffectDecision {
  allowed: boolean;
  requiresDryRun: boolean;
  requiresConfirmation: boolean;
  auditLogRequired: boolean;
  reason: string;
}

const READ_ACTIONS = new Set<RuntimeAction>(['read_local', 'summarize', 'search']);

export function decideSideEffect(input: SideEffectInput): SideEffectDecision {
  const operation = READ_ACTIONS.has(input.action)
    ? 'read'
    : input.action === 'send_message' || input.action === 'proactive_message'
      ? 'send'
      : 'external_action';
  const auth = authorizeRoomOperation({
    chatroomId: input.chatroomId,
    operation,
    policy: { roomModes: { [input.chatroomId]: input.mode } }
  });

  if (!auth.allowed) return deny(false, false, auth.mode === 'business_support', auth.reason);
  if (READ_ACTIONS.has(input.action)) return allow(false);

  if (input.action === 'proactive_message') {
    return deny(
      false,
      false,
      auth.mode === 'business_support',
      'proactive messages are disabled by default'
    );
  }

  if (!input.dryRun) {
    return deny(
      true,
      false,
      auth.mode === 'business_support',
      'side effects require a dry-run preview first'
    );
  }

  if (!input.confirmed) {
    return deny(
      false,
      true,
      auth.mode === 'business_support',
      'side effects require explicit confirmation'
    );
  }

  return allow(auth.mode === 'business_support');
}

function allow(auditLogRequired: boolean): SideEffectDecision {
  return {
    allowed: true,
    requiresDryRun: false,
    requiresConfirmation: false,
    auditLogRequired,
    reason: 'action permitted by side-effect gate'
  };
}

function deny(
  requiresDryRun: boolean,
  requiresConfirmation: boolean,
  auditLogRequired: boolean,
  reason: string
): SideEffectDecision {
  return { allowed: false, requiresDryRun, requiresConfirmation, auditLogRequired, reason };
}
