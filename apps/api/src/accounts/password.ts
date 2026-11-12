/**
 * Mật khẩu: scrypt (node:crypto) với muối ngẫu nhiên 16 byte. Chuỗi lưu tự mang tham số
 * ("scrypt$N$r$p$salt$hash", base64url) nên đổi độ mạnh sau này không làm hỏng mật khẩu cũ.
 * So sánh theo thời gian hằng. Không bao giờ ghi log mật khẩu hay chuỗi băm.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;

function scrypt(password: string, salt: Buffer, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...opts, maxmem: 256 * opts.N * opts.r };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Sai định dạng hoặc tham số lạ thì trả false (không ném lỗi ra request). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every(Number.isInteger) || n < 1024 || n > 1 << 20 || (n & (n - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const want = Buffer.from(parts[5], 'base64url');
  if (want.length !== KEY_LEN || salt.length < 8) return false;
  const got = await scrypt(password, salt, { N: n, r, p });
  return timingSafeEqual(got, want);
}

/**
 * Băm giả để đăng nhập bằng tên không tồn tại vẫn tốn đúng một lần scrypt: thời gian phản hồi
 * không lộ tên đăng nhập nào có thật.
 */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(12).toString('base64url'));
  await verifyPassword(password, await dummy);
  return false;
}
