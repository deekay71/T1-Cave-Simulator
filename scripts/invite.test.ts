import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteMatches } from '../apps/api/src/invite.js';

test('không đặt INVITE_CODE thì ai cũng vào được', () => {
  for (const expected of [undefined, '', '   ']) {
    assert.equal(inviteMatches(expected, undefined), true);
    assert.equal(inviteMatches(expected, 'bất kỳ'), true);
  }
});

test('có INVITE_CODE thì phải nhập đúng mã (bỏ khoảng trắng, không phân biệt hoa thường)', () => {
  assert.equal(inviteMatches('HANG-2026', 'HANG-2026'), true);
  assert.equal(inviteMatches('HANG-2026', '  hang-2026 '), true);
  assert.equal(inviteMatches('HANG-2026', 'HANG-2025'), false);
  assert.equal(inviteMatches('HANG-2026', 'HANG'), false);
  assert.equal(inviteMatches('HANG-2026', ''), false);
  assert.equal(inviteMatches('HANG-2026', undefined), false);
  assert.equal(inviteMatches('HANG-2026', 2026), false);
});
