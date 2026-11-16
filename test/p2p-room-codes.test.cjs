// P2P new 4-digit room codes: validation, local/remote collisions and legacy invites.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','public','js','p2p-transport.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','public','js','app.js'),'utf8');
function fixture(sequence=[]) {
  const store=new Map(), peers=[],messages=[];
  let sequenceIndex=0,guestCounter=0,timerId=0;
  const storage={
    get length(){return store.size;},
    getItem:key=>store.has(key)?store.get(key):null,
    setItem:(key,value)=>store.set(key,String(value)),
    removeItem:key=>store.delete(key),
    key:index=>[...store.keys()][index]??null
  };
  class FakeAuthority {
    constructor(roomId,name,deliver,gameType='gomoku',playerCount=2){
      this.id=roomId;this.gameType=gameType;this.playerCount=playerCount;
      this.players={black:{resumeToken:'host-token',name}};
    }
    exportState(){return {id:this.id,gameType:this.gameType,playerCount:this.playerCount,players:this.players};}
    static restore(saved,deliver){return new FakeAuthority(saved.id,saved.players.black.name,deliver,saved.gameType,saved.playerCount);}
    snapshot(){return {gameType:this.gameType,playerCount:this.playerCount};}
    dispose(){}
  }
  class FakePeer{
    constructor(id){this.id=id;this.events={};this.destroyed=false;peers.push(this);}
    on(event,fn){this.events[event]=fn;return this;}
    emit(event,data){this.events[event]?.(data);}
    destroy(){this.destroyed=true;}
  }
  const ctx={
    window:{
      Peer:FakePeer,PocketGameAuthority:FakeAuthority,
      PocketGameRules:{TYPES:['gomoku','bingo'],count:(game,count)=>game==='bingo'?Math.max(2,Math.min(4,count)):2}
    },
    localStorage:storage,console,Date,Math,
    crypto:{getRandomValues(arr){
      if(arr instanceof Uint32Array)arr[0]=sequence[sequenceIndex++]??sequenceIndex;
      else for(let i=0;i<arr.length;i++)arr[i]=++guestCounter&255;
      return arr;
    }},
    setInterval:()=>++timerId,clearInterval:()=>{},
    setTimeout:()=>++timerId,clearTimeout:()=>{}
  };
  vm.createContext(ctx);
  vm.runInContext(src,ctx,{filename:'p2p-transport.js'});
  const create=()=>new ctx.window.PocketP2PSocket(null,event=>messages.push(JSON.parse(event.data)),()=>{},()=>{});
  return {ctx,store,peers,messages,create};
}
{
  const f=fixture();
  const valid=f.ctx.window.PocketP2PSocket.isValidRoomCode;
  for(const code of ['1000','9999','5284','ABCD2345','HJKLMN29'])assert(valid(code),code+' should be valid');
  for(const code of ['0000','999','10000','123A','abcd2345','ABCD1234','1000AB','',null])assert(!valid(code),String(code)+' should be invalid');
  assert(app.includes("window.PocketP2PSocket?.isValidRoomCode(code)"),'lobby join must share transport validation');
  assert(app.includes("window.PocketP2PSocket?.isValidRoomCode((invitedRoomId || '').toUpperCase())"),'QR invitation must accept four digits and old codes');
  assert(app.includes("placeholder='輸入 4 位數字房號'"),'mobile entry must show 4-digit hint');
  console.log('PASS P2P codes: 4-digit validation and old 8-character invites');
}
{
  const f=fixture([0,1]);
  const socket=f.create();
  socket.create('A','gomoku',2);
  assert.equal(socket.roomId,'1000');
  assert.equal(f.peers[0].id,'pocketgame-v1-1000');
  // Simulate an occupied ID on public PeerJS signaling. It must choose a new code.
  f.peers[0].emit('error',{type:'unavailable-id'});
  assert.equal(socket.roomId,'1001');
  assert(f.peers[0].destroyed,'failed peer should be destroyed');
  assert.equal(f.store.get('pocket_p2p_host_1000'),undefined,'failed host snapshot must be cleaned');
  f.peers.at(-1).emit('open');
  assert.equal(f.messages.at(-1).roomId,'1001');
  assert.equal(f.messages.at(-1).type,'room_created');
  socket.close();
  console.log('PASS P2P codes: remote collision retry and room_created');
}
{
  const f=fixture([0,1]);
  f.store.set('pocket_p2p_host_1000',JSON.stringify({savedAt:Date.now(),room:{id:'1000'}}));
  const socket=f.create();
  socket.create('A','bingo',4);
  assert.equal(socket.roomId,'1001','must avoid overwriting an existing local room snapshot');
  assert(f.store.has('pocket_p2p_host_1000'));
  socket.close();
  console.log('PASS P2P codes: local room snapshot collision avoided');
}
{
  const f=fixture([0,1,2,3,4,5,6,7,8]);
  const socket=f.create();
  socket.create('A','gomoku',2);
  for(let i=0;i<8;i++){
    const peer=f.peers.at(-1);
    peer.emit('error',{type:'unavailable-id'});
  }
  assert.equal(socket.stopped,true,'failed host must stop after capped retries');
  assert(!f.store.has('pocket_p2p_host_'+socket.roomId),'failed room must not linger in storage');
  assert(f.messages.some(m=>m.type==='error'));
  console.log('PASS P2P codes: bounded retries and exhausted-room cleanup');
}
{
  const f=fixture([2400]);
  const guest=f.create();
  guest.join('5372');
  assert.equal(guest.roomId,'5372');
  assert.equal(f.peers.at(-1).id.startsWith('pocketgame-v1-guest-'),true);
  guest.close();
  const old=f.create();
  old.join('ABCD2345');
  assert.equal(old.roomId,'ABCD2345');
  old.close();
  const bad=f.create();
  bad.join('005');
  assert.equal(bad.roomId,null);
  assert.equal(f.messages.at(-1).type,'error');
  bad.close();
  console.log('PASS P2P codes: join new, join legacy, reject invalid');
}
{
  const f=fixture([0]);
  const creator=f.create();
  creator.create('Host','gomoku',2);
  const room=creator.roomId;
  creator.close();
  const saved=f.store.get('pocket_p2p_host_'+room);
  assert(saved,'host snapshot should persist for reload');
  const recovered=f.create();
  assert.equal(recovered.restore(room),true);
  assert.equal(recovered.roomId,room);
  assert.equal(recovered.isHost,true);
  recovered.close();
  console.log('PASS P2P codes: numeric host room restore');
}
