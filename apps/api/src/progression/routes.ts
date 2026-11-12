import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { emptyProgression, EquipRequest, PurchaseRequest, QuizSubmitRequest, galleryState } from '../../../../packages/shared/src/progression.js';
import { ProgressionStore, type GuestIdentity } from './store.js';
import {
  createSessionToken, guardOrigin, hashSessionToken, progressionConfig, ProgressionError,
  readSessionToken, sessionCookie, type ProgressionConfig,
} from './security.js';

/** Public-safe errors only. Never return/log database messages or session cookie values. */
export function sendProgressionError(reply: FastifyReply, error: unknown) {
  reply.header('Cache-Control', 'no-store');
  if (error instanceof ProgressionError) return reply.code(error.statusCode).send({ code: error.code, error: error.message });
  return reply.code(503).send({ code: 'progression_unavailable', error: 'Tạm chưa tải được tiến trình. Thử lại sau.' });
}

/**
 * Registration creates no credentials and performs no database writes.
 * Default OFF. Enable only after explicit approval of persistent guest sessions.
 * The existing /v1/guest handler must validate its name and invite BEFORE resolveGuest().
 */
export async function registerProgressionRoutes(
  app: FastifyInstance,
  db: Pool | null,
  config: ProgressionConfig = progressionConfig(),
) {
  const store = db ? new ProgressionStore(db) : null;
  const activeStore = () => {
    if (!config.enabled) throw new ProgressionError('progression_disabled', 503, 'Điểm danh và cửa hàng chưa mở.');
    if (!store) throw new ProgressionError('progression_unavailable', 503, 'Chưa kết nối kho tiến trình.');
    return store;
  };
  const identity = async (req: FastifyRequest): Promise<GuestIdentity | null> => {
    const current = activeStore();
    const token = readSessionToken(req, config);
    return token ? current.findSession(hashSessionToken(token)) : null;
  };
  const authenticated = async (req: FastifyRequest) => {
    const current = activeStore();
    guardOrigin(req, config, true);
    const who = await identity(req);
    if (!who) throw new ProgressionError('session_required', 401, 'Vào hang để bắt đầu phiên khách.');
    return { current, who };
  };
  const options = { config: { rateLimit: { max: 60, timeWindow: '1 minute', groupId: 'progression' } } };

  app.get('/v1/progression', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.enabled) return emptyProgression(false);
    try {
      guardOrigin(req, config, false);
      const current = activeStore();
      const who = await identity(req);
      return who ? await current.read(who.id) : await current.anonymous();
    } catch (error) { return sendProgressionError(reply, error); }
  });

  app.post('/v1/progression/check-in', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { current, who } = await authenticated(req);
      if (!z.object({}).strict().safeParse(req.body ?? {}).success)
        throw new ProgressionError('invalid_request', 400, 'Điểm danh không nhận ngày, số xu hay ID từ trình duyệt.');
      return await current.checkIn(who.id);
    } catch (error) { return sendProgressionError(reply, error); }
  });

  app.post('/v1/progression/purchase', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { current, who } = await authenticated(req);
      const body = PurchaseRequest.safeParse(req.body);
      if (!body.success) throw new ProgressionError('invalid_request', 400, 'Cần vật phẩm và mã giao dịch hợp lệ.');
      return await current.purchase(who.id, body.data.itemId, body.data.idempotencyKey);
    } catch (error) { return sendProgressionError(reply, error); }
  });

  app.post('/v1/progression/equip', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { current, who } = await authenticated(req);
      const body = EquipRequest.safeParse(req.body);
      if (!body.success) throw new ProgressionError('invalid_request', 400, 'Vật phẩm không hợp lệ.');
      return await current.equip(who.id, body.data.itemId);
    } catch (error) { return sendProgressionError(reply, error); }
  });

  app.post('/v1/progression/quiz/start', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { current, who } = await authenticated(req);
      if (!z.object({}).strict().safeParse(req.body ?? {}).success)
        throw new ProgressionError('invalid_request', 400, 'Không nhận câu hỏi hay điểm từ trình duyệt.');
      return await current.startQuiz(who.id);
    } catch (error) { return sendProgressionError(reply, error); }
  });
  app.post('/v1/progression/quiz/submit', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const { current, who } = await authenticated(req);
      const body = QuizSubmitRequest.safeParse(req.body);
      if (!body.success) throw new ProgressionError('invalid_request', 400, 'Cần đủ 5 câu trả lời hợp lệ.');
      return await current.submitQuiz(who.id, body.data.attemptId, body.data.answers);
    } catch (error) { return sendProgressionError(reply, error); }
  });
  app.get('/v1/progression/gallery', options, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return galleryState();
  });

  app.post('/v1/progression/logout', options, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const current = activeStore();
      guardOrigin(req, config, true);
      if (!z.object({}).strict().safeParse(req.body ?? {}).success)
        throw new ProgressionError('invalid_request', 400, 'Yêu cầu không hợp lệ.');
      const token = readSessionToken(req, config);
      if (token) await current.revokeSession(hashSessionToken(token));
      reply.header('Set-Cookie', sessionCookie(config, null));
      return { ok: true };
    } catch (error) { return sendProgressionError(reply, error); }
  });

  return {
    enabled: config.enabled,
    /** null means disabled: preserve ephemeral guest behavior; errors must not fall back to UUID auth. */
    async resolveGuest(req: FastifyRequest, reply: FastifyReply, name: string): Promise<GuestIdentity | null> {
      if (!config.enabled) return null;
      reply.header('Cache-Control', 'no-store');
      try {
        const current = activeStore();
        guardOrigin(req, config, true);
        const existing = await identity(req);
        if (existing) {
          if (existing.name !== name) await current.renameGuest(existing.id, name);
          return { ...existing, name };
        }
        const token = createSessionToken();
        const who = await current.createGuest(name, hashSessionToken(token));
        reply.header('Set-Cookie', sessionCookie(config, token));
        return who;
      } catch (error) {
        if (error instanceof ProgressionError) throw error;
        throw new ProgressionError('progression_unavailable', 503, 'Tạm chưa tạo được phiên khách. Thử lại sau.');
      }
    },
  };
}
