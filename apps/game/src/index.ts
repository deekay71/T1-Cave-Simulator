import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import { HubRoom } from './HubRoom.js';
import { colyseusLogger, log, registry } from './telemetry.js';

if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) throw new Error('REDIS_URL required');
const redis = process.env.REDIS_URL;
const port = Number(process.env.GAME_PORT || 2567);
const adminPort = Number(process.env.ADMIN_PORT || 9100);
let phase: 'starting' | 'running' | 'draining' = 'starting';

const server = new Server({
  transport: new WebSocketTransport({ maxPayload: 4096 }),
  ...(redis ? { presence: new RedisPresence(redis), driver: new RedisDriver(redis) } : {}),
  ...(process.env.PUBLIC_ADDRESS ? { publicAddress: process.env.PUBLIC_ADDRESS } : {}),
  gracefullyShutdown: true,
  greet: false,
  logger: colyseusLogger,
});
server.define('hub_v1', HubRoom);

// Cổng quản trị nội bộ cho orchestrator và Prometheus. Không public ra Internet.
const admin = createServer((req, res) => {
  if (req.url === '/health/live') return void res.writeHead(200).end('ok');
  if (req.url === '/health/ready') return void res.writeHead(phase === 'running' ? 200 : 503).end(phase);
  if (req.url === '/metrics') {
    registry.metrics().then(
      (body) => res.writeHead(200, { 'Content-Type': registry.contentType }).end(body),
      (err) => { log.error({ err }, 'metrics failed'); res.writeHead(500).end(); },
    );
    return;
  }
  res.writeHead(404).end();
});

// Colyseus tự xử lý tắt máy êm (gracefullyShutdown); ở đây chỉ báo "không nhận thêm" cho readiness.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { phase = 'draining'; log.info({ signal }, 'draining'); });
}

await server.listen(port, '0.0.0.0');
admin.listen(adminPort, '0.0.0.0');
phase = 'running';
log.info({ port, adminPort, redis: Boolean(redis) }, 'Tê Liệt game listening');
