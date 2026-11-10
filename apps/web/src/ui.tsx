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
import { ROOM_CAPACITY } from "@te-liet/shared";
import { StallPanel, RankPanel, ResidentHUD } from "./stalls/StallPanel.js";
import { CAVE_STALLS, CAVE_STALL_RADIUS, stallApproach, type CaveStallId } from "../../../packages/shared/src/stalls.js";
import { SHRINE_PORTAL } from "../../../packages/shared/src/shrine.js";
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
  /** Điểm tương tác ở gần (bấm E hoặc chạm nút để mở bảng). */
  prompt: { id: string; name: string } | null;
  /** API yêu cầu mã mời (close test): hiện ô nhập mã trong form vào hang. */
  needInvite: boolean;
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
  prompt: null,
  needInvite: false,
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
export type EmoteName = "wave" | "laugh" | "cheer";
/** Ba cảm xúc server nhận (Emote trong @te-liet/shared), theo thứ tự phím 1/2/3. */
export const EMOTES: readonly {
  id: EmoteName;
  key: string;
  icon: string;
  label: string;
}[] = [
  { id: "wave", key: "1", icon: "✋", label: "Chào" },
  { id: "laugh", key: "2", icon: "😆", label: "Cười trừ" },
  { id: "cheer", key: "3", icon: "🙌", label: "Cổ vũ" },
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
  /** Gửi chat: 0 khi đã gửi, nếu không thì số ms phải chờ (giới hạn tần suất của khách). */
  chat: (text: string) => number;
  emote: (name: EmoteName) => void;
  /** Mở bảng của điểm tương tác đang ở gần (như phím E). */
  interact: () => void;
  visit: (id: string) => void;
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
    const destination = s.destination === "altar" ? {id:"altar",name:"Điện thờ",...SHRINE_PORTAL} : CAVE_STALLS.find(stall=>stall.id===s.destination);
    const target = destination && (destination.id === "altar" ? destination : stallApproach(destination as (typeof CAVE_STALLS)[number]));
    const [name, setName] = useState("Người trong hang");
    const [invite, setInvite] = useState(initialInvite);
    return (
      <>
        <header>
          <div className="brand">
            TÊ LIỆT<span>HANG TRÚ THUA</span>
          </div>
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
        {!s.connected && (
          <section className="welcome">
            <p className="eyebrow">THUA THÌ VỀ HANG.</p>
            <h1>
              Ở đây,
              <br />
              không ai hỏi tỉ số.
            </h1>
            <p>
              Một đốm lửa. Vài người cùng cảnh.
              <br />
              Ngồi lại một chút rồi tính.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                actions.join(name, invite);
              }}
            >
              <label htmlFor="name">Tên trong hang</label>
              <input
                id="name"
                maxLength={24}
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
              <button disabled={s.busy}>
                {s.busy ? "Đang tìm chỗ…" : "Vào hang →"}
              </button>
            </form>
            <small aria-live="polite">{s.status}</small>
          </section>
        )}
        {s.connected && (
          <>
            <ResidentHUD />
            {destination && target && !s.panel && <div className="destination-hint"><b>↗ {destination.name}</b><span>Còn {Math.ceil(Math.hypot(s.position.x-target.x,s.position.z-target.z))} m · Đến vòng sáng rồi bấm E</span><button onClick={()=>ui.set({destination:null})}>Bỏ chỉ dẫn</button></div>}
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
            {s.position.x > 25 && !s.panel && <div className={s.shrineSeat ? "shrine-quick seated" : "shrine-quick"} role="group" aria-label="Thao tác điện thờ">
              {s.shrineSeat ? <><strong>Đang ngồi hướng về tượng</strong><button onClick={() => actions.shrine({action:"gesture",gesture:"pray"})}>🙏 Giơ tay cầu nguyện</button><button onClick={() => actions.shrine({action:"gesture",gesture:"bow"})}>Cúi lạy</button><button onClick={() => actions.shrine({action:"stand"})}>Đứng dậy</button></> : <><span>Chọn ghế đá còn trống</span>{s.nearbyShrineSeat && <button onClick={() => actions.shrine({action:"sit",seatId:s.nearbyShrineSeat!.id})}>Ngồi {s.nearbyShrineSeat.label}</button>}</>}
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
            </div>}
            <nav className="shortcuts" aria-label="Tiện ích trong hang">
              <button onClick={() => ui.set({ panel: "map" })}>⌖ Các sạp trong hang</button>
              <button onClick={() => ui.set({ panel: "rest" })}>Hạng · Nhân dạng</button>
              <button onClick={() => void actions.copyInvite()}>Mời bạn</button>
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
              aria-label={isStall ? CAVE_STALLS.find(stall=>stall.id===s.panel)!.name : s.panel === "map" ? "Các sạp trong hang" : s.panel === "rest" ? "Hạng và nhân dạng" : "Điện thờ"}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                autoFocus
                className="close"
                onClick={() => ui.set({ panel: null })}
              >
                Đóng ✕
              </button>
              {isStall ? <StallPanel id={s.panel as CaveStallId} onClose={()=>ui.set({panel:null})}/> : s.panel === "rest" ? <RankPanel onClose={()=>ui.set({panel:null})}/> : s.panel === "map" ? <>
                <p className="eyebrow">ĐI MỘT VÒNG QUANH HANG</p><h2>Gặp nhau ở sạp.</h2>
                <p className="map-intro">Mỗi sạp có một vòng sáng. Đi vào vòng rồi bấm E hoặc chạm nút để trò chuyện. Chọn một sạp bên dưới để theo dõi khoảng cách.</p>
                <div className="map-grid">{[...CAVE_STALLS.map(stall=>({...stall,...stallApproach(stall)})),{id:"altar",name:"ĐIỆN THỜ",npc:"Tượng Faker",...SHRINE_PORTAL}].map(stall=>{const distance=Math.hypot(s.position.x-stall.x,s.position.z-stall.z);return <button key={stall.id} onClick={()=>actions.visit(stall.id)}><b>{stall.name}</b><small>{stall.npc} · {Math.ceil(distance)} m</small><small>{distance <= (stall.id==='altar'?3:CAVE_STALL_RADIUS)?'Vào ngay →':'Chỉ đường →'}</small></button>;})}</div>
              </> : <ShrinePanel state={s.shrine} self={s.selfId} position={s.position} seated={s.shrineSeat} act={actions.shrine} />}

            </section>
          </div>
        )}
      </>
    );
  }
  createRoot(document.querySelector("#ui")!).render(<Overlay />);
}
