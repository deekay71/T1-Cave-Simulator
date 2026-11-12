/**
 * Nơi lưu nội dung admin: Postgres (bảng content_docs, db/005_content.sql) khi có DATABASE_URL,
 * không thì một tệp JSON (CONTENT_FILE, mặc định .data/content.json; ghi tạm rồi đổi tên để không
 * bao giờ để lại tệp dở). Phần nào chưa từng lưu thì trả mặc định của packages/shared.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import { DEFAULT_CONTENT, QuestList, VideoList, type ContentDoc, type QuestDef, type ScreenVideo } from '@te-liet/shared';

export type ContentSection = 'videos' | 'quests';
export interface ContentStore {
  readonly kind: 'postgres' | 'file';
  get(): Promise<ContentDoc>;
  put(section: 'videos', value: ScreenVideo[]): Promise<ContentDoc>;
  put(section: 'quests', value: QuestDef[]): Promise<ContentDoc>;
  /** Bỏ bản đã lưu của một phần: quay về mặc định. */
  reset(section: ContentSection): Promise<ContentDoc>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
interface Saved { videos?: unknown; quests?: unknown; updatedAt?: string }
/** Dữ liệu đã lưu hỏng (sửa tay, khác phiên bản) thì bỏ qua phần đó và dùng mặc định. */
function merge(saved: Saved): ContentDoc {
  const videos = VideoList.safeParse(saved.videos);
  const quests = QuestList.safeParse(saved.quests);
  return {
    videos: videos.success ? videos.data : clone(DEFAULT_CONTENT.videos),
    quests: quests.success ? quests.data : clone(DEFAULT_CONTENT.quests),
    updatedAt: saved.updatedAt ?? null,
  };
}

export function fileContentStore(path = process.env.CONTENT_FILE || '.data/content.json'): ContentStore {
  const file = resolve(path);
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Saved> => {
    try { return JSON.parse(await readFile(file, 'utf8')) as Saved; } catch { return {}; }
  };
  const write = (change: (s: Saved) => void): Promise<ContentDoc> => {
    const run = queue.then(async () => {
      const saved = await read();
      change(saved);
      saved.updatedAt = new Date().toISOString();
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(saved, null, 2));
      await rename(tmp, file);
      return merge(saved);
    });
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    kind: 'file',
    get: async () => merge(await read()),
    put: (section: ContentSection, value: unknown) => write((s) => { s[section] = value; }),
    reset: (section) => write((s) => { delete s[section]; }),
  } as ContentStore;
}

export function pgContentStore(db: pg.Pool): ContentStore {
  const get = async (): Promise<ContentDoc> => {
    const { rows } = await db.query<{ key: ContentSection; doc: unknown; updated_at: Date }>('SELECT key, doc, updated_at FROM content_docs');
    const saved: Saved = {};
    let latest = 0;
    for (const r of rows) {
      saved[r.key] = r.doc;
      latest = Math.max(latest, r.updated_at.getTime());
    }
    if (latest) saved.updatedAt = new Date(latest).toISOString();
    return merge(saved);
  };
  return {
    kind: 'postgres',
    get,
    put: (async (section: ContentSection, value: unknown) => {
      await db.query(
        `INSERT INTO content_docs (key, doc, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
        [section, JSON.stringify(value)],
      );
      return get();
    }) as ContentStore['put'],
    reset: async (section) => {
      await db.query('DELETE FROM content_docs WHERE key = $1', [section]);
      return get();
    },
  };
}
