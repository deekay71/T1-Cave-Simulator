#!/usr/bin/env node
// One-origin front door for hosting a play test from a personal machine, without Docker: the job
// infra/nginx.conf does in the Compose stack. Serves the production web build (apps/web/dist) and
// forwards /v1 + /health to the API and /matchmake + the Colyseus WebSockets to the game server.
//
//   npm run build
//   API_PORT=3320 API_HOST=127.0.0.1 TRUST_PROXY=1 INVITE_CODE=... node dist/server/api.mjs
//   GAME_PORT=2820 GAME_HOST=127.0.0.1 ADMIN_PORT=9320 ADMIN_HOST=127.0.0.1 node dist/server/game.mjs
//   PORT=8088 API=http://127.0.0.1:3320 GAME=http://127.0.0.1:2820 node scripts/local-host.mjs
//
// The API sees one X-Forwarded-For entry, written here (never the client's own header): the peer
// address, or Cf-Connecting-Ip when the peer is a tunnel daemon on this machine (cloudflared).
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/dist");
/**
 * Media the host drops in later (screen clips, the shrine audio) are served straight from
 * apps/web/public, so a new file shows up without a rebuild.
 */
const MEDIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/public");
const LIVE_MEDIA = ["/videos/", "/audio/"];
const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || "0.0.0.0";
const API = new URL(process.env.API || "http://127.0.0.1:3320");
const GAME = new URL(process.env.GAME || "http://127.0.0.1:2820");
if (!existsSync(path.join(ROOT, "index.html"))) {
  console.error(`local-host: ${ROOT}/index.html not found; run \`npm run build\` first`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8", ".map": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".md": "text/plain; charset=utf-8",
};
const ZIPPED = new Set([".html", ".js", ".css", ".json", ".glb", ".svg", ".txt"]);
/** path -> { mtimeMs, body } of the gzipped file. */
const zipCache = new Map();

const loopback = (a) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
function clientIp(req) {
  const peer = req.socket.remoteAddress || "";
  const viaTunnel = loopback(peer) && typeof req.headers["cf-connecting-ip"] === "string";
  return (viaTunnel ? req.headers["cf-connecting-ip"] : peer).replace(/^::ffff:/, "");
}
function forwardHeaders(req) {
  const headers = { ...req.headers, "x-forwarded-for": clientIp(req), "x-real-ip": clientIp(req) };
  headers["x-forwarded-proto"] = req.headers["cf-visitor"]?.includes("https") || req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  return headers;
}

function proxy(req, res, target) {
  const up = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req) },
    (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); },
  );
  up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }); res.end("upstream unavailable"); });
  req.pipe(up);
}

async function serveFile(req, res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  const stat = statSync(file);
  const headers = { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": cache };
  // Byte ranges (video seeking needs them): one range, never compressed.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (range && !ZIPPED.has(ext)) {
    let start = range[1] === "" ? stat.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (!(start <= end)) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return void createReadStream(file, { start, end }).pipe(res);
  }
  if (!ZIPPED.has(ext)) headers["accept-ranges"] = "bytes";
  if (ZIPPED.has(ext) && stat.size > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    let hit = zipCache.get(file);
    if (!hit || hit.mtimeMs !== stat.mtimeMs) {
      hit = { mtimeMs: stat.mtimeMs, body: gzipSync(await readFile(file)) };
      zipCache.set(file, hit);
    }
    res.writeHead(200, { ...headers, "content-encoding": "gzip", "content-length": hit.body.length, vary: "Accept-Encoding" });
    return res.end(req.method === "HEAD" ? undefined : hit.body);
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  if (p.startsWith("/v1/") || p.startsWith("/health/")) return proxy(req, res, API);
  if (p.startsWith("/matchmake/")) return proxy(req, res, GAME);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(p); } catch { res.writeHead(400); return res.end(); }
  const base = LIVE_MEDIA.some((m) => p.startsWith(m)) ? MEDIA : ROOT;
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  const isFile = existsSync(file) && statSync(file).isFile();
  if (isFile) {
    const cache = p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : p.startsWith("/models/") ? "public, max-age=3600" : base === MEDIA ? "public, max-age=300" : "no-cache";
    return void serveFile(req, res, file, cache).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  }
  // Hashed assets and models never fall back to the page; everything else is the single-page app.
  if (p.startsWith("/assets/") || p.startsWith("/models/") || base === MEDIA) { res.writeHead(404); return res.end(); }
  void serveFile(req, res, path.join(ROOT, "index.html"), "no-cache").catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
});

// Colyseus WebSockets: /{processId}/{roomId}. Replay the upgrade request to the game server and splice the sockets.
server.on("upgrade", (req, socket, head) => {
  if (!/^\/[^/]+\/[^/?]+(\?.*)?$/.test(req.url || "")) return socket.destroy();
  const up = net.connect(Number(GAME.port), GAME.hostname, () => {
    const headers = forwardHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.setNoDelay(true);
  socket.setNoDelay(true);
  const close = () => { up.destroy(); socket.destroy(); };
  up.on("error", close); socket.on("error", close); up.on("close", close); socket.on("close", close);
});

server.listen(PORT, HOST, () => console.log(`local-host: http://${HOST}:${PORT} -> web ${ROOT}, api ${API.host}, game ${GAME.host}`));
