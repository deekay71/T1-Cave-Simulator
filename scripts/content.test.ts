import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { DEFAULT_CONTENT, DEFAULT_QUESTS, DEFAULT_VIDEOS, QuestList, VideoList, VideoUrl, publicContent } from '../packages/shared/src/index.js';
import { SHRINE_GESTURE_MS, shrineLoopAt } from '../packages/shared/src/shrine.js';
import { registerContentRoutes } from '../apps/api/src/content/routes.js';
import { fileContentStore } from '../apps/api/src/content/store.js';
import { playlistAt } from '../apps/web/src/world/playlist.js';

const TOKEN = 'x'.repeat(24);
const auth = { authorization: `Bearer ${TOKEN}` };

test('defaults validate; the suggested clips have no file yet so nothing plays', () => {
  assert.equal(VideoList.safeParse(DEFAULT_VIDEOS).success, true);
  assert.equal(QuestList.safeParse(DEFAULT_QUESTS).success, true);
  assert.ok(DEFAULT_VIDEOS.length >= 8 && DEFAULT_VIDEOS.every((v) => v.url === ''));
  const pub = publicContent(DEFAULT_CONTENT);
  assert.equal(pub.videos.length, 0);
  assert.equal(pub.quests.length, DEFAULT_QUESTS.length);
});

test('video URLs: a site path or https to a file; never a YouTube/Twitch page or javascript:', () => {
  for (const ok of ['', '/videos/a.mp4', 'https://cdn.example/clip.webm']) assert.equal(VideoUrl.safeParse(ok).success, true, ok);
  for (const bad of ['//evil.example/a.mp4', 'http://a.example/a.mp4', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://www.twitch.tv/x', 'videos/a.mp4'])
    assert.equal(VideoUrl.safeParse(bad).success, false, bad);
});

test('quest lists reject duplicate ids, duplicate options and bad answers', () => {
  const q = structuredClone(DEFAULT_QUESTS[0]);
  assert.equal(QuestList.safeParse([q, q]).success, false);
  assert.equal(QuestList.safeParse([{ ...q, questions: [{ ...q.questions[0], options: ['a', 'a', 'b', 'c'] }] }]).success, false);
  assert.equal(QuestList.safeParse([{ ...q, questions: [{ ...q.questions[0], answer: 4 }] }]).success, false);
  assert.equal(QuestList.safeParse([{ ...q, questions: [] }]).success, false);
});

test('the playlist clock: same clip and offset for everyone, looping; no clock without every duration', () => {
  const clips = [{ durationSec: 10 }, { durationSec: 20 }, { durationSec: 5 }];
  assert.deepEqual(playlistAt(clips, 0), { index: 0, offset: 0 });
  assert.deepEqual(playlistAt(clips, 12_000), { index: 1, offset: 2 });
  assert.deepEqual(playlistAt(clips, 33_000), { index: 2, offset: 3 });
  assert.deepEqual(playlistAt(clips, 35_000 + 4_000), { index: 0, offset: 4 });
  assert.equal(playlistAt([{ durationSec: 10 }, { durationSec: null }], 1000), null);
  assert.equal(playlistAt([], 1000), null);
});

test('shrine worship loop: bow then pray, each SHRINE_GESTURE_MS, on the shared clock', () => {
  assert.deepEqual(shrineLoopAt(0), { gesture: 'bow', elapsed: 0 });
  assert.deepEqual(shrineLoopAt(SHRINE_GESTURE_MS + 500), { gesture: 'pray', elapsed: 0.5 });
  assert.deepEqual(shrineLoopAt(2 * SHRINE_GESTURE_MS + 250), { gesture: 'bow', elapsed: 0.25 });
  assert.equal(shrineLoopAt(Number.NaN).gesture, 'bow');
});

test('content API: public view, admin token, validation, save, reset, file store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-content-'));
  const file = join(dir, 'content.json');
  const app = Fastify();
  try {
    await registerContentRoutes(app, fileContentStore(file), { adminToken: TOKEN });
    const pub = await app.inject('/v1/content');
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.json().videos.length, 0);
    assert.equal((await app.inject('/v1/admin/content')).statusCode, 401);
    assert.equal((await app.inject({ url: '/v1/admin/content', headers: { authorization: 'Bearer wrong-token-wrong-token' } })).statusCode, 401);
    const all = await app.inject({ url: '/v1/admin/content', headers: auth });
    assert.equal(all.statusCode, 200);
    assert.equal(all.json().storage, 'file');
    assert.equal(all.json().videos.length, DEFAULT_VIDEOS.length);

    const videos = structuredClone(DEFAULT_VIDEOS);
    videos[0].url = '/videos/2013.mp4';
    videos[0].durationSec = 42;
    videos[1].url = 'https://www.youtube.com/watch?v=abc';
    const bad = await app.inject({ method: 'PUT', url: '/v1/admin/content/videos', headers: auth, payload: { videos } });
    assert.equal(bad.statusCode, 400);
    assert.match(bad.json().issues[0].message, /YouTube/);
    videos[1].url = '';
    const ok = await app.inject({ method: 'PUT', url: '/v1/admin/content/videos', headers: auth, payload: { videos } });
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.json().updatedAt);
    const after = (await app.inject('/v1/content')).json();
    assert.deepEqual(after.videos.map((v: { id: string }) => v.id), ['worlds-2013']);
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).videos);

    const quests = structuredClone(DEFAULT_QUESTS).slice(0, 2);
    quests[1].enabled = false;
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/admin/content/quests', headers: auth, payload: { quests } })).statusCode, 200);
    assert.equal((await app.inject('/v1/content')).json().quests.length, 1);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/content/reset', headers: auth, payload: { section: 'quests' } })).statusCode, 200);
    assert.equal((await app.inject('/v1/content')).json().quests.length, DEFAULT_QUESTS.length);
    // the saved videos survive a quest reset
    assert.equal((await app.inject('/v1/content')).json().videos.length, 1);

    // a hand-broken file falls back to defaults instead of failing
    writeFileSync(file, '{"videos": [{"id": 1}], "quests": "nope"}');
    assert.equal((await app.inject('/v1/content')).json().quests.length, DEFAULT_QUESTS.length);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('admin is off without a long enough ADMIN_TOKEN, and /live relays the game admin port', async () => {
  const off = Fastify();
  await registerContentRoutes(off, fileContentStore(join(tmpdir(), 'tl-none.json')), { adminToken: 'short' });
  assert.equal((await off.inject({ url: '/v1/admin/content', headers: { authorization: 'Bearer short' } })).statusCode, 503);
  await off.close();

  const game = createServer((req, res) => {
    if (req.url === '/live') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ online: 2, rooms: [] }));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => game.listen(0, '127.0.0.1', r));
  const port = (game.address() as { port: number }).port;
  const app = Fastify();
  try {
    await registerContentRoutes(app, fileContentStore(join(tmpdir(), 'tl-none.json')), { adminToken: TOKEN, gameAdminUrl: `http://127.0.0.1:${port}` });
    assert.equal((await app.inject('/v1/admin/live')).statusCode, 401);
    const live = await app.inject({ url: '/v1/admin/live', headers: auth });
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().online, 2);
  } finally {
    await app.close();
    game.close();
  }
});
