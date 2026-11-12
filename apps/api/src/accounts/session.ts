/**
 * Cookie phiên và chống CSRF cho các route tài khoản / quản trị.
 *
 * - Cookie `tl_session`: token ngẫu nhiên 32 byte, HttpOnly, SameSite=Lax, 30 ngày; Secure khi
 *   request đến qua https (sau proxy: X-Forwarded-Proto, cần TRUST_PROXY). Server chỉ lưu SHA-256.
 * - Mọi request đổi trạng thái phải có header `X-T1-Request: 1` (trang khác không gửi được header
 *   này nếu CORS không cho) và, khi trình duyệt gửi Origin, Origin phải là WEB_ORIGIN hoặc chính host
 *   đang phục vụ (front door / tunnel cùng origin với game).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'tl_session';
export const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export const newSessionToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const sessionExpiry = (now = Date.now()) => new Date(now + SESSION_SECONDS * 1000);

/** Token trong cookie, hoặc null. Hai cookie cùng tên là mơ hồ: coi như không có. */
export function readSession(req: Pick<FastifyRequest, 'headers'>): string | null {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
    .map((part) => part.slice(SESSION_COOKIE.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

export function sessionCookie(req: Pick<FastifyRequest, 'protocol'>, token: string | null): string {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSION_SECONDS : 0}${secure}`;
}

/** Request đổi trạng thái có thật sự đến từ trang game không (xem đầu tệp). */
export function fromGamePage(req: Pick<FastifyRequest, 'headers'>, webOrigin?: string): boolean {
  if (req.headers['x-t1-request'] !== '1') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (webOrigin && origin === webOrigin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === req.headers['x-forwarded-host'];
  } catch {
    return false;
  }
}
