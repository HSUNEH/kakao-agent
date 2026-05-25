export const ROOM_MODES = [
  'personal_assistant',
  'family_group',
  'business_support',
  'automation_bridge',
  'ignored',
  'read_only_intelligence'
] as const;

export type RoomMode = (typeof ROOM_MODES)[number];

export interface RoomBehavior {
  mode: RoomMode;
  label: string;
  canRead: boolean;
  canRespondInline: boolean;
  allowsProactiveMessages: boolean;
  memoryDefault: 'disabled' | 'explicit_room_scoped';
  sideEffectPosture: 'forbidden' | 'confirmation_required';
  requiresSourceAttribution: boolean;
  auditLogRequired: boolean;
}

export interface RoomPolicyConfig {
  defaultMode?: RoomMode;
  roomModes?: Readonly<Record<number, RoomMode>>;
}

export const ROOM_BEHAVIOR_TABLE: Readonly<Record<RoomMode, RoomBehavior>> = {
  personal_assistant: {
    mode: 'personal_assistant',
    label: 'Personal assistant / self room',
    canRead: true,
    canRespondInline: true,
    allowsProactiveMessages: false,
    memoryDefault: 'explicit_room_scoped',
    sideEffectPosture: 'confirmation_required',
    requiresSourceAttribution: true,
    auditLogRequired: false
  },
  family_group: {
    mode: 'family_group',
    label: 'Family / trusted group helper',
    canRead: true,
    canRespondInline: true,
    allowsProactiveMessages: false,
    memoryDefault: 'disabled',
    sideEffectPosture: 'confirmation_required',
    requiresSourceAttribution: true,
    auditLogRequired: false
  },
  business_support: {
    mode: 'business_support',
    label: 'Business / customer support room',
    canRead: true,
    canRespondInline: true,
    allowsProactiveMessages: false,
    memoryDefault: 'disabled',
    sideEffectPosture: 'confirmation_required',
    requiresSourceAttribution: true,
    auditLogRequired: true
  },
  automation_bridge: {
    mode: 'automation_bridge',
    label: 'Automation bridge / commands only',
    canRead: true,
    canRespondInline: false,
    allowsProactiveMessages: false,
    memoryDefault: 'disabled',
    sideEffectPosture: 'confirmation_required',
    requiresSourceAttribution: true,
    auditLogRequired: true
  },
  ignored: {
    mode: 'ignored',
    label: 'Ignored room',
    canRead: false,
    canRespondInline: false,
    allowsProactiveMessages: false,
    memoryDefault: 'disabled',
    sideEffectPosture: 'forbidden',
    requiresSourceAttribution: false,
    auditLogRequired: false
  },
  read_only_intelligence: {
    mode: 'read_only_intelligence',
    label: 'Read-only intelligence room',
    canRead: true,
    canRespondInline: false,
    allowsProactiveMessages: false,
    memoryDefault: 'disabled',
    sideEffectPosture: 'forbidden',
    requiresSourceAttribution: true,
    auditLogRequired: false
  }
};

export function resolveRoomBehavior(
  chatroomId: number,
  config: RoomPolicyConfig = {}
): RoomBehavior {
  const mode = config.roomModes?.[chatroomId] ?? config.defaultMode ?? 'read_only_intelligence';
  return ROOM_BEHAVIOR_TABLE[mode];
}

export function isRoomMode(value: unknown): value is RoomMode {
  return typeof value === 'string' && ROOM_MODES.includes(value as RoomMode);
}
