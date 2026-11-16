// Full P2P room/engine contract. Uses the real browser engines, not stubs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const webcrypto=require('node:crypto').webcrypto;
const source=name=>fs.readFileSync(path.join(__dirname,'..','public','js',name),'utf8');
const seats=['black','white','blue','green'];
function setup(){
  let serial=0;
  const timers=new Map(),storage=new Map();
  const ctx={
    window:{},crypto:webcrypto,console,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:()=>++serial,clearInterval:()=>{},
    localStorage:{
      get length(){return storage.size;},
      getItem:k=>storage.has(k)?storage.get(k):null,
      setItem:(k,v)=>storage.set(k,String(v)),
      removeItem:k=>storage.delete(k),
      key:i=>[...storage.keys()][i]??null
    }
  };
  vm.createContext(ctx);
  for(const f of [
    'gomoku.js','reversi.js','xiangqi.js','chess.js','checkers.js','connect4.js',
    'uttt.js','blokus.js','p2p-game-rules.js','p2p-carc-rules.js','p2p-authority.js','p2p-transport.js'
  ])vm.runInContext(source(f),ctx,{filename:f});
  const sent=[];
  const deliver=(id,msg)=>sent.push({id,msg});
  const room=(g,n=2)=>{
    const a=new ctx.window.PocketGameAuthority('ABCDEFGH','Host',deliver,g,n);
    for(let i=1;i<n;i++)a.receive('guest'+i,{type:'join_room',name:'Guest '+i});
    assert.equal(a.snapshot().status,g==='bingo'?'waiting':'playing');
    return a;
  };
  return {ctx,room,sent,storage};
}
const trials=[
  ['gomoku',2,e=>({x:7,y:7})],
  ['reversi',2,e=>({x:2,y:3})],
  ['connect4',2,e=>({col:3})],
  ['uttt',2,e=>({mainR:0,mainC:0,subR:1,subC:1})],
  ['xiangqi',2,pieceMove],
  ['chess',2,pieceMove],
  ['checkers',2,checkersMove],
  ['checkers',3,checkersMove],
  ['blokus',2,blokusMove],
  ['blokus',4,blokusMove]
];
function pieceMove(e) {
  for(let y=0;y<e.board.length;y++)for(let x=0;x<e.board[y].length;x++){
    const p=e.getPiece(x,y);if(p?.color!==e.turn)continue;
    const moves=e.getValidMovesForPiece(x,y);
    if(moves.length)return {from:{x,y},to:{x:moves[0].x,y:moves[0].y}};
  }
  throw new Error('No legal chess/Xiangqi move');
}
function checkersMove(e) {
  for(let i=0;i<e.board.length;i++){
    if(e.board[i]!==e.turn)continue;
    const options=e.getValidMoves(i);
    if(options.length)return {from:i,to:options[0].targetId};
  }
  throw new Error('No legal checkers move');
}
function blokusMove(e) {
  const piece=e.playerPieces[e.turn]?.find(p=>p.size===1);
  assert(piece,'missing monomino');
  const shape=Array.from(piece.coords,xy=>Array.from(xy));
  for(let y=0;y<e.size;y++)for(let x=0;x<e.size;x++){
    if(e.isValidPlacement(e.turn,shape,y,x))return {pieceId:piece.id,shape,originY:y,originX:x};
  }
  throw new Error('No legal blokus move');
}
for(const [g,n,next] of trials){
  const f=setup(),a=f.room(g,n),e=a.engine;
  assert.equal(a.snapshot().gameType,g);
  assert.equal(a.snapshot().playerCount,n);
  const move=next(e),role=f.ctx.window.PocketGameRules.role(g,n,e.turn,e);
  const id=role==='black'?'host':'guest'+seats.indexOf(role);
  const version=a.version;
  const enemy=id==='host'?'guest1':'host';
  a.receive(enemy,{type:'move',...move});
  assert.equal(a.version,version,g+' wrong-turn rejected');
  a.receive(id,{type:'move',...move});
  assert.equal(a.version,version+1,g+' first legal move');
  a.receive('spectator',{type:'join_room',name:'Viewer'});
  a.receive('spectator',{type:'move',...move});
  assert.equal(a.version,version+1,g+' spectator rejected');
  const snapshot=a.snapshot(),serialized=JSON.parse(JSON.stringify(a.exportState()));
  const recovered=f.ctx.window.PocketGameAuthority.restore(serialized,f.deliver||(()=>{}));
  assert.equal(recovered.gameType,g);
  assert.equal(recovered.playerCount,n);
  assert.equal(recovered.version,a.version);
  assert.equal(JSON.stringify(recovered.snapshot().board),JSON.stringify(snapshot.board),g+' restored board');
  assert.equal(recovered.snapshot().turn,snapshot.turn,g+' restored turn');
  assert.equal(recovered.snapshot().status,'reconnecting',g+' seat recovery status');
  const last=seats[n-1],token=serialized.players[last].resumeToken;
  recovered.receive('restored',{type:'join_room',name:'Returned',resumeToken:token});
  assert.equal(recovered.roleOf('restored'),last);
  if(n===2)assert.equal(recovered.snapshot().status,'playing');
  else assert.equal(recovered.snapshot().status,'reconnecting'); // other guests still disconnected
  a.dispose();recovered.dispose();
  console.log('PASS P2P rules '+g+' '+n+'p (move, reject, spectator, restore)');
}
// Bingo: per-player card remains private, calls are canonical, 2-4 player seats.
for(const n of [2,4]){
  const f=setup(),a=f.room('bingo',n);
  for(let i=0;i<n;i++){
    a.receive(i===0?'host':'guest'+i,{type:'bingo_setup',mode:'random'});
  }
  assert.equal(a.status,'playing');
  for(let i=0;i<n;i++){
    const role=seats[i],snap=a.snapshot(role);
    assert(snap.bingoState.cards[role],'own card should be readable');
    assert.deepEqual(Object.keys(snap.bingoState.cards),[role],'other cards must not leak');
  }
  assert.equal(Object.keys(a.snapshot('spectator').bingoState.cards).length,0);
  a.receive('host',{type:'bingo_call',number:1});
  assert.deepEqual(Array.from(a.bingoState.called),[1]);
  assert.equal(a.turn,seats[1]);
  const version=a.version;
  a.receive('host',{type:'bingo_call',number:2});
  assert.equal(a.version,version,'out-of-turn call should be rejected');
  const saved=JSON.parse(JSON.stringify(a.exportState()));
  const restored=f.ctx.window.PocketGameAuthority.restore(saved,()=>{});
  assert.deepEqual(Array.from(restored.bingoState.called),[1]);
  a.dispose();restored.dispose();
  console.log('PASS P2P Bingo '+n+'p (privacy, ready, turns, restore)');
}
// Carcassonne: reuse server's exact terrain/turn validator, including replay version.
for(const n of [2,4]){
  const f=setup(),a=f.room('carcassonne',n),deck=[];
  for(let code=65;code<=88;code++)for(let i=0;i<3;i++)deck.push(String.fromCharCode(code));
  deck.splice(deck.indexOf('J'),1);
  deck.splice(deck.indexOf('A'),1);
  const initial={
    grid:[['0,0',{typeKey:'J',rotation:0,meeple:null}]],
    deck,currentTile:{typeKey:'A',rotation:0},activePlayer:'red',
    scores:{red:0,blue:0,green:0,yellow:0},
    meeplesRemaining:{red:7,blue:7,green:7,yellow:7},
    remainingDeckCount:deck.length,turnPhase:'PLACE_TILE',justPlacedCoords:null,
    playerCount:n,playerNames:{},gameResult:null
  };
  a.receive('host',{type:'carcassonne_init',actorPlayer:'red',baseVersion:0,state:initial});
  assert.equal(a.carcassonneVersion,1,'map init');
  const rotated=JSON.parse(JSON.stringify(initial));
  rotated.currentTile.rotation=1;
  a.receive('host',{type:'carcassonne_sync',actorPlayer:'red',baseVersion:1,state:rotated});
  assert.equal(a.carcassonneVersion,2,'legal tile rotation');
  a.receive('guest1',{type:'carcassonne_sync',actorPlayer:'red',baseVersion:2,state:rotated});
  assert.equal(a.carcassonneVersion,2,'wrong actor rejected');
  a.receive('host',{type:'carcassonne_sync',actorPlayer:'red',baseVersion:1,state:rotated});
  assert.equal(a.carcassonneVersion,2,'stale version rejected');
  const forged=JSON.parse(JSON.stringify(rotated));
  forged.grid.push(['10,10',{typeKey:'J',rotation:0,meeple:null}]);
  a.receive('host',{type:'carcassonne_sync',actorPlayer:'red',baseVersion:2,state:forged});
  assert.equal(a.carcassonneVersion,2,'disconnected tile rejected');
  const saved=JSON.parse(JSON.stringify(a.exportState()));
  const restored=f.ctx.window.PocketGameAuthority.restore(saved,()=>{});
  assert.equal(restored.carcassonneVersion,2);
  assert.equal(restored.carcassonneState.currentTile.rotation,1);
  a.dispose();restored.dispose();
  console.log('PASS P2P Carcassonne '+n+'p (validated map, version, tampering, restore)');
}
// Four-seat restart requires all connected players.
{
  const f=setup(),a=f.room('blokus',4);
  for(const id of ['host','guest1','guest2'])a.receive(id,{type:'restart'});
  assert.equal(a.version,0);
  a.receive('guest3',{type:'restart'});
  assert.equal(a.version,1);
  assert.equal(a.status,'playing');
  a.dispose();
  console.log('PASS P2P 4-seat restart ballot');
}
// The UI-facing transport forwards game selection and player count.
{
  const f=setup(),root=f.ctx.window;
  class PeerFake {
    constructor(id){this.id=id;this.events={};}
    on(ev,fn){this.events[ev]=fn;return this;}
    destroy(){}
  }
  root.Peer=PeerFake;
  for(const [g,n] of [['gomoku',2],['chess',2],['checkers',3],['blokus',4],['bingo',4],['carcassonne',4]]){
    const events=[],socket=new root.PocketP2PSocket(null,event=>events.push(JSON.parse(event.data)),()=>{},()=>{});
    socket.create('Host',g,n);
    assert.equal(socket.authority.gameType,g);
    assert.equal(socket.authority.playerCount,n);
    socket.peer.events.open();
    assert.equal(events.at(-1).roomState.gameType,g);
    assert.equal(events.at(-1).roomState.playerCount,n);
    const roomId=socket.roomId;
    socket.send(JSON.stringify({type:'leave_room'}));
    assert.equal(f.ctx.localStorage.getItem('pocket_p2p_host_'+roomId),null,'leave clears saved host');
  }
  console.log('PASS P2P transport: game selection, seats, host cleanup');
}
