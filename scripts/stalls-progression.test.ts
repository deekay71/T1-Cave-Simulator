import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import Fastify from 'fastify';
import { dailyReward, experienceState, RANKS, QuizSubmitRequest } from '../packages/shared/src/progression.js';
import { T1_QUESTION_BANK, type GradedQuestion } from '../apps/api/src/progression/questions.js';
import { ProgressionStore } from '../apps/api/src/progression/store.js';
import { registerProgressionRoutes } from '../apps/api/src/progression/routes.js';
import { hashSessionToken, progressionConfig } from '../apps/api/src/progression/security.js';

let db: PGlite, pool: Pool, store: ProgressionStore;
before(async () => {
  db = new PGlite();
  for (const migration of ['001_initial', '003_progression', '004_cave_stalls'])
    await db.exec(await readFile(`db/${migration}.sql`, 'utf8'));
  let tail = Promise.resolve();
  pool = { connect: async () => {
    const prior = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    return { query: (sql: string, params?: unknown[]) => db.query(sql, params), release } as unknown as PoolClient;
  } } as unknown as Pool;
  store = new ProgressionStore(pool);
});
after(async () => { await db?.close(); });
async function guest(total = 0, balance = 0) {
  const id = randomUUID();
  await db.query('INSERT INTO accounts(id, display_name) VALUES ($1, $2)', [id, 'Synthetic fan']);
  await db.query('INSERT INTO profiles(account_id) VALUES ($1)', [id]);
  await db.query('INSERT INTO progression_wallets(account_id,total_checkins,balance) VALUES ($1,$2,$3)', [id,total,balance]);
  return id;
}
async function correctAnswers(attemptId: string) {
  const { rows } = await db.query<{ questions: GradedQuestion[] }>('SELECT questions FROM progression_quiz_attempts WHERE id = $1', [attemptId]);
  return rows[0].questions.map(question => question.answer);
}

test('five exact ranks and attendance milestones are stable', () => {
  assert.deepEqual(RANKS.map(rank => rank.title), ['Tê con mới nhú','Tê Thở','Tê Nạng','Tê Lăn','Tê Liệt']);
  for (const rank of RANKS) assert.equal(experienceState(rank.minXp).rank.title, rank.title);
  assert.equal(experienceState(1499).rank.level, 4);
  assert.equal(experienceState(1500).nextRank, null);
  assert.deepEqual(Array.from({length:21}, (_, i) => dailyReward(i + 1)), [...Array(15).fill(25), 0, 0, 25, 0, 0, 25]);
  assert.ok(T1_QUESTION_BANK.length >= 30);
  assert.equal(new Set(T1_QUESTION_BANK.map(q => q.id)).size, T1_QUESTION_BANK.length);
});

test('unrewarded attendance is recorded once and counts toward next milestone', async () => {
  for (const [prior, reward] of [[14,25],[15,0],[16,0],[17,25],[20,25]]) {
    const id = await guest(prior);
    const result = await store.checkIn(id);
    assert.equal(result.claimed,true); assert.equal(result.reward,reward);
    assert.equal(result.xpEarned, reward ? 20 : 0);
    assert.equal(result.state.daily.totalCheckins,prior + 1);
    assert.ok(result.state.daily.nextRewardCheckin > prior + 1);
    const replay = await store.checkIn(id);
    assert.equal(replay.claimed,false); assert.equal(replay.xpEarned,0);
    assert.equal(replay.state.daily.totalCheckins,prior + 1);
    const {rows} = await db.query<{count:number}>('SELECT count(*)::int AS count FROM daily_checkins WHERE account_id=$1',[id]);
    assert.equal(rows[0].count,1);
  }
});

test('start consumes one slot, concurrent resume returns same five questions without keys', async () => {
  const id = await guest();
  const starts = await Promise.all(Array.from({length:8}, () => store.startQuiz(id)));
  assert.equal(new Set(starts.map(s => s.attempt.id)).size,1);
  assert.equal(starts[0].state.quiz.attemptsUsed,1);
  assert.equal(starts[0].attempt.questions.length,5);
  assert.equal(new Set(starts[0].attempt.questions.map(q => q.id)).size,5);
  for (const q of starts[0].attempt.questions) assert.deepEqual(Object.keys(q).sort(),['id','options','prompt']);
  assert.equal(JSON.stringify(starts).includes('"answer"'),false);
  assert.deepEqual((await store.read(id)).quiz.activeAttempt, starts[0].attempt);
});

test('server grades, concurrent retries award once, caps three starts, prevents cross-account access', async () => {
  const id = await guest(), other = await guest();
  for (let i=0;i<3;i++) {
    const {attempt} = await store.startQuiz(id);
    const answers = await correctAnswers(attempt.id);
    await assert.rejects(store.submitQuiz(other,attempt.id,answers), /Không tìm thấy/);
    const submitted = await Promise.all(Array.from({length:5}, () => store.submitQuiz(id,attempt.id,answers)));
    assert.equal(submitted.filter(s => !s.replayed).length,1);
    assert.equal(submitted[0].xpEarned,50); assert.equal(submitted[0].correct,5);
    assert.equal(submitted[0].state.experience.xp,50*(i+1));
    const changed = [...answers]; changed[0]=(changed[0]+1)%4;
    await assert.rejects(store.submitQuiz(id,attempt.id,changed),/câu trả lời khác/);
  }
  await assert.rejects(store.startQuiz(id),/hết 3 lượt/);
  assert.equal((await store.read(id)).quiz.remaining,0);
  assert.equal((await store.read(id)).experience.xp,150);
  const {rows} = await db.query<{count:number}>("SELECT count(*)::int AS count FROM reward_ledger WHERE account_id=$1 AND source_type='quiz'",[id]);
  assert.equal(rows[0].count,3);
});

test('wrong answers earn zero and UTC rollover expires old unfinished attempt but resets quota', async () => {
  const id=await guest(); const {attempt}=await store.startQuiz(id);
  const wrong=(await correctAnswers(attempt.id)).map(n=>(n+1)%4);
  assert.equal((await store.submitQuiz(id,attempt.id,wrong)).xpEarned,0);
  const old=(await store.startQuiz(id)).attempt;
  await db.query("UPDATE progression_quiz_attempts SET day=day-1 WHERE account_id=$1",[id]);
  await assert.rejects(store.submitQuiz(id,old.id,await correctAnswers(old.id)),/hết hạn/);
  const fresh=await store.startQuiz(id);
  assert.notEqual(fresh.attempt.id,old.id);
  assert.equal(fresh.state.quiz.attemptsUsed,1);
  assert.equal(fresh.state.experience.xp,0);
});

test('same fallback asset keeps exact style selection and ownership', async () => {
  const id=await guest(0,500);
  for (const itemId of ['cave-tshirt','cave-glasses','cave-keyboard']) {
    await assert.rejects(store.equip(id,itemId),/chưa sở hữu/);
    await store.purchase(id,itemId,randomUUID());
    const state=await store.equip(id,itemId);
    assert.equal(state.equippedItemId,itemId);
    assert.equal((await store.read(id)).equippedItemId,itemId);
    assert.equal(state.catalog.find(item=>item.id===itemId)?.styleKey,itemId);
  }
  assert.equal((await store.equip(id,null)).equippedItemId,null);
});

test('strict HTTP quiz schema, origin checks, no answer leak, gallery upload unavailable', async () => {
  const id=await guest();
  const token='Q'.repeat(43); // Public test fixture in an ephemeral database only.
  await db.query("INSERT INTO guest_sessions(token_hash,account_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 day')",[hashSessionToken(token),id]);
  const config=progressionConfig({PROGRESSION_ENABLED:'true',WEB_ORIGIN:'https://cave.example',NODE_ENV:'production'});
  const headers={origin:config.webOrigin,'x-t1-request':'1',cookie:`${config.cookieName}=${token}`};
  const app=Fastify(); await registerProgressionRoutes(app,pool,config);
  try {
    for (const payload of [{xp:100},{questions:[]},{accountId:id}])
      assert.equal((await app.inject({method:'POST',url:'/v1/progression/quiz/start',headers,payload})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/v1/progression/quiz/start',headers:{cookie:headers.cookie},payload:{}})).statusCode,403);
    const started=await app.inject({method:'POST',url:'/v1/progression/quiz/start',headers,payload:{}});
    assert.equal(started.statusCode,200); assert.equal(started.body.includes('"answer"'),false);
    const attemptId=started.json().attempt.id;
    for (const answers of [[],[0,1,2,3,4],[0,0,0,0,0,0],['0',0,0,0,0]])
      assert.equal(QuizSubmitRequest.safeParse({attemptId,answers}).success,false);
    assert.equal((await app.inject({method:'POST',url:'/v1/progression/quiz/submit',headers,payload:{attemptId,answers:[0,0,0,0,0],xp:999}})).statusCode,400);
    const gallery=await app.inject({url:'/v1/progression/gallery'});
    assert.equal(gallery.json().contribution.enabled,false);
    assert.equal((await app.inject({method:'POST',url:'/v1/progression/gallery',headers,payload:{}})).statusCode,404);
  } finally {await app.close();}
});


test('quiz failure rolls back submission and XP so retry remains possible', async () => {
  const id=await guest(); const {attempt}=await store.startQuiz(id);
  const answers=await correctAnswers(attempt.id);
  await db.exec(`ALTER TABLE reward_ledger ADD CONSTRAINT synthetic_quiz_failure CHECK (source_id <> '${attempt.id}')`);
  try {
    await assert.rejects(store.submitQuiz(id,attempt.id,answers));
    const state=await store.read(id);
    assert.equal(state.experience.xp,0);
    assert.equal(state.quiz.activeAttempt?.id,attempt.id);
  } finally {await db.exec('ALTER TABLE reward_ledger DROP CONSTRAINT synthetic_quiz_failure');}
  assert.equal((await store.submitQuiz(id,attempt.id,answers)).xpEarned,50);
});
