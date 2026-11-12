import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { emptyProgression } from '../packages/shared/src/progression.js';

async function client(fetcher: (url: string, options?: any) => Promise<any>) {
  const bundle = await build({ entryPoints: ['apps/web/src/stalls/client.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', define: { 'import.meta.env': JSON.stringify({ DEV: true }) } });
  let now = Date.parse('2026-11-10T23:59:00Z');
  class Clock extends Date { constructor(value?: any) { super(value === undefined ? now : value); } static now() { return now; } }
  const module = { exports: {} as any };
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, Date: Clock, URL, crypto: { randomUUID }, location: { origin: 'http://localhost:5173' }, fetch: fetcher });
  return { resident: module.exports.resident, advance: () => { now += 86400000; } };
}
const response = (value: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => value });

for (const staleFails of [false, true]) test(`live mutation survives delayed rollover GET ${staleFails ? 'failure' : 'success'}`, async () => {
  let gets = 0;
  let finishGet!: (value: any) => void;
  const delayed = new Promise<any>(resolve => { finishGet = resolve; });
  const state = emptyProgression(true);
  state.authenticated = true;
  state.daily.day = '2026-11-10';
  const updated = { ...state, currency: { ...state.currency, balance: 25 }, daily: { ...state.daily, day: '2026-11-11', claimed: true } };
  const { resident, advance } = await client((_url, options) => {
    if (options?.method === 'POST') return response({ claimed: true, state: updated });
    return ++gets === 1 ? response(state) : delayed;
  });
  await resident.load();
  advance();
  await resident.mutate('check-in');
  const pending = resident.load(true);
  finishGet(await response(state, staleFails ? 503 : 200));
  await pending;
  assert.equal(gets, 2);
  assert.equal(resident.get().mode, 'live');
  assert.equal(resident.get().state.currency.balance, 25);
  assert.equal(resident.get().state.daily.claimed, true);
  assert.equal(resident.get().state.daily.day, '2026-11-11');
});

test('preview preserves earnings over rollover, prevents double claims and limits quiz to three attempts', async () => {
  const { resident, advance } = await client(() => response(emptyProgression(false)));
  await resident.load();
  await resident.mutate('check-in');
  await resident.mutate('check-in');
  assert.equal(resident.get().state.currency.balance, 25);
  assert.equal(resident.get().state.experience.xp, 20);
  for (let n = 0; n < 3; n++) {
    await resident.mutate('quiz/start');
    const attempt = resident.get().state.quiz.activeAttempt;
    await resident.mutate('quiz/start');
    assert.equal(resident.get().state.quiz.attemptsUsed, n + 1);
    assert.equal(resident.get().state.quiz.activeAttempt.id, attempt.id);
    await resident.mutate('quiz/submit', { attemptId: attempt.id, answers: [0, 1, 2, 3, 0] });
  }
  await assert.rejects(() => resident.mutate('quiz/start'), /3/);
  const xp = resident.get().state.experience.xp;
  advance();
  await resident.load();
  assert.equal(resident.get().state.daily.claimed, false);
  assert.equal(resident.get().state.quiz.remaining, 3);
  assert.equal(resident.get().state.experience.xp, xp);
  assert.equal(resident.get().state.currency.balance, 25);
  await resident.mutate('check-in');
  await resident.mutate('purchase', { itemId: 'cave-ragged-shorts' });
  await resident.mutate('purchase', { itemId: 'cave-ragged-shorts' });
  assert.equal(resident.get().state.currency.balance, 25);
  await resident.mutate('equip', { itemId: 'cave-ragged-shorts' });
  assert.equal(resident.get().state.equippedItemId, 'cave-ragged-shorts');
});

test('preview expires active quiz at rollover without losing earned points', async () => {
  const { resident, advance } = await client(() => response(emptyProgression(false)));
  await resident.load();
  await resident.mutate('quiz/start');
  const id = resident.get().state.quiz.activeAttempt.id;
  advance();
  await assert.rejects(() => resident.mutate('quiz/submit', { attemptId: id, answers: [0, 0, 0, 0, 0] }), /hết hạn/);
  assert.equal(resident.get().state.quiz.activeAttempt, null);
  assert.equal(resident.get().state.quiz.remaining, 3);
});

test('live conflict reconciles authoritative state before reporting error', async () => {
  let gets = 0;
  const state = emptyProgression(true);
  state.authenticated = true;
  state.daily.day = '2026-11-10';
  state.quiz.activeAttempt = { id: randomUUID(), day: '2026-11-10', questions: [] };
  const { resident } = await client((_url, options) => {
    if (options?.method === 'POST') return response({ code: 'idempotency_conflict', error: 'Already submitted' }, 409);
    gets++;
    return response(gets === 1 ? state : { ...state, quiz: { ...state.quiz, activeAttempt: null } });
  });
  await resident.load();
  await assert.rejects(() => resident.mutate('quiz/submit', { attemptId: state.quiz.activeAttempt!.id, answers: [0, 0, 0, 0, 0] }), /Already submitted/);
  assert.equal(gets, 2);
  assert.equal(resident.get().state.quiz.activeAttempt, null);
});
