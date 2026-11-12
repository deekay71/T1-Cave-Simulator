import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { HUB_LANDMARKS, ROOM_CAPACITY, SCREEN_SPOT } from "@te-liet/shared";
import { loadDone } from "./stalls/quests.js";
import { content, offContent } from "./content/api.js";
import { StallPanel, RankPanel, ResidentHUD } from "./stalls/StallPanel.js";
import { CAVE_STALLS, CAVE_STALL_RADIUS, stallApproach, type CaveStallId } from "../../../packages/shared/src/stalls.js";
import { SHRINE_PORTAL, isInShrine } from "../../../packages/shared/src/shrine.js";
import { ShrinePanel, type ShrineView, type ShrineAction } from "./activities/ShrinePanel.js";
import { AltarPanel, type AltarView } from "./activities/AltarPanel.js";
import { MatchPanel } from "./matches/MatchPanel.js";

/** Một dòng trong nhật ký chat; id ổn định làm key React. */
export type ChatLine = { id: number; text: string; at: number; messageId?: string; senderId?: string };
type Snapshot = {
  connected: boolean;
  selfId: string;
  altar: AltarView | null;
  altarBadge: boolean;
  shrine: ShrineView | null; shrineSeat: string; position: {x:number;z:number};
  nearbyShrineSeat: {id:string;label:string} | null;
  busy: boolean;
  status: string;
  count: number;
  messages: ChatLine[];
  panel: string | null;
  destination: string | null;
  /** Nhân vật đang tự đi tới `destination`. */
  autoWalk: boolean;
  /** Chỗ ngồi trong hang: đang ngồi, có ghế trống trong tầm với, hoặc không. */
  seat: "seated" | "near" | null;
  /** Audio khi vào điện thờ: không có tệp, đang bật, hoặc người chơi đã tắt. */
  shrineAudio: "none" | "on" | "muted";
  /** Tiếng clip trên màn hình lớn: không có clip / tắt / bật. */
  screenSound: "none" | "off" | "on";
  /** Điểm tương tác ở gần (bấm E hoặc chạm nút để mở bảng). */
  prompt: { id: string; name: string } | null;
  /** API yêu cầu mã mời (close test): hiện ô nhập mã trong form vào hang. */
  needInvite: boolean;
  /** Thông báo dưới nút đăng nhập (ví dụ: Google chưa mở). */
  loginNotice: string;
};
let state: Snapshot = {
  connected: false,
  selfId: "", altar: null, altarBadge: false,
  shrine: null, shrineSeat: "", position: {x:0,z:10}, nearbyShrineSeat: null,
  busy: false,
  status: "Trong hang vẫn còn chỗ cho bạn.",
  count: 0,
  messages: [],
  panel: null,
  destination: null,
  autoWalk: false,
  seat: null,
  shrineAudio: "none",
  screenSound: "none",
  prompt: null,
  needInvite: false,
  loginNotice: "",
};

/**
 * Mã mời close test: lấy từ link (?invite=…, rồi xóa khỏi thanh địa chỉ) hoặc lần nhập trước.
 * localStorage chỉ để tiện, lỗi hay trống thì người chơi nhập lại.
 */
const INVITE_KEY = "te-liet.invite";
function initialInvite(): string {
  let code = "";
  try {
    const url = new URL(location.href);
    code = url.searchParams.get("invite")?.trim() ?? "";
    if (code) {
      url.searchParams.delete("invite");
      history.replaceState(null, "", url);
    }
  } catch {
    /* URL lạ: bỏ qua */
  }
  try {
    if (code) localStorage.setItem(INVITE_KEY, code);
    else code = localStorage.getItem(INVITE_KEY) ?? "";
  } catch {
    /* trình duyệt chặn bộ nhớ */
  }
  return code.slice(0, 64);
}
export function rememberInvite(code: string) {
  try {
    if (code) localStorage.setItem(INVITE_KEY, code);
    else localStorage.removeItem(INVITE_KEY);
  } catch {
    /* bỏ qua */
  }
}
let panelTrigger: HTMLElement | null = null;
const listeners = new Set<() => void>();
/** Số dòng chat giữ lại. */
const MAX_LINES = 40;
let lineId = 0;
let pendingLines: ChatLine[] = [];
let flushQueued = false;
function flushLines() {
  flushQueued = false;
  if (!pendingLines.length) return;
  const next = state.messages.concat(pendingLines).slice(-MAX_LINES);
  pendingLines = [];
  ui.set({ messages: next });
}
export const ui = {
  get: () => state,
  set: (patch: Partial<Snapshot>) => {
    if (patch.panel && !state.panel) {
      const focused = document.activeElement;
      panelTrigger = focused instanceof HTMLElement && focused !== document.body
        ? focused : document.querySelector<HTMLElement>('.prompt, .shortcuts button');
    }
    state = { ...state, ...patch };
    listeners.forEach((f) => f());
  },
  removeSender: (senderId: string) => {
    pendingLines = pendingLines.filter(m => m.senderId !== senderId);
    ui.set({ messages: state.messages.filter(m => m.senderId !== senderId) });
  },
  /** Thêm một dòng chat; gom lại, tối đa một lần cập nhật React mỗi khung hình. */
  log: (text: string, meta: { messageId?: string; senderId?: string } = {}) => {
    pendingLines.push({ id: ++lineId, text, at: Date.now(), ...meta });
    if (pendingLines.length > MAX_LINES)
      pendingLines.splice(0, pendingLines.length - MAX_LINES);
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(flushLines);
  },
};
export type EmoteName = "wave" | "laugh" | "cheer" | "jump";
/** Ba cảm xúc server nhận (Emote trong @te-liet/shared), theo thứ tự phím 1/2/3. */
/** Màu chấm của từng điểm trong box "Gần đây" (trùng màu mũi tên trong cảnh). */
const SPOT_COLORS: Record<string, string> = { altar: "#F2C76B", screen: "#8FB8F2", rest: "#D8C7B0" };
const spotColor = (id: string) => CAVE_STALLS.find((stall) => stall.id === id)?.accent ?? SPOT_COLORS[id] ?? "#E8DCCB";
/**
 * Box gọn dưới thẻ cư dân: đích đang chỉ đường (nếu có), ba điểm tương tác gần nhất kèm khoảng cách
 * (bấm là nhân vật tự đi tới), và tiến độ quest T1.
 */
function NearbyBox({ position, destination, autoWalk, visit }: {
  position: { x: number; z: number };
  destination: { id: string; name: string; x: number; z: number } | null;
  autoWalk: boolean;
  visit: (id: string) => void;
}) {
  const [quests, setQuests] = useState(() => ({ done: loadDone(undefined, content().quests).length, total: content().quests.length }));
  useEffect(() => {
    const count = () => setQuests({ done: loadDone(undefined, content().quests).length, total: content().quests.length });
    count();
    const on = () => count();
    content(on);
    return () => offContent(on);
  }, [destination?.id]);
  const far = (p: { x: number; z: number }) => Math.ceil(Math.hypot(position.x - p.x, position.z - p.z));
  const near = HUB_LANDMARKS.filter((l) => l.id !== destination?.id)
    .map((l) => ({ ...l, d: far(l) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  return (
    <aside className="nearby" aria-label="Điểm gần đây và quest">
      {destination && (
        <div className="nearby-goal">
          <i style={{ background: spotColor(destination.id) }} />
          <div><b>{destination.name}</b><small>{far(destination)} m · {autoWalk ? "đang tự đi" : "theo mũi tên"}</small></div>
          <button onClick={() => ui.set({ destination: null })} aria-label="Bỏ chỉ dẫn">✕</button>
        </div>
      )}
      <header><span>Gần đây</span><button onClick={() => visit("quest")} title="Tới Hang Quest">Quest T1 {quests.done}/{quests.total}</button></header>
      <ul>
        {near.map((l) => (
          <li key={l.id}><button onClick={() => visit(l.id)} title="Tự đi tới đây"><i style={{ background: spotColor(l.id) }} /><span>{l.name}</span><small>{l.d} m</small></button></li>
        ))}
      </ul>
    </aside>
  );
}

export const EMOTES: readonly {
  id: EmoteName;
  key: string;
  icon: string;
  label: string;
}[] = [
  { id: "wave", key: "1", icon: "✋", label: "Chào" },
  { id: "laugh", key: "2", icon: "😆", label: "Cười trừ" },
  { id: "cheer", key: "3", icon: "🙌", label: "Cổ vũ" },
  { id: "jump", key: "4", icon: "⤴", label: "Nhảy" },
];
/** Màn hình cảm ứng (ngón tay là con trỏ chính): không có phím E / 1 / 2 / 3. */
export const touch =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** Hướng dẫn điều khiển (chân trang khi không có việc gì đặc biệt). */
export const CONTROLS_HELP = touch
  ? "Nút W A S D để đi · Vuốt để xoay · Chụm hai ngón để zoom · Chạm nút sáng để tương tác"
  : "WASD đi theo hướng camera · Kéo chuột xoay · Cuộn để zoom · E tương tác · 1/2/3 cảm xúc · Enter để chat";
const MOVES: readonly [key: string, label: string][] = [
  ["w", "Đi tới"],
  ["a", "Sang trái"],
  ["s", "Lùi lại"],
  ["d", "Sang phải"],
];
export type Actions = {
  join: (name: string, invite: string) => void;
  /** Nút Google ở màn đăng nhập. Chưa có đăng nhập Google thật: chỉ báo qua ui.loginNotice. */
  google: () => void;
  /** Gửi chat: 0 khi đã gửi, nếu không thì số ms phải chờ (giới hạn tần suất của khách). */
  chat: (text: string) => number;
  emote: (name: EmoteName) => void;
  /** Mở bảng của điểm tương tác đang ở gần (như phím E). */
  interact: () => void;
  visit: (id: string) => void;
  /** Ngồi xuống ghế gần nhất / đứng dậy. */
  seat: () => void;
  /** Bật / tắt audio điện thờ (chỉ mình nghe). */
  toggleShrineAudio: () => void;
  /** Bật / tắt tiếng clip trên màn hình lớn (chỉ mình nghe). */
  toggleScreenSound: () => void;
  leave: () => void;
  copyInvite: () => Promise<void>;
  report: (messageId: string, reason: string) => void;
  mute: (senderId: string) => void;
  shrine: (request: ShrineAction) => void;
  altar: (action: "join" | "leave", preset?: "prayer" | "cheer") => void;
  move: (key: string, down: boolean) => void;
};

let chatInput: HTMLInputElement | null = null;
/** Đưa con trỏ vào ô chat (phím Enter trong hang); false khi chưa có ô chat. */
export function focusChat(): boolean {
  if (!chatInput) return false;
  chatInput.focus();
  return true;
}

/** Bỏ focus khỏi nút vừa bấm bằng chuột / ngón tay để phím trong game không kích hoạt lại nó. */
const releaseFocus = (e: MouseEvent<HTMLElement>) => {
  if (e.detail > 0) e.currentTarget.blur();
};

/** Thu gọn: tối đa ngần này dòng mới nhất, mỗi dòng mờ dần rồi ẩn sau LINE_SHOW_MS. */
const VISIBLE_LINES = 4;
const LINE_SHOW_MS = 12_000;
const LINE_FADE_MS = 900;

/**
 * Nhật ký chat. Thu gọn (mặc định): vài dòng mới nhất trên nền trong suốt, tự mờ đi; mở (đang gõ
 * hoặc rê chuột vào): toàn bộ lịch sử, cuộn được. Trình đọc màn hình đọc một bản log ẩn riêng nên
 * việc thu gọn / mở không đọc lại các dòng cũ.
 */
const ChatLog = memo(function ChatLog({
  messages,
  open, report, mute,
}: {
  messages: ChatLine[];
  open: boolean;
  report: Actions["report"]; mute: Actions["mute"];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const [, setTick] = useState(0);
  const now = Date.now();
  // thu gọn: vẽ lại đúng lúc dòng kế tiếp bắt đầu mờ hoặc biến mất
  useEffect(() => {
    if (open) return;
    let next = Infinity;
    for (const m of messages.slice(-VISIBLE_LINES))
      for (const edge of [
        m.at + LINE_SHOW_MS - LINE_FADE_MS,
        m.at + LINE_SHOW_MS,
      ])
        if (edge > now && edge < next) next = edge;
    if (next === Infinity) return;
    const id = setTimeout(() => setTick((n) => n + 1), next - now + 20);
    return () => clearTimeout(id);
  });
  // tự cuộn xuống dòng mới, trừ khi người chơi đang cuộn lên đọc lại
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (stickToEnd.current || !open)) el.scrollTop = el.scrollHeight;
  }, [messages, open]);
  const lines = open
    ? messages
    : messages.slice(-VISIBLE_LINES).filter((m) => now - m.at < LINE_SHOW_MS);
  return (
    <>
      <div className="sr-only" role="log" aria-label="Tin nhắn trong hang">
        {messages.map((m) => (
          <p key={m.id}>{m.text}</p>
        ))}
      </div>
      <div
        className="messages"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToEnd.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.map((m) => (
          <p
            key={m.id}
            className={
              !open && now - m.at > LINE_SHOW_MS - LINE_FADE_MS
                ? "fading"
                : undefined
            }
          >
            {m.text}
            {open && m.messageId && m.senderId && m.senderId !== state.selfId && <span className="chat-actions">
              <button title="Ẩn tin của người này trong phiên hiện tại" onClick={() => mute(m.senderId!)}>Ẩn</button>
              <button onClick={() => report(m.messageId!, "Nội dung chat không phù hợp")}>Báo cáo</button>
            </span>}
          </p>
        ))}
        {open && !messages.length && (
          <p className="muted">Chào một câu, bớt cô đơn.</p>
        )}
      </div>
    </>
  );
});

function Chat({
  messages,
  send, report, mute,
}: {
  messages: ChatLine[];
  send: Actions["chat"];
  report: Actions["report"]; mute: Actions["mute"];
}) {
  const [typing, setTyping] = useState(false);
  const [hover, setHover] = useState(false);
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    chatInput = inputRef.current;
    return () => {
      chatInput = null;
    };
  }, []);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(id);
  }, [hint]);
  const open = typing || hover;
  return (
    <section
      className={open ? "chat open" : "chat"}
      aria-label="Tiếng vọng trong hang"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div className="chat-title" aria-hidden="true">
        TIẾNG VỌNG TRONG HANG
      </div>
      <ChatLog messages={messages} open={open} report={report} mute={mute} />
      {hint && (
        <p className="chat-hint" role="status">
          {hint}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = message.trim();
          if (!text) {
            inputRef.current?.blur(); // Enter trống: quay lại đi lại
            return;
          }
          const wait = send(text);
          if (wait > 0) {
            setHint(
              `Nói chậm lại chút… gửi lại được sau ${Math.ceil(wait / 1000)} giây.`,
            );
            return;
          }
          setMessage("");
          setHint(null);
          inputRef.current?.blur(); // gửi xong: WASD lại điều khiển nhân vật
        }}
      >
        <input
          ref={inputRef}
          aria-label="Tin nhắn"
          placeholder={
            touch || window.innerWidth <= 700
              ? "Nhắn cả hang…"
              : "Enter để nói với cả hang…"
          }
          value={message}
          maxLength={240}
          enterKeyHint="send"
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
        />
        <button>Gửi</button>
      </form>
    </section>
  );
}

/** Rời hang cần bấm hai lần (trong 3 giây), tránh chạm nhầm trên điện thoại. */
function LeaveButton({ leave }: { leave: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      className={armed ? "leave armed" : "leave"}
      onClick={(e) => {
        if (armed) leave();
        else {
          setArmed(true);
          releaseFocus(e);
        }
      }}
    >
      {armed ? "Bấm lần nữa để rời" : "Rời hang"}
    </button>
  );
}

/** Chữ G bốn màu, vẽ tay bằng bốn cung tròn và một thanh ngang. */
function GoogleMark() {
  return (
    <svg className="slab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" strokeWidth="4.2">
      <path d="M18.8 7.24A8.3 8.3 0 0 0 4.81 7.85" stroke="#EA4335" />
      <path d="M4.81 7.85A8.3 8.3 0 0 0 5.2 16.76" stroke="#FBBC05" />
      <path d="M5.2 16.76A8.3 8.3 0 0 0 18.8 16.76" stroke="#34A853" />
      <path d="M18.8 16.76A8.3 8.3 0 0 0 20.3 12" stroke="#4285F4" />
      <path d="M12 12H21.6" stroke="#4285F4" />
    </svg>
  );
}
function GamepadIcon() {
  return (
    <svg className="slab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M7.2 6h9.6c2.5 0 4.2 1.7 4.7 4.3l.9 5.1c.3 1.9-.8 3.3-2.4 3.3-1 0-1.8-.5-2.5-1.3L16.2 16H7.8l-1.3 1.4c-.7.8-1.5 1.3-2.5 1.3-1.6 0-2.7-1.4-2.4-3.3l.9-5.1C3 7.7 4.7 6 7.2 6zM7 9v1.6H5.4v1.8H7V14h1.8v-1.6h1.6v-1.8H8.8V9zM15.3 12.7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM17.8 9.7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"
      />
    </svg>
  );
}

/**
 * Màn đăng nhập (design/concepts/login-low-poly): tựa game bằng chữ + CSS, hai phiến nút. "Chơi thử"
 * mở ngay tại chỗ bước nhập tên (và mã mời khi API đòi) rồi vào hang như trước; "Google" chưa có
 * đăng nhập thật nên chỉ gọi actions.google() để hiện thông báo. Luôn được gắn (ẩn khi đã vào hang)
 * để tên, mã mời và bước đang mở còn nguyên khi rời hang quay lại.
 */
function LoginPanel({ s, actions }: { s: Snapshot; actions: Actions }) {
  const [name, setName] = useState("Người trong hang");
  const [invite, setInvite] = useState(initialInvite);
  const [guest, setGuest] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const guestRef = useRef<HTMLButtonElement>(null);
  const wasGuest = useRef(false);
  // mở bước nhập tên: con trỏ vào ô tên (chọn sẵn chữ); quay lại: focus về nút Chơi thử
  useEffect(() => {
    if (guest) {
      nameRef.current?.focus();
      nameRef.current?.select();
    } else if (wasGuest.current) guestRef.current?.focus();
    wasGuest.current = guest;
  }, [guest]);
  if (s.connected) return null;
  return (
    <section className={guest ? "login guest" : "login"} aria-labelledby="login-title">
      <h1 id="login-title" className="login-title">
        <span className="login-title-main">Tê Liệt</span>
        <span className="login-title-sub">Cave Simulator</span>
        <svg className="login-brush" viewBox="0 0 300 30" aria-hidden="true" focusable="false">
          <path d="M6 15 C60 5 150 2 292 8 C230 8 150 11 96 17 C150 14 220 14 262 17 C190 17 120 21 62 27 C96 20 60 19 6 15Z" />
          <path d="M20 24 C70 17 120 15 176 15 C130 19 80 23 34 29Z" />
        </svg>
      </h1>
      {guest ? (
        <form
          className="login-guest"
          onSubmit={(e) => {
            e.preventDefault();
            actions.join(name, invite);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape" || s.busy) return;
            e.stopPropagation();
            setGuest(false);
          }}
        >
          <label htmlFor="name">Tên trong hang</label>
          <input
            ref={nameRef}
            id="name"
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="go"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {(s.needInvite || invite !== "") && (
            <>
              <label htmlFor="invite">Mã mời</label>
              <input
                id="invite"
                maxLength={64}
                autoComplete="off"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                required={s.needInvite}
              />
            </>
          )}
          <button className="slab slab-crimson" disabled={s.busy}>
            <span>{s.busy ? "Đang tìm chỗ…" : "Vào hang →"}</span>
          </button>
          <button type="button" className="login-back" disabled={s.busy} onClick={() => setGuest(false)}>
            ← Quay lại
          </button>
        </form>
      ) : (
        <div className="login-actions">
          <button type="button" className="slab slab-stone" aria-describedby="login-notice" onClick={actions.google}>
            <GoogleMark />
            <span>Google</span>
            <span className="slab-tag">Sắp có</span>
          </button>
          <button
            ref={guestRef}
            type="button"
            className="slab slab-crimson"
            onClick={() => {
              ui.set({ loginNotice: "" });
              setGuest(true);
            }}
          >
            <GamepadIcon />
            <span>Chơi thử</span>
          </button>
        </div>
      )}
      <p id="login-notice" className="login-notice" role="status" aria-live="polite">
        {guest ? "" : s.loginNotice}
      </p>
      <small aria-live="polite">{s.status}</small>
    </section>
  );
}

export function mountUI(actions: Actions) {
  function Overlay() {
    const s = useSyncExternalStore((cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }, ui.get);
    const panelRef = useRef<HTMLElement>(null);
    useEffect(() => {
      if (!s.panel) return;
      const previous = panelTrigger;
      panelRef.current?.querySelector<HTMLButtonElement>(".close")?.focus();
      return () => { if (previous?.isConnected) previous.focus(); };
    }, [s.panel]);
    const isStall = CAVE_STALLS.some(stall => stall.id === s.panel);
    const destination = s.destination === "altar" ? {id:"altar",name:"Điện thờ",...SHRINE_PORTAL} : s.destination === "screen" ? {id:"screen",name:"Màn hình lớn",...SCREEN_SPOT} : CAVE_STALLS.find(stall=>stall.id===s.destination);
    const target = destination && (destination.id === "altar" || destination.id === "screen" ? destination : stallApproach(destination as (typeof CAVE_STALLS)[number]));
    return (
      <>
        <header className={s.connected ? undefined : "at-login"}>
          {s.connected ? (
            <div className="brand">
              TÊ LIỆT<span>HANG TRÚ THUA</span>
            </div>
          ) : (
            <span />
          )}
          <div className="header-right">
            <div className="presence">
              <i />
              {s.connected
                ? `${s.count}/${ROOM_CAPACITY} cư dân`
                : "Bản chơi thử · v0.3"}
            </div>
            {s.connected && <LeaveButton leave={actions.leave} />}
          </div>
        </header>
        <LoginPanel s={s} actions={actions} />
        {s.connected && (
          <>
            <ResidentHUD />
            {isInShrine(s.position) && s.shrineAudio !== "none" && <button className="shrine-audio" onClick={() => actions.toggleShrineAudio()} aria-pressed={s.shrineAudio === "on"} title="Chỉ bạn nghe thấy">{s.shrineAudio === "on" ? "🔊 Bình luận pha Zed · Tắt" : "🔇 Bình luận pha Zed · Bật"}</button>}
            {!s.panel && !isInShrine(s.position) && <NearbyBox position={s.position} destination={destination && target ? { id: destination.id, name: destination.name, x: target.x, z: target.z } : null} autoWalk={s.autoWalk} visit={actions.visit} />}
            <Chat messages={s.messages} send={actions.chat} report={actions.report} mute={actions.mute} />
            {s.prompt && !s.panel && (
              <button
                className="prompt"
                onClick={(e) => {
                  releaseFocus(e);
                  actions.interact();
                }}
              >
                {!touch && <kbd>E</kbd>} Vào {s.prompt.name}
              </button>
            )}
            {isInShrine(s.position) && !s.panel && <div className={s.shrineSeat ? "shrine-quick seated" : "shrine-quick"} role="group" aria-label="Thao tác điện thờ">
              {s.shrineSeat ? <><strong>Cả điện thờ cùng cúi lạy rồi giơ tay cầu nguyện</strong><button onClick={() => actions.shrine({action:"stand"})}>Đứng dậy</button></> : <><span>Chọn ghế đá còn trống</span>{s.nearbyShrineSeat && <button onClick={() => actions.shrine({action:"sit",seatId:s.nearbyShrineSeat!.id})}>Ngồi {s.nearbyShrineSeat.label}</button>}</>}
              <button onClick={() => actions.shrine({action:"exit"})}>Về hang</button>
            </div>}
            {!s.shrineSeat && <div className="toolbar" role="group" aria-label="Cảm xúc">
              {EMOTES.map((e) => (
                <button
                  key={e.id}
                  onClick={(ev) => {
                    releaseFocus(ev);
                    actions.emote(e.id);
                  }}
                  title={touch ? e.label : `Phím ${e.key}`}
                >
                  {!touch && <kbd>{e.key}</kbd>} {e.icon} {e.label}
                </button>
              ))}
              {s.seat && <button className="seat-toggle" onClick={() => actions.seat()} title={touch ? undefined : "Phím F"}>{!touch && <kbd>F</kbd>} 🪑 {s.seat === "seated" ? "Đứng dậy" : "Ngồi"}</button>}
            </div>}
            <nav className="shortcuts" aria-label="Tiện ích trong hang">
              <button onClick={() => ui.set({ panel: "map" })}>⌖ Các sạp trong hang</button>
              <button onClick={() => ui.set({ panel: "rest" })}>Hạng · Nhân dạng</button>
              <button onClick={() => void actions.copyInvite()}>Mời bạn</button>
              {s.screenSound !== "none" && !isInShrine(s.position) && <button className={s.screenSound === "on" ? "screen-sound on" : "screen-sound"} aria-pressed={s.screenSound === "on"} onClick={() => actions.toggleScreenSound()} title="Tiếng clip trên màn hình lớn, chỉ bạn nghe">{s.screenSound === "on" ? "🔊 Tiếng màn hình" : "🔇 Tiếng màn hình"}</button>}
            </nav>
            {!s.shrineSeat && <div className="movement" role="group" aria-label="Di chuyển">
              {MOVES.map(([k, label]) => (
                <button
                  key={k}
                  className={`move-${k}`}
                  aria-label={label}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    actions.move(k, true);
                  }}
                  onPointerUp={() => actions.move(k, false)}
                  onPointerCancel={() => actions.move(k, false)}
                  onLostPointerCapture={() => actions.move(k, false)}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>}
          </>
        )}
        <footer>
          {s.connected ? s.status : CONTROLS_HELP}
          <span>
            Bản chơi thử · Dự án của fan, không phải sản phẩm chính thức
          </span>
        </footer>
        {s.panel && (
          <div
            className="modal-backdrop"
            onClick={() => ui.set({ panel: null })}
          >
            <section
              ref={panelRef}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  ui.set({ panel: null });
                  return;
                }
                if (e.key !== "Tab") return;
                const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]):not([tabindex="-1"]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe',
                );
                if (!nodes?.length) return;
                const first = nodes[0],
                  last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }}
              className={isStall ? "panel stall-dialog" : "panel"}
              role="dialog"
              aria-modal="true"
              aria-label={isStall ? CAVE_STALLS.find(stall=>stall.id===s.panel)!.name : s.panel === "map" ? "Các sạp trong hang" : s.panel === "rest" ? "Hạng và nhân dạng" : s.panel === "screen" ? "Lịch đấu T1" : "Điện thờ"}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                autoFocus
                className="close"
                onClick={() => ui.set({ panel: null })}
              >
                Đóng ✕
              </button>
              {isStall ? <StallPanel id={s.panel as CaveStallId} onClose={()=>ui.set({panel:null})} onVisit={actions.visit}/> : s.panel === "screen" ? <div className="screen-panel"><p className="eyebrow">MÀN HÌNH LỚN · HANG LỚN</p><h2>Lịch đấu T1</h2><MatchPanel/></div> : s.panel === "rest" ? <RankPanel onClose={()=>ui.set({panel:null})}/> : s.panel === "map" ? <>
                <p className="eyebrow">ĐI MỘT VÒNG QUANH HANG</p><h2>Gặp nhau ở sạp.</h2>
                <p className="map-intro">Mỗi sạp có một vòng sáng. Đi vào vòng rồi bấm E hoặc chạm nút để trò chuyện. Chọn một sạp bên dưới để theo dõi khoảng cách.</p>
                <div className="map-grid">{[...CAVE_STALLS.map(stall=>({...stall,...stallApproach(stall)})),{id:"altar",name:"ĐIỆN THỜ",npc:"Tượng Faker",...SHRINE_PORTAL},{id:"screen",name:"MÀN HÌNH LỚN",npc:"Lịch đấu T1",...SCREEN_SPOT}].map(stall=>{const distance=Math.hypot(s.position.x-stall.x,s.position.z-stall.z);return <button key={stall.id} onClick={()=>actions.visit(stall.id)}><b>{stall.name}</b><small>{stall.npc} · {Math.ceil(distance)} m</small><small>{distance <= (stall.id==='altar'||stall.id==='screen'?3:CAVE_STALL_RADIUS)?'Vào ngay →':'Chỉ đường →'}</small></button>;})}</div>
              </> : <ShrinePanel state={s.shrine} self={s.selfId} position={s.position} seated={s.shrineSeat} act={actions.shrine} />}

            </section>
          </div>
        )}
      </>
    );
  }
  createRoot(document.querySelector("#ui")!).render(<Overlay />);
}
