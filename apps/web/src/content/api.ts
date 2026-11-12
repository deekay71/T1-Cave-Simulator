/**
 * Where the API lives, and the content the admin set (video playlist, quests). The game reads it
 * once at start and again every few minutes; until it arrives (or when the API is unreachable) the
 * defaults of packages/shared/src/content.ts are used.
 */
import { DEFAULT_CONTENT, type ContentDoc } from "@te-liet/shared";

const guestUrl = () => import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3000/v1/guest" : "/v1/guest");
/** API root (VITE_API_URL points at /v1/guest), e.g. "http://127.0.0.1:3300" or "" for same-origin. */
export function apiRoot(): string {
  const url = new URL(guestUrl(), location.origin);
  const root = url.pathname.replace(/\/v1\/guest\/?$/, "");
  return url.origin === location.origin ? root : url.origin + root;
}

type Listener = (doc: ContentDoc) => void;
let current: ContentDoc = DEFAULT_CONTENT;
const listeners = new Set<Listener>();
let started = false;
async function refresh() {
  try {
    const res = await fetch(`${apiRoot()}/v1/content`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const doc = (await res.json()) as ContentDoc;
    if (!doc || !Array.isArray(doc.videos) || !Array.isArray(doc.quests)) return;
    if (JSON.stringify(doc) === JSON.stringify(current)) return;
    current = doc;
    for (const l of listeners) l(current);
  } catch {
    /* keep what we have */
  }
}
/** Current content; `listener` (optional) is called whenever a newer version arrives. */
export function content(listener?: Listener): ContentDoc {
  if (listener) listeners.add(listener);
  if (!started && typeof window !== "undefined") {
    started = true;
    void refresh();
    setInterval(() => { if (!document.hidden) void refresh(); }, 180_000);
  }
  return current;
}
export function offContent(listener: Listener) {
  listeners.delete(listener);
}
