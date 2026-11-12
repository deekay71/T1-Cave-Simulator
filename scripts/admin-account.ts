/**
 * Tạo (hoặc cấp lại mật khẩu cho) một tài khoản QUẢN TRỊ. Web không có cách nào tự nâng quyền.
 *
 *   npm run admin:account -- admin                        # mật khẩu ngẫu nhiên, ghi vào tệp
 *   npm run admin:account -- admin --out .local-host/admin-login
 *   printf '%s' 'mat-khau-cua-anh' | npm run admin:account -- admin --password-stdin
 *
 * - Có DATABASE_URL: ghi vào Postgres (cần db/006_accounts.sql). Không có: tệp ACCOUNTS_FILE
 *   (mặc định .data/accounts.json), API đang chạy tự đọc lại.
 * - Mật khẩu ngẫu nhiên KHÔNG in ra màn hình: chỉ ghi vào tệp --out (mặc định .data/admin-login.txt,
 *   quyền 0600). Đăng nhập xong nên đổi mật khẩu ở tab Tài khoản của /admin.html rồi xóa tệp.
 * - Tên đã có: thành quản trị, đặt mật khẩu mới và đăng xuất mọi phiên cũ của tài khoản đó.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import pg from 'pg';
import { Password, Username } from '../packages/shared/src/accounts.js';
import { hashPassword } from '../apps/api/src/accounts/password.js';
import { fileAccountStore, PgAccountStore, type AccountStore } from '../apps/api/src/accounts/store.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const fromStdin = args.includes('--password-stdin');
if (fromStdin) args.splice(args.indexOf('--password-stdin'), 1);
const out = resolve(flag('--out') ?? '.data/admin-login.txt');
const displayName = flag('--name');
const username = Username.safeParse(args[0] ?? '');
if (!username.success) {
  console.error('Cách dùng: npm run admin:account -- <tên-đăng-nhập> [--name "Tên trong hang"] [--out tệp] [--password-stdin]');
  console.error(username.error.issues[0]?.message ?? 'Thiếu tên đăng nhập');
  process.exit(2);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}
const password = fromStdin ? await readStdin() : randomBytes(18).toString('base64url');
const valid = Password.safeParse(password);
if (!valid.success) {
  console.error(valid.error.issues[0]?.message);
  process.exit(2);
}

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;
const store: AccountStore = pool ? new PgAccountStore(pool) : fileAccountStore();
try {
  const passwordHash = await hashPassword(password);
  const existing = await store.findByUsername(username.data);
  let id: string;
  if (existing) {
    await store.update(existing.id, { role: 'admin', passwordHash, ...(displayName ? { name: displayName.slice(0, 24) } : {}) });
    await store.removeSessionsOf(existing.id);
    id = existing.id;
  } else {
    id = (await store.create({
      username: username.data, name: (displayName ?? username.data).slice(0, 24), provider: 'password', role: 'admin',
      passwordHash, googleSub: null, email: null,
    })).id;
  }
  const where = store.kind === 'postgres' ? 'Postgres' : relative(process.cwd(), resolve(process.env.ACCOUNTS_FILE || '.data/accounts.json'));
  if (!fromStdin) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, [
      'Tài khoản quản trị Tê Liệt',
      `Tên đăng nhập: ${username.data}`,
      `Mật khẩu: ${password}`,
      '',
      'Đăng nhập ở /admin.html, đổi mật khẩu ở tab "Tài khoản", rồi xóa tệp này.',
      '',
    ].join('\n'), { mode: 0o600 });
    await chmod(out, 0o600);
  }
  console.log(`${existing ? 'Đã cấp lại mật khẩu và quyền quản trị cho' : 'Đã tạo tài khoản quản trị'} "${username.data}" (${id.slice(0, 8)}…) trong ${where}.`);
  console.log(fromStdin ? 'Mật khẩu là mật khẩu vừa nhập.' : `Mật khẩu ghi ở ${relative(process.cwd(), out)} (chỉ chủ máy đọc được), không in ra đây.`);
} finally {
  await pool?.end();
}
