import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedRoom, roomInviteUrl } from '../apps/web/src/roomInvite.js';
test('room invite strips access codes and debug data', () => {
  assert.equal(roomInviteUrl('https://game.test/?invite=secret&autojoin=A#secret', 'Abcd123'), 'https://game.test/?room=Abcd123');
});
test('room locator validates and never accepts arbitrary path data', () => {
  assert.equal(requestedRoom('https://game.test/?room=Abcd123'), 'Abcd123');
  assert.equal(requestedRoom('https://game.test/?room=../../foo'), null);
  assert.equal(requestedRoom('bad-url'), null);
});
test('room invite rejects non-web destinations and removes URL credentials', () => {
  assert.equal(roomInviteUrl('https://user:password@game.test/', 'Abcd123'), 'https://game.test/?room=Abcd123');
  assert.throws(() => roomInviteUrl('file:///tmp/game', 'Abcd123'));
});
