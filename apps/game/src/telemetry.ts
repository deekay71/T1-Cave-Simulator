import { format } from 'node:util';
import pino from 'pino';
import { Registry, collectDefaultMetrics, Gauge, Histogram } from 'prom-client';

export const log = pino({ name: 'te-liet-game', level: process.env.LOG_LEVEL ?? 'info' });

/** Colyseus log kiểu console (nhiều tham số); gộp thành một chuỗi để pino không bỏ mất tham số phụ. */
export const colyseusLogger = {
  trace: (...args: unknown[]) => log.trace(format(...args)),
  debug: (...args: unknown[]) => log.debug(format(...args)),
  info: (...args: unknown[]) => log.info(format(...args)),
  warn: (...args: unknown[]) => log.warn(format(...args)),
  error: (...args: unknown[]) => log.error(format(...args)),
};

export const registry = new Registry();
collectDefaultMetrics({ register: registry });   // gồm nodejs_eventloop_lag_seconds, heap, GC

const rooms = new Gauge({ name: 'te_liet_rooms', help: 'Số room hub đang mở', registers: [registry] });
const clients = new Gauge({ name: 'te_liet_clients', help: 'Số client đang giữ ghế (kể cả đang chờ kết nối lại)', registers: [registry] });
const tick = new Histogram({
  name: 'te_liet_tick_seconds',
  help: 'Thời gian chạy một bước mô phỏng của một room',
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05],
  registers: [registry],
});

export const metrics = { rooms, clients, startTick: () => tick.startTimer() };
