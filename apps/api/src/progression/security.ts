import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export interface ProgressionConfig {
  enabled: boolean;
  webOrigin: string;
  secureCookie: boolean;
  cookieName: string;
}

export class ProgressionError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
  }
}

export function progressionConfig(env: NodeJS.ProcessEnv = process.env): ProgressionConfig {
  const enabled = env.PROGRESSION_ENABLED === 'true';
  if (!enabled) return { enabled: false, webOrigin: '', secureCookie: true, cookieName: '__Host-t1_guest' };
  let origin: URL;
  try { origin = new URL(env.WEB_ORIGIN || 'http://localhost:5173'); }
  catch { throw new Error('PROGRESSION_ENABLED requires a valid WEB_ORIGIN'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  const secureCookie = origin.protocol === 'https:';
  if (origin.origin !== (env.WEB_ORIGIN || 'http://localhost:5173') || origin.username || origin.password ||
      (!secureCookie && !(env.NODE_ENV !== 'production' && local && origin.protocol === 'http:'))) {
    throw new Error('Progression requires an exact HTTPS WEB_ORIGIN (HTTP loopback is development-only)');
  }
  return { enabled, webOrigin: origin.origin, secureCookie, cookieName: secureCookie ? '__Host-t1_guest' : 't1_guest_dev' };
}

/** All mutations require exact browser Origin and a custom header; SameSite is additional defense. */
export function guardOrigin(req: Pick<FastifyRequest, 'headers'>, config: ProgressionConfig, mutation: boolean): void {
  const origin = req.headers.origin;
  if ((mutation && !origin) || (origin !== undefined && origin !== config.webOrigin) ||
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (mutation && req.headers['x-t1-request'] !== '1')) {
    throw new ProgressionError('origin_forbidden', 403, 'Yêu cầu phải xuất phát từ trang game.');
  }
}

/** Only the cookie authenticates. Neither user IDs, game tickets nor localStorage are credentials here. */
export function readSessionToken(req: Pick<FastifyRequest, 'headers'>, config: ProgressionConfig): string | null {
  const cookies = (req.headers.cookie || '').split(';').map(part => part.trim());
  const values = cookies.filter(part => part.startsWith(`${config.cookieName}=`)).map(part => part.slice(config.cookieName.length + 1));
  // Duplicate cookies are ambiguous; fail closed rather than choose an attacker-controlled value.
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex');
/** Called only after the feature is explicitly enabled and the request passes invite/origin validation. */
export const createSessionToken = (): string => randomBytes(32).toString('base64url');

export function sessionCookie(config: ProgressionConfig, token: string | null): string {
  return `${config.cookieName}=${token || ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_TTL_SECONDS : 0}${config.secureCookie ? '; Secure' : ''}`;
}
