import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { QUESTS, TITLES, gradeQuest, loadDone, saveDone } from '../apps/web/src/stalls/quests.js';

test('every T1 quest has three questions with four distinct options and a valid answer', () => {
  assert.ok(QUESTS.length >= 6);
  assert.equal(new Set(QUESTS.map(q => q.id)).size, QUESTS.length);
  for (const quest of QUESTS) {
    assert.equal(quest.questions.length, 3);
    for (const q of quest.questions) {
      assert.equal(new Set(q.options).size, 4, q.prompt);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.prompt);
      assert.ok(q.note.length > 0);
    }
    // the correct option does not always sit in the same place
    assert.ok(new Set(quest.questions.map(q => q.answer)).size > 1, quest.id);
  }
});

test('a quest is done only with all three right; progress survives storage and ignores junk', () => {
  const quest = QUESTS[0], right = quest.questions.map(q => q.answer);
  assert.equal(gradeQuest(quest, right), 3);
  assert.equal(gradeQuest(quest, [right[0], (right[1] + 1) % 4, right[2]]), 2);
  assert.equal(gradeQuest(quest, []), 0);
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(loadDone(storage), []);
  saveDone([quest.id, quest.id, 'not-a-quest'], storage);
  assert.deepEqual(loadDone(storage), [quest.id]);
  store.set('tl.quests.v1', '{broken');
  assert.deepEqual(loadDone(storage), []);
  assert.deepEqual(loadDone({ getItem: () => { throw new Error('blocked'); } }), []);
});

test('the memory cave lists the six world titles, each with a credited local photo', () => {
  assert.deepEqual(TITLES.map(t => t.year), [2013, 2015, 2016, 2023, 2024, 2025]);
  for (const t of TITLES) {
    assert.ok(/^(SK Telecom T1( K)?|T1) 3-[0-2] /.test(t.final), t.final);
    assert.ok(t.roster.includes('Faker'));
    assert.ok(existsSync(`apps/web/public${t.photo.src}`), t.photo.src);
    assert.ok(/^CC BY(-SA)? \d\.0$/.test(t.photo.license), t.photo.license);
    assert.ok(t.photo.licenseUrl.startsWith('https://creativecommons.org/licenses/by'));
    assert.ok(t.photo.source.startsWith('https://commons.wikimedia.org/wiki/File:'));
    assert.ok(t.photo.author.length > 0);
  }
});
