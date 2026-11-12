/**
 * Nơi lưu tài khoản và phiên đăng nhập.
 *
 * - Postgres (db/006_accounts.sql) khi API có DATABASE_URL.
 * - Không có DB (chơi thử trên máy cá nhân): một tệp JSON (ACCOUNTS_FILE, mặc định
 *   .data/accounts.json, quyền 0600). Ghi qua tệp tạm rồi đổi tên; đọc lại khi tệp đổi (mtime), nên
 *   script tạo tài khoản quản trị (scripts/admin-account.ts) ghi vào lúc API đang chạy vẫn có hiệu lực.
 *
 * Phiên chỉ lưu SHA-256 của token (token nằm trong cookie HttpOnly của trình duyệt). Mật khẩu chỉ
 * lưu chuỗi băm scrypt (password.ts).
 */
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { AccountProvider, AccountRole, AccountSummary, AccountView } from '@te-liet/shared';

export interface AccountRecord {
  id: string;
  username: string | null;
  name: string;
  provider: AccountProvider;
  role: AccountRole;
  passwordHash: string | null;
  googleSub: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}
export type NewAccount = Pick<AccountRecord, 'username' | 'name' | 'provider' | 'role' | 'passwordHash' | 'googleSub' | 'email'>;
export type AccountPatch = Partial<Pick<AccountRecord, 'name' | 'role' | 'passwordHash' | 'email' | 'lastLoginAt'>>;

/** Tên đăng nhập hoặc tài khoản Google đã có. */
export class AccountConflict extends Error {
  constructor(readonly field: 'username' | 'google') { super(`${field} taken`); }
}

export interface AccountStore {
  readonly kind: 'postgres' | 'file';
  findByUsername(username: string): Promise<AccountRecord | null>;
  findByGoogle(sub: string): Promise<AccountRecord | null>;
  create(account: NewAccount): Promise<AccountRecord>;
  update(id: string, patch: AccountPatch): Promise<AccountRecord | null>;
  list(): Promise<AccountRecord[]>;
  addSession(tokenHash: string, accountId: string, expiresAt: Date): Promise<void>;
  /** Tài khoản của phiên còn hạn, không thì null. */
  sessionAccount(tokenHash: string): Promise<AccountRecord | null>;
  removeSession(tokenHash: string): Promise<void>;
  /** Đăng xuất mọi phiên của một tài khoản (trừ `keep`), vd. sau khi đổi mật khẩu. */
  removeSessionsOf(accountId: string, keep?: string): Promise<void>;
}

export const accountView = (a: AccountRecord): AccountView => ({ id: a.id, username: a.username, name: a.name, provider: a.provider, role: a.role });
export const accountSummary = (a: AccountRecord): AccountSummary => ({ ...accountView(a), email: a.email, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt });

/* ------------------------------------------------------------------ JSON file */

interface FileSession { hash: string; accountId: string; expiresAt: string }
interface FileData { version: 1; accounts: AccountRecord[]; sessions: FileSession[] }
const emptyData = (): FileData => ({ version: 1, accounts: [], sessions: [] });

export function fileAccountStore(path = process.env.ACCOUNTS_FILE || '.data/accounts.json'): AccountStore {
  const file = resolve(path);
  let cache: { mtimeMs: number; data: FileData } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  /** Đọc tệp khi nó đổi. Tệp hỏng thì báo lỗi (không bao giờ ghi đè danh sách tài khoản bằng rỗng). */
  const load = async (): Promise<FileData> => {
    let mtimeMs: number;
    try { mtimeMs = (await stat(file)).mtimeMs; } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return (cache = { mtimeMs: -1, data: emptyData() }).data;
      throw e;
    }
    if (cache && cache.mtimeMs === mtimeMs) return cache.data;
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<FileData>;
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.sessions)) throw new Error(`${file}: not an accounts file`);
    const data: FileData = { version: 1, accounts: parsed.accounts, sessions: parsed.sessions };
    cache = { mtimeMs, data };
    return data;
  };
  const mutate = <T>(change: (data: FileData) => T): Promise<T> => {
    const run = queue.then(async () => {
      const data = structuredClone(await load());
      const result = change(data);
      const now = Date.now();
      data.sessions = data.sessions.filter((s) => Date.parse(s.expiresAt) > now);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, file);
      cache = { mtimeMs: (await stat(file)).mtimeMs, data };
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  };
  const copy = (a: AccountRecord | undefined) => (a ? { ...a } : null);

  return {
    kind: 'file',
    async findByUsername(username) { return copy((await load()).accounts.find((a) => a.username === username)); },
    async findByGoogle(sub) { return copy((await load()).accounts.find((a) => a.googleSub === sub)); },
    create: (account) => mutate((data) => {
      if (account.username && data.accounts.some((a) => a.username === account.username)) throw new AccountConflict('username');
      if (account.googleSub && data.accounts.some((a) => a.googleSub === account.googleSub)) throw new AccountConflict('google');
      const record: AccountRecord = { ...account, id: randomUUID(), createdAt: new Date().toISOString(), lastLoginAt: null };
      data.accounts.push(record);
      return { ...record };
    }),
    update: (id, patch) => mutate((data) => {
      const a = data.accounts.find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, patch);
      return { ...a };
    }),
    async list() { return (await load()).accounts.map((a) => ({ ...a })); },
    addSession: (tokenHash, accountId, expiresAt) => mutate((data) => {
      data.sessions.push({ hash: tokenHash, accountId, expiresAt: expiresAt.toISOString() });
    }),
    async sessionAccount(tokenHash) {
      const data = await load();
      const s = data.sessions.find((x) => x.hash === tokenHash);
      if (!s || Date.parse(s.expiresAt) <= Date.now()) return null;
      return copy(data.accounts.find((a) => a.id === s.accountId));
    },
    removeSession: (tokenHash) => mutate((data) => { data.sessions = data.sessions.filter((s) => s.hash !== tokenHash); }),
    removeSessionsOf: (accountId, keep) => mutate((data) => {
      data.sessions = data.sessions.filter((s) => s.accountId !== accountId || s.hash === keep);
    }),
  };
}

/* ------------------------------------------------------------------ Postgres */

interface Row {
  id: string; username: string | null; name: string; role: AccountRole; password_hash: string | null;
  auth_subject: string | null; email: string | null; created_at: Date | string; last_login_at: Date | string | null;
}
const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
const GOOGLE = 'google:';
function fromRow(r: Row): AccountRecord {
  const google = r.auth_subject?.startsWith(GOOGLE) ? r.auth_subject.slice(GOOGLE.length) : null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role, passwordHash: r.password_hash,
    provider: google ? 'google' : 'password', googleSub: google, email: r.email,
    createdAt: iso(r.created_at)!, lastLoginAt: iso(r.last_login_at),
  };
}
const SELECT = `SELECT a.id, p.username, a.display_name AS name, a.role, p.password_hash, a.auth_subject, a.email, a.created_at, a.last_login_at
  FROM accounts a LEFT JOIN account_passwords p ON p.account_id = a.id
  WHERE a.kind = 'member' AND a.deleted_at IS NULL`;

export class PgAccountStore implements AccountStore {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: Pick<Pool, 'connect'>) {}

  private async run<T>(fn: (db: Pick<PoolClient, 'query'>) => Promise<T>, transaction = false): Promise<T> {
    const db = await this.pool.connect();
    try {
      if (!transaction) return await fn(db);
      await db.query('BEGIN');
      try {
        const result = await fn(db);
        await db.query('COMMIT');
        return result;
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
      }
    } finally { db.release(); }
  }
  private async one(where: string, value: unknown): Promise<AccountRecord | null> {
    return this.run(async (db) => {
      const { rows } = await db.query<Row>(`${SELECT} AND ${where} LIMIT 1`, [value]);
      return rows[0] ? fromRow(rows[0]) : null;
    });
  }

  findByUsername(username: string) { return this.one('p.username = $1', username); }
  findByGoogle(sub: string) { return this.one('a.auth_subject = $1', GOOGLE + sub); }

  async create(account: NewAccount): Promise<AccountRecord> {
    const id = randomUUID();
    try {
      await this.run(async (db) => {
        await db.query(
          `INSERT INTO accounts(id, display_name, kind, auth_subject, role, email) VALUES ($1, $2, 'member', $3, $4, $5)`,
          [id, account.name, account.googleSub ? GOOGLE + account.googleSub : null, account.role, account.email],
        );
        await db.query('INSERT INTO profiles(account_id) VALUES ($1)', [id]);
        if (account.username) {
          await db.query('INSERT INTO account_passwords(account_id, username, password_hash) VALUES ($1, $2, $3)',
            [id, account.username, account.passwordHash]);
        }
      }, true);
    } catch (error) {
      const e = error as { code?: string; constraint?: string; message?: string };
      if (e.code === '23505') throw new AccountConflict(/auth_subject/.test(`${e.constraint} ${e.message}`) ? 'google' : 'username');
      throw error;
    }
    const created = await this.one('a.id = $1', id);
    if (!created) throw new Error('account vanished');
    return created;
  }

  async update(id: string, patch: AccountPatch): Promise<AccountRecord | null> {
    await this.run(async (db) => {
      const sets: string[] = [];
      const values: unknown[] = [id];
      const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
      if (patch.name !== undefined) set('display_name', patch.name);
      if (patch.role !== undefined) set('role', patch.role);
      if (patch.email !== undefined) set('email', patch.email);
      if (patch.lastLoginAt !== undefined) set('last_login_at', patch.lastLoginAt);
      if (sets.length) await db.query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $1 AND kind = 'member'`, values);
      if (patch.passwordHash !== undefined) await db.query('UPDATE account_passwords SET password_hash = $2 WHERE account_id = $1', [id, patch.passwordHash]);
    }, true);
    return this.one('a.id = $1', id);
  }

  list(): Promise<AccountRecord[]> {
    return this.run(async (db) => (await db.query<Row>(`${SELECT} ORDER BY a.created_at`)).rows.map(fromRow));
  }
  async addSession(tokenHash: string, accountId: string, expiresAt: Date) {
    await this.run((db) => db.query('INSERT INTO account_sessions(token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, accountId, expiresAt]));
  }
  async sessionAccount(tokenHash: string) {
    return this.run(async (db) => {
      const { rows } = await db.query<Row>(
        `${SELECT} AND a.id = (SELECT account_id FROM account_sessions WHERE token_hash = $1 AND expires_at > clock_timestamp())`, [tokenHash]);
      return rows[0] ? fromRow(rows[0]) : null;
    });
  }
  async removeSession(tokenHash: string) {
    await this.run((db) => db.query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]));
  }
  async removeSessionsOf(accountId: string, keep?: string) {
    await this.run((db) => db.query('DELETE FROM account_sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, keep ?? '']));
  }
}
