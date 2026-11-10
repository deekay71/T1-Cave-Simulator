import test from 'node:test';
import assert from 'node:assert/strict';
import { moderate, normalize } from '../packages/security/src/moderation.js';

function rejects(text: string, kind: 'name' | 'chat' = 'chat') {
  assert.equal(moderate(text, kind).ok, false, `${kind}: ${JSON.stringify(text)}`);
}
function accepts(text: string, kind: 'name' | 'chat' = 'chat') {
  assert.equal(moderate(text, kind).ok, true, `${kind}: ${JSON.stringify(text)}`);
}

test('moderation rejects plain profanity inside accented Vietnamese sentences', () => {
  for (const word of ['dit', 'deo', 'dm', 'dmm', 'dcm', 'vcl', 'fuck', 'shit']) {
    rejects(`Bạn nói ${word} à?`);
    rejects(`${word} nhé`);
    rejects(word.toUpperCase());
  }
});

test('moderation preserves Vietnamese syllables and real names', () => {
  for (const name of ['Du', 'Nguyễn Du', 'Dũng', 'Đức', 'Đỗ', 'Deon', 'Shitake', 'Admiral']) {
    accepts(name, 'name');
  }
  for (const message of ['Du ơi, đi du lịch nhé', 'Minh Du', 'đủ rồi, dù sao vẫn vui', 'Mình đeo kính', 'Đi thôi bạn ơi', 'Mình thích nhạc và chơi game']) {
    accepts(message);
    accepts(message.normalize('NFD'));
  }
});

test('moderation checks accented profanity in NFC and NFD', () => {
  for (const word of ['địt', 'đụ', 'đéo']) {
    rejects(`Bạn nói ${word} à?`);
    rejects(word.normalize('NFD'));
    rejects(word, 'name');
  }
  assert.equal(normalize('ĐỦ'), normalize('ĐỦ'.normalize('NFD')));
});

test('moderation handles common invisible, compatibility, leet and separated bypasses', () => {
  for (const message of [
    'fu\u200bck nhé', 'fu\u2060ck nhé', 'fu\u00adck nhé', 'fu\u034fck nhé',
    'ｆｕｃｋ nhé', 'sh1t nhé', 'd1t', 'fu.ck', 'd.cm', 'f uck', 'fu.ck nhé', 'd.c.m nhé', 'bạn f u c k à', 'v-c-l nhé',
  ]) rejects(message);
  // A longer innocent word must not be treated as multiple single letters.
  accepts('Đó là cách mình chơi');
});

test('moderation retains reserved-name, link and phone checks', () => {
  for (const name of ['Admin', 'a.d.m.i.n', 'ＡＤＭＩＮ', 'Faker']) rejects(name, 'name');
  accepts('Faker thi đấu hay');
  for (const message of ['https://example.com', 'discord.gg/team', 'example[dot]com', '090 123 4567']) rejects(message);
  accepts('Hẹn bạn lúc 19 giờ');
});
