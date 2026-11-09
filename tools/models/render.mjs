#!/usr/bin/env node
// Headless screenshot of a gallery URL (or any page that sets window.__ready = true).
//
//   node tools/models/render.mjs --url "http://127.0.0.1:5190/gallery.html?group=props" \
//        --out .renders/props/all.png [--w 1280 --h 720] [--timeout 20000]
//
// - Launches Google Chrome headless (new) with Metal ANGLE (WebGL2 on the Apple GPU) and a
//   fresh temporary profile, so any number of renders can run in parallel.
// - Drives it over the Chrome DevTools Protocol (Node's global WebSocket): waits until
//   window.__ready === true, then captures a PNG of the viewport.
// - Prints the page's console errors / exceptions and window.__errors (load failures).
// - Exit codes: 0 ok · 1 timeout or Chrome/CDP failure (no PNG at --out; a debug capture is
//   written to <out>.timeout.png when possible) · 2 PNG written but the page reported errors.
// - Never leaves Chrome running: the whole process group is killed and the profile deleted.
// - If CDP cannot be established it falls back to --screenshot + --virtual-time-budget
//   (no readiness check; prints a warning).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parseArgs(argv) {
  const out = { w: 1280, h: 720, timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inline] = a.slice(2).split("=", 2);
    const v = inline ?? argv[++i];
    out[k] = v;
  }
  out.w = Number(out.w);
  out.h = Number(out.h);
  out.timeout = Number(out.timeout);
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.out) {
  console.error(
    "usage: node tools/models/render.mjs --url <url> --out <png> [--w 1280 --h 720] [--timeout 20000]",
  );
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error(`render: Chrome not found at ${CHROME} (set CHROME_PATH)`);
  process.exit(1);
}
const outPath = path.resolve(args.out);
mkdirSync(path.dirname(outPath), { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), "tl-render-"));
let chrome;
let cleaned = false;

function killChrome() {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;
  try {
    process.kill(-chrome.pid, "SIGKILL"); // whole process group (GPU/renderer helpers too)
  } catch {
    try {
      chrome.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  killChrome();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* best effort */
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(1);
  });
}
process.on("uncaughtException", (err) => {
  console.error("render: uncaught", err);
  cleanup();
  process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baseFlags() {
  return [
    "--headless=new",
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--hide-scrollbars",
    "--mute-audio",
    "--force-device-scale-factor=1",
    `--window-size=${args.w},${args.h}`,
  ];
}

function launch(extra) {
  const proc = spawn(CHROME, [...baseFlags(), ...extra], {
    detached: true, // own process group so cleanup can kill every helper process
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", () => {});
  return proc;
}

async function waitForWsUrl(proc, ms) {
  let buf = "";
  proc.stderr.on("data", (d) => (buf += d.toString()));
  const t0 = Date.now();
  const portFile = path.join(profile, "DevToolsActivePort");
  while (Date.now() - t0 < ms) {
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) return m[1];
    if (existsSync(portFile)) {
      const [port, p] = readFileSync(portFile, "utf8").split("\n");
      if (port && p) return `ws://127.0.0.1:${port.trim()}${p.trim()}`;
    }
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (${proc.exitCode}): ${buf.slice(-400)}`);
    await sleep(50);
  }
  throw new Error("timed out waiting for DevTools endpoint");
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error("CDP websocket error " + (e?.message ?? "")));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
          else p.resolve(msg.result);
        } else {
          for (const l of this.listeners) l(msg);
        }
      };
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
        this.pending.clear();
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function waitExit(proc, ms) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    proc.once("exit", () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

async function renderWithCdp() {
  chrome = launch(["--remote-debugging-port=0", "about:blank"]);
  const wsUrl = await waitForWsUrl(chrome, 15000);
  const cdp = new Cdp(wsUrl);
  await cdp.open();

  const logs = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      const { type, args: a } = msg.params;
      if (type === "error" || type === "warning" || type === "assert") {
        const text = a.map((x) => x.value ?? x.description ?? x.type).join(" ");
        logs.push(`console.${type}: ${text}`);
      }
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      logs.push(`exception: ${d.exception?.description ?? d.text}`);
    } else if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      if (e.level === "error") logs.push(`log.${e.source}: ${e.text}${e.url ? " " + e.url : ""}`);
    }
  });

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => cdp.send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Log.enable");
  await s("Emulation.setDeviceMetricsOverride", {
    width: args.w,
    height: args.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const nav = await s("Page.navigate", { url: args.url });
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText} (${args.url})`);

  const t0 = Date.now();
  let state = { ready: false, title: "", errors: [], info: null };
  while (Date.now() - t0 < args.timeout) {
    try {
      const r = await s("Runtime.evaluate", {
        expression:
          "JSON.stringify({ready: window.__ready === true, title: document.title, errors: window.__errors || [], info: window.__info || null})",
        returnByValue: true,
      });
      if (r?.result?.value) state = JSON.parse(r.result.value);
    } catch {
      /* page navigating; retry */
    }
    if (state.ready) break;
    await sleep(150);
  }

  const shot = async (file) => {
    const { data } = await s("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(file, Buffer.from(data, "base64"));
  };

  for (const l of logs.slice(0, 40)) console.error("  " + l);
  if (logs.length > 40) console.error(`  ... ${logs.length - 40} more console messages`);

  let code = 0;
  if (!state.ready) {
    const dbg = outPath.replace(/\.png$/i, "") + ".timeout.png";
    try {
      await shot(dbg);
      console.error(`render: TIMEOUT after ${args.timeout} ms (title "${state.title}"); debug capture ${dbg}`);
    } catch {
      console.error(`render: TIMEOUT after ${args.timeout} ms (title "${state.title}")`);
    }
    for (const e of state.errors) console.error("  page error: " + e);
    code = 1;
  } else {
    await shot(outPath);
    if (state.info) console.log("render: " + JSON.stringify(state.info));
    if (state.errors.length) {
      for (const e of state.errors) console.error("  page error: " + e);
      code = 2;
    }
    console.log(`render: wrote ${outPath} (${args.w}x${args.h}, ${Date.now() - t0} ms)`);
  }

  try {
    await Promise.race([cdp.send("Browser.close"), sleep(2000)]);
  } catch {
    /* ignore */
  }
  cdp.close();
  if (!(await waitExit(chrome, 4000))) killChrome();
  return code;
}

async function renderFallback() {
  console.error("render: WARNING falling back to --virtual-time-budget (no readiness check)");
  chrome = launch([`--screenshot=${outPath}`, `--virtual-time-budget=${args.timeout}`, args.url]);
  const done = await waitExit(chrome, args.timeout + 20000);
  if (!done) {
    killChrome();
    console.error("render: fallback timed out");
    return 1;
  }
  if (!existsSync(outPath)) {
    console.error("render: fallback produced no screenshot");
    return 1;
  }
  console.log(`render: wrote ${outPath} (fallback)`);
  return 0;
}

let code;
try {
  code = await renderWithCdp();
} catch (err) {
  console.error("render: CDP failed: " + (err?.message ?? err));
  killChrome();
  await sleep(300);
  code = await renderFallback();
}
cleanup();
process.exit(code);
