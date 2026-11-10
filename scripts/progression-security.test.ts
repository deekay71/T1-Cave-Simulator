import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import {
  guardOrigin, hashSessionToken, progressionConfig, readSessionToken, sessionCookie,
} from '../apps/api/src/progression/security.js';
import { registerProgressionRoutes } from '../apps/api/src/progression/routes.js';
import { dailyReward, PurchaseRequest, EquipRequest } from '../packages/shared/src/progression.js';
import { nextStreak } from '../apps/api/src/progression/store.js';

const enabled = progressionConfig({ PROGRESSION_ENABLED: 'true', NODE_ENV: 'production', WEB_ORIGIN: 'https://cave.example' });
// Public synthetic test fixture only. No generated credential or persistent database is used.
const fixtureToken = 'A'.repeat(43);

test('progression is off by default; production requires exact HTTPS origin', () => {
  assert.equal(progressionConfig({}).enabled, false);
  assert.equal(progressionConfig({ PROGRESSION_ENABLED: 'TRUE' }).enabled, false);
  assert.equal(enabled.cookieName, '__Host-t1_guest');
  for (const origin of ['*', 'https://cave.example/', 'http://localhost:5173', 'https://cave.example/path', 'https://user:pass@cave.example']) {
    assert.throws(() => progressionConfig({ PROGRESSION_ENABLED: 'true', NODE_ENV: 'production', WEB_ORIGIN: origin }));
  }
  assert.throws(() => progressionConfig({ PROGRESSION_ENABLED: 'true', WEB_ORIGIN: 'http://nonlocal.example' }));
  const local = progressionConfig({ PROGRESSION_ENABLED: 'true', NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173' });
  assert.equal(local.secureCookie, false);
  assert.equal(local.cookieName, 't1_guest_dev');
});

test('origin, fetch-site, custom header and exact cookie checks reject CSRF and UUID spoofing', () => {
  const good = { origin: enabled.webOrigin, 'x-t1-request': '1', 'sec-fetch-site': 'same-origin' };
  assert.doesNotThrow(() => guardOrigin({ headers: good }, enabled, true));
  assert.doesNotThrow(() => guardOrigin({ headers: {} }, enabled, false));
  for (const headers of [{}, { origin: enabled.webOrigin }, { ...good, origin: 'null' },
    { ...good, origin: 'https://evil.example' }, { ...good, 'sec-fetch-site': 'cross-site' }, { ...good, 'x-t1-request': 'true' }]) {
    assert.throws(() => guardOrigin({ headers }, enabled, true), /trang game/);
  }
  const cookie = `${enabled.cookieName}=${fixtureToken}`;
  assert.equal(readSessionToken({ headers: { cookie } }, enabled), fixtureToken);
  for (const bad of [`${cookie}; ${cookie}`, 'accountId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', `${enabled.cookieName}=uuid`, `${cookie}%00`, `t1_guest_dev=${fixtureToken}`]) {
    assert.equal(readSessionToken({ headers: { cookie: bad } }, enabled), null);
  }
  const serialized = sessionCookie(enabled, fixtureToken);
  assert.match(serialized, /Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
  assert.equal(serialized.includes('Domain='), false);
  assert.match(sessionCookie(enabled, null), /Max-Age=0; Secure$/);
  assert.match(hashSessionToken(fixtureToken), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(fixtureToken), fixtureToken);
});

test('streak date boundaries and cumulative attendance rewards are deterministic', () => {
  assert.equal(nextStreak(null, 0, '2026-11-10'), 1);
  assert.equal(nextStreak('2026-11-09', 4, '2026-11-10'), 5);
  assert.equal(nextStreak('2026-11-10', 4, '2026-11-10'), 4);
  assert.equal(nextStreak('2026-11-08', 4, '2026-11-10'), 1);
  assert.equal(nextStreak('2026-12-31', 4, '2027-01-01'), 5);
  assert.equal(nextStreak('2028-02-29', 4, '2028-03-01'), 5);
  assert.deepEqual([0, 1, 2, 15, 16, 17, 18, 21, 1000].map(dailyReward), [0, 25, 25, 25, 0, 0, 25, 25, 0]);
});

test('purchase/equip requests reject supplied identity, price or arbitrary avatar key', () => {
  const valid = { itemId: 'fan-cap-red', idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  assert.equal(PurchaseRequest.safeParse(valid).success, true);
  for (const extra of [{ price: 0 }, { accountId: 'another-player' }, { currency: 1000 }]) {
    assert.equal(PurchaseRequest.safeParse({ ...valid, ...extra }).success, false);
  }
  assert.equal(PurchaseRequest.safeParse({ ...valid, idempotencyKey: 'not-a-uuid' }).success, false);
  assert.equal(EquipRequest.safeParse({ itemId: null }).success, true);
  assert.equal(EquipRequest.safeParse({ itemId: 'fan-cap-red', avatarKey: 'anything' }).success, false);
});

test('disabled registration and guest helper never access DB, issue cookies or authenticate', async () => {
  let queries = 0;
  const pool = { connect: async () => { queries++; throw new Error('must not connect'); } } as unknown as Pool;
  const app = Fastify();
  try {
    const helper = await registerProgressionRoutes(app, pool, progressionConfig({}));
    app.post('/guest-probe', async (req, reply) => ({ identity: await helper.resolveGuest(req, reply, 'Guest') }));
    const guest = await app.inject({ method: 'POST', url: '/guest-probe' });
    assert.deepEqual(guest.json(), { identity: null });
    assert.equal(guest.headers['set-cookie'], undefined);
    const state = await app.inject('/v1/progression');
    assert.equal(state.statusCode, 200);
    assert.equal(state.headers['cache-control'], 'no-store');
    assert.equal(state.json().enabled, false);
    assert.equal(state.json().authenticated, false);
    for (const url of ['check-in', 'purchase', 'equip', 'logout', 'quiz/start', 'quiz/submit']) {
      const response = await app.inject({ method: 'POST', url: `/v1/progression/${url}`, payload: {} });
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().code, 'progression_disabled');
      assert.equal(response.headers['set-cookie'], undefined);
    }
    assert.equal(queries, 0);
  } finally { await app.close(); }
});

test('enabled but missing/failed database fails closed with public-safe errors', async () => {
  for (const pool of [null, { connect: async () => { throw new Error('private database information'); } } as unknown as Pool]) {
    const app = Fastify();
    try {
      await registerProgressionRoutes(app, pool, enabled);
      const response = await app.inject('/v1/progression');
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.includes('private'), false);
      assert.equal(response.headers['set-cookie'], undefined);
    } finally { await app.close(); }
  }
});
