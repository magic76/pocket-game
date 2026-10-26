/* Browser host authority — phase 1: Gomoku. Existing GomokuEngine is reused. */
(function (root) {
  const ROLES = ['black', 'white'];
  const GRACE_MS=5*60*1000, VOTE_MS=30*1000;
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  class GomokuAuthority {
    constructor(roomId, hostName, deliver) {
      this.id = roomId;
      this.deliver = deliver; // (peerId, protocolMessage) => void; 'host' is local
      this.engine = new root.GomokuEngine(15);
      this.players = {black: {name: hostName.slice(0,20), resumeToken: token(), peerId:'host', connected:true}, white:null};
      this.spectators = new Map();
      this.restartVotes = new Set();
      this.version = 0;
      this.status = 'waiting';this.expiryTimers=new Map();this.voteTimer=null;this.onChange=null;
    }
    exportState() {
      return {schema:1,id:this.id,version:this.version,players:this.players,engine:{board:this.engine.board,turn:this.engine.turn,winner:this.engine.winner,lastMove:this.engine.lastMove,winningLine:this.engine.winningLine,moveHistory:this.engine.moveHistory},restartVotes:[...this.restartVotes]};
    }
    static restore(saved,deliver) {
      if(!saved||saved.schema!==1||!saved.id||!saved.players?.black||!Array.isArray(saved.engine?.board)||saved.engine.board.length!==15)throw new Error('Invalid saved room');
      const result=new GomokuAuthority(saved.id,saved.players.black.name,deliver);
      result.version=Number.isSafeInteger(saved.version)?saved.version:0;
      for(const role of ROLES){const old=saved.players[role];result.players[role]=old?{name:String(old.name).slice(0,20),resumeToken:old.resumeToken,peerId:role==='black'?'host':null,connected:role==='black'}:null;}
      result.engine.loadState(saved.engine);
      result.engine.moveHistory=Array.isArray(saved.engine.moveHistory)?saved.engine.moveHistory:[];
      result.restartVotes.clear();result.updateStatus();
      if(result.players.white){result.expiryTimers.set('white',setTimeout(()=>result.expire('white',null),GRACE_MS));}
      return result;
    }
    changed(){this.onChange?.(this.exportState());}
    player(role) { const p = this.players[role]; return p ? {name:p.name,ready:true,connected:p.connected,reconnecting:!p.connected} : null; }
    snapshot() {
      return {roomId:this.id, gameType:'gomoku',playerCount:2,board:this.engine.board,turn:this.engine.turn,
        winner:this.engine.winner,lastMove:this.engine.lastMove,winningLine:this.engine.winningLine,size:15,
        status:this.status,players:{black:this.player('black'),white:this.player('white'),blue:null,green:null},
        spectatorCount:this.spectators.size,restartVotes:[...this.restartVotes],version:this.version};
    }
    send(peerId, type, fields={}) { this.deliver(peerId, {type,...fields,roomState:this.snapshot()}); }
    broadcast(type, fields={}) {
      this.changed();
      for(const p of Object.values(this.players)) if(p?.connected) this.send(p.peerId,type,fields);
      for(const id of this.spectators.keys()) this.send(id,type,fields);
    }
    error(id,message) { this.deliver(id,{type:'error',message}); this.send(id,'state_sync'); }
    updateStatus() { this.status = this.engine.winner ? 'ended' : !this.players.white ? 'waiting' : Object.values(this.players).every(p=>p?.connected) ? 'playing' : 'reconnecting'; }
    join(id, data) {
      let role = null, resumed = false;
      if(typeof data.resumeToken==='string') role=ROLES.find(r=>this.players[r]?.resumeToken===data.resumeToken) || null;
      if(role) { const p=this.players[role]; this.clearExpiry(role);if(p.peerId!==id&&p.connected)this.spectators.delete(p.peerId);p.peerId=id;p.connected=true;resumed=true; }
      else if (!this.players.white) {role='white';this.players.white={name:String(data.name||'訪客').slice(0,20),resumeToken:token(),peerId:id,connected:true};}
      else {role='spectator';this.spectators.set(id,{name:String(data.name||'觀眾').slice(0,20)});}
      this.updateStatus();this.changed();
      this.send(id,'room_joined',{roomId:this.id,role,resumeToken:role==='spectator'?null:this.players[role].resumeToken});
      const notice={type:resumed?'player_reconnected':'player_joined',name:role==='spectator'?this.spectators.get(id).name:this.players[role].name,role,roomState:this.snapshot()};
      for(const p of Object.values(this.players))if(p?.connected&&p.peerId!==id)this.deliver(p.peerId,notice);
      for(const spectator of this.spectators.keys())if(spectator!==id)this.deliver(spectator,notice);
    }
    roleOf(id) { return ROLES.find(r=>this.players[r]?.peerId===id && this.players[r].connected) || (this.spectators.has(id)?'spectator':null); }
    clearExpiry(role){const t=this.expiryTimers.get(role);if(t)clearTimeout(t);this.expiryTimers.delete(role);}
    expire(role,peerId){const p=this.players[role];if(!p||p.connected||p.peerId!==peerId)return;this.players[role]=null;this.updateStatus();this.broadcast('player_left',{role,name:p.name,reconnecting:false});}
    dispose(){for(const t of this.expiryTimers.values())clearTimeout(t);this.expiryTimers.clear();clearTimeout(this.voteTimer);}
    disconnect(id, intentional=false) {
      const role=this.roleOf(id); if(!role)return;
      if(role==='spectator')this.spectators.delete(id);
      else if(role==='white') {this.clearExpiry('white');if(intentional)this.players.white=null;else {this.players.white.connected=false;this.expiryTimers.set('white',setTimeout(()=>this.expire('white',id),GRACE_MS));} }
      else if(role==='black') { this.players.black.connected=false; }
      this.updateStatus(); this.broadcast('player_left',{role,name:role==='spectator'?'觀眾':this.players[role]?.name||'',reconnecting:!intentional});
    }
    receive(id,data) {
      if(!data || typeof data.type!=='string')return;
      if(data.type==='join_room')return this.join(id,data);
      const role=this.roleOf(id);if(!role)return;
      if(data.type==='leave_room')return this.disconnect(id,true);
      if(data.type==='sync_request')return this.send(id,'state_sync');
      if(data.type==='reaction') {if(role!=='spectator')this.broadcast('reaction',{emoji:String(data.emoji||'').slice(0,8),from:this.players[role].name,role});return;}
      if(data.type==='restart') {
        if(role==='spectator')return;
        if(!this.restartVotes.size){clearTimeout(this.voteTimer);this.voteTimer=setTimeout(()=>{if(this.restartVotes.size){this.restartVotes.clear();this.broadcast('restart_vote_expired');}},VOTE_MS);}
        this.restartVotes.add(role);
        if(this.restartVotes.size===2 && this.players.white?.connected && this.players.black.connected){this.engine.reset();this.version++;this.restartVotes.clear();clearTimeout(this.voteTimer);this.updateStatus();this.broadcast('game_restarted',{by:this.players[role].name});}
        else this.broadcast('restart_requested',{by:this.players[role].name,neededVotes:2});return;
      }
      if(data.type!=='move')return;
      if(role==='spectator'||this.status!=='playing'||role!==this.engine.turn) return this.error(id,'現在不是你的回合');
      const x=data.x,y=data.y;
      if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=15||y<0||y>=15||!this.engine.makeMove(x,y))return this.error(id,'這一步不符合規則');
      this.version++;this.restartVotes.clear();this.updateStatus();this.broadcast('move_made',{move:{...this.engine.lastMove,by:role}});
    }
  }
  root.PocketGomokuAuthority=GomokuAuthority;
})(window);
