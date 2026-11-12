import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createTicketIssuer, loadPrivateJwk, TICKET_TTL_SECONDS } from '@te-liet/auth';
import { registerMatchRoutes } from './matches/routes.js';
import { registerProgressionRoutes, sendProgressionError } from './progression/routes.js';
import { inviteMatches } from './invite.js';
import { registerContentRoutes } from './content/routes.js';
import { fileContentStore, pgContentStore } from './content/store.js';

/**
 * TRUST_PROXY: "true", số hop ("1" khi đứng sau một Nginx), hoặc danh sách IP/CIDR của proxy.
 * Không bật thì sau proxy mọi request mang IP của proxy và cả site dùng chung một bucket rate limit.
 */
function trustProxy(raw = process.env.TRUST_PROXY): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return (_address, hop) => hop < hops;   // tin `hops` proxy gần nhất
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const app = Fastify({ logger: { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }, bodyLimit: 2048, trustProxy: trustProxy() });
const db = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
if (process.env.NODE_ENV === 'production' && !db) throw new Error('DATABASE_URL required');
const issueTicket = createTicketIssuer(await loadPrivateJwk());

await app.register(cors, { origin: process.env.WEB_ORIGIN || 'http://localhost:5173', credentials: true });
/** Close test: đặt INVITE_CODE thì chỉ người có mã mới lấy được vé. Để trống = mở cho mọi người. */
const INVITE_CODE = process.env.INVITE_CODE?.trim() || '';
/** Số request mỗi phút cho một IP. Nhiều tester chung mạng (văn phòng, quán net) thì tăng lên. */
const RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.GUEST_RATE_LIMIT) || 20);
await app.register(rateLimit, { max: RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' });

await registerMatchRoutes(app, db);
const progression = await registerProgressionRoutes(app, db);
await registerContentRoutes(app, db ? pgContentStore(db) : fileContentStore(), {
  adminToken: process.env.ADMIN_TOKEN,
  gameAdminUrl: process.env.GAME_ADMIN_URL || 'http://127.0.0.1:9100',
});

app.get('/health/live', async () => ({ ok: true }));
app.get('/health/ready', async () => {
  if (db) await db.query('SELECT 1');
  return { ok: true, persistence: !!db };
});

app.post('/v1/guest', async (req, reply) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(24), invite: z.string().max(64).optional() })
    .strict()
    .safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Tên cần 1–24 ký tự' });
  if (!inviteMatches(INVITE_CODE, body.data.invite)) {
    const code = body.data.invite?.trim() ? 'invite_invalid' : 'invite_required';
    return reply.code(403).send({ code, error: code === 'invite_invalid' ? 'Mã mời không đúng' : 'Cần mã mời để vào hang' });
  }
  try {
  const persistent = await progression.resolveGuest(req, reply, body.data.name);
  const id = persistent?.id ?? randomUUID();
  if (!persistent && db) await db.query('INSERT INTO accounts(id, display_name) VALUES ($1, $2)', [id, body.data.name]);
  const ticket = await issueTicket({ id, name: body.data.name, trust: 0 });
  return { ticket, expiresIn: TICKET_TTL_SECONDS };
  } catch (error) { return sendProgressionError(reply, error); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); await db?.end(); });
}
await app.listen({ port: Number(process.env.API_PORT || 3000), host: process.env.API_HOST || '0.0.0.0' });
