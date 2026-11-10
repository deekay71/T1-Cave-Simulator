import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import Fastify from 'fastify';
import { COSMETICS } from '../packages/shared/src/progression.js';
import { ProgressionStore } from '../apps/api/src/progression/store.js';
import { hashSessionToken, progressionConfig } from '../apps/api/src/progression/security.js';
import { registerProgressionRoutes, sendProgressionError } from '../apps/api/src/progression/routes.js';

let db: PGlite;
let pool: Pool;
let store: ProgressionStore;
// A public deterministic token exists only in this ephemeral in-memory database.
const fixtureToken = 'T'.repeat(43);
const config = progressionConfig({ PROGRESSION_ENABLED: 'true', WEB_ORIGIN: 'https://cave.example', NODE_ENV: 'production' });
before(async () => {
  db = new PGlite();
  await db.exec(await readFile('db/001_initial.sql', 'utf8'));
  await db.exec(await readFile('db/003_progression.sql', 'utf8'));
  await db.exec(await readFile('db/004_cave_stalls.sql', 'utf8'));
  // PGlite has one connection: serialize transactions for its adapter. Production Pool uses
  // independent connections; SELECT ... FOR UPDATE in the store provides cross-process locking.
  let tail = Promise.resolve();
  pool = {
    connect: async () => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await prior;
      return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release } as unknown as PoolClient;
    },
  } as unknown as Pool;
  store = new ProgressionStore(pool);
});
after(async () => { await db?.close(); });

async function guest(balance = 0) {
  const id = randomUUID();
  await db.query('INSERT INTO accounts(id, display_name) VALUES ($1, $2)', [id, 'Synthetic fan']);
  await db.query('INSERT INTO profiles(account_id) VALUES ($1)', [id]);
  await db.query('INSERT INTO progression_wallets(account_id, balance) VALUES ($1, $2)', [id, balance]);
  return id;
}
async function scalar(sql: string, params: unknown[] = []) {
  return (await db.query<{ n: number }>(sql, params)).rows[0].n;
}

test('migration catalog matches existing avatar assets and fresh wallet has no invented rewards', async () => {
  const id = await guest();
  const state = await store.read(id);
  assert.equal(state.authenticated, true);
  assert.equal(state.currency.balance, 0);
  assert.equal(state.daily.claimed, false);
  assert.deepEqual(state.catalog, COSMETICS.map(item => ({ ...item })).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id)));
  assert.deepEqual(state.inventory, []);
  assert.equal(state.avatarKey, null);
  const manifest = JSON.parse(await readFile('apps/web/public/models/manifest.characters.json', 'utf8'));
  for (const item of state.catalog) assert.ok(JSON.stringify(manifest).includes(item.assetKey));
});

test('repeated concurrent checkins award exactly once, with coin/XP ledger entries and server UTC day', async () => {
  const id = await guest();
  const results = await Promise.all(Array.from({ length: 10 }, () => store.checkIn(id)));
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.reward, 0), 25);
  assert.equal((await store.read(id)).currency.balance, 25);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM daily_checkins WHERE account_id = $1', [id]), 1);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM reward_ledger WHERE account_id = $1', [id]), 2);
  const day = (await db.query<{ day: string }>("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  assert.equal(results[0].state.daily.day, day);
  assert.equal(results[0].state.daily.claimed, true);
});

test('consecutive day increases streak; missed day resets; database timezone does not change UTC day', async () => {
  const id = await guest();
  await db.query("UPDATE progression_wallets SET last_checkin_day = (clock_timestamp() AT TIME ZONE 'UTC')::date - 1, streak = 3 WHERE account_id = $1", [id]);
  await db.exec("SET TIME ZONE 'Pacific/Kiritimati'");
  try {
    const result = await store.checkIn(id);
    assert.equal(result.state.daily.streak, 4);
    assert.equal(result.reward, 25);
    assert.equal(result.state.daily.timezone, 'UTC');
  } finally { await db.exec("SET TIME ZONE 'UTC'"); }
  const missed = await guest();
  await db.query("UPDATE progression_wallets SET last_checkin_day = (clock_timestamp() AT TIME ZONE 'UTC')::date - 2, streak = 15 WHERE account_id = $1", [missed]);
  const reset = await store.checkIn(missed);
  assert.equal(reset.state.daily.streak, 1);
  assert.equal(reset.reward, 25);
});

test('purchase is atomic, price is server-controlled, replay is idempotent and funds cannot go negative', async () => {
  const id = await guest(150), key = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => store.purchase(id, 'fan-cap-red', key)));
  assert.equal(results.filter(result => result.purchased).length, 1);
  assert.equal(results.filter(result => result.replayed).length, 7);
  assert.equal((await store.read(id)).currency.balance, 100);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM progression_purchases WHERE account_id = $1', [id]), 1);
  await assert.rejects(store.purchase(id, 'fan-hoodie-white', key), /Mã giao dịch/);
  await assert.rejects(store.purchase(id, 'fan-cap-red', randomUUID()), /đã sở hữu/);
  await assert.rejects(store.purchase(id, 'fan-headband', randomUUID()), /Chưa đủ/);
  assert.equal((await store.read(id)).currency.balance, 100);
  const outcomes = await Promise.allSettled([
    store.purchase(id, 'fan-hoodie-white', randomUUID()),
    store.purchase(id, 'fan-hoodie-white', randomUUID()),
  ]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal((await store.read(id)).currency.balance, 0);
  assert.equal(await scalar('SELECT sum(quantity)::int AS n FROM inventory WHERE account_id = $1', [id]), 2);
});

test('failed receipt insert rolls back wallet debit and inventory grant', async () => {
  const id = await guest(100);
  const rejectedKey = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  // Test-only constraint trips at receipt INSERT, after the wallet debit and inventory grant.
  await db.exec(`ALTER TABLE progression_purchases ADD CONSTRAINT synthetic_receipt_failure
    CHECK (idempotency_key <> '${rejectedKey}'::uuid)`);
  try {
    await assert.rejects(store.purchase(id, 'fan-cap-red', rejectedKey));
    const state = await store.read(id);
    assert.equal(state.currency.balance, 100);
    assert.deepEqual(state.inventory, []);
    assert.equal(await scalar('SELECT count(*)::int AS n FROM progression_purchases WHERE account_id = $1', [id]), 0);
  } finally { await db.exec('ALTER TABLE progression_purchases DROP CONSTRAINT synthetic_receipt_failure'); }
});

test('competing different purchases cannot overspend the same wallet', async () => {
  const id = await guest(150);
  const results = await Promise.allSettled([
    store.purchase(id, 'fan-hoodie-white', randomUUID()),
    store.purchase(id, 'fan-headband', randomUUID()),
  ]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const state = await store.read(id);
  assert.ok(state.currency.balance >= 0);
  assert.equal(state.inventory.length, 1);
  const paid = await scalar('SELECT sum(cost)::int AS n FROM progression_purchases WHERE account_id = $1', [id]);
  assert.equal(state.currency.balance + paid, 150);
});

test('equip requires ownership, persists across reads, and can return to default', async () => {
  const id = await guest(50), other = await guest();
  await assert.rejects(store.equip(id, 'fan-cap-red'), /chưa sở hữu/);
  await store.purchase(id, 'fan-cap-red', randomUUID());
  const equipped = await store.equip(id, 'fan-cap-red');
  assert.equal(equipped.equippedItemId, 'fan-cap-red');
  assert.equal((await store.read(id)).avatarKey, 'tl_char_fan_cap_red_v01');
  await assert.rejects(store.equip(other, 'fan-cap-red'), /chưa sở hữu/);
  assert.equal((await store.equip(id, null)).avatarKey, null);
  await db.query("UPDATE catalog_items SET enabled = false WHERE id = 'fan-headband'");
  try { await assert.rejects(store.purchase(id, 'fan-headband', randomUUID()), /chưa mở bán/); }
  finally { await db.query("UPDATE catalog_items SET enabled = true WHERE id = 'fan-headband'"); }
});

test('hashed synthetic session resolves server identity; expiry, revocation and deleted accounts reject it', async () => {
  const id = await guest();
  const hash = hashSessionToken(fixtureToken);
  await db.query("INSERT INTO guest_sessions(token_hash, account_id, expires_at) VALUES ($1, $2, clock_timestamp() + interval '1 day')", [hash, id]);
  assert.equal((await store.findSession(hash))?.id, id);
  assert.equal(await store.findSession('0'.repeat(64)), null);
  await db.query("UPDATE accounts SET deleted_at = clock_timestamp() WHERE id = $1", [id]);
  assert.equal(await store.findSession(hash), null);
  await db.query('UPDATE accounts SET deleted_at = NULL WHERE id = $1', [id]);
  await db.query("UPDATE guest_sessions SET created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' WHERE token_hash = $1", [hash]);
  assert.equal(await store.findSession(hash), null);
  await store.revokeSession(hash);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM guest_sessions WHERE token_hash = $1', [hash]), 0);
});

test('HTTP identity ignores client UUID, enforces CSRF/schema, and resumes only an existing synthetic cookie', async () => {
  const id = await guest(50), other = await guest(100);
  const hash = hashSessionToken(fixtureToken);
  await db.query("INSERT INTO guest_sessions(token_hash, account_id, expires_at) VALUES ($1, $2, clock_timestamp() + interval '1 day')", [hash, id]);
  const app = Fastify();
  const headers = { origin: config.webOrigin, 'x-t1-request': '1', cookie: `${config.cookieName}=${fixtureToken}` };
  try {
    const helpers = await registerProgressionRoutes(app, pool, config);
    app.post('/guest-probe', async (req, reply) => {
      try { return await helpers.resolveGuest(req, reply, 'Resumed fan'); }
      catch (error) { return sendProgressionError(reply, error); }
    });
    const anon = await app.inject({ url: '/v1/progression', headers: { cookie: `accountId=${other}` } });
    assert.equal(anon.json().authenticated, false);
    const noSession = await app.inject({ method: 'POST', url: '/v1/progression/check-in', headers: { origin: config.webOrigin, 'x-t1-request': '1' }, payload: {} });
    assert.equal(noSession.statusCode, 401);
    const spoof = await app.inject({ method: 'POST', url: '/v1/progression/check-in', headers, payload: { accountId: other, day: '2030-01-01', reward: 999 } });
    assert.equal(spoof.statusCode, 400);
    for (const invalidHeaders of [{ ...headers, origin: 'https://evil.example' }, { cookie: headers.cookie }]) {
      const blocked = await app.inject({ method: 'POST', url: '/v1/progression/check-in', headers: invalidHeaders, payload: {} });
      assert.equal(blocked.statusCode, 403);
    }
    const resume = await app.inject({ method: 'POST', url: '/guest-probe', headers });
    assert.equal(resume.statusCode, 200);
    assert.equal(resume.json().id, id);
    assert.equal(resume.headers['set-cookie'], undefined);
    const checked = await app.inject({ method: 'POST', url: '/v1/progression/check-in', headers, payload: {} });
    assert.equal(checked.statusCode, 200);
    assert.equal(checked.json().state.account.id, id);
    assert.equal(checked.json().state.currency.balance, 75);
    assert.equal((await store.read(other)).currency.balance, 100);
    const bought = await app.inject({ method: 'POST', url: '/v1/progression/purchase', headers, payload: { itemId: 'fan-cap-red', idempotencyKey: randomUUID() } });
    assert.equal(bought.statusCode, 200);
    const equipped = await app.inject({ method: 'POST', url: '/v1/progression/equip', headers, payload: { itemId: 'fan-cap-red' } });
    assert.equal(equipped.json().avatarKey, 'tl_char_fan_cap_red_v01');
    const state = await app.inject({ url: '/v1/progression', headers });
    assert.equal(state.headers['cache-control'], 'no-store');
    assert.equal(state.json().account.name, 'Resumed fan');
    const logout = await app.inject({ method: 'POST', url: '/v1/progression/logout', headers, payload: {} });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await app.inject({ url: '/v1/progression', headers })).json().authenticated, false);
  } finally { await app.close(); await store.revokeSession(hash); }
});
