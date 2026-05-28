import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKakaoExportText } from '../dist/bootstrap/parser.js';

test('Kakao export parser handles multiline, media, system, and raw fallback rows', () => {
  const parsed = parseKakaoExportText(
    `카카오톡 대화내용\n[2026년 5월 27일 오후 9:01, 민수 : 안녕]\n이어지는 줄\n[2026년 5월 27일 오후 9:02, 지영 : [사진]]\n[2026년 5월 27일 오후 9:03, system : 민수님이 들어왔습니다]\n[깨진 원문]\n`,
    {
      chatroomId: 99,
      roomDisplayName: '테스트방',
      defaultTimestamp: Date.parse('2026-05-27T00:00:00.000+09:00')
    }
  );
  assert.equal(parsed.headerLines.length, 1);
  assert.equal(parsed.messages.length, 4);
  assert.equal(parsed.messages[0].content, '안녕\n이어지는 줄');
  assert.equal(parsed.messages[1].messageType, 'media_meta');
  assert.equal(parsed.messages[2].systemEventType, 'member_join');
  assert.equal(parsed.messages[3].parseStatus, 'raw');
  assert.ok(parsed.messages.every((message) => message.source === 'export' && message.logId < 0));
});

test('Kakao export parser classifies title events even when sender is not system', () => {
  const parsed = parseKakaoExportText(
    '[2026년 5월 27일 오후 11:04, 방장 : 채팅방 이름이 변경되었습니다]\n',
    { chatroomId: 100, roomDisplayName: '오픈채팅' }
  );
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].messageType, 'system');
  assert.equal(parsed.messages[0].systemEventType, 'room_title_change');
  assert.equal(parsed.messages[0].senderName, '방장');
});

test('Kakao export parser treats Korean export timestamps as Asia/Seoul time', () => {
  const parsed = parseKakaoExportText('[2026년 5월 27일 오후 9:01, 민수 : 타임존]\n', {
    chatroomId: 101,
    roomDisplayName: '타임존방'
  });
  assert.equal(parsed.messages[0].timestamp, Date.parse('2026-05-27T21:01:00.000+09:00'));
});
