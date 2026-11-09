import {
  SignJWT, jwtVerify, generateKeyPair, exportJWK, importJWK, createLocalJWKSet,
  type JWK, type JSONWebKeySet,
} from 'jose';
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Vé vào game (docs/tech-decisions.md, T8): JWT EdDSA hạn ngắn.
 * API giữ khóa riêng để ký; game server chỉ giữ khóa công khai để xác minh.
 */
const ISSUER = 'te-liet-api';
const AUDIENCE = 'te-liet-game';
const ALG = 'EdDSA';
export const TICKET_TTL_SECONDS = 60;

export interface TicketIdentity {
  /** id tài khoản */
  id: string;
  name: string;
  /** cấp tin cậy: 0 = guest */
  trust: number;
}
export interface TicketKeys { privateJwk: JWK; publicJwks: JSONWebKeySet }

export async function generateTicketKeys(): Promise<TicketKeys> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { crv: 'Ed25519', extractable: true });
  const kid = randomUUID();
  return {
    privateJwk: { ...(await exportJWK(privateKey)), kid, alg: ALG },
    publicJwks: { keys: [{ ...(await exportJWK(publicKey)), kid, alg: ALG, use: 'sig' }] },
  };
}

export function createTicketIssuer(privateJwk: JWK) {
  let key: ReturnType<typeof importJWK> | undefined;
  return async (who: TicketIdentity): Promise<string> => {
    key ??= importJWK(privateJwk, ALG);
    return new SignJWT({ name: who.name, trust: who.trust })
      .setProtectedHeader({ alg: ALG, ...(privateJwk.kid ? { kid: privateJwk.kid } : {}) })
      .setSubject(who.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
      .sign(await key);
  };
}

export function createTicketVerifier(publicJwks: JSONWebKeySet) {
  const keys = createLocalJWKSet(publicJwks);
  return async (ticket: unknown): Promise<TicketIdentity> => {
    if (typeof ticket !== 'string' || ticket.length > 2048) throw new Error('Ticket required');
    const { payload } = await jwtVerify(ticket, keys, {
      algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE, maxTokenAge: `${TICKET_TTL_SECONDS + 5}s`,
    });
    const { sub, name, trust } = payload;
    if (!sub || typeof name !== 'string' || name.trim().length === 0 || name.length > 24
      || typeof trust !== 'number' || !Number.isInteger(trust) || trust < 0 || trust > 3) {
      throw new Error('Invalid identity');
    }
    return { id: sub, name, trust };
  };
}

function parseJson<T>(variable: string, raw: string): T {
  try { return JSON.parse(raw) as T; } catch { throw new Error(`${variable} must be JSON`); }
}

/** Khóa ký vé cho API: biến môi trường TICKET_PRIVATE_JWK, ngoài production thì dùng khóa dev. */
export async function loadPrivateJwk(): Promise<JWK> {
  const raw = process.env.TICKET_PRIVATE_JWK;
  return raw ? parseJson<JWK>('TICKET_PRIVATE_JWK', raw) : (await devKeys()).privateJwk;
}

/** Khóa xác minh vé cho game: biến môi trường TICKET_PUBLIC_JWKS, ngoài production thì dùng khóa dev. */
export async function loadPublicJwks(): Promise<JSONWebKeySet> {
  const raw = process.env.TICKET_PUBLIC_JWKS;
  return raw ? parseJson<JSONWebKeySet>('TICKET_PUBLIC_JWKS', raw) : (await devKeys()).publicJwks;
}

/**
 * Khóa dev tạo một lần trong .dev-keys/ (đã gitignore) để API, game và bot test dùng chung
 * mà không cần cấu hình. Ghi qua file tạm rồi link() để hai process khởi động cùng lúc không đọc phải file dở.
 */
async function devKeys(): Promise<TicketKeys> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set TICKET_PRIVATE_JWK (API) and TICKET_PUBLIC_JWKS (game) in production; run `npm run keys`');
  }
  const path = resolve(process.env.TICKET_DEV_KEYS_PATH ?? '.dev-keys/ticket-keys.json');
  try {
    return JSON.parse(await readFile(path, 'utf8')) as TicketKeys;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const keys = await generateTicketKeys();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(keys), { mode: 0o600 });
  try {
    await link(tmp, path);
    return keys;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return JSON.parse(await readFile(path, 'utf8')) as TicketKeys;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
