import {Client,Predict} from '@colyseus/sdk';
import {applyInput,MoveInput} from '@te-liet/shared';
import {createTicketIssuer,loadPrivateJwk} from '@te-liet/auth';
import assert from 'node:assert/strict';
const issue=createTicketIssuer(await loadPrivateJwk());
const rooms=await Promise.all([0,1].map(async i=>new Client(process.env.GAME_URL||'ws://localhost:2567').joinOrCreate('hub_v1',{ticket:await issue({id:crypto.randomUUID(),name:`sync${i}`,trust:0})})));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
rooms.forEach(r=>{r.onMessage('chat',()=>{});r.onMessage('emote',()=>{});});
await sleep(200);
const pairs=rooms.map(r=>{const input=r.input({type:MoveInput});const predict=Predict.get(r,{mode:'lerp',delay:100});predict.attachAll('players',{x:'lerp',z:'lerp'});const self=r.state.players.get(r.sessionId);predict.reconciler(self,{input,fields:['x','z'],smoothMs:65,step:(ctx,s,cmd)=>applyInput(s,cmd,ctx.dt)});return {input,predict,self};});
let frames=0;const timer=setInterval(()=>{frames++;for(const [i,p] of pairs.entries()){const steps=p.predict.tick(performance.now());for(let j=0;j<steps;j++){p.input.data.moveX=frames<90?(i===0?127:-127):0;p.input.data.moveZ=0;p.input.send();}}},16);
try{await sleep(4000);const samples=pairs.map((p,i)=>({client:i,authoritative:{x:p.self.x,z:p.self.z},predicted:{x:p.predict.value(p.self,'x'),z:p.predict.value(p.self,'z')},otherView:rooms[1-i].state.players.get(rooms[i].sessionId)?.toJSON()}));console.log(JSON.stringify(samples,null,2));for(const p of pairs){assert.ok(Math.abs(p.predict.value(p.self,'x')-p.self.x)<.1);assert.ok(Math.abs(p.predict.value(p.self,'z')-p.self.z)<.1);}}
finally{clearInterval(timer);pairs.forEach(p=>p.predict.dispose());await Promise.all(rooms.map(r=>r.leave()));}
