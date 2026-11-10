import { HubRoom, HubState } from '../../apps/game/src/HubRoom.js';
import { LocalPresence, type Client } from '@colyseus/core';
import assert from 'node:assert/strict';
let publications=0; let release!:()=>void;
const barrier=new Promise<void>(r=>release=r);
class RacingPresence extends LocalPresence {
 override async publish(topic:string,data:any){await super.publish(topic,data);if(++publications===2)release();await barrier;return this;}
}
const presence=new RacingPresence();
const rooms=[new HubRoom(),new HubRoom()];
const clients=rooms.map((room,i)=>{room.setState(new HubState());room.presence=presence;return {sessionId:`race-${i}`,auth:{id:'same-account',name:'fan',trust:0},leave:()=>{room.state.players.delete(`race-${i}`);}} as unknown as Client;});
await Promise.all(rooms.map((room,i)=>room.onJoin(clients[i])));
const seats=rooms.reduce((n,room)=>n+room.state.players.size,0);
console.log({simultaneousActiveSeats:seats});
for(let i=0;i<rooms.length;i++)await rooms[i].onLeave(clients[i]);
assert.equal(seats,1,'same account must not retain two active seats after simultaneous joins');
