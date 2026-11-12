/**
 * Ai được vào /v1/admin/*:
 *
 * - Một tài khoản có role "admin" đang đăng nhập (cookie phiên). Request đổi dữ liệu còn phải qua
 *   kiểm tra CSRF (header X-T1-Request + Origin, xem accounts/session.ts).
 * - Hoặc `Authorization: Bearer <ADMIN_TOKEN>` (script, công cụ). Token phải dài ít nhất 16 ký tự,
 *   so sánh theo thời gian hằng. Không đặt ADMIN_TOKEN thì đường token tắt.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromGamePage } from '../accounts/session.js';

export interface AdminAuth {
  token?: string;
  /** Request này có phiên của một tài khoản quản trị không. */
  isAdmin?: (req: FastifyRequest) => Promise<boolean>;
  webOrigin?: string;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function adminGuard(auth: AdminAuth) {
  const token = auth.token?.trim() ?? '';
  const tokenOn = token.length >= 16;
  const expected = digest(token);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) {
      if (!tokenOn) {
        return auth.isAdmin
          ? reply.code(401).send({ code: 'admin_token_off', error: 'Đăng nhập bằng mã đang tắt: dùng tài khoản quản trị.' })
          : reply.code(503).send({ code: 'admin_off', error: 'Trang quản trị chưa bật (đặt ADMIN_TOKEN cho API).' });
      }
      const given = header.slice(7).trim();
      if (given && timingSafeEqual(digest(given), expected)) return;
      return reply.code(401).send({ code: 'admin_token_invalid', error: 'Sai mã quản trị.' });
    }
    if (!auth.isAdmin) {
      return tokenOn
        ? reply.code(401).send({ code: 'admin_required', error: 'Cần mã quản trị.' })
        : reply.code(503).send({ code: 'admin_off', error: 'Trang quản trị chưa bật (đặt ADMIN_TOKEN cho API).' });
    }
    let ok = false;
    try { ok = await auth.isAdmin(req); } catch { return reply.code(503).send({ code: 'accounts_unavailable', error: 'Tạm chưa kiểm tra được phiên đăng nhập.' }); }
    if (!ok) return reply.code(401).send({ code: 'admin_required', error: 'Cần đăng nhập bằng tài khoản quản trị.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !fromGamePage(req, auth.webOrigin)) {
      return reply.code(403).send({ code: 'origin_forbidden', error: 'Yêu cầu phải xuất phát từ trang quản trị.' });
    }
  };
}
