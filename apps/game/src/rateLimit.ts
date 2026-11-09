import type { Limit } from '@te-liet/shared';

/** Token bucket theo khóa (vd `sessionId:chat`). Gọi allow() TRƯỚC khi parse payload. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  allow(key: string, limit: Limit, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: limit.capacity, at: now };
    bucket.tokens = Math.min(limit.capacity, bucket.tokens + ((now - bucket.at) * limit.capacity) / limit.perMs);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Xóa mọi bucket có khóa bắt đầu bằng `prefix` (khi client rời room). */
  forget(prefix: string): void {
    for (const key of this.buckets.keys()) if (key.startsWith(prefix)) this.buckets.delete(key);
  }
}
