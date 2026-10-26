const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=path.join(__dirname,'..','public','js');
// Fake timers: the authority schedules a 5-minute seat grace and a 30-second restart ballot.
const timers=new Map();let timerSeq=0;
const fakeSetTimeout=(fn,ms)=>{const id=++timerSeq;timers.set(id,{fn,ms});return id;};
const fakeClearTimeout=id=>timers.delete(id);
const runTimers=ms=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
const ctx={window:{},crypto:require('node:crypto').webcrypto,console,setTimeout:fakeSetTimeout,clearTimeout:fakeClearTimeout};
vm.createContext(ctx);
const gomoku=process.env.GOMOKU_FILE || path.join(src,'gomoku.js');
vm.runInContext(fs.readFileSync(gomoku,'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(src,'p2p-authority.js'),'utf8'),ctx);
const messages=[];
const a=new ctx.window.PocketGomokuAuthority('ABCDEFGH','Host',(id,msg)=>messages.push({id,...msg}));
assert.equal(a.snapshot().status,'waiting');
a.receive('guest1',{type:'join_room',name:'Guest'});
assert.equal(a.snapshot().status,'playing');
a.receive('guest1',{type:'move',x:0,y:0});
assert.equal(a.engine.board[0][0],null);
a.receive('host',{type:'move',x:0,y:0});
assert.equal(a.engine.board[0][0],'black');
a.receive('guest1',{type:'move',x:0,y:0});
assert.equal(a.engine.turn,'white');
a.receive('guest1',{type:'move',x:1,y:0});
assert.equal(a.engine.board[0][1],'white');
const resume=a.players.white.resumeToken;
a.disconnect('guest1');assert.equal(a.snapshot().status,'reconnecting');
a.receive('guest2',{type:'join_room',name:'Guest',resumeToken:resume});
assert.equal(a.snapshot().status,'playing');
assert.equal(a.players.white.peerId,'guest2');
a.receive('spectator',{type:'join_room',name:'Viewer'});
assert.equal(a.roleOf('spectator'),'spectator');
a.receive('spectator',{type:'move',x:2,y:0});
assert.equal(a.engine.board[0][2],null);
assert(messages.some(m=>m.type==='move_made'));
// The joiner gets room_joined, not its own player_joined notice.
assert(!messages.some(m=>m.id==='spectator'&&m.type==='player_joined'));
// A restart ballot expires after 30 s.
messages.length=0;a.receive('host',{type:'restart'});assert.equal(a.restartVotes.size,1);
runTimers(30*1000);assert.equal(a.restartVotes.size,0);assert(messages.some(m=>m.type==='restart_vote_expired'));
// A disconnected guest seat is released after the 5-minute grace.
a.disconnect('guest2');assert.equal(a.snapshot().status,'reconnecting');
runTimers(5*60*1000);assert.equal(a.players.white,null);assert.equal(a.snapshot().status,'waiting');
a.dispose();
console.log('PASS P2P authority: turns, invalid moves, reconnect, spectator, vote expiry, seat grace');
