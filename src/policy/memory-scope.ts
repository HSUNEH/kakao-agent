import { resolveRoomBehavior, type RoomMode } from './room-scope.js';

export interface MemoryScopeInput {
  chatroomId: number;
  mode: RoomMode;
  explicitMemoryEnabled?: boolean;
}

export interface MemoryScopeDecision {
  enabled: boolean;
  scope: 'none' | 'room';
  key: string | null;
  crossRoomAllowed: false;
  reason: string;
}

export function decideMemoryScope(input: MemoryScopeInput): MemoryScopeDecision {
  const behavior = resolveRoomBehavior(input.chatroomId, {
    roomModes: { [input.chatroomId]: input.mode }
  });

  if (behavior.memoryDefault === 'disabled' || !input.explicitMemoryEnabled) {
    return {
      enabled: false,
      scope: 'none',
      key: null,
      crossRoomAllowed: false,
      reason: 'memory is disabled unless explicitly enabled for a room-scoped mode'
    };
  }

  return {
    enabled: true,
    scope: 'room',
    key: buildRoomMemoryKey(input.chatroomId),
    crossRoomAllowed: false,
    reason: 'memory is explicitly enabled and remains room-scoped'
  };
}

export function buildRoomMemoryKey(chatroomId: number): string {
  return `room:${chatroomId}`;
}
