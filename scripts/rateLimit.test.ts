import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '@te-liet/shared';
import { RateLimiter } from '../apps/game/src/rateLimit.js';

test('guest chỉ gửi được 3 tin chat trong 10 giây, sau đó hồi dần', () => {
  const limiter = new RateLimiter();
  const t0 = 1_000_000;
  const sent = Array.from({ length: 10 }, () => limiter.allow('s1:chat', LIMITS.chat.guest, t0)).filter(Boolean).length;
  assert.equal(sent, 3);
  assert.equal(limiter.allow('s1:chat', LIMITS.chat.guest, t0 + 3_000), false);
  assert.equal(limiter.allow('s1:chat', LIMITS.chat.guest, t0 + 3_400), true);   // hồi 1 tin sau ~3,33 s
});

test('mỗi client và mỗi loại message có bucket riêng; forget() xóa bucket của client', () => {
  const limiter = new RateLimiter();
  const t0 = 5_000;
  for (let i = 0; i < 2; i++) limiter.allow('a:emote', LIMITS.emote, t0);
  assert.equal(limiter.allow('a:emote', LIMITS.emote, t0), false);
  assert.equal(limiter.allow('b:emote', LIMITS.emote, t0), true);
  limiter.forget('a:');
  assert.equal(limiter.allow('a:emote', LIMITS.emote, t0), true);
});
