/**
 * Admin hub (/admin.html): the playlist of the big wall screen, the T1 quests, and who is online.
 * Talks to the API's /v1/admin/* with the admin token (kept in sessionStorage for this tab only).
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QuestList, VIDEO_CATEGORIES, VideoList, youtubeId, type QuestDef, type QuestQuestion, type ScreenVideo } from "@te-liet/shared";
import { loadYouTubeApi } from "../world/youtubeScreen.js";
import { apiRoot } from "../content/api.js";
import "./admin.css";

const TOKEN_KEY = "tl.admin.token";
type Tab = "live" | "videos" | "quests";
interface Issue { path: string; message: string }
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues: Issue[] = []) { super(message); }
}

function readToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiRoot()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Lỗi ${res.status}`, res.status, data.issues ?? []);
  return data as T;
}

/** "Đăng quang CKTG 2013" -> "dang-quang-cktg-2013-x7k". */
function newId(title: string): string {
  const base = title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "muc";
  return `${base}-${Math.random().toString(36).slice(2, 5)}`;
}
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const fmtDuration = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/* ------------------------------------------------------------------ login */

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await call(value.trim(), "GET", "/v1/admin/content");
      try { sessionStorage.setItem(TOKEN_KEY, value.trim()); } catch { /* this tab only */ }
      onToken(value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <form onSubmit={submit}>
        <p className="eyebrow">TÊ LIỆT · QUẢN TRỊ</p>
        <h1>Đăng nhập quản trị</h1>
        <label>Mã quản trị<input type="password" autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <button className="primary" disabled={busy || !value.trim()}>{busy ? "Đang kiểm tra…" : "Vào trang quản trị"}</button>
        {error && <p className="error" role="alert">{error}</p>}
        <small>Mã là biến ADMIN_TOKEN của API. Mã chỉ được nhớ trong tab này.</small>
      </form>
    </main>
  );
}

/* ------------------------------------------------------------------ live */

interface Live {
  at: number; startedAt: number; online: number; peak: number; joins: number;
  zones: Record<string, number>;
  rooms: { roomId: string; players: { id: string; name: string; zone: string; seat: "cave" | "shrine" | null; connected: boolean; minutes: number }[] }[];
  recent: { name: string; at: number; leftAt: number | null }[];
}
function LiveTab({ token }: { token: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setLive(await call<Live>(token, "GET", "/v1/admin/live")); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Không tải được."); }
  }, [token]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const players = live?.rooms.flatMap((r) => r.players.map((p) => ({ ...p, room: r.roomId }))) ?? [];
  const zones = Object.entries(live?.zones ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...zones.map(([, n]) => n));
  return (
    <section>
      <header className="section-head"><h2>Đang diễn ra</h2><span>{live ? `Cập nhật ${fmtTime(live.at)} · tự làm mới mỗi 5 giây` : "Đang tải…"}</span></header>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="cards">
        <div className="card"><small>Đang online</small><b>{live?.online ?? "—"}</b></div>
        <div className="card"><small>Cao nhất từ lúc server chạy</small><b>{live?.peak ?? "—"}</b></div>
        <div className="card"><small>Lượt vào hang</small><b>{live?.joins ?? "—"}</b></div>
        <div className="card"><small>Server chạy từ</small><b className="small">{live ? new Date(live.startedAt).toLocaleString("vi-VN") : "—"}</b></div>
      </div>
      <div className="split">
        <div className="panel">
          <h3>Người chơi theo khu vực</h3>
          {zones.length ? <ul className="bars">{zones.map(([zone, n]) => <li key={zone}><span>{zone}</span><i style={{ width: `${(n / max) * 100}%` }} /><b>{n}</b></li>)}</ul> : <p className="muted">Chưa có ai trong hang.</p>}
        </div>
        <div className="panel">
          <h3>Vào gần đây</h3>
          {live?.recent.length ? <ul className="recent">{live.recent.slice(0, 12).map((r, i) => <li key={i}><b>{r.name}</b><span>{fmtTime(r.at)}{r.leftAt ? ` → ${fmtTime(r.leftAt)}` : " · đang ở trong"}</span></li>)}</ul> : <p className="muted">Chưa có lượt vào nào từ lúc server chạy.</p>}
        </div>
      </div>
      <div className="panel">
        <h3>Danh sách đang online ({players.length})</h3>
        {players.length ? (
          <table><thead><tr><th>Tên</th><th>Khu vực</th><th>Đang</th><th>Thời gian</th><th>Phòng</th></tr></thead>
            <tbody>{players.map((p) => <tr key={p.room + p.id} className={p.connected ? "" : "dim"}><td>{p.name}</td><td>{p.zone}</td><td>{!p.connected ? "mất kết nối" : p.seat === "shrine" ? "ngồi ở điện thờ" : p.seat === "cave" ? "ngồi trong hang" : "đi lại"}</td><td>{p.minutes} phút</td><td className="mono">{p.room}</td></tr>)}</tbody></table>
        ) : <p className="muted">Không có ai online.</p>}
        <small className="muted">Chỉ tính các phòng của server game mà API đang hỏi (GAME_ADMIN_URL). Không lưu lịch sử: số liệu đặt lại khi server game khởi động lại.</small>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ videos */

/** YouTube preview in the editor: the official player (356 x 200, YouTube's minimum is 200 x 200). */
/** YouTube player errors (onError): 150/101 = the owner blocks embedding, 100 = gone, 2 = bad id, 5 = HTML5. */
const YT_ERRORS: Record<number, string> = {
  2: "Id video không hợp lệ.",
  5: "Trình duyệt không phát được video này.",
  100: "Video đã bị xóa hoặc để riêng tư.",
  101: "Chủ video không cho phát nhúng trên trang khác (lỗi 101): video này không chiếu được trong game.",
  150: "YouTube không cho phát nhúng ở đây (lỗi 150). Nếu đang mở trang quản trị bằng địa chỉ http hoặc IP nội bộ (127.0.0.1, 192.168…), thử lại qua link https của game: nhiều kênh chỉ chặn các địa chỉ đó. Vẫn lỗi qua https thì chủ video đã tắt nhúng.",
  153: "YouTube từ chối phát nhúng (lỗi 153).",
};
function YoutubePreview({ id, onDuration, onResult }: { id: string; onDuration: (s: number) => void; onResult: (ok: boolean, text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const done = useRef(onDuration);
  done.current = onDuration;
  const result = useRef(onResult);
  result.current = onResult;
  useEffect(() => {
    let cancelled = false;
    let player: { destroy(): void; getDuration(): number } | null = null;
    const mount = document.createElement("div");
    host.current?.replaceChildren(mount);
    void loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      player = new YT.Player(mount, {
        width: 356, height: 200, videoId: id,
        playerVars: { rel: 0, playsinline: 1, autoplay: 1, mute: 1 },
        events: {
          onError: (e: { data: number }) => result.current(false, YT_ERRORS[e.data] ?? `YouTube báo lỗi ${e.data}.`),
          onStateChange: (e: { data: number }) => {
            if (e.data === 1) result.current(true, "Phát nhúng được: clip sẽ chiếu trong game.");
          },
          onReady: () => {
            // the duration arrives with the metadata, shortly after the player is ready
            let tries = 0;
            const read = () => {
              const d = player?.getDuration() ?? 0;
              if (d > 0) done.current(Math.round(d * 10) / 10);
              else if (tries++ < 20 && !cancelled) setTimeout(read, 300);
            };
            read();
          },
        },
      }) as unknown as typeof player;
    });
    return () => { cancelled = true; player?.destroy(); };
  }, [id]);
  return <div className="yt-preview" ref={host} />;
}

function useProbe(token: string) {
  const [state, setState] = useState<Record<string, { ok: boolean; text: string; youtube?: string }>>({});
  const probe = (id: string, url: string, done: (duration: number) => void) => {
    if (!url) return;
    const yt = youtubeId(url);
    if (yt) {
      setState((s) => ({ ...s, [id]: { ok: true, text: "Đang hỏi YouTube…" } }));
      call<{ embeddable: boolean; title?: string; author?: string; reason?: string }>(token, "GET", `/v1/admin/youtube?url=${encodeURIComponent(url)}`)
        .then((r) => setState((s) => ({ ...s, [id]: r.embeddable
          ? { ok: true, text: `Tìm thấy: ${r.title}${r.author ? ` · ${r.author}` : ""}. Đang phát thử…`, youtube: yt }
          : { ok: false, text: `Không nhúng được: ${r.reason}` } })))
        .catch((err) => setState((s) => ({ ...s, [id]: { ok: false, text: err instanceof Error ? err.message : "Không hỏi được YouTube." } })));
      return;
    }
    setState((s) => ({ ...s, [id]: { ok: true, text: "Đang tải thử…" } }));
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.preload = "metadata";
    v.muted = true;
    const timer = setTimeout(() => fail("Quá 15 giây không tải được."), 15000);
    const fail = (text: string) => { clearTimeout(timer); v.removeAttribute("src"); setState((s) => ({ ...s, [id]: { ok: false, text } })); };
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : 0;
      setState((s) => ({ ...s, [id]: { ok: true, text: `Tải được · ${v.videoWidth}×${v.videoHeight} · ${fmtDuration(d)}` } }));
      if (d > 0) done(d);
      v.removeAttribute("src");
    };
    v.onerror = () => fail("Không tải được: sai đường dẫn, định dạng không hỗ trợ, hoặc máy chủ chặn CORS.");
    v.src = url.startsWith("/") ? new URL(url, location.origin).toString() : url;
  };
  const set = (id: string, value: { ok: boolean; text: string; youtube?: string }) => setState((s) => ({ ...s, [id]: value }));
  return { state, probe, set };
}

function VideosTab({ token }: { token: string }) {
  const [list, setList] = useState<ScreenVideo[] | null>(null);
  const [saved, setSaved] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string; issues?: Issue[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { state: probe, probe: runProbe, set: setProbe } = useProbe(token);
  const load = useCallback(async () => {
    const doc = await call<{ videos: ScreenVideo[] }>(token, "GET", "/v1/admin/content");
    setList(doc.videos);
    setSaved(JSON.stringify(doc.videos));
  }, [token]);
  useEffect(() => { void load().catch((err) => setNotice({ ok: false, text: String(err.message ?? err) })); }, [load]);
  const dirty = list !== null && JSON.stringify(list) !== saved;
  const set = (id: string, patch: Partial<ScreenVideo>) => setList((l) => l!.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const move = (i: number, d: number) => setList((l) => { const n = [...l!]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const check = useMemo(() => (list ? VideoList.safeParse(list) : null), [list]);
  const save = async () => {
    if (!list) return;
    setBusy(true);
    setNotice(null);
    try {
      const doc = await call<{ videos: ScreenVideo[] }>(token, "PUT", "/v1/admin/content/videos", { videos: list });
      setList(doc.videos);
      setSaved(JSON.stringify(doc.videos));
      setNotice({ ok: true, text: "Đã lưu. Màn hình trong game nhận danh sách mới trong vòng 3 phút (hoặc khi người chơi tải lại trang)." });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Chưa lưu được.", issues: err instanceof ApiError ? err.issues : [] });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!confirm("Bỏ danh sách đã lưu và quay về danh sách gợi ý mặc định?")) return;
    const doc = await call<{ videos: ScreenVideo[] }>(token, "POST", "/v1/admin/content/reset", { section: "videos" });
    setList(doc.videos);
    setSaved(JSON.stringify(doc.videos));
    setNotice({ ok: true, text: "Đã về danh sách mặc định." });
  };
  if (!list) return <section><p className="muted">Đang tải…</p>{notice && <p className="error">{notice.text}</p>}</section>;
  const playable = list.filter((v) => v.enabled && v.url).length;
  return (
    <section>
      <header className="section-head"><h2>Video màn hình lớn</h2><span>{playable}/{list.length} clip đang chiếu · {fmtDuration(list.filter((v) => v.enabled && v.url).reduce((n, v) => n + (v.durationSec ?? 0), 0))} một vòng</span></header>
      <p className="hint">Màn hình chiếu lần lượt các clip đang bật và đã có link, lặp lại; khi mọi clip đều có thời lượng, mọi người trong hang xem cùng một khoảnh khắc. Dán <b>link YouTube</b> (video phải cho phép nhúng; phát bằng trình phát chính thức của YouTube, người chơi phải lại gần màn hình mới thấy), hoặc <b>tệp video</b> mp4/webm: đặt vào <code>apps/web/public/videos/</code> rồi điền <code>/videos/ten-tep.mp4</code>. Twitch / Facebook / TikTok không dùng được. Bấm kiểm tra để đo thời lượng trước khi lưu.</p>
      <ol className="items">
        {list.map((v, i) => {
          const p = probe[v.id];
          const expanded = open === v.id;
          return (
            <li key={v.id} className={`item ${v.enabled ? "" : "off"}`}>
              <div className="row">
                <span className="order">{i + 1}</span>
                <button className="title" onClick={() => setOpen(expanded ? null : v.id)}><b>{v.title}</b><small>{VIDEO_CATEGORIES[v.category]}{v.year ? ` · ${v.year}` : ""} · {fmtDuration(v.durationSec)} · {v.url ? <>{youtubeId(v.url) ? "YouTube · " : ""}<span className="mono">{v.url}</span></> : <em>chưa có link</em>}</small></button>
                <label className="switch" title="Bật / tắt"><input type="checkbox" checked={v.enabled} onChange={(e) => set(v.id, { enabled: e.target.checked })} /><span /></label>
                <button className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                <button className="icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
              </div>
              {expanded && (
                <div className="editor">
                  <label>Tiêu đề<input value={v.title} maxLength={80} onChange={(e) => set(v.id, { title: e.target.value })} /></label>
                  <div className="grid3">
                    <label>Loại<select value={v.category} onChange={(e) => set(v.id, { category: e.target.value as ScreenVideo["category"] })}>{Object.entries(VIDEO_CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></label>
                    <label>Năm<input type="number" min={2012} max={2100} value={v.year ?? ""} onChange={(e) => set(v.id, { year: e.target.value ? Number(e.target.value) : null })} /></label>
                    <label>Thời lượng (giây)<input type="number" min={0} step={0.1} value={v.durationSec ?? ""} onChange={(e) => set(v.id, { durationSec: e.target.value ? Number(e.target.value) : null })} /></label>
                  </div>
                  <label>Link YouTube hoặc tệp video<input value={v.url} placeholder="https://www.youtube.com/watch?v=… hoặc /videos/ten-tep.mp4" onChange={(e) => set(v.id, { url: e.target.value.trim() })} /></label>
                  <div className="actions">
                    <button disabled={!v.url} onClick={() => runProbe(v.id, v.url, (d) => set(v.id, { durationSec: d }))}>{youtubeId(v.url) ? "Kiểm tra YouTube và đo thời lượng" : "Tải thử và đo thời lượng"}</button>
                    {p && <span className={p.ok ? "ok" : "error"}>{p.text}</span>}
                    <span className="spacer" />
                    <button className="danger" onClick={() => { if (confirm(`Xóa "${v.title}"?`)) setList((l) => l!.filter((x) => x.id !== v.id)); }}>Xóa clip</button>
                  </div>
                  {p?.youtube && p.youtube === youtubeId(v.url) && <YoutubePreview id={p.youtube} onDuration={(d) => set(v.id, { durationSec: d })} onResult={(ok, text) => setProbe(v.id, { ok, text, youtube: p.youtube })} />}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="toolbar">
        <button onClick={() => { const v: ScreenVideo = { id: newId("clip moi"), title: "Clip mới", category: "highlight", year: null, url: "", durationSec: null, enabled: true }; setList((l) => [...l!, v]); setOpen(v.id); }}>+ Thêm clip</button>
        <button onClick={() => void reset()}>Về mặc định</button>
        <span className="spacer" />
        {check && !check.success && <span className="error">{check.error.issues[0]?.message}</span>}
        <button className="primary" disabled={!dirty || busy || !check?.success} onClick={() => void save()}>{busy ? "Đang lưu…" : dirty ? "Lưu thay đổi" : "Đã lưu"}</button>
      </div>
      {notice && <Notice {...notice} />}
    </section>
  );
}

/* ------------------------------------------------------------------ quests */

const blankQuestion = (): QuestQuestion => ({ prompt: "Câu hỏi mới?", options: ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"], answer: 0, note: "" });
function QuestsTab({ token }: { token: string }) {
  const [list, setList] = useState<QuestDef[] | null>(null);
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; issues?: Issue[] } | null>(null);
  const load = useCallback(async () => {
    const doc = await call<{ quests: QuestDef[] }>(token, "GET", "/v1/admin/content");
    setList(doc.quests);
    setSaved(JSON.stringify(doc.quests));
  }, [token]);
  useEffect(() => { void load().catch((err) => setNotice({ ok: false, text: String(err.message ?? err) })); }, [load]);
  const dirty = list !== null && JSON.stringify(list) !== saved;
  const check = useMemo(() => (list ? QuestList.safeParse(list) : null), [list]);
  const set = (id: string, patch: Partial<QuestDef>) => setList((l) => l!.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const setQ = (id: string, i: number, patch: Partial<QuestQuestion>) =>
    setList((l) => l!.map((q) => (q.id === id ? { ...q, questions: q.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : q)));
  const move = (i: number, d: number) => setList((l) => { const n = [...l!]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const save = async () => {
    if (!list) return;
    setBusy(true);
    setNotice(null);
    try {
      const doc = await call<{ quests: QuestDef[] }>(token, "PUT", "/v1/admin/content/quests", { quests: list });
      setList(doc.quests);
      setSaved(JSON.stringify(doc.quests));
      setNotice({ ok: true, text: "Đã lưu. Người chơi thấy bộ quest mới khi mở lại Bảng Quest (tối đa 3 phút, hoặc tải lại trang)." });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Chưa lưu được.", issues: err instanceof ApiError ? err.issues : [] });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!confirm("Bỏ bộ quest đã lưu và quay về bộ mặc định?")) return;
    const doc = await call<{ quests: QuestDef[] }>(token, "POST", "/v1/admin/content/reset", { section: "quests" });
    setList(doc.quests);
    setSaved(JSON.stringify(doc.quests));
    setNotice({ ok: true, text: "Đã về bộ quest mặc định." });
  };
  if (!list) return <section><p className="muted">Đang tải…</p>{notice && <p className="error">{notice.text}</p>}</section>;
  return (
    <section>
      <header className="section-head"><h2>Quest về T1</h2><span>{list.filter((q) => q.enabled).length}/{list.length} quest đang bật · {list.reduce((n, q) => n + q.questions.length, 0)} câu hỏi</span></header>
      <p className="hint">Mỗi quest 1–5 câu, mỗi câu 4 đáp án khác nhau; người chơi phải đúng hết mới xong quest. Đổi id của quest đã có làm mất tiến độ của người chơi với quest đó, nên trang này không cho sửa id.</p>
      <ol className="items">
        {list.map((q, i) => {
          const expanded = open === q.id;
          return (
            <li key={q.id} className={`item ${q.enabled ? "" : "off"}`}>
              <div className="row">
                <span className="order">{i + 1}</span>
                <button className="title" onClick={() => setOpen(expanded ? null : q.id)}><b>{q.title}</b><small>{q.questions.length} câu · {q.blurb || <em>chưa có mô tả</em>}</small></button>
                <label className="switch" title="Bật / tắt"><input type="checkbox" checked={q.enabled} onChange={(e) => set(q.id, { enabled: e.target.checked })} /><span /></label>
                <button className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                <button className="icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
              </div>
              {expanded && (
                <div className="editor">
                  <div className="grid2">
                    <label>Tên quest<input value={q.title} maxLength={60} onChange={(e) => set(q.id, { title: e.target.value })} /></label>
                    <label>Mô tả ngắn<input value={q.blurb} maxLength={160} onChange={(e) => set(q.id, { blurb: e.target.value })} /></label>
                  </div>
                  {q.questions.map((x, j) => (
                    <fieldset key={j} className="question">
                      <legend>Câu {j + 1}</legend>
                      <label>Câu hỏi<input value={x.prompt} maxLength={200} onChange={(e) => setQ(q.id, j, { prompt: e.target.value })} /></label>
                      <div className="options">
                        {x.options.map((o, k) => (
                          <label key={k} className={x.answer === k ? "correct" : ""}>
                            <input type="radio" name={`${q.id}-${j}`} checked={x.answer === k} onChange={() => setQ(q.id, j, { answer: k })} title="Đáp án đúng" />
                            <span>{String.fromCharCode(65 + k)}</span>
                            <input value={o} maxLength={120} onChange={(e) => { const options = [...x.options] as QuestQuestion["options"]; options[k] = e.target.value; setQ(q.id, j, { options }); }} />
                          </label>
                        ))}
                      </div>
                      <label>Giải thích sau khi trả lời<input value={x.note} maxLength={240} onChange={(e) => setQ(q.id, j, { note: e.target.value })} /></label>
                      <button className="danger small" disabled={q.questions.length <= 1} onClick={() => set(q.id, { questions: q.questions.filter((_, n) => n !== j) })}>Xóa câu này</button>
                    </fieldset>
                  ))}
                  <div className="actions">
                    <button disabled={q.questions.length >= 5} onClick={() => set(q.id, { questions: [...q.questions, blankQuestion()] })}>+ Thêm câu hỏi</button>
                    <span className="spacer" />
                    <button className="danger" onClick={() => { if (confirm(`Xóa quest "${q.title}"?`)) setList((l) => l!.filter((x) => x.id !== q.id)); }}>Xóa quest</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="toolbar">
        <button onClick={() => { const q: QuestDef = { id: newId("quest"), title: "Quest mới", blurb: "", enabled: false, questions: [blankQuestion(), blankQuestion(), blankQuestion()] }; setList((l) => [...l!, q]); setOpen(q.id); }}>+ Thêm quest</button>
        <button onClick={() => void reset()}>Về mặc định</button>
        <span className="spacer" />
        {check && !check.success && <span className="error">{check.error.issues[0]?.message}</span>}
        <button className="primary" disabled={!dirty || busy || !check?.success} onClick={() => void save()}>{busy ? "Đang lưu…" : dirty ? "Lưu thay đổi" : "Đã lưu"}</button>
      </div>
      {notice && <Notice {...notice} />}
    </section>
  );
}

function Notice({ ok, text, issues }: { ok: boolean; text: string; issues?: Issue[] }) {
  return <div className={ok ? "notice ok" : "notice error"} role="status"><b>{text}</b>{issues?.length ? <ul>{issues.map((i, n) => <li key={n}><code>{i.path || "—"}</code> {i.message}</li>)}</ul> : null}</div>;
}

/* ------------------------------------------------------------------ shell */

function App() {
  const [token, setToken] = useState(readToken);
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "live");
  const [storage, setStorage] = useState("");
  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);
  useEffect(() => {
    if (!token) return;
    call<{ storage: string }>(token, "GET", "/v1/admin/content")
      .then((d) => setStorage(d.storage))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) return;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* this tab only */ }
        setToken("");
      });
  }, [token]);
  if (!token) return <Login onToken={setToken} />;
  return (
    <div className="shell">
      <aside>
        <div className="brand"><b>TÊ LIỆT</b><small>QUẢN TRỊ HANG</small></div>
        <nav>
          {([["live", "Tổng quan"], ["videos", "Video màn hình"], ["quests", "Quest T1"]] as const).map(([id, label]) => (
            <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="foot">
          <small>Lưu ở: {storage === "postgres" ? "Postgres" : storage === "file" ? "tệp JSON trên máy chủ" : "—"}</small>
          <a href="/" target="_blank" rel="noreferrer">Mở game ↗</a>
          <button onClick={() => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ } setToken(""); }}>Đăng xuất</button>
        </div>
      </aside>
      <main>{tab === "live" ? <LiveTab token={token} /> : tab === "videos" ? <VideosTab token={token} /> : <QuestsTab token={token} />}</main>
    </div>
  );
}

createRoot(document.getElementById("admin")!).render(<StrictMode><App /></StrictMode>);
