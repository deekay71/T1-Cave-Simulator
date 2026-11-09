import { createHash, timingSafeEqual } from 'node:crypto';

/** Chuẩn hóa mã mời: bỏ khoảng trắng hai đầu, không phân biệt hoa thường. */
const normalize = (code: string) => code.trim().toUpperCase();

/**
 * Kiểm tra mã mời cho close test. `expected` rỗng nghĩa là không bật mã mời (ai cũng vào được).
 * So sánh băm SHA-256 bằng timingSafeEqual để thời gian không lộ độ dài hay tiền tố của mã.
 */
export function inviteMatches(expected: string | undefined, provided: unknown): boolean {
  const want = normalize(expected ?? '');
  if (!want) return true;
  if (typeof provided !== 'string') return false;
  const got = normalize(provided);
  if (!got) return false;
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}
