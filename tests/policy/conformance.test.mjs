import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ROOM_BEHAVIOR_TABLE,
  ROOM_MODES,
  authorizeRoomOperation,
  buildRoomMemoryKey,
  decideMemoryScope,
  decideSideEffect,
  resolveRoomBehavior
} from '../../dist/policy/index.js';
import { FakeKakaoClient } from '../fakes/kakao-client.mjs';
import { FakeMacOSBridge } from '../fakes/macos-bridge.mjs';
import { makeLocoMessageEvent } from '../fakes/loco-events.mjs';
import { fakeRooms, roomModesById } from '../fakes/rooms.mjs';

test('room behavior table covers all canonical OSS modes', () => {
  assert.deepEqual(Object.keys(ROOM_BEHAVIOR_TABLE).sort(), [...ROOM_MODES].sort());
  assert.equal(ROOM_BEHAVIOR_TABLE.read_only_intelligence.canRead, true);
  assert.equal(ROOM_BEHAVIOR_TABLE.read_only_intelligence.canRespondInline, false);
  assert.equal(ROOM_BEHAVIOR_TABLE.ignored.canRead, false);
  assert.equal(ROOM_BEHAVIOR_TABLE.business_support.auditLogRequired, true);
});

test('authorization is explicit for allowlist, denylist, ignored, and read-only rooms', () => {
  const policy = { roomModes: roomModesById() };
  assert.equal(
    authorizeRoomOperation({
      chatroomId: fakeRooms.readOnly.chatroomId,
      operation: 'read',
      allowedRoomIds: [fakeRooms.readOnly.chatroomId],
      policy
    }).allowed,
    true
  );
  assert.equal(
    authorizeRoomOperation({
      chatroomId: fakeRooms.readOnly.chatroomId,
      operation: 'respond',
      allowedRoomIds: [fakeRooms.readOnly.chatroomId],
      policy
    }).allowed,
    false
  );
  assert.equal(
    authorizeRoomOperation({
      chatroomId: fakeRooms.ignored.chatroomId,
      operation: 'read',
      allowedRoomIds: [fakeRooms.ignored.chatroomId],
      policy
    }).allowed,
    false
  );
  assert.equal(
    authorizeRoomOperation({
      chatroomId: fakeRooms.family.chatroomId,
      operation: 'read',
      deniedRoomIds: [fakeRooms.family.chatroomId],
      policy
    }).allowed,
    false
  );
  assert.equal(
    authorizeRoomOperation({
      chatroomId: fakeRooms.family.chatroomId,
      operation: 'read',
      allowedRoomIds: [9999],
      policy
    }).allowed,
    false
  );
});

test('memory is room-scoped only and disabled unless explicitly enabled', () => {
  assert.deepEqual(decideMemoryScope({ chatroomId: 1, mode: 'personal_assistant' }), {
    enabled: false,
    scope: 'none',
    key: null,
    crossRoomAllowed: false,
    reason: 'memory is disabled unless explicitly enabled for a room-scoped mode'
  });
  assert.deepEqual(
    decideMemoryScope({ chatroomId: 1, mode: 'personal_assistant', explicitMemoryEnabled: true }),
    {
      enabled: true,
      scope: 'room',
      key: buildRoomMemoryKey(1),
      crossRoomAllowed: false,
      reason: 'memory is explicitly enabled and remains room-scoped'
    }
  );
  assert.notEqual(buildRoomMemoryKey(1), buildRoomMemoryKey(2));
  assert.equal(
    decideMemoryScope({ chatroomId: 2, mode: 'family_group', explicitMemoryEnabled: true }).enabled,
    false
  );
});

test('side-effect gate requires dry-run and confirmation and blocks read-only/ignored sends', () => {
  assert.equal(
    decideSideEffect({
      chatroomId: 1,
      mode: 'read_only_intelligence',
      action: 'search',
      dryRun: false,
      confirmed: false
    }).allowed,
    true
  );
  assert.equal(
    decideSideEffect({
      chatroomId: 1,
      mode: 'read_only_intelligence',
      action: 'send_message',
      dryRun: true,
      confirmed: true
    }).allowed,
    false
  );
  const noDryRun = decideSideEffect({
    chatroomId: 2,
    mode: 'family_group',
    action: 'send_message',
    dryRun: false,
    confirmed: false
  });
  assert.equal(noDryRun.allowed, false);
  assert.equal(noDryRun.requiresDryRun, true);
  const noConfirm = decideSideEffect({
    chatroomId: 2,
    mode: 'family_group',
    action: 'send_message',
    dryRun: true,
    confirmed: false
  });
  assert.equal(noConfirm.allowed, false);
  assert.equal(noConfirm.requiresConfirmation, true);
  assert.equal(
    decideSideEffect({
      chatroomId: 2,
      mode: 'family_group',
      action: 'send_message',
      dryRun: true,
      confirmed: true
    }).allowed,
    true
  );
  assert.equal(
    decideSideEffect({
      chatroomId: 3,
      mode: 'business_support',
      action: 'external_request',
      dryRun: true,
      confirmed: true
    }).auditLogRequired,
    true
  );
  assert.equal(
    decideSideEffect({
      chatroomId: 4,
      mode: 'automation_bridge',
      action: 'proactive_message',
      dryRun: true,
      confirmed: true
    }).allowed,
    false
  );
});

test('canonical fakes are deterministic and carry source attribution', async () => {
  const event = makeLocoMessageEvent({ chatroomId: fakeRooms.readOnly.chatroomId, logId: 42 });
  const client = new FakeKakaoClient({ messages: [event] });
  const rooms = await client.listChats();
  const messages = await client.getMessages(fakeRooms.readOnly.chatroomId);
  assert.equal(rooms.length, Object.keys(fakeRooms).length);
  assert.deepEqual(messages[0].source, { chatroomId: fakeRooms.readOnly.chatroomId, logId: 42 });

  const bridge = new FakeMacOSBridge();
  const dryRun = await bridge.sendMessage(fakeRooms.family.chatroomId, '안녕', { dryRun: true });
  assert.deepEqual(dryRun, { chatroomId: fakeRooms.family.chatroomId, text: '안녕', dryRun: true });
});

test('default room policy is read-only intelligence', () => {
  assert.equal(resolveRoomBehavior(123).mode, 'read_only_intelligence');
});
