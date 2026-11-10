// Small reviewable baseline, not a complete Vietnamese moderation model.
const reserved = new Set([
  'admin', 'administrator', 'moderator', 'staff',
  'faker', 'oner', 'gumayusi', 'keria', 'doran',
]);
const accentWords = new Set(['địt', 'đụ', 'đéo']);
// "du" is also a real name and an ordinary Vietnamese syllable. Without the
// accent it is too ambiguous to block; explicit "đụ" is still checked above.
const plainWords = new Set(['dit', 'deo', 'dm', 'dmm', 'dcm', 'vcl', 'fuck', 'shit']);
const separatedWords = new Set(['dcm', 'dmm', 'vcl', 'fuck']);
const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a' };
const unaccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

export function normalize(text: string) {
  // Compatibility folding also handles full-width Latin text. Keep Vietnamese
  // accents so harmless words such as "đủ", "dù", and "đeo" stay distinct.
  return text.normalize('NFKC').toLowerCase()
    .replace(/[\p{Cf}\u034f\ufe00-\ufe0f]/gu, '')
    .normalize('NFC')
    .replace(/(.)\1{2,}/gu, '$1$1');
}

export function moderate(raw: string, kind: 'name' | 'chat'): { ok: boolean; reason?: string } {
  const s = normalize(raw);
  const plain = unaccent(s);
  if (kind === 'name' && reserved.has(plain.replace(/[^a-z]/g, ''))) {
    return { ok: false, reason: 'Tên dành riêng' };
  }
  if (/(?:https?:|www\s*\.|discord\s*\.\s*gg|[a-z0-9-]+\s*(?:\.|\[dot\])\s*(?:com|net|org|vn|io|gg)\b)/iu.test(s)) {
    return { ok: false, reason: 'Không gửi đường dẫn trong chat' };
  }
  if (/(?:\+?\d[\s().-]*){9,}/u.test(s)) {
    return { ok: false, reason: 'Không gửi số điện thoại' };
  }
  const tokens = s.replace(/[013457@]/g, c => leet[c]).match(/[\p{L}\p{M}]+/gu) || [];
  // Check each token, not whether the entire sentence happens to have accents.
  // Do not remove accents from a word just to compare it with an ASCII denylist.
  if (tokens.some(t => accentWords.has(t) || (t === unaccent(t) && plainWords.has(t)))) {
    return { ok: false, reason: 'Nội dung không phù hợp' };
  }
  // Join only short adjacent ASCII fragments, up to the longest denylisted
  // word (four letters). This also covers partial splitting such as fu.ck,
  // without stripping Vietnamese accents or compacting an entire sentence.
  for (let i = 0; i < tokens.length; i++) {
    let letters = '';
    for (let j = i; j < Math.min(tokens.length, i + 4) && /^[a-z]{1,4}$/.test(tokens[j]); j++) {
      letters += tokens[j];
      if (letters.length > 4) break;
      if (separatedWords.has(letters)) return { ok: false, reason: 'Nội dung không phù hợp' };
    }
  }
  return { ok: true };
}
