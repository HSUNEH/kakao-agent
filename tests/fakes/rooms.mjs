export const fakeRooms = Object.freeze({
  self: Object.freeze({ chatroomId: 1001, mode: 'personal_assistant', title: '나와의 채팅' }),
  family: Object.freeze({ chatroomId: 1002, mode: 'family_group', title: '가족방' }),
  support: Object.freeze({ chatroomId: 1003, mode: 'business_support', title: '고객상담' }),
  automation: Object.freeze({
    chatroomId: 1004,
    mode: 'automation_bridge',
    title: '자동화 명령방'
  }),
  ignored: Object.freeze({ chatroomId: 1005, mode: 'ignored', title: '무시방' }),
  readOnly: Object.freeze({
    chatroomId: 1006,
    mode: 'read_only_intelligence',
    title: '읽기전용 로그방'
  })
});

export function roomModesById() {
  return Object.fromEntries(Object.values(fakeRooms).map((room) => [room.chatroomId, room.mode]));
}
