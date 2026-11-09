import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createTicketIssuer, loadPrivateJwk, TICKET_TTL_SECONDS } from '@te-liet/auth';

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

const app = Fastify({ logger: true, bodyLimit: 2048, trustProxy: trustProxy() });
const db = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) : null;
if (process.env.NODE_ENV === 'production' && !db) throw new Error('DATABASE_URL required');
const issueTicket = createTicketIssuer(await loadPrivateJwk());

await app.register(cors, { origin: process.env.WEB_ORIGIN || 'http://localhost:5173' });
await app.register(rateLimit, { max: 20, timeWindow: '1 minute' });

app.get('/health/live', async () => ({ ok: true }));
app.get('/health/ready', async () => {
  if (db) await db.query('SELECT 1');
  return { ok: true, persistence: !!db };
});

app.post('/v1/guest', async (req, reply) => {
  const body = z.object({ name: z.string().trim().min(1).max(24) }).strict().safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Tên cần 1–24 ký tự' });
  const id = randomUUID();
  if (db) await db.query('INSERT INTO accounts(id, display_name) VALUES ($1, $2)', [id, body.data.name]);
  const ticket = await issueTicket({ id, name: body.data.name, trust: 0 });
  return { ticket, expiresIn: TICKET_TTL_SECONDS };
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => { await app.close(); await db?.end(); });
}
await app.listen({ port: Number(process.env.API_PORT || 3000), host: '0.0.0.0' });
