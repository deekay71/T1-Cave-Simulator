/**
 * Client-side mirror of the server's chat token bucket (apps/game RateLimiter + LIMITS.chat): a
 * message the server would drop stays in the chat input with a "slow down" hint instead of
 * vanishing silently. Refills `slack` times slower than the server, so network jitter between two
 * messages (they can arrive closer together than they were sent) never pushes one over the limit.
 * Unit-tested against the real RateLimiter in scripts/chat.test.ts.
 */
import type { Limit } from "@te-liet/shared";

export interface ChatBucket {
  /** Spend a token at `now` (ms): 0 = allowed, otherwise the ms to wait before one is free. */
  take(now: number): number;
  /** Full bucket again (a new session gets a fresh bucket on the server too). */
  reset(): void;
}

export function chatBucket(limit: Limit, slack = 1.08): ChatBucket {
  const refill = (limit.perMs / limit.capacity) * slack;
  let tokens = limit.capacity;
  let at = -Infinity;
  return {
    take(now) {
      tokens = Math.min(limit.capacity, tokens + (now - at) / refill);
      at = now;
      if (tokens < 1) return Math.ceil((1 - tokens) * refill);
      tokens -= 1;
      return 0;
    },
    reset() {
      tokens = limit.capacity;
      at = -Infinity;
    },
  };
}
