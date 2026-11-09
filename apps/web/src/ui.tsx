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

/** Một dòng trong nhật ký chat; id ổn định làm key React. */
export type ChatLine = { id: number; text: string; at: number };
type Snapshot = {
  connected: boolean;
  busy: boolean;
  status: string;
  count: number;
  messages: ChatLine[];
  panel: string | null;
  /** Điểm tương tác ở gần (bấm E hoặc chạm nút để mở bảng). */
  prompt: { id: string; name: string } | null;
};
let state: Snapshot = {
  connected: false,
  busy: false,
  status: "Trong hang vẫn còn chỗ cho anh.",
  count: 0,
  messages: [],
  panel: null,
  prompt: null,
};
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
    state = { ...state, ...patch };
    listeners.forEach((f) => f());
  },
  /** Thêm một dòng chat; gom lại, tối đa một lần cập nhật React mỗi khung hình. */
  log: (text: string) => {
    pendingLines.push({ id: ++lineId, text, at: Date.now() });
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
  join: (name: string) => void;
  /** Gửi chat: 0 khi đã gửi, nếu không thì số ms phải chờ (giới hạn tần suất của khách). */
  chat: (text: string) => number;
  emote: (name: EmoteName) => void;
  /** Mở bảng của điểm tương tác đang ở gần (như phím E). */
  interact: () => void;
  leave: () => void;
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
  open,
}: {
  messages: ChatLine[];
  open: boolean;
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
        aria-hidden="true"
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
  send,
}: {
  messages: ChatLine[];
  send: Actions["chat"];
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
      <ChatLog messages={messages} open={open} />
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
      const previous = document.activeElement as HTMLElement;
      return () => previous?.focus();
    }, [s.panel]);
    const [name, setName] = useState("Người trong hang");
    return (
      <>
        <header>
          <div className="brand">
            TÊ LIỆT<span>HANG TRÚ THUA</span>
          </div>
          <div className="header-right">
            <div className="presence">
              <i />
              {s.connected ? `${s.count}/30 cư dân` : "Bản chơi thử · v0.3"}
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
                actions.join(name);
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
              <button disabled={s.busy}>
                {s.busy ? "Đang tìm chỗ…" : "Vào hang →"}
              </button>
            </form>
            <small aria-live="polite">{s.status}</small>
          </section>
        )}
        {s.connected && (
          <>
            <Chat messages={s.messages} send={actions.chat} />
            {s.prompt && !s.panel && (
              <button
                className="prompt"
                onClick={(e) => {
                  releaseFocus(e);
                  actions.interact();
                }}
              >
                {!touch && <kbd>E</kbd>} Xem {s.prompt.name}
              </button>
            )}
            <div className="toolbar" role="group" aria-label="Cảm xúc">
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
            </div>
            <nav className="shortcuts" aria-label="Góc trong hang">
              <button
                onClick={(e) => {
                  releaseFocus(e);
                  ui.set({ panel: "memory" });
                }}
              >
                Vách ký ức
              </button>
              <button
                onClick={(e) => {
                  releaseFocus(e);
                  ui.set({ panel: "rest" });
                }}
              >
                Thâm niên
              </button>
            </nav>
            <div className="movement" role="group" aria-label="Di chuyển">
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
            </div>
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
                  "button,a[href],input",
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
              className="panel"
              role="dialog"
              aria-modal="true"
              aria-label={
                s.panel === "memory"
                  ? "Vách ký ức"
                  : s.panel === "rest"
                    ? "Góc thâm niên"
                    : "TV trú thua"
              }
              onClick={(e) => e.stopPropagation()}
            >
              <button
                autoFocus
                className="close"
                onClick={() => ui.set({ panel: null })}
              >
                Đóng ✕
              </button>
              {s.panel === "memory" ? (
                <>
                  <p className="eyebrow">NHỚ NGÀY CHƯA PHẢI VÀO HANG</p>
                  <h2>Vách ký ức</h2>
                  <p>2013 · 2015 · 2016 · 2023 · 2024 · 2025</p>
                  <p>
                    Những mùa Worlds đáng nhớ của đội nhà. Đôi khi nhìn lại cũng
                    đủ để ngồi thêm một lúc.
                  </p>
                  <a
                    href="https://www.korea.net/NewsFocus/Sports/view?articleId=281930"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Đọc nguồn lịch sử ↗
                  </a>
                  <small>
                    Bản đọc thử; chưa có quiz hoặc nội dung cộng đồng.
                  </small>
                </>
              ) : s.panel === "rest" ? (
                <>
                  <p className="eyebrow">CƯ DÂN LÂU NĂM</p>
                  <h2>Càng ở lâu, càng có chỗ nằm.</h2>
                  {[
                    "01 · Rách rưới",
                    "02 · Xe lăn",
                    "03 · Thở oxy",
                    "04 · Liệt giường",
                  ].map((t) => (
                    <p className="rank" key={t}>
                      {t}
                    </p>
                  ))}
                  <small>
                    Bốn hạng đang ngồi quanh lửa trại và nằm ở góc này. Bản thử
                    chọn ngẫu nhiên một trong 7 bộ đồ fan cho mỗi người; chưa
                    ghi tiến trình hoặc mở khóa thâm niên.
                  </small>
                </>
              ) : (
                <>
                  <h2>DEFEAT</h2>
                  <p>TV vẫn chiếu lại khoảnh khắc ấy.</p>
                  <small>
                    Góc minigame đang được xây dựng. Hiện có đi lại, chat và ba
                    cảm xúc (phím 1/2/3).
                  </small>
                </>
              )}
            </section>
          </div>
        )}
      </>
    );
  }
  createRoot(document.querySelector("#ui")!).render(<Overlay />);
}
