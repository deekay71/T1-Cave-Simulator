import { useEffect, useRef, useState } from 'react';
import type { ProgressionState } from '@te-liet/shared';
function endpoint() {
  const guest = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/v1/guest' : '/v1/guest');
  const url = new URL(guest, location.origin); url.pathname = url.pathname.replace(/\/guest\/?$/, '/progression'); url.search = ''; url.hash = '';
  return url.toString();
}
export function ProgressionPanel() {
  const [state, setState] = useState<ProgressionState | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const active = useRef(true); const lock = useRef(false);
  // Retain receipt key across a failed response, making an uncertain purchase safe to retry.
  const receipts = useRef(new Map<string, string>());
  useEffect(() => {
    active.current = true; const controller = new AbortController();
    fetch(endpoint(), { credentials: 'include', signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Chưa tải được tiến trình.');
      if (active.current) setState(body);
    }).catch(error => { if (!controller.signal.aborted && active.current) setNotice(error.message); });
    return () => { active.current = false; controller.abort(); };
  }, []);
  async function mutate(path: string, payload: object) {
    if (lock.current) return; lock.current = true; setBusy(true); setNotice('');
    try {
      const response = await fetch(`${endpoint()}/${path}`, { method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json', 'X-T1-Request':'1'}, body:JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Chưa hoàn tất, thử lại sau.');
      if (!active.current) return;
      setState(result.state ?? result);
      setNotice(path === 'equip' ? 'Đã lưu trang phục. Rời và vào lại hang để mọi người thấy bộ đồ mới.' : path === 'check-in' ? (result.claimed ? `Đã nhận ${result.reward} Xu Hang.` : 'Hôm nay bạn đã điểm danh.') : 'Vật phẩm đã nằm trong tủ đồ.');
    } catch (error) { if (active.current) setNotice(error instanceof Error ? error.message : 'Chưa hoàn tất.'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <div className="progression-panel">
    <p className="eyebrow">ĐIỂM DANH & TỦ ĐỒ</p><h2>Góc cư dân</h2>
    <p role="status">{notice || (!state ? 'Đang tải…' : '')}</p>
    {state && !state.enabled ? <p>Điểm danh và cửa hàng chưa mở. Tiến trình sẽ chỉ được lưu khi phiên khách bền vững được bật.</p> : state && !state.authenticated ? <p>Vào lại hang để tạo phiên cư dân trước khi điểm danh.</p> : state && <>
      <p><strong>{state.currency.balance} Xu Hang</strong> · Điểm trong game, không có giá trị tiền mặt.</p>
      <h3>Điểm danh hôm nay</h3><p>{state.daily.claimed ? 'Đã nhận phần thưởng hôm nay.' : `Nhận ${state.daily.reward} Xu Hang.`} Làm mới lúc 00:00 UTC (07:00 Việt Nam).</p>
      <button disabled={busy || state.daily.claimed} onClick={() => void mutate('check-in', {})}>{state.daily.claimed ? 'Đã điểm danh' : 'Nhận xu hôm nay'}</button>
      <h3>Cửa hàng đồ ảo</h3>
      <div className="cosmetic-grid">{state.catalog.map(item => {
        const owned = state.inventory.includes(item.id); const equipped = state.equippedItemId === item.id;
        return <article key={item.id}><h4>{item.name}</h4><p>{item.description}</p><small>{owned ? 'Đã sở hữu' : `${item.price} Xu Hang`}</small>
          <button disabled={busy || equipped || (!owned && state.currency.balance < item.price)} onClick={() => {
            if (owned) void mutate('equip', {itemId:item.id});
            else { const key = receipts.current.get(item.id) ?? crypto.randomUUID(); receipts.current.set(item.id,key); void mutate('purchase',{itemId:item.id,idempotencyKey:key}); }
          }}>{equipped ? 'Đang mặc' : owned ? 'Mặc bộ này' : 'Đổi bằng xu'}</button>
        </article>;
      })}</div>
      {state.equippedItemId && <button disabled={busy} onClick={() => void mutate('equip',{itemId:null})}>Về trang phục mặc định</button>}
    </>}
  </div>;
}
