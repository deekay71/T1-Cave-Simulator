import { COSMETICS, CHECKIN_XP, QUIZ_CORRECT_XP, emptyProgression, experienceState, dailyReward, nextRewardCheckin, type ProgressionState, type QuizAttempt, type QuizSubmitResult } from '@te-liet/shared';

export type ResidentSnapshot = { state: ProgressionState | null; mode: 'loading'|'preview'|'live'|'disabled'|'error'; error: string; visualRank: number | null; visualItem: string | null | undefined };
let snapshot: ResidentSnapshot = { state:null,mode:'loading',error:'',visualRank:null,visualItem:undefined };
const listeners = new Set<()=>void>();
const emit = (patch:Partial<ResidentSnapshot>) => { snapshot={...snapshot,...patch}; listeners.forEach(f=>f()); };
let loading:Promise<void>|null=null;
let busy=false;
let stateRevision=0;
let guestName='Cư dân';
const receipts=new Map<string,string>();
export function progressionEndpoint() {
  const guest=import.meta.env.VITE_API_URL || (import.meta.env.DEV?'http://localhost:3000/v1/guest':'/v1/guest');
  const url=new URL(guest,location.origin); url.pathname=url.pathname.replace(/\/guest\/?$/,'/progression'); url.search=''; url.hash=''; return url.toString();
}
const practice = [
  {id:'p1',prompt:'Tên thi đấu của Lee Sang-hyeok là gì?',options:['Faker','Oner','Keria','Doran'],answer:0},
  {id:'p2',prompt:'T1 thi đấu bộ môn nào trong bài ôn này?',options:['Valorant','Liên Minh Huyền Thoại','Dota 2','StarCraft'],answer:1},
  {id:'p3',prompt:'T1 giành chức vô địch Worlds 2023 trước đội nào?',options:['JDG','Gen.G','Weibo Gaming','G2'],answer:2},
  {id:'p4',prompt:'Keria nổi tiếng ở vị trí nào?',options:['Đi rừng','Đường trên','Đường giữa','Hỗ trợ'],answer:3},
  {id:'p5',prompt:'Chức vô địch Worlds đầu tiên của Faker diễn ra năm nào?',options:['2013','2014','2015','2016'],answer:0},
  {id:'p6',prompt:'Oner nổi tiếng ở vị trí nào?',options:['Hỗ trợ','Đi rừng','Đường dưới','Đường giữa'],answer:1},
  {id:'p7',prompt:'T1 đánh bại đội nào ở chung kết Worlds 2024?',options:['Gen.G','Weibo Gaming','Bilibili Gaming','JDG'],answer:2},
  {id:'p8',prompt:'Tên cũ của T1 trong lịch sử LMHT là gì?',options:['KT Rolster','Samsung White','ROX Tigers','SK Telecom T1'],answer:3},
  {id:'p9',prompt:'T1 thi đấu tại giải khu vực nào?',options:['LCK','LEC','LPL','VCS'],answer:0},
  {id:'p10',prompt:'Faker thường thi đấu ở đường nào?',options:['Đường trên','Đường giữa','Đường dưới','Đi rừng'],answer:1},
  {id:'p11',prompt:'Worlds 2023 được tổ chức ở quốc gia nào?',options:['Trung Quốc','Mỹ','Hàn Quốc','Đức'],answer:2},
  {id:'p12',prompt:'Đội vô địch Worlds 2015 là đội nào?',options:['Fnatic','EDG','KOO Tigers','SK Telecom T1'],answer:3},
  {id:'p13',prompt:'T1 đánh bại đội nào ở bán kết Worlds 2023?',options:['JDG','G2','NRG','KT'],answer:0},
  {id:'p14',prompt:'Một đội LMHT có bao nhiêu người thi đấu trên bản đồ?',options:['4','5','6','7'],answer:1},
  {id:'p15',prompt:'Faker giành Worlds lần thứ tư vào năm nào?',options:['2021','2022','2023','2024'],answer:2},
];
const today=()=>new Date().toISOString().slice(0,10);
function previewState():ProgressionState {
  const state=emptyProgression(false);
  return {...state,authenticated:true,account:{id:'tab-preview',name:guestName},daily:{...state.daily,day:today(),nextAt:new Date(Date.parse(today()+'T00:00:00Z')+86400000).toISOString()},quiz:{...state.quiz,day:today()}};
}
function rollover(state:ProgressionState):ProgressionState {
  const day=today();
  if(state.daily.day===day) return state;
  return {...state,daily:{...state.daily,day,claimed:false,reward:dailyReward(state.daily.totalCheckins+1),nextAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString()},quiz:{...state.quiz,day,attemptsUsed:0,remaining:3,activeAttempt:null}};
}
export const resident = {
  get:()=>snapshot,
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  name:(name:string)=>{guestName=name;if(snapshot.mode==='preview'&&snapshot.state)emit({state:{...snapshot.state,account:{id:'tab-preview',name}}});},
  visual:(rank:number|null,item?:string|null)=>emit({visualRank:rank,visualItem:item}),
  refreshDay() {
    if(!snapshot.state)return;
    if(snapshot.mode==='preview'){const state=rollover(snapshot.state);if(state!==snapshot.state)emit({state});}
    else if(snapshot.mode==='live'&&snapshot.state.daily.day!==today())void resident.load(true);
  },
  async load(force=false) {
    if(snapshot.mode==='preview'&&snapshot.state){const state=rollover(snapshot.state);if(state!==snapshot.state)emit({state});}
    if(loading)return loading;
    if(!force&&snapshot.mode!=='loading')return;
    const requestedRevision=stateRevision;
    loading=(async()=>{
      try{
        const response=await fetch(progressionEndpoint(),{credentials:'include'});
        if(!response.ok)throw new Error('Không tải được tiến trình. Thử lại sau.');
        const state=await response.json() as ProgressionState;
        if(requestedRevision!==stateRevision)return;
        if(!state.enabled&&import.meta.env.DEV){if(snapshot.mode!=='preview')emit({mode:'preview',state:previewState(),error:''});}
        else emit({state,mode:state.enabled?'live':'disabled',error:''});
      }catch(error){if(requestedRevision===stateRevision)emit({mode:'error',error:error instanceof Error?error.message:'Chưa kết nối được.'});}
      finally{loading=null;}
    })();
    return loading;
  },
  async mutate(path:string,payload:Record<string,unknown>={}):Promise<Record<string,unknown>> {
    if(busy)throw new Error('Đang xử lý, chờ một chút.');
    busy=true;
    resident.refreshDay();
    try{
      if(snapshot.mode==='preview') return previewMutation(path,payload);
      if(snapshot.mode!=='live'||!snapshot.state?.authenticated)throw new Error('Phần thưởng bền vững chưa mở.');
      if(path==='purchase') {
        const item=String(payload.itemId); if(!receipts.has(item))receipts.set(item,crypto.randomUUID());
        payload={...payload,idempotencyKey:receipts.get(item)};
      }
      const response=await fetch(`${progressionEndpoint()}/${path}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-T1-Request':'1'},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok){if(response.status===409||response.status===410)await resident.load(true);throw new Error(result.error||'Chưa hoàn tất.');}
      stateRevision++;
      emit({state:result.state??result,visualRank:null,visualItem:undefined});return result;
    }finally{busy=false;}
  },
};
function previewMutation(path:string,payload:Record<string,unknown>):Record<string,unknown>{
  let state=rollover(snapshot.state!);let result:Record<string,unknown>={};
  if(path==='check-in'){
    if(state.daily.claimed)return {claimed:false,reward:0,xpEarned:0,state};
    const count=state.daily.totalCheckins+1,reward=dailyReward(count),xpEarned=reward?CHECKIN_XP:0;
    state={...state,currency:{...state.currency,balance:state.currency.balance+reward},experience:experienceState(state.experience.xp+xpEarned),daily:{...state.daily,claimed:true,totalCheckins:count,streak:state.daily.streak+1,reward,rewardEligible:reward>0,nextRewardCheckin:nextRewardCheckin(count+1)}};
    result={claimed:true,reward,xpEarned};
  }else if(path==='quiz/start'){
    if(state.quiz.activeAttempt)return {attempt:state.quiz.activeAttempt,state};
    if(state.quiz.remaining<=0)throw new Error('Đã hết 3 lượt hôm nay. Quay lại sau 07:00 Việt Nam.');
    const questions=practice.slice(state.quiz.attemptsUsed*5,state.quiz.attemptsUsed*5+5).map(({answer,...q})=>q);
    const attempt:QuizAttempt={id:crypto.randomUUID(),day:today(),questions};
    state={...state,quiz:{...state.quiz,attemptsUsed:state.quiz.attemptsUsed+1,remaining:state.quiz.remaining-1,activeAttempt:attempt}};result={attempt};
  }else if(path==='quiz/submit'){
    const attempt=state.quiz.activeAttempt,answers=payload.answers;
    if(!attempt||attempt.id!==payload.attemptId)throw new Error('Lượt ôn này đã kết thúc hoặc hết hạn.');
    if(!Array.isArray(answers)||answers.length!==5||answers.some(n=>!Number.isInteger(n)||n<0||n>3))throw new Error('Hãy chọn đủ 5 câu trả lời.');
    const correct=attempt.questions.filter((q,i)=>practice.find(p=>p.id===q.id)?.answer===answers[i]).length,xpEarned=correct*QUIZ_CORRECT_XP;
    state={...state,experience:experienceState(state.experience.xp+xpEarned),quiz:{...state.quiz,activeAttempt:null}};
    result={attemptId:attempt.id,correct,total:5,xpEarned,replayed:false} satisfies Omit<QuizSubmitResult,'state'>;
  }else if(path==='purchase'){
    const item=COSMETICS.find(i=>i.id===payload.itemId);if(!item)throw new Error('Không có món này.');
    if(state.inventory.includes(item.id))return{state};
    if(state.currency.balance<item.price)throw new Error('Chưa đủ Xu Hang.');
    state={...state,currency:{...state.currency,balance:state.currency.balance-item.price},inventory:[...state.inventory,item.id]};result={purchased:true};
  }else if(path==='equip'){
    const id=payload.itemId as string|null;if(id&&!state.inventory.includes(id))throw new Error('Bạn chưa sở hữu món này.');
    state={...state,equippedItemId:id,avatarKey:COSMETICS.find(i=>i.id===id)?.assetKey??null};
  }else throw new Error('Thao tác chưa hỗ trợ trong bản thử.');
  emit({state,visualRank:null,visualItem:undefined});return{...result,state};
}
