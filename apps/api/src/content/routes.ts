/**
 * Nội dung và trang quản trị.
 *
 * - GET  /v1/content                    công khai: video bật + có tệp, quest bật (client đọc lúc vào game).
 * - GET  /v1/admin/content              toàn bộ (kể cả mục tắt / chưa có tệp).
 * - PUT  /v1/admin/content/videos       { videos: ScreenVideo[] }   thay cả danh sách.
 * - PUT  /v1/admin/content/quests       { quests: QuestDef[] }
 * - POST /v1/admin/content/reset        { section: "videos" | "quests" }   về mặc định.
 * - GET  /v1/admin/live                 người chơi đang online, thống kê (hỏi cổng quản trị của game).
 *
 * /v1/admin/* cần header `Authorization: Bearer <ADMIN_TOKEN>`. Không đặt ADMIN_TOKEN (hoặc ngắn hơn
 * 16 ký tự) thì trang quản trị tắt hẳn (503). So sánh token theo thời gian hằng.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { QuestList, VideoList, publicContent } from '@te-liet/shared';
import type { ContentStore } from './store.js';

const digest = (s: string) => createHash('sha256').update(s).digest();
const BODY_LIMIT = 256 * 1024;

export async function registerContentRoutes(app: FastifyInstance, store: ContentStore, opts: { adminToken?: string; gameAdminUrl?: string } = {}) {
  const token = opts.adminToken?.trim() ?? '';
  const enabled = token.length >= 16;
  const expected = digest(token);

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!enabled) return reply.code(503).send({ error: 'Trang quản trị chưa bật (đặt ADMIN_TOKEN cho API).' });
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!given || !timingSafeEqual(digest(given), expected)) return reply.code(401).send({ error: 'Sai mã quản trị.' });
  };
  const invalid = (reply: FastifyReply, error: z.ZodError) =>
    reply.code(400).send({ error: 'Dữ liệu không hợp lệ', issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) });

  app.get('/v1/content', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return publicContent(await store.get());
  });

  app.register(async (admin) => {
    admin.addHook('onRequest', guard);
    admin.get('/v1/admin/content', async () => ({ ...(await store.get()), storage: store.kind }));
    admin.put('/v1/admin/content/videos', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
      const body = z.object({ videos: VideoList }).strict().safeParse(req.body);
      if (!body.success) return invalid(reply, body.error);
      req.log.info({ count: body.data.videos.length }, 'admin saved videos');
      return { ...(await store.put('videos', body.data.videos)), storage: store.kind };
    });
    admin.put('/v1/admin/content/quests', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
      const body = z.object({ quests: QuestList }).strict().safeParse(req.body);
      if (!body.success) return invalid(reply, body.error);
      req.log.info({ count: body.data.quests.length }, 'admin saved quests');
      return { ...(await store.put('quests', body.data.quests)), storage: store.kind };
    });
    admin.post('/v1/admin/content/reset', async (req, reply) => {
      const body = z.object({ section: z.enum(['videos', 'quests']) }).strict().safeParse(req.body);
      if (!body.success) return invalid(reply, body.error);
      req.log.info({ section: body.data.section }, 'admin reset content');
      return { ...(await store.reset(body.data.section)), storage: store.kind };
    });
    admin.get('/v1/admin/live', async (_req, reply) => {
      if (!opts.gameAdminUrl) return reply.code(503).send({ error: 'Chưa đặt GAME_ADMIN_URL cho API.' });
      try {
        const res = await fetch(new URL('/live', opts.gameAdminUrl), { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return reply.code(502).send({ error: `Server game trả ${res.status}` });
        return await res.json();
      } catch {
        return reply.code(502).send({ error: 'Không hỏi được server game.' });
      }
    });
  });
}
