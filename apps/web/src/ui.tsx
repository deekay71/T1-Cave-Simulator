import React, {
  useSyncExternalStore,
  useState,
  useEffect,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
type Snapshot = {
  connected: boolean;
  busy: boolean;
  status: string;
  count: number;
  messages: string[];
  panel: string | null;
};
let state: Snapshot = {
  connected: false,
  busy: false,
  status: "Trong hang vẫn còn chỗ cho anh.",
  count: 0,
  messages: [],
  panel: null,
};
const listeners = new Set<() => void>();
export const ui = {
  get: () => state,
  set: (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((f) => f());
  },
  log: (text: string) => {
    ui.set({ messages: [...state.messages.slice(-39), text] });
  },
};
export type Actions = {
  join: (name: string) => void;
  chat: (text: string) => void;
  emote: () => void;
  leave: () => void;
  move: (key: string, down: boolean) => void;
};
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
    const [name, setName] = useState("Người trong hang"),
      [message, setMessage] = useState("");
    return (
      <>
        <header>
          <div className="brand">
            TÊ LIỆT<span>HANG TRÚ THUA</span>
          </div>
          <div className="presence">
            <i />
            {s.connected ? `${s.count}/30 cư dân` : "Bản chơi thử · v0.2"}
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
            <small>{s.status}</small>
          </section>
        )}
        {s.connected && (
          <>
            <section className="chat">
              <div className="chat-title">
                TIẾNG VỌNG TRONG HANG{" "}
                <button onClick={actions.leave} aria-label="Rời hang">
                  Rời hang
                </button>
              </div>
              <div className="messages" role="log" aria-live="polite">
                {s.messages.length ? (
                  s.messages.map((m, i) => <p key={i}>{m}</p>)
                ) : (
                  <p className="muted">Chào một câu, bớt cô đơn.</p>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (message.trim()) {
                    actions.chat(message);
                    setMessage("");
                  }
                }}
              >
                <input
                  aria-label="Tin nhắn"
                  placeholder="Nói gì với cả hang…"
                  value={message}
                  maxLength={240}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button>Gửi</button>
              </form>
            </section>
            <div className="toolbar">
              <button onClick={actions.emote}>✋ Chào đồng cảnh</button>
              <button onClick={() => ui.set({ panel: "memory" })}>
                Vách ký ức
              </button>
              <button onClick={() => ui.set({ panel: "rest" })}>
                Thâm niên
              </button>
            </div>
            <div className="movement">
              {["w", "a", "s", "d"].map((k) => (
                <button
                  key={k}
                  aria-label={`Đi ${k.toUpperCase()}`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    actions.move(k, true);
                  }}
                  onPointerUp={() => actions.move(k, false)}
                  onPointerCancel={() => actions.move(k, false)}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </>
        )}
        <footer>
          {s.connected
            ? s.status
            : "WASD / phím mũi tên để đi · E tương tác khi ở gần"}
          <span>
            Low-poly social hub · Không phải sản phẩm chính thức của T1
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
                s.panel === "memory" ? "Vách ký ức" : "Góc trong hang"
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
                    Những mùa Worlds ghi dấu trong lịch sử SKT T1 / T1. Đôi khi
                    nhìn lại cũng đủ để ngồi thêm một lúc.
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
                    Đây là thiết kế thâm niên. Bản thử hiện dùng avatar Rách
                    rưới; chưa ghi tiến trình hoặc mở khóa skin.
                  </small>
                </>
              ) : (
                <>
                  <h2>DEFEAT</h2>
                  <p>TV vẫn chiếu lại khoảnh khắc ấy.</p>
                  <small>
                    Góc minigame đang được xây dựng. Hiện có đi lại, chat và
                    emote.
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
