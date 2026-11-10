import { SHRINE_SEATS } from '../../../../packages/shared/src/shrine.js';
export interface ShrineView { serverNow: number; seats: { id: string; occupant: string | null }[] }
export type ShrineAction = {action:'enter'|'exit'|'stand'} | {action:'sit';seatId:string} | {action:'gesture';gesture:'pray'|'bow'};
export function ShrinePanel({ state, self, position, seated, act }: {
  state: ShrineView | null; self:string; position:{x:number;z:number}; seated:string;
  act:(action:ShrineAction)=>void;
}) {
  const inside=position.x>25;
  return <div className="shrine-panel"><p className="eyebrow">ĐIỆN THỜ · KHÔNG GIAN ĐỒNG HÀNH</p><h2>Điện thờ Faker</h2>
    <p>Tượng low-poly tượng trưng do dự án tự dựng, không phải model chính thức hay bản sao chân dung.</p>
    {!inside ? <><p>Đi đến cửa có biển Điện thờ ở vách cuối hang, rồi vào điện thờ riêng. Chọn một ghế đá trên hai vòng đồng tâm hướng về tượng.</p><button onClick={()=>act({action:'enter'})}>Vào điện thờ</button></> : <>
      <p>Đi lại gần ghế còn trống rồi bấm ghế trong cảnh, hoặc chọn bên dưới. Ghế có người ngồi được giữ riêng bởi server.</p>
      <div className="shrine-seat-map">{[1,2].map(ring=><section key={ring}><h3>Vòng {ring}</h3><div>{SHRINE_SEATS.filter(s=>s.ring===ring).map(seat=>{
        const occupant=state?.seats.find(s=>s.id===seat.id)?.occupant;
        const mine=occupant===self;const near=Math.hypot(position.x-seat.x,position.z-seat.z)<=2;
        return <button key={seat.id} disabled={!state || !!occupant || !near || !!seated} title={!near?'Đi lại gần ghế này trong 2m':seat.label} onClick={()=>act({action:'sit',seatId:seat.id})}>{seat.label}{mine?' · Bạn':occupant?' · Có người':''}</button>;
      })}</div></section>)}</div>
      {seated && <div className="activity-buttons"><button onClick={()=>act({action:'gesture',gesture:'pray'})}>Giơ tay cầu nguyện</button><button onClick={()=>act({action:'gesture',gesture:'bow'})}>Cúi lạy</button><button onClick={()=>act({action:'stand'})}>Đứng dậy</button></div>}
      <button onClick={()=>act({action:'exit'})}>Về hang</button>
    </>}
    <small>Hoạt động giao lưu, không tác động đến kết quả thi đấu và không có đặt cược.</small>
  </div>;
}
