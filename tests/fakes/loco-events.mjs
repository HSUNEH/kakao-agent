export function makeLocoMessageEvent(overrides = {}) {
  const event = {
    chatroomId: 1006,
    logId: 1,
    senderId: 'user-1',
    senderName: '테스터',
    content: '테스트 메시지',
    timestamp: 1_700_000_000_000,
    ...overrides
  };
  return Object.freeze({
    ...event,
    source: Object.freeze(overrides.source ?? { chatroomId: event.chatroomId, logId: event.logId })
  });
}

export function makeChatInfoTitle(title) {
  return Object.freeze({ chatInfo: { chatMetas: [{ type: 3, content: title }] } });
}
