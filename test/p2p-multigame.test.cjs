// P2P first batch: all four engines use the same host-authoritative room protocol.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..', 'public', 'js');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function fixture() {
  let timerId = 0;
  const timers = new Map();
  const setTimeoutFake = (fn, ms) => {
    const id = ++timerId;
    timers.set(id, {fn, ms});
    return id;
  };
  const clearTimeoutFake = id => timers.delete(id);
  const store = new Map();
  const localStorage = {
    get length() { return store.size; },
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    key: n => [...store.keys()][n] ?? null
  };
  const ctx = {window: {}, crypto, console, localStorage,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    setInterval: () => ++timerId, clearInterval: () => {}};
  vm.createContext(ctx);
  for (const file of ['gomoku.js', 'reversi.js', 'connect4.js', 'uttt.js',
                      'p2p-game-rules.js', 'p2p-authority.js', 'p2p-transport.js']) {
    vm.runInContext(read(file), ctx, {filename: file});
  }
  const out = [];
  const deliver = (peer, message) => out.push({peer, message});
  return {ctx, out, deliver, timers, setTimeoutFake, clearTimeoutFake, localStorage};
}

const cases = [
  {game:'gomoku', a:{x:7,y:7}, b:{x:7,y:8},
   bad:{x:15,y:7}, inspect:s=>s.board[7][7]==='black'},
  {game:'reversi', a:{x:2,y:3}, b:{x:2,y:2},
   bad:{x:8,y:0}, inspect:s=>s.board[3][2]==='black'},
  {game:'connect4', a:{col:3}, b:{col:4},
   bad:{col:7}, inspect:s=>s.board[5][3]==='red'},
  {game:'uttt', a:{mainR:0,mainC:0,subR:1,subC:1},
   b:{mainR:1,mainC:1,subR:0,subC:0},
   bad:{mainR:3,mainC:0,subR:0,subC:0},
   inspect:s=>s.subBoards[0][0][1][1]==='X'}
];

for (const test of cases) {
  const f=fixture();
  const Authority=f.ctx.window.PocketGameAuthority;
  const room=new Authority('ABCDEFGH', 'Host', f.deliver, test.game);
  assert.equal(room.snapshot().gameType,test.game);
  assert.equal(room.snapshot().status,'waiting');
  room.receive('guest',{type:'join_room',name:'Guest'});
  assert.equal(room.snapshot().status,'playing');
  assert.equal(room.roleOf('guest'),'white');
  const initial=JSON.stringify(room.snapshot());
  room.receive('guest',{type:'move',...test.a});
  room.receive('host',{type:'move',...test.bad});
  assert.equal(JSON.stringify(room.snapshot()),initial,'bad moves must not mutate state');
  assert(f.out.some(x=>x.peer==='guest' && x.message.type==='error'));
  assert(f.out.some(x=>x.peer==='host' && x.message.type==='state_sync'));
  room.receive('host',{type:'move',...test.a});
  assert.equal(room.version,1);
  assert(test.inspect(room.snapshot()),test.game+' host move');
  if (test.game === 'reversi') assert.equal(room.snapshot().scores.black,4);
  if (test.game === 'uttt') assert.equal(room.snapshot().activeBoard.mainR,1);
  room.receive('guest',{type:'move',...test.b});
  assert.equal(room.version,2);
  const after=JSON.stringify(room.snapshot());
  room.receive('host',{type:'move',...test.bad}); // out-of-range action after legal moves
  assert.equal(JSON.stringify(room.snapshot()),after);
  room.receive('spectator',{type:'join_room',name:'Watcher'});
  room.receive('spectator',{type:'move',...test.a});
  assert.equal(room.version,2,'spectators cannot move');

  const saved=JSON.parse(JSON.stringify(room.exportState()));
  assert.equal(saved.gameType,test.game);
  const restored=Authority.restore(saved,f.deliver);
  assert.equal(restored.version,2);
  assert.equal(restored.snapshot().gameType,test.game);
  assert.equal(restored.snapshot().status,'reconnecting');
  assert(test.inspect(restored.snapshot()),test.game+' restored');
  const resume=saved.players.white.resumeToken;
  restored.receive('guest2',{type:'join_room',name:'Guest',resumeToken:resume});
  assert.equal(restored.roleOf('guest2'),'white');
  assert.equal(restored.snapshot().status,'playing');
  // Two-party restart voting works on any engine and resets its turn/state.
  restored.receive('host',{type:'restart'});
  restored.receive('guest2',{type:'restart'});
  assert.equal(restored.version,3);
  assert.equal(restored.snapshot().status,'playing');
  assert.equal(restored.engine.turn,
    {gomoku:'black',reversi:'black',connect4:'red',uttt:'X'}[test.game]);
  assert.equal(restored.engine.winner,null);
  restored.dispose();
  room.dispose();
  console.log('PASS P2P multigame: '+test.game+' validation, move, spectator, reconnect, restart');
}

// The existing game-less schema:1 host cache remains restorable as Gomoku.
{
  const f=fixture(); const Authority=f.ctx.window.PocketGameAuthority;
  const a=new Authority('ABCDEFGH','Host',f.deliver);
  const saved=JSON.parse(JSON.stringify(a.exportState()));
  saved.schema=1; delete saved.gameType;
  const restored=Authority.restore(saved,f.deliver);
  assert.equal(restored.gameType,'gomoku');
  a.dispose(); restored.dispose();
}

// Win and terminal-state protection for gravity connect four.
{
  const f=fixture(), a=new f.ctx.window.PocketGameAuthority('ABCDEFGH','Host',f.deliver,'connect4');
  a.receive('guest',{type:'join_room',name:'Guest'});
  for (const [peer,col] of [['host',0],['guest',1],['host',0],
                             ['guest',1],['host',0],['guest',1],['host',0]]) {
    a.receive(peer,{type:'move',col});
  }
  assert.equal(a.snapshot().winner,'red');
  assert.equal(a.snapshot().status,'ended');
  const final=a.version;
  a.receive('guest',{type:'move',col:4});
  assert.equal(a.version,final);
  a.dispose();
  console.log('PASS P2P connect4: win detection and ended-room protection');
}

// The transport must forward selected game type to the host authority.
{
  const f=fixture();
  class PeerFake {
    constructor(id) {this.id=id;this.events={};}
    on(event,handler) {this.events[event]=handler;return this;}
    destroy() {}
  }
  f.ctx.window.Peer=PeerFake;
  const messages=[];
  for (const game of ['gomoku','reversi','connect4','uttt']) {
    const socket=new f.ctx.window.PocketP2PSocket(null,
      event=>messages.push(JSON.parse(event.data)),()=>{},()=>{});
    socket.create('Host',game);
    assert.equal(socket.authority.gameType,game);
    socket.peer.events.open();
    assert.equal(messages.at(-1).roomState.gameType,game);
    assert.equal(messages.at(-1).type,'room_created');
    socket.close();
  }
  const invalid=new f.ctx.window.PocketP2PSocket(null,
    event=>messages.push(JSON.parse(event.data)),()=>{},()=>{});
  invalid.create('Host','chess');
  assert.equal(invalid.authority,null);
  assert.equal(messages.at(-1).type,'error');
  invalid.close();
  console.log('PASS P2P transport: selected game carried, unsupported game rejected');
}
