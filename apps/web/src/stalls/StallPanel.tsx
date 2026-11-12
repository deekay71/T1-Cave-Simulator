import { useEffect, useState, useSyncExternalStore } from 'react';
import { RANKS, dailyReward, type CosmeticItem, type ProgressionState } from '@te-liet/shared';
import { CAVE_STALLS, type CaveStallId } from '../../../../packages/shared/src/stalls.js';
import { resident } from './client.js';
import { TITLES, gradeQuest, loadDone, saveDone, type Quest } from './quests.js';
import { content, offContent } from '../content/api.js';
import type { ContentDoc } from '@te-liet/shared';
import './stalls.css';

export function useResident(){return useSyncExternalStore(resident.subscribe,resident.get);}
export function ResidentHUD(){
  const s=useResident(); useEffect(()=>{void resident.load();const timer=setInterval(()=>resident.refreshDay(),30000);const refresh=()=>resident.refreshDay();window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
  if(!s.state)return null;
  return <div className="resident-hud"><span className="resident-medal">{s.state.experience.rank.level.toString().padStart(2,'0')}</span><div><strong>{s.state.experience.rank.title}</strong><small>{s.state.experience.xp} XP · {s.state.currency.balance} Xu Hang {s.mode==='preview'?'· thử trong tab':''}</small></div></div>;
}
export function NpcPortrait({name,accent}:{name:string;accent:string}){
  const glasses=name==='Keria', jacket=name==='Oner';
  return <svg className="npc-portrait" viewBox="0 0 320 410" role="img" aria-label={`NPC ${name}, minh họa fan low-poly`}>
    <ellipse cx="160" cy="386" rx="110" ry="17" fill="#000" opacity=".25"/>
    <path d="M64 392 86 251 125 211 195 211 234 251 256 392Z" fill={accent}/>
    <path d="m86 251 38-40 36 34 36-34 38 40-28 140H114Z" fill={jacket?'#1c2029':'#282731'}/>
    <path d="m130 211 30 34 30-34 3-21h-66Z" fill="#bb846d"/>
    <path d="m104 87 56-27 56 27 9 79-31 40h-68l-31-40Z" fill="#e4b59a"/>
    <path d="m95 135 4-54 35-28 54 1 32 28 5 53-25-38-31 9-31-17-29 21Z" fill="#24212a"/>
    <path d="m99 109 37-20 33 17 31-9-18-24-48-2Z" fill="#39303a"/>
    <path d="m123 145 17-2m40 0 17 2" stroke="#34242a" strokeWidth="5" strokeLinecap="round"/>
    <path d="m160 146-5 19 12 2" fill="none" stroke="#c18a75" strokeWidth="3"/>
    <path d="M146 182q14 8 28 0" fill="none" stroke="#9d5e59" strokeWidth="3"/>
    {glasses&&<g fill="none" stroke="#25212a" strokeWidth="5"><rect x="109" y="132" width="39" height="29" rx="8"/><rect x="174" y="132" width="39" height="29" rx="8"/><path d="M148 140h26"/></g>}
    {jacket?<g><path d="m124 214 36 31-18 40-31-55m84-16-35 31 18 40 31-55" fill="#e6ddd0"/><path d="M160 247v145" stroke="#c8ad79" strokeWidth="3"/><path d="m116 303 26 5-5 40-29-6m96-39-26 5 5 40 29-6" fill="#454452"/></g>:<><path d="m126 219 34 26 34-26" fill="none" stroke={accent} strokeWidth="9"/><path d="m139 280 21-16 21 16-21 27Z" fill={accent}/></>}
    <path d="m90 280-23 79 32 15 28-73m103-21 23 79-32 15-28-73" fill={jacket?'#34313b':accent}/>
    <path d="m66 358 32 15-6 22-31-13m192-24-32 15 6 22 31-13" fill="#e4b59a"/>
    <path d="m101 367 12-7 7 8-10 9m93-58 10-7 9 12-12 9" fill="#b79877" opacity=".7"/>
  </svg>;
}
const talks:Record<string,string>={checkin:'Về hang rồi à? Điểm danh một cái, rồi ngồi cạnh lửa nhé.',shop:'Đồ có hơi sờn, nhưng tinh thần cổ vũ thì còn nguyên.',quiz:'Năm câu thôi. Mình cùng nhớ lại những mùa giải đáng nhớ nhé!',quest:'Quest về T1 ghim cả trên bảng rồi. Đúng ba câu là gạch được một dòng.',memory:'Sáu lần nâng cúp. Lần nào cả hang cũng nhớ.'};
const icons:Record<string,string>={'cave-ragged-shorts':'🩳','cave-tshirt':'👕','cave-tank-top':'🎽','cave-jersey':'🔴','cave-glasses':'👓','cave-keyboard':'⌨','fan-cap-red':'🧢','fan-hoodie-white':'🧥','fan-headband':'🎗'};
function StatusStrip(){const s=useResident();return s.mode==='preview'?<p className="preview-strip">BẢN THỬ TRONG TAB · Xu, XP và đồ sẽ mất khi tải lại. Không lưu tài khoản, không đồng bộ với người khác.</p>:s.mode==='disabled'?<p className="preview-strip">Tiến trình bền vững chưa mở. Hiện chỉ xem trước nội dung.</p>:s.mode==='error'?<p role="alert">{s.error} <button onClick={()=>void resident.load(true)}>Thử tải lại</button></p>:null;}
function Experience({state}:{state:ProgressionState}){const {xp,rank,nextRank}=state.experience;return <div className="experience-strip"><div><b>LV.{rank.level} · {rank.title}</b><span>{xp} / {nextRank?.minXp??xp} XP</span></div><progress max={nextRank?nextRank.minXp-rank.minXp:1} value={nextRank?xp-rank.minXp:1}/><small>{nextRank?`Còn ${nextRank.minXp-xp} XP để thành ${nextRank.title}`:'Đã chạm hạng cao nhất trong hang.'}</small></div>;}
export function StallPanel({id,onClose,onVisit}:{id:CaveStallId;onClose:()=>void;onVisit?:(id:string)=>void}){
  const meta=CAVE_STALLS.find(s=>s.id===id)!;const data=useResident();
  useEffect(()=>{void resident.load();},[]);
  return <div className={`stall-layout stall-${id}`} style={{'--stall-accent':meta.accent} as React.CSSProperties}>
    <aside className="npc-stage"><div className="npc-kicker">CƯ DÂN TRONG HANG</div><NpcPortrait name={meta.npc} accent={meta.accent}/><div className="npc-caption"><small>{meta.role}</small><h2>{meta.npc}</h2><p>“{talks[id]}”</p></div><small className="fan-art-note">NPC fan-art cách điệu · Không phải hình ảnh chính thức</small></aside>
    <div className="stall-content"><p className="eyebrow">TÊ LIỆT / SẠP CƯ DÂN</p><h2 className="stall-title">{meta.name}</h2>
      <StatusStrip/>
      {id==='memory'?<Gallery/>:id==='quest'?<Quests onVisit={onVisit}/>:!data.state?<p role="status">Đang tải sạp…</p>:<>
        <div className="wallet-row"><span>Xu Hang <b>{data.state.currency.balance}</b></span><small>Điểm trong game · Không có giá trị tiền mặt</small></div>
        <Experience state={data.state}/>
        {id==='checkin'?<CheckIn state={data.state}/>:id==='shop'?<Shop state={data.state} onClose={onClose}/>:<Quiz state={data.state}/>}</>}
    </div>
  </div>;
}
function useMutation(){const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');return {busy,notice,run:async(path:string,payload:Record<string,unknown>={},success?:(r:Record<string,unknown>)=>string)=>{if(busy)return;setBusy(true);setNotice('');try{const result=await resident.mutate(path,payload);setNotice(success?.(result)||'Đã cập nhật.');return result;}catch(e){setNotice(e instanceof Error?e.message:'Chưa hoàn tất.');}finally{setBusy(false);}}};}
function CheckIn({state}:{state:ProgressionState}){
  const m=useMutation(),count=state.daily.totalCheckins,day=count+1,reward=dailyReward(day);
  const can=resident.get().mode==='preview'||(state.enabled&&state.authenticated);
  return <><div className="section-heading"><h3>Hôm nay có mặt!</h3><span>{count} ngày đã ghé hang</span></div><div className="attendance-grid">{Array.from({length:18},(_,i)=>{const n=i+1;return <div key={n} className={n<=count?'stamped':n===day?'next-day':''}><small>NGÀY {n}</small><b>{n<=count?'✓':dailyReward(n)?'✦':'·'}</b><span>{dailyReward(n)?'25 xu + 20 XP':'Có mặt'}</span></div>;})}</div><button className="primary-action" disabled={m.busy||state.daily.claimed||!can} onClick={()=>void m.run('check-in',{},r=>r.claimed?`Oner đã ghi nhận! +${r.reward} Xu Hang · +${r.xpEarned??(r.reward?20:0)} XP`:'Hôm nay bạn đã điểm danh.')}>
    {state.daily.claimed?'✓ Đã điểm danh hôm nay':m.busy?'Đang ghi nhận…':reward?`Điểm danh · +${reward} xu +20 XP`:'Điểm danh hôm nay'}</button><p role="status" className="action-notice">{m.notice}</p><p className="rule-note">Lịch thưởng đề xuất: 15 ngày điểm danh đầu nhận xu + XP mỗi ngày. Sau đó nhận ở ngày 18, 21, 24… theo tổng số ngày đã điểm danh, không mất tiến độ khi bỏ lỡ. Ngày mới lúc 07:00 Việt Nam (00:00 UTC).</p></>;
}
/**
 * Bảng quest của Doran: các quest về T1 (stalls/quests.ts). Mỗi quest ba câu, đúng cả ba là xong.
 * Tiến độ lưu ở trình duyệt; không cộng xu hay XP.
 */
function useQuests(){const[list,setList]=useState<readonly Quest[]>(()=>content().quests);useEffect(()=>{const on=(d:ContentDoc)=>setList(d.quests);content(on);return()=>offContent(on);},[]);return list;}
function Quests({onVisit}:{onVisit?:(id:string)=>void}){
  const QUESTS=useQuests();
  const [done,setDone]=useState<string[]>(()=>loadDone(undefined,content().quests));
  const [open,setOpen]=useState<Quest|null>(null);
  const [answers,setAnswers]=useState<number[]>([]);
  const start=(q:Quest)=>{setOpen(q);setAnswers([]);};
  if(open){
    const step=answers.length,finished=step>=open.questions.length,correct=gradeQuest(open,answers);
    if(finished){
      const passed=correct===open.questions.length;
      return <div className="quest-run"><div className="section-heading"><h3>{open.title}</h3><span>{correct}/{open.questions.length} câu đúng</span></div>
        <div className={passed?'quest-result passed':'quest-result'} role="status"><strong>{passed?'Xong quest!':'Chưa qua quest này'}</strong><span>{passed?'Doran gạch một dòng trên bảng.':'Phải đúng cả ba câu. Làm lại là được.'}</span></div>
        <ol className="quest-review">{open.questions.map((q,i)=><li key={i} className={answers[i]===q.answer?'right':'wrong'}><b>{q.prompt}</b><span>{answers[i]===q.answer?'✓':'✗'} {q.options[q.answer]}</span><small>{q.note}</small></li>)}</ol>
        <div className="quiz-navigation">{!passed&&<button className="primary-action" onClick={()=>start(open)}>Làm lại quest</button>}<button onClick={()=>setOpen(null)}>← Về bảng quest</button></div></div>;
    }
    const q=open.questions[step];
    return <div className="quest-run"><div className="section-heading"><h3>{open.title}</h3><span>Câu {step+1}/{open.questions.length}</span></div>
      <h3 className="quest-prompt">{q.prompt}</h3>
      <div className="quest-options">{q.options.map((option,i)=><button key={i} onClick={()=>{const next=[...answers,i];setAnswers(next);if(next.length===open.questions.length&&gradeQuest(open,next)===open.questions.length&&!done.includes(open.id)){const all=[...done,open.id];setDone(all);saveDone(all);}}}><span>{String.fromCharCode(65+i)}</span>{option}</button>)}</div>
      <button onClick={()=>setOpen(null)}>← Về bảng quest</button></div>;
  }
  return <><div className="section-heading"><h3>Quest về T1</h3><span>Đã xong {done.length}/{QUESTS.length}</span></div>
    <ul className="quest-list">{QUESTS.map(q=>{const ok=done.includes(q.id);return <li key={q.id} className={ok?'quest done':'quest'}><span className="quest-mark" aria-hidden="true">{ok?'✓':'?'}</span><div><b>{q.title}</b><small>{q.blurb}</small></div><div className="quest-side"><button onClick={()=>start(q)}>{ok?'Làm lại':'Nhận quest'}</button></div></li>;})}</ul>
    <p className="rule-note">Mỗi quest gồm ba câu hỏi về T1, đúng cả ba là xong. Tiến độ lưu trên trình duyệt này, chưa cộng xu hay XP. Muốn kiếm XP thì sang Đố vui của Keria.{onVisit&&<> <button className="link-button" onClick={()=>onVisit('quiz')}>Chỉ đường → Hang đố vui</button></>}</p></>;
}
function Shop({state,onClose}:{state:ProgressionState;onClose:()=>void}){
  const m=useMutation();const[filter,setFilter]=useState('all');const can=resident.get().mode==='preview'||(state.enabled&&state.authenticated);
  const catalog=state.catalog.filter(item=>item.id.startsWith('cave-'));
  return <><div className="shop-tabs" role="group" aria-label="Loại trang phục">{[['all','Tất cả'],['outfit','Quần áo'],['accessory','Phụ kiện'],['handheld','Cầm tay']].map(([k,label])=><button key={k} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{label}</button>)}</div><div className="cave-catalog">{catalog.filter(i=>filter==='all'||(i.slot??'accessory')===filter).map(item=>{const owned=state.inventory.includes(item.id),equipped=state.equippedItemId===item.id;return <article key={item.id}><div className="item-illustration" aria-hidden="true">{icons[item.id]??'✦'}<span>HANG EDITION</span></div><h3>{item.name}</h3><p>{item.description}</p><div className="item-price">{owned?'Đã sở hữu':`${item.price} Xu Hang`}</div><button disabled={m.busy||equipped||!can||(!owned&&state.currency.balance<item.price)} onClick={()=>void m.run(owned?'equip':'purchase',{itemId:item.id},()=>owned?'Đã đổi diện mạo.':`Đã có ${item.name} trong tủ đồ.`)}>{equipped?'Đang mặc':owned?'Mặc ngay':state.currency.balance<item.price?'Chưa đủ xu':'Đổi bằng xu'}</button><button className="try-on" onClick={()=>{resident.visual(state.experience.rank.level,item.id);onClose();}}>Thử lên nhân vật</button></article>;})}</div><p role="status" className="action-notice">{m.notice}</p><p className="rule-note">Thử đồ không tốn xu, chỉ bạn nhìn thấy. Mỗi lần trang bị một diện mạo; phối nhiều món sẽ được bổ sung sau.</p><button onClick={()=>{resident.visual(null);}}>Bỏ đồ thử</button>{state.equippedItemId&&<button disabled={m.busy} onClick={()=>void m.run('equip',{itemId:null})}>Về đồ mặc định</button>}</>;
}
function Quiz({state}:{state:ProgressionState}){
  const m=useMutation();const attempt=state.quiz.activeAttempt;const[answers,setAnswers]=useState<number[]>(Array(5).fill(-1));const[index,setIndex]=useState(0);const[result,setResult]=useState<{correct:number;xp:number}|null>(null);
  useEffect(()=>{setAnswers(Array(5).fill(-1));setIndex(0);},[attempt?.id]);
  const can=resident.get().mode==='preview'||(state.enabled&&state.authenticated);
  if(!attempt)return <><div className="quiz-intro"><span className="quiz-emblem">?</span><h3>Fan cứng nhớ được bao nhiêu?</h3><p>5 câu mỗi lượt · 10 XP cho mỗi câu đúng</p><b>Còn {state.quiz.remaining}/3 lượt hôm nay</b></div>{result&&<div className="quiz-result" role="status"><strong>{result.correct}/5 câu đúng</strong><span>+{result.xp} XP · {result.correct===5?'Keria gật gù!':'Lần sau mình nhớ thêm một chút.'}</span></div>}<button className="primary-action" disabled={m.busy||!can||state.quiz.remaining===0} onClick={()=>{setResult(null);void m.run('quiz/start');}}>{m.busy?'Đang chuẩn bị…':state.quiz.remaining?'Bắt đầu ôn kiến thức':'Đã dùng hết lượt hôm nay'}</button><p className="action-notice" role="status">{m.notice}</p><p className="rule-note">Bấm bắt đầu sẽ dùng một lượt. Có thể đóng sạp rồi quay lại làm tiếp trước ngày mới. Lượt được làm mới lúc 07:00 Việt Nam. Ngân hàng câu hỏi hiện tập trung vào lịch sử T1.</p></>;
  const q=attempt.questions[index];const answered=answers.filter(n=>n>=0).length;
  return <div className="quiz-session"><div className="section-heading"><b>Câu {index+1}/5</b><span>Đã chọn {answered}/5</span></div><div className="question-dots">{attempt.questions.map((_,i)=><button key={i} aria-current={i===index?'step':undefined} className={answers[i]>=0?'answered':''} onClick={()=>setIndex(i)} aria-label={`Câu ${i+1}`}>{i+1}</button>)}</div><h3>{q.prompt}</h3><fieldset className="quiz-options"><legend className="sr-only">Chọn đáp án câu {index+1}</legend>{q.options.map((option,i)=><label key={i} className={answers[index]===i?'selected':''}><input type="radio" name={`question-${q.id}`} checked={answers[index]===i} onChange={()=>setAnswers(old=>old.map((v,j)=>j===index?i:v))}/><span>{String.fromCharCode(65+i)}</span>{option}</label>)}</fieldset><div className="quiz-navigation"><button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>← Câu trước</button>{index<4?<button onClick={()=>setIndex(i=>i+1)}>Câu tiếp →</button>:<button className="primary-action" disabled={m.busy||answered!==5} onClick={()=>void m.run('quiz/submit',{attemptId:attempt.id,answers},r=>{setResult({correct:Number(r.correct),xp:Number(r.xpEarned)});return 'Đã chấm bài.';})}>Nộp bài</button>}</div><p role="status" className="action-notice">{m.notice||'Đóng sạp không mất lượt đang làm; đáp án chưa nộp cần chọn lại khi mở.'}</p></div>;
}
export function RankPanel({onClose}:{onClose:()=>void}){const s=useResident();return <div className="rank-panel"><p className="eyebrow">HỒ SƠ CƯ DÂN</p><h2>Càng gắn bó, càng có chỗ nằm.</h2><StatusStrip/>{s.state&&<Experience state={s.state}/>}<div className="rank-road">{RANKS.map((r,i)=><article key={r.level}><span>{['🚶','🫧','🩼','🦽','🛏'][i]}</span><div><small>HẠNG {r.level} · {r.minXp} XP</small><h3>{r.title}</h3><p>{['Người mới về hang','Kéo theo bình oxy','Chống đôi nạng gỗ','Ngồi xe lăn','Nằm trên giường'][i]}</p></div><button onClick={()=>{resident.visual(r.level);onClose();}}>Xem dáng</button></article>)}</div><p className="rule-note">Xem dáng chỉ là thử ngoại hình trên máy bạn, không cộng XP hay mở khóa hạng. Sau khi thử, chọn “Bỏ xem trước” để quay về nhân dạng hiện tại.</p><button onClick={()=>{resident.visual(null);onClose();}}>Bỏ xem trước</button></div>;}
function Gallery(){
  const [selected,setSelected]=useState(TITLES.length-1);const t=TITLES[selected];
  return <><div className="section-heading"><h3>Sáu lần vô địch thế giới</h3><span>2013 · 2015 · 2016 · 2023 · 2024 · 2025</span></div>
    <div className="memory-feature"><img key={t.year} src={t.photo.src} alt={t.photo.shows} loading="lazy"/><div><span>CKTG {t.year} · {t.date}</span><h3>{t.name}</h3><p className="memory-final">{t.final}</p><p className="memory-facts">{t.place}<br/>{t.roster}<br/>{t.note}</p>
      <small>Ảnh: {t.photo.shows}. © {t.photo.author}, <a href={t.photo.licenseUrl} target="_blank" rel="noreferrer">{t.photo.license}</a>, <a href={t.photo.source} target="_blank" rel="noreferrer">Wikimedia Commons</a>; chỉ thu nhỏ.</small></div></div>
    <div className="memory-thumbnails six">{TITLES.map((m,i)=><button key={m.year} aria-pressed={selected===i} onClick={()=>setSelected(i)}><img src={m.photo.src} alt="" loading="lazy"/><span>{m.year}</span></button>)}</div>
    <p className="rule-note">Ảnh thật có giấy phép tự do từ Wikimedia Commons, ghi công từng ảnh. Năm 2016 và 2025 chưa có ảnh nâng cúp nào dùng được, nên là ảnh sự kiện của đúng giải đó. Góp ảnh của fan chưa mở.</p></>;
}
