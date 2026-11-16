const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const pub=path.join(__dirname,'..','public');
const lobby=fs.readFileSync(path.join(pub,'index.html'),'utf8');
const map=fs.readFileSync(path.join(pub,'carcassonne.html'),'utf8');
const expected=['js/p2p-game-rules.js','js/p2p-carc-rules.js','js/p2p-authority.js','js/p2p-transport.js','js/app.js'];
let prev=-1;
for(const script of expected){
  const pos=lobby.indexOf(script);
  assert(pos>prev,'Lobby import missing or wrong order: '+script);
  prev=pos;
}
for(const script of expected.slice(0,4))assert(map.includes(script),'Map page must load '+script);
assert(map.includes("socket.restore(onlineRoomId)"),'Map room host restore missing');
assert(map.includes("socket.join(onlineRoomId)"),'Map room guest join missing');
assert(map.includes("socket.isHost"),'Map reconnect must not send join from host');
assert(map.includes("message.type === 'room_created'"),'Map page must process restored host room');
assert(map.includes("if (this.p2pMode) params.set('transport','p2p')")===false,'Different modules should not inject lobby-only route logic');
for(const [name,html] of [['lobby',lobby],['map',map]]){
  const matches=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inline=matches.map(m=>m[1]).filter(s=>s.trim());
  for(let i=0;i<inline.length;i++)assert.doesNotThrow(()=>new vm.Script(inline[i],{filename:name+'-inline-'+i+'.js'}));
}
console.log('PASS P2P Pages script order and dedicated map host/guest wiring');
