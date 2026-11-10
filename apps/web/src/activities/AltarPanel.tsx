import { useEffect, useState } from 'react';
export interface AltarView {
  phase: 'idle' | 'running' | 'completed';
  serverNow: number; endsAt: number | null; participantCount: number;
  participants: { sessionId: string; preset: string }[];
  completedSessionIds: string[];
}
export function AltarPanel({ state, self, badge, act }: {
  state: AltarView | null; self: string; badge: boolean;
  act: (action: 'join' | 'leave', preset?: 'prayer' | 'cheer') => void;
}) {
  const [now, setNow] = useState(Date.now);
  const [offset, setOffset] = useState(0);
  useEffect(() => { if (state) setOffset(state.serverNow - Date.now()); }, [state]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const joined = !!state?.participants.some(p => p.sessionId === self);
  const seconds = Math.max(0, Math.ceil(((state?.endsAt ?? 0) - now - offset) / 1000));
  return <div className="altar-panel">
    <p className="eyebrow">CÙNG Ở LẠI · 30 GIÂY</p><h2>Tế đàn đồng hành</h2>
    <p>Đến vòng sáng cạnh lửa trại (bên phải), chọn lời cổ vũ và ở gần tế đàn đến hết lượt. Một mình vẫn có thể tham gia.</p>
    <p>Hoạt động gắn kết của fan, không tác động đến kết quả trận đấu.</p>
    <div role="status" aria-live="polite">
      {!state ? <p>Đang đồng bộ hoạt động…</p> : state.phase === 'running'
        ? <p><strong>{state.participantCount} người đang đồng hành</strong> · Còn {seconds}s</p>
        : state.phase === 'completed' ? <p>Đã kết thúc lượt. {state.completedSessionIds.includes(self) ? 'Bạn đã hoàn thành cùng mọi người!' : 'Lượt mới sắp bắt đầu.'}</p>
        : <p>Tế đàn đang chờ bạn mở lượt mới.</p>}
      {badge && <p>✦ Bạn đã nhận dấu ấn đồng hành trong phiên này.</p>}
    </div>
    {state && state.phase !== 'completed' && <div className="activity-buttons">
      {!joined ? <><button onClick={() => act('join', 'prayer')}>Cầu nguyện bình an</button><button onClick={() => act('join', 'cheer')}>Cùng cổ vũ T1</button></> : <button onClick={() => act('leave')}>Rời lượt đồng hành</button>}
    </div>}
    <small>Rời khu vực hoặc mất kết nối sẽ rời lượt. Dấu ấn hiện chỉ lưu trong phiên chơi, chưa cộng tiền hoặc vật phẩm.</small>
  </div>;
}
