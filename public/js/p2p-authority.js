/* Browser-host authority. Uses the LAN game's existing engines, one room protocol. */
(function(root) {
'use strict';
const rules=root.PocketGameRules;
if(!rules) throw new Error('PocketGameRules must load before p2p-authority');
const ROLES=rules.SEATS;
const CARC_ORDER=['red','blue','green','yellow'];
const GRACE_MS=5*60*1000,VOTE_MS=30*1000;
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const lines=[
  ...Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r*5+c)),
  ...Array.from({length:5},(_,c)=>Array.from({length:5},(_,r)=>r*5+c)),
  [0,6,12,18,24],[4,8,12,16,20]
];
const freshBingo=()=>({called:[],cards:{},marks:{},lines:{},lineCounts:{},ready:{},winner:null});
const validCard=card=>Array.isArray(card)&&card.length===25&&card.every(n=>integer(n,1,25))&&new Set(card).size===25;
function randomCard(){
  const card=Array.from({length:25},(_,i)=>i+1);
  const seed=new Uint32Array(25);crypto.getRandomValues(seed);
  for(let i=24;i>0;i--){const j=seed[i]%(i+1);[card[i],card[j]]=[card[j],card[i]];}
  return card;
}
const completeLines=marks=>{const set=new Set(marks);return lines.filter(line=>line.every(idx=>set.has(idx)));};
const clone=value=>JSON.parse(JSON.stringify(value));
const safeRoomName=name=>String(name||'訪客').trim().slice(0,20)||'訪客';
const isCellGrid=(v,rows,cols)=>Array.isArray(v)&&v.length===rows&&v.every(row=>Array.isArray(row)&&row.length===cols);
function validSavedBoard(type,state) {
  if(type==='bingo')return true;
  if(type==='carcassonne')return true; // validated again before mutations
  if(!state || typeof state!=='object')return false;
  if(type==='uttt')return isCellGrid(state.mainBoard,3,3)&&
    Array.isArray(state.subBoards)&&state.subBoards.length===3&&state.subBoards.every(row=>
      Array.isArray(row)&&row.length===3&&row.every(sub=>isCellGrid(sub,3,3)));
  if(type==='checkers')return Array.isArray(state.board)&&state.board.length===121;
  const dim={gomoku:[15,15],reversi:[8,8],connect4:[6,7],xiangqi:[10,9],chess:[8,8]};
  if(type==='blokus')return isCellGrid(state.board,state.playerCount===4?20:14,state.playerCount===4?20:14);
  const [height,width]=dim[type]||[];
  return Boolean(height)&&isCellGrid(state.board,height,width);
}
class GameAuthority {
  constructor(roomId,hostName,deliver,gameType='gomoku',playerCount=2) {
    if(!rules.TYPES.includes(gameType))throw new Error('Unsupported P2P game');
    this.id=roomId;
    this.deliver=deliver;
    this.gameType=gameType;
    this.playerCount=rules.count(gameType,playerCount);
    this.engine=rules.engine(gameType,this.playerCount);
    this.players={
      black:{name:safeRoomName(hostName),resumeToken:token(),peerId:'host',connected:true},
      white:null,blue:null,green:null
    };
    this.spectators=new Map();
    this.restartVotes=new Set();
    this.expiryTimers=new Map();
    this.voteTimer=null;
    this.version=0;
    this.status='waiting';
    this.onChange=null;
    this.turn=gameType==='bingo'?'black':gameType==='carcassonne'?'red':this.engine.turn;
    this.winner=null;
    this.lastMove=null;
    this.bingoState=gameType==='bingo'?freshBingo():null;
    this.carcassonneState=null;
    this.carcassonneVersion=0;
  }
  seats(){return ROLES.slice(0,this.playerCount);}
  changed(){this.onChange?.(this.exportState());}
  exportState(){
    return {
      schema:3,id:this.id,gameType:this.gameType,playerCount:this.playerCount,version:this.version,
      players:this.players,engine:this.engine?rules.state(this.gameType,this.engine,this.playerCount):null,
      turn:this.turn,winner:this.winner,lastMove:this.lastMove,
      bingoState:this.bingoState,carcassonneState:this.carcassonneState,
      carcassonneVersion:this.carcassonneVersion,restartVotes:[...this.restartVotes]
    };
  }
  static restore(saved,deliver){
    const type=saved?.schema===1?'gomoku':saved?.gameType;
    if(!saved||![1,2,3].includes(saved.schema)||!rules.TYPES.includes(type)||
       typeof saved.id!=='string'||!saved.players?.black)throw new Error('Invalid saved room');
    const n=rules.count(type,saved.playerCount);
    if(!validSavedBoard(type,saved.engine))throw new Error('Invalid saved game state');
    const a=new GameAuthority(saved.id,saved.players.black.name,deliver,type,n);
    a.version=integer(saved.version,0,Number.MAX_SAFE_INTEGER)?saved.version:0;
    for(const role of ROLES){
      if(!a.seats().includes(role))continue;
      const old=saved.players[role];
      a.players[role]=old?{
        name:safeRoomName(old.name),resumeToken:old.resumeToken,peerId:role==='black'?'host':null,
        connected:role==='black'
      }:null;
    }
    if(a.engine)rules.restore(type,a.engine,saved.engine);
    a.turn=saved.turn||a.engine?.turn||a.turn;
    a.winner=saved.winner??a.engine?.winner??null;
    a.lastMove=saved.lastMove||a.engine?.lastMove||null;
    if(type==='bingo'){
      const b=saved.bingoState;
      if(!b||!Array.isArray(b.called)||!b.cards||!b.marks||!b.lines||!b.lineCounts||!b.ready||
          !Object.values(b.cards).every(validCard))throw new Error('Invalid saved Bingo state');
      a.bingoState=clone(b);
    }
    if(type==='carcassonne'){
      a.carcassonneState=saved.carcassonneState?clone(saved.carcassonneState):null;
      a.carcassonneVersion=integer(saved.carcassonneVersion,0,1e8)?saved.carcassonneVersion:0;
      if(a.carcassonneState&&!root.PocketCarcRules?.validateSaved(a.carcassonneState,a))throw new Error('Invalid saved map');
    }
    a.restartVotes.clear();
    a.updateStatus();
    for(const role of a.seats().slice(1)){
      if(a.players[role])a.expiryTimers.set(role,setTimeout(()=>a.expire(role,null),GRACE_MS));
    }
    return a;
  }
  player(role){
    const p=this.players[role];
    return p?{name:p.name,ready:true,connected:p.connected,reconnecting:!p.connected}:null;
  }
  roleOf(id){
    return this.seats().find(role=>this.players[role]?.peerId===id&&this.players[role].connected)||
      (this.spectators.has(id)?'spectator':null);
  }
  snapshot(viewerRole=null){
    const e=this.engine;
    const engineState=e?rules.state(this.gameType,e,this.playerCount):{};
    const b=this.bingoState;
    return {
      roomId:this.id,gameType:this.gameType,playerCount:this.playerCount,...engineState,
      turn:e?.turn||this.turn,winner:e?.winner||this.winner||null,lastMove:this.lastMove||e?.lastMove||null,
      status:this.status,version:this.version,players:{
        black:this.player('black'),white:this.player('white'),blue:this.player('blue'),green:this.player('green')
      },spectatorCount:this.spectators.size,restartVotes:[...this.restartVotes],
      carcassonneState:this.carcassonneState,carcassonneVersion:this.carcassonneVersion,
      bingoState:b?{
        called:b.called,ready:b.ready,winner:b.winner,lineCounts:b.lineCounts,
        cards:viewerRole&&b.cards[viewerRole]?{[viewerRole]:b.cards[viewerRole]}:{},
        marks:viewerRole&&b.marks[viewerRole]?{[viewerRole]:b.marks[viewerRole]}:{},
        lines:viewerRole&&b.lines[viewerRole]?{[viewerRole]:b.lines[viewerRole]}:{}
      }:null
    };
  }
  send(id,type,fields={}){
    this.deliver(id,{type,...fields,roomState:this.snapshot(this.roleOf(id))});
  }
  broadcast(type,fields={}){
    this.changed();
    for(const p of Object.values(this.players))if(p?.connected)this.send(p.peerId,type,fields);
    for(const id of this.spectators.keys())this.send(id,type,fields);
  }
  error(id,message){this.deliver(id,{type:'error',message});this.send(id,'state_sync');}
  updateStatus(){
    if(this.winner||this.engine?.winner||this.bingoState?.winner||this.carcassonneState?.turnPhase==='GAME_OVER'){
      this.status='ended';return;
    }
    const seats=this.seats();
    if(!seats.every(role=>this.players[role]))this.status='waiting';
    else if(!seats.every(role=>this.players[role].connected))this.status='reconnecting';
    else if(this.gameType==='bingo'&&!seats.every(role=>this.bingoState.ready[role]))this.status='waiting';
    else this.status='playing';
  }
  clearExpiry(role){clearTimeout(this.expiryTimers.get(role));this.expiryTimers.delete(role);}
  expire(role,id){
    const p=this.players[role];
    if(!p||p.connected||p.peerId!==id)return;
    this.players[role]=null;this.restartVotes.delete(role);this.updateStatus();
    this.broadcast('player_left',{role,name:p.name,reconnecting:false});
  }
  dispose(){
    for(const t of this.expiryTimers.values())clearTimeout(t);
    this.expiryTimers.clear();clearTimeout(this.voteTimer);
  }
  disconnect(id,intentional=false){
    const role=this.roleOf(id);if(!role)return;
    const p=this.players[role];
    const name=p?.name||this.spectators.get(id)?.name||'觀眾';
    if(role==='spectator')this.spectators.delete(id);
    else if(role!=='black'){
      this.clearExpiry(role);
      if(intentional){this.players[role]=null;this.restartVotes.delete(role);}
      else{p.connected=false;this.expiryTimers.set(role,setTimeout(()=>this.expire(role,id),GRACE_MS));}
    }else{p.connected=false;}
    this.updateStatus();
    this.broadcast('player_left',{role,name,reconnecting:!intentional});
  }
  join(id,data){
    let role=null,resumed=false;
    if(typeof data.resumeToken==='string'){
      role=this.seats().slice(1).find(r=>this.players[r]?.resumeToken===data.resumeToken)||null;
    }
    if(role){
      const p=this.players[role];this.clearExpiry(role);
      if(p.peerId&&p.peerId!==id&&p.connected)this.spectators.delete(p.peerId);
      p.peerId=id;p.connected=true;resumed=true;
    }else{
      role=this.seats().slice(1).find(r=>!this.players[r])||null;
      if(role)this.players[role]={name:safeRoomName(data.name),resumeToken:token(),peerId:id,connected:true};
      else{role='spectator';this.spectators.set(id,{name:safeRoomName(data.name)});}
    }
    this.updateStatus();this.changed();
    this.send(id,'room_joined',{roomId:this.id,role,resumeToken:role==='spectator'?null:this.players[role].resumeToken});
    const name=role==='spectator'?this.spectators.get(id).name:this.players[role].name;
    for(const p of Object.values(this.players))if(p?.connected&&p.peerId!==id){
      this.send(p.peerId,resumed?'player_reconnected':'player_joined',{name,role,reconnected:resumed});
    }
    for(const peer of this.spectators.keys())if(peer!==id){
      this.send(peer,resumed?'player_reconnected':'player_joined',{name,role,reconnected:resumed});
    }
  }
  reset(by){
    if(this.engine)this.engine.reset();
    this.bingoState=this.gameType==='bingo'?freshBingo():null;
    this.carcassonneState=null;this.carcassonneVersion=0;
    this.turn=this.gameType==='bingo'?'black':this.gameType==='carcassonne'?'red':this.engine.turn;
    this.winner=null;this.lastMove=null;this.version++;
    this.restartVotes.clear();clearTimeout(this.voteTimer);this.updateStatus();
    this.broadcast('game_restarted',{by});
  }
  bingoReceive(id,role,d){
    const b=this.bingoState;
    if(role==='spectator'||!this.players[role])return this.error(id,'觀戰者不能改變棋局');
    if(d.type==='bingo_setup'){
      if(b.ready[role])return this.error(id,'牌面已確認，不能修改');
      const card=d.mode==='random'?randomCard():d.card;
      if(!validCard(card))return this.error(id,'牌面須為 1–25 的不重複排列');
      b.cards[role]=[...card];b.marks[role]=[];b.lines[role]=[];b.lineCounts[role]=0;b.ready[role]=true;
      this.updateStatus();this.version++;this.broadcast('bingo_updated');return;
    }
    if(!this.seats().every(r=>this.players[r]&&b.ready[r])||b.winner||this.status!=='playing')return this.error(id,'等待所有玩家準備完成');
    if(d.type==='bingo_call'){
      if(role!==this.turn||!integer(d.number,1,25)||b.called.includes(d.number))return this.error(id,'請選一個尚未出現的數字');
      b.called.push(d.number);this.lastMove={number:d.number,by:role};
      for(const r of this.seats()){
        const idx=b.cards[r]?.indexOf(d.number)??-1;
        if(idx>=0&&!b.marks[r].includes(idx))b.marks[r].push(idx);
        b.lines[r]=completeLines(b.marks[r]);b.lineCounts[r]=b.lines[r].length;
        if(!b.winner&&b.lineCounts[r]>=5)b.winner=r;
      }
      if(b.winner)this.winner=b.winner;
      else this.turn=this.seats()[(this.seats().indexOf(role)+1)%this.playerCount];
    }else if(d.type==='bingo_mark'){
      if(!integer(d.index,0,24)||!b.cards[role]||b.marks[role].includes(d.index)||
         !b.called.includes(b.cards[role][d.index]))return this.error(id,'只能標記已抽出的號碼');
      b.marks[role].push(d.index);b.lines[role]=completeLines(b.marks[role]);b.lineCounts[role]=b.lines[role].length;
      if(b.lineCounts[role]>=5){b.winner=role;this.winner=role;}
    }else return;
    this.version++;this.updateStatus();this.broadcast('bingo_updated');
  }
  carcReceive(id,role,d){
    const pc=root.PocketCarcRules;
    if(!pc)return this.error(id,'缺少地圖規則驗證');
    const actor=rules.role('carcassonne',this.playerCount,d.actorPlayer,null);
    if(role==='spectator'||!this.players[role]||role!==actor)return this.error(id,'不能代替其他玩家操作');
    if(d.type==='carcassonne_init'){
      if(role!=='black'||this.carcassonneState)return this.error(id,'棋局已經初始化');
    }else{
      if(!this.carcassonneState||this.carcassonneState.activePlayer!==d.actorPlayer)return this.error(id,'現在不是你的回合');
      if(d.baseVersion!==this.carcassonneVersion)return this.send(id,'state_sync');
    }
    const err=pc.validate(d.state,this.carcassonneState,this);
    if(err)return this.error(id,err);
    this.carcassonneState=pc.canonicalize(this,d.state);
    this.carcassonneVersion++;this.version++;
    this.turn=this.carcassonneState.activePlayer;
    this.winner=this.carcassonneState.gameResult?.winners?.[0]||null;
    this.updateStatus();this.broadcast('carcassonne_state');
  }
  receive(id,d){
    if(!d||typeof d.type!=='string')return;
    if(d.type==='join_room')return this.join(id,d);
    const role=this.roleOf(id);if(!role)return;
    if(d.type==='leave_room')return this.disconnect(id,true);
    if(d.type==='sync_request')return this.send(id,'state_sync');
    if(d.type==='reaction'){if(role!=='spectator')this.broadcast('reaction',{emoji:String(d.emoji||'').slice(0,8),from:this.players[role].name,role});return;}
    if(d.type==='restart'){
      if(role==='spectator'||!this.players[role])return this.error(id,'觀戰者不能重新開始');
      if(!this.restartVotes.size){
        clearTimeout(this.voteTimer);
        this.voteTimer=setTimeout(()=>{if(this.restartVotes.size){this.restartVotes.clear();this.broadcast('restart_vote_expired');}},VOTE_MS);
      }
      this.restartVotes.add(role);
      const needed=this.seats().filter(r=>this.players[r]);
      if(needed.every(r=>this.restartVotes.has(r)))this.reset(this.players[role].name);
      else this.broadcast('restart_requested',{by:this.players[role].name,neededVotes:needed.length});
      return;
    }
    if(['bingo_setup','bingo_call','bingo_mark'].includes(d.type)){
      if(this.gameType==='bingo')return this.bingoReceive(id,role,d);
      return this.error(id,'房間遊戲類型不符');
    }
    if(d.type==='carcassonne_init'||d.type==='carcassonne_sync'){
      if(this.gameType==='carcassonne')return this.carcReceive(id,role,d);
      return this.error(id,'房間遊戲類型不符');
    }
    if(d.type!=='move')return;
    if(!this.engine)return this.error(id,'此遊戲不支援一般落子');
    if(role==='spectator'||this.status!=='playing'||role!==rules.role(this.gameType,this.playerCount,this.engine.turn,this.engine))
      return this.error(id,'現在不是你的回合');
    if(!rules.apply(this.gameType,this.engine,d))return this.error(id,'這一步不符合規則');
    this.turn=this.engine.turn;this.winner=this.engine.winner||null;
    this.lastMove={...(this.engine.lastMove||{}),by:role};
    this.version++;this.restartVotes.clear();this.updateStatus();
    this.broadcast('move_made',{move:this.lastMove});
  }
}
root.PocketGameAuthority=GameAuthority;
root.PocketGomokuAuthority=GameAuthority; // Legacy API compatibility.
})(window);
