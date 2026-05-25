import { resolveRoomBehavior, type RoomMode, type RoomPolicyConfig } from './room-scope.js';

export type RoomOperation = 'read' | 'respond' | 'send' | 'external_action';

export interface AuthorizationInput {
  chatroomId: number;
  operation: RoomOperation;
  allowedRoomIds?: readonly number[];
  deniedRoomIds?: readonly number[];
  policy?: RoomPolicyConfig;
}

export interface AuthorizationDecision {
  allowed: boolean;
  mode: RoomMode;
  reason: string;
}

export function authorizeRoomOperation(input: AuthorizationInput): AuthorizationDecision {
  const behavior = resolveRoomBehavior(input.chatroomId, input.policy);

  if (input.deniedRoomIds?.includes(input.chatroomId)) {
    return deny(behavior.mode, 'room is explicitly denylisted');
  }

  if (input.allowedRoomIds && !input.allowedRoomIds.includes(input.chatroomId)) {
    return deny(behavior.mode, 'room is not in the explicit allowlist');
  }

  if (!behavior.canRead) return deny(behavior.mode, 'room mode does not permit reading');

  if (input.operation === 'read') return allow(behavior.mode, 'read permitted by room policy');

  if (input.operation === 'respond' && !behavior.canRespondInline) {
    return deny(behavior.mode, 'room mode does not permit inline responses');
  }

  if (
    (input.operation === 'send' || input.operation === 'external_action') &&
    behavior.sideEffectPosture === 'forbidden'
  ) {
    return deny(behavior.mode, 'room mode forbids side effects');
  }

  return allow(behavior.mode, `${input.operation} permitted by room policy gate`);
}

function allow(mode: RoomMode, reason: string): AuthorizationDecision {
  return { allowed: true, mode, reason };
}

function deny(mode: RoomMode, reason: string): AuthorizationDecision {
  return { allowed: false, mode, reason };
}
