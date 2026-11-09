// Chạy lần lượt db/NNN_ten.sql, mỗi file một transaction, ghi version + checksum.
// File đã chạy mà bị sửa thì dừng: thay đổi schema phải là migration mới.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const LOCK_ID = 921771;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const dir = resolve(process.env.MIGRATIONS_DIR ?? 'db');
const files = (await readdir(dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
const versionOf = (file: string) => Number(file.slice(0, 3));
const duplicate = files.find((f, i) => i > 0 && versionOf(f) === versionOf(files[i - 1]));
if (duplicate) throw new Error(`Trùng số migration: ${duplicate}`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await client.query<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r]));
  const known = new Set(files.map(versionOf));
  for (const version of applied.keys()) {
    if (!known.has(version)) throw new Error(`DB đã chạy migration ${version} nhưng repo không còn file tương ứng`);
  }

  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const done = applied.get(versionOf(file));
    if (done) {
      if (done.checksum !== checksum) throw new Error(`${file} đã chạy nhưng nội dung bị sửa; hãy tạo migration mới`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [versionOf(file), file, checksum]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log(`schema up to date (${files.length} migration)`);
} finally {
  await client.end();
}
