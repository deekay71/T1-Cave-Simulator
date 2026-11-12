/**
 * Tài khoản: băm mật khẩu, xác minh ID token Google (khóa giả lập cục bộ), các route đăng ký /
 * đăng nhập / Google / vé / đăng xuất / đổi mật khẩu, quyền quản trị, kho tệp và kho Postgres
 * (PGlite), và script tạo tài khoản quản trị (không in mật khẩu).
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test, { after } from 'node:test';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { createTicketIssuer, createTicketVerifier, generateTicketKeys } from '../packages/auth/src/index.js';
import { googleDisplayName, SignUpRequest, Username } from '../packages/shared/src/accounts.js';
import { hashPassword, verifyPassword } from '../apps/api/src/accounts/password.js';
import { googleVerifier, isGoogleClientId, type GoogleVerifier } from '../apps/api/src/accounts/google.js';
import { registerAccountRoutes } from '../apps/api/src/accounts/routes.js';
import { AccountConflict, fileAccountStore, PgAccountStore, type AccountStore } from '../apps/api/src/accounts/store.js';
import { registerContentRoutes } from '../apps/api/src/content/routes.js';
import { fileContentStore } from '../apps/api/src/content/store.js';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tl-accounts-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PAGE = { 'x-t1-request': '1', origin: 'http://cave.test', host: 'cave.test' };
const CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
const cookieOf = (res: LightMyRequestResponse) => {
  const raw = res.headers['set-cookie'];
  const line = (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith('tl_session='));
  return line ? line.split(';')[0] : '';
};

test('passwords: scrypt with salt, self-describing, constant-time verify, junk rejected', async () => {
  const a = await hashPassword('hang-tru-thua-2026');
  const b = await hashPassword('hang-tru-thua-2026');
  assert.match(a, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('hang-tru-thua-2026', a), true);
  assert.equal(await verifyPassword('hang-tru-thua-2025', a), false);
  for (const junk of ['', 'plain', 'scrypt$3$8$1$x$y', 'bcrypt$a$b$c$d$e', a.replace(/\$[\w-]+$/, '$short')])
    assert.equal(await verifyPassword('hang-tru-thua-2026', junk), false, junk);
});

test('usernames are lowercased and limited; display names fall back sensibly', () => {
  assert.equal(Username.parse('  Faker.Fan_01 '), 'faker.fan_01');
  for (const bad of ['ab', '-abc', 'có-dấu', 'a'.repeat(25), 'with space'])
    assert.equal(Username.safeParse(bad).success, false, bad);
  assert.equal(SignUpRequest.safeParse({ username: 'abc', password: 'short' }).success, false);
  assert.equal(SignUpRequest.safeParse({ username: 'abc', password: 'long enough', extra: 1 }).success, false);
  assert.equal(googleDisplayName('  Lee   Sang-hyeok  ', null), 'Lee Sang-hyeok');
  assert.equal(googleDisplayName('', 'fan.t1@example.com'), 'fan.t1');
  assert.equal(googleDisplayName('😀'.repeat(30), null), '😀'.repeat(24));
  assert.equal(googleDisplayName(undefined, undefined), 'Người trong hang');
  assert.equal(isGoogleClientId(CLIENT_ID), true);
  assert.equal(isGoogleClientId('not-a-client'), false);
});

/** A stand-in for Google's signing keys, so the real verifier (jose) runs end to end. */
async function fakeGoogle() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'g1', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, o: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'g1' }).setIssuer(o.iss ?? 'https://accounts.google.com')
      .setAudience(o.aud ?? CLIENT_ID).setIssuedAt().setExpirationTime(o.exp ?? '5m').sign(privateKey);
  return { keys, sign };
}

test('Google ID tokens: signature, issuer, audience and expiry all checked; email only when verified', async () => {
  const g = await fakeGoogle();
  const verify = googleVerifier(CLIENT_ID, g.keys);
  const who = await verify(await g.sign({ sub: '1098', name: 'Fan T1', email: 'fan@example.com', email_verified: true }));
  assert.deepEqual(who, { sub: '1098', name: 'Fan T1', email: 'fan@example.com' });
  assert.equal((await verify(await g.sign({ sub: '1098', email: 'fan@example.com', email_verified: false }))).email, null);
  await assert.rejects(verify(await g.sign({ sub: '1' }, { aud: '999-other.apps.googleusercontent.com' })));
  await assert.rejects(verify(await g.sign({ sub: '1' }, { iss: 'https://evil.example' })));
  await assert.rejects(verify(await g.sign({ sub: '1' }, { exp: '-2m' })));
  await assert.rejects(verify(await g.sign({ name: 'no subject' })));
  const other = await fakeGoogle();
  await assert.rejects(verify(await other.sign({ sub: '1' })), 'signed by someone else');
});

async function makeApp(store: AccountStore, o: { invite?: string; google?: GoogleVerifier | null; adminToken?: string } = {}) {
  const keys = await generateTicketKeys();
  const app = Fastify({ trustProxy: true });
  const accounts = await registerAccountRoutes(app, store, {
    issueTicket: createTicketIssuer(keys.privateJwk), inviteCode: o.invite,
    googleClientId: o.google === null ? undefined : CLIENT_ID,
    verifyGoogle: o.google ?? undefined, adminToken: o.adminToken,
  });
  await registerContentRoutes(app, fileContentStore(join(tmp(), 'content.json')), { isAdmin: accounts.isAdmin });
  await app.ready();
  return { app, verifyTicket: createTicketVerifier(keys.publicJwks) };
}
const post = (app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: { ...PAGE, ...headers } });

test('quick sign-up: invite gate, CSRF gate, session cookie, then /me and a member ticket', async () => {
  const store = fileAccountStore(join(tmp(), 'accounts.json'));
  const { app, verifyTicket } = await makeApp(store, { invite: 'HANG-1' });

  const me0 = (await app.inject('/v1/auth/me')).json();
  assert.deepEqual(me0, { account: null, google: CLIENT_ID, inviteRequired: true });

  const form = { username: 'Faker_Fan', password: 'mat-khau-dai', name: 'Fan Cứng' };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: form })).statusCode, 403, 'no X-T1-Request');
  assert.equal((await post(app, '/v1/auth/signup', form, { origin: 'https://evil.example' })).statusCode, 403, 'foreign origin');
  assert.equal((await post(app, '/v1/auth/signup', form)).json().code, 'invite_required');
  assert.equal((await post(app, '/v1/auth/signup', { ...form, invite: 'nope' })).json().code, 'invite_invalid');
  assert.equal((await post(app, '/v1/auth/signup', { ...form, password: 'short', invite: 'hang-1' })).statusCode, 400);

  const ok = await post(app, '/v1/auth/signup', { ...form, invite: 'hang-1' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual({ ...ok.json().account, id: '-' }, { id: '-', username: 'faker_fan', name: 'Fan Cứng', provider: 'password', role: 'player' });
  const setCookie = String(ok.headers['set-cookie']);
  assert.match(setCookie, /^tl_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const cookie = cookieOf(ok);
  assert.equal((await post(app, '/v1/auth/signup', { ...form, invite: 'hang-1' })).statusCode, 409, 'username taken');

  const me = (await app.inject({ url: '/v1/auth/me', headers: { cookie } })).json();
  assert.equal(me.account.username, 'faker_fan');
  assert.equal((await post(app, '/v1/auth/ticket', {})).statusCode, 401);
  const ticket = await post(app, '/v1/auth/ticket', {}, { cookie });
  const who = await verifyTicket(ticket.json().ticket);
  assert.deepEqual(who, { id: me.account.id, name: 'Fan Cứng', trust: 1 });

  // stored: only hashes, never the password or the raw session token
  const raw = readFileSync(join(dirs.at(-2)!, 'accounts.json'), 'utf8');
  assert.equal(raw.includes('mat-khau-dai'), false);
  assert.equal(raw.includes(cookie.split('=')[1]), false);
  assert.equal(statSync(join(dirs.at(-2)!, 'accounts.json')).mode & 0o777, 0o600);
  await app.close();
});

test('sign in, wrong password, logout, password change signs other sessions out; https gets Secure', async () => {
  const store = fileAccountStore(join(tmp(), 'accounts.json'));
  const { app } = await makeApp(store);
  await post(app, '/v1/auth/signup', { username: 'keria', password: 'nho-mat-khau' });
  const bad = await post(app, '/v1/auth/login', { username: 'keria', password: 'sai-mat-khau' });
  assert.equal(bad.statusCode, 401);
  const ghost = await post(app, '/v1/auth/login', { username: 'khong-co', password: 'sai-mat-khau' });
  assert.deepEqual(ghost.json(), bad.json(), 'unknown user and wrong password look the same');

  const a = cookieOf(await post(app, '/v1/auth/login', { username: ' KERIA ', password: 'nho-mat-khau' }));
  const secure = await post(app, '/v1/auth/login', { username: 'keria', password: 'nho-mat-khau' }, { 'x-forwarded-proto': 'https' });
  assert.match(String(secure.headers['set-cookie']), /; Secure$/);
  const b = cookieOf(secure);
  assert.ok(a && b && a !== b);

  assert.equal((await post(app, '/v1/auth/password', { current: 'sai', next: 'mat-khau-moi-1' }, { cookie: a })).statusCode, 401);
  assert.equal((await post(app, '/v1/auth/password', { current: 'nho-mat-khau', next: 'mat-khau-moi-1' }, { cookie: a })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie: b } })).json().account, null, 'other session revoked');
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie: a } })).json().account.username, 'keria');
  assert.equal((await post(app, '/v1/auth/login', { username: 'keria', password: 'nho-mat-khau' })).statusCode, 401);

  const out = await post(app, '/v1/auth/logout', {}, { cookie: a });
  assert.match(String(out.headers['set-cookie']), /^tl_session=; .*Max-Age=0/);
  assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie: a } })).json().account, null);
  await app.close();
});

test('Google: first sign-in needs the invite and creates the account; later ones reuse it', async () => {
  const store = fileAccountStore(join(tmp(), 'accounts.json'));
  const g = await fakeGoogle();
  const { app } = await makeApp(store, { invite: 'HANG-1', google: googleVerifier(CLIENT_ID, g.keys) });
  const credential = await g.sign({ sub: '777', name: 'Fan Google', email: 'g@example.com', email_verified: true });
  assert.equal((await post(app, '/v1/auth/google', { credential: 'x'.repeat(40) })).json().code, 'google_invalid');
  assert.equal((await post(app, '/v1/auth/google', { credential })).json().code, 'invite_required');
  const first = await post(app, '/v1/auth/google', { credential, invite: 'HANG-1' });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().created, true);
  assert.deepEqual({ ...first.json().account, id: '-' }, { id: '-', username: null, name: 'Fan Google', provider: 'google', role: 'player' });
  const again = await post(app, '/v1/auth/google', { credential });
  assert.equal(again.json().created, false);
  assert.equal(again.json().account.id, first.json().account.id);
  assert.equal((await store.list()).length, 1);
  // a Google account has no password to sign in with
  assert.equal((await post(app, '/v1/auth/password', { current: 'x', next: 'mat-khau-moi-1' }, { cookie: cookieOf(again) })).json().code, 'no_password');
  await app.close();

  const off = await makeApp(fileAccountStore(join(tmp(), 'accounts.json')), { google: null });
  assert.equal((await off.app.inject('/v1/auth/me')).json().google, null);
  assert.equal((await post(off.app, '/v1/auth/google', { credential })).json().code, 'google_off');
  await off.app.close();
});

test('admin: only an admin session (or the token) reaches /v1/admin; writes need the page header', async () => {
  const store = fileAccountStore(join(tmp(), 'accounts.json'));
  const { app } = await makeApp(store, { adminToken: 'y'.repeat(20) });
  const player = cookieOf(await post(app, '/v1/auth/signup', { username: 'player1', password: 'mat-khau-dai' }));
  const bossId = (await post(app, '/v1/auth/signup', { username: 'boss', password: 'mat-khau-dai' })).json().account.id;
  await store.update(bossId, { role: 'admin' });
  const boss = cookieOf(await post(app, '/v1/auth/login', { username: 'boss', password: 'mat-khau-dai' }));

  assert.equal((await app.inject('/v1/admin/accounts')).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/admin/accounts', headers: { cookie: player } })).statusCode, 401);
  const list = await app.inject({ url: '/v1/admin/accounts', headers: { cookie: boss } });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().accounts.map((a: { username: string }) => a.username).sort(), ['boss', 'player1']);
  assert.equal(list.body.includes('scrypt'), false, 'no password hashes leave the server');
  assert.equal((await app.inject({ url: '/v1/admin/accounts', headers: { authorization: `Bearer ${'y'.repeat(20)}` } })).statusCode, 200);

  assert.equal((await app.inject({ url: '/v1/admin/content', headers: { cookie: boss } })).statusCode, 200);
  const reset = { method: 'POST' as const, url: '/v1/admin/content/reset', payload: { section: 'quests' } };
  assert.equal((await app.inject({ ...reset, headers: { cookie: boss } })).statusCode, 403, 'cookie write without the page header');
  assert.equal((await app.inject({ ...reset, headers: { cookie: boss, ...PAGE } })).statusCode, 200);
  assert.equal((await app.inject({ ...reset, headers: { cookie: player, ...PAGE } })).statusCode, 401);
  await app.close();
});

test('file store: a second process (the admin script) writing the file is picked up', async () => {
  const path = join(tmp(), 'accounts.json');
  const api = fileAccountStore(path);
  const script = fileAccountStore(path);
  assert.equal(await api.findByUsername('admin'), null);
  await new Promise((r) => setTimeout(r, 15)); // distinct mtime
  const made = await script.create({ username: 'admin', name: 'admin', provider: 'password', role: 'admin', passwordHash: await hashPassword('mat-khau-dai'), googleSub: null, email: null });
  assert.equal((await api.findByUsername('admin'))?.id, made.id);
  await assert.rejects(script.create({ ...made, username: 'admin' }), AccountConflict);
});

test('Postgres store (PGlite): members, sessions, conflicts, expiry', async () => {
  const db = new PGlite();
  for (const f of ['001_initial.sql', '003_progression.sql', '006_accounts.sql']) await db.exec(await readFile(`db/${f}`, 'utf8'));
  let tail = Promise.resolve();
  const pool = {
    connect: async () => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>((r) => { release = r; });
      await prior;
      return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release } as unknown as PoolClient;
    },
  } as unknown as Pool;
  const store = new PgAccountStore(pool);
  const hash = await hashPassword('mat-khau-dai');
  const a = await store.create({ username: 'faker', name: 'Faker Fan', provider: 'password', role: 'player', passwordHash: hash, googleSub: null, email: null });
  const g = await store.create({ username: null, name: 'G', provider: 'google', role: 'player', passwordHash: null, googleSub: '42', email: 'g@example.com' });
  assert.equal((await store.findByUsername('faker'))?.id, a.id);
  assert.equal((await store.findByGoogle('42'))?.id, g.id);
  assert.equal((await store.findByGoogle('42'))?.provider, 'google');
  await assert.rejects(store.create({ ...a, username: 'faker' }), (e) => e instanceof AccountConflict && e.field === 'username');
  await assert.rejects(store.create({ ...g, googleSub: '42' }), (e) => e instanceof AccountConflict && e.field === 'google');

  const updated = await store.update(a.id, { role: 'admin', name: 'Quản trị', lastLoginAt: new Date().toISOString() });
  assert.equal(updated?.role, 'admin');
  assert.equal(updated?.name, 'Quản trị');
  assert.ok(updated?.lastLoginAt);

  const h1 = 'a'.repeat(64), h2 = 'b'.repeat(64), old = 'c'.repeat(64);
  await store.addSession(h1, a.id, new Date(Date.now() + 60_000));
  await store.addSession(h2, a.id, new Date(Date.now() + 60_000));
  await db.query(`INSERT INTO account_sessions(token_hash, account_id, created_at, expires_at) VALUES ($1, $2, now() - interval '2 days', now() - interval '1 day')`, [old, a.id]);
  assert.equal((await store.sessionAccount(h1))?.id, a.id);
  assert.equal(await store.sessionAccount(old), null, 'expired');
  await store.removeSessionsOf(a.id, h1);
  assert.equal(await store.sessionAccount(h2), null);
  assert.equal((await store.sessionAccount(h1))?.id, a.id);
  await store.removeSession(h1);
  assert.equal(await store.sessionAccount(h1), null);
  assert.equal((await store.list()).length, 2);
  await db.close();
});

test('admin script: creates the admin, writes the password only to a 0600 file, never to the terminal', async () => {
  const dir = tmp();
  const accountsFile = join(dir, 'accounts.json');
  const out = join(dir, 'admin-login');
  const run = promisify(execFile);
  const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', 'scripts/admin-account.ts', 'Admin', '--out', out], {
    env: { ...process.env, ACCOUNTS_FILE: accountsFile, DATABASE_URL: '' },
  });
  const saved = readFileSync(out, 'utf8');
  const password = /Mật khẩu: (\S+)/.exec(saved)?.[1] ?? '';
  assert.ok(password.length >= 20);
  assert.equal((stdout + stderr).includes(password), false, 'password never printed');
  assert.equal(statSync(out).mode & 0o777, 0o600);
  const admin = await fileAccountStore(accountsFile).findByUsername('admin');
  assert.equal(admin?.role, 'admin');
  assert.equal(await verifyPassword(password, admin!.passwordHash!), true);
});
