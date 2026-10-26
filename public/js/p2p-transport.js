/* Pocket Game PeerJS DataConnection transport. Host browser retains authority. */
(function(root){'use strict';
const CONNECTING=0, OPEN=1, CLOSED=3, WAIT=75000, FRESH_WAIT=25000, RETAIN=24*3600*1000;
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>alphabet[v%alphabet.length]).join('');
const hostId=id=>'pocketgame-v1-'+id;
const hostKey=id=>'pocket_p2p_host_'+id;
const makeGuestId=()=> 'pocketgame-v1-guest-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),v=>v.toString(16).padStart(2,'0')).join('');
function purge(){try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(!k?.startsWith('pocket_p2p_host_')&&!k?.startsWith('pocket_p2p_view_'))continue;const v=JSON.parse(localStorage.getItem(k));const at=v?.savedAt||v?.at;if(!at||Date.now()-at>RETAIN||v.ended)localStorage.removeItem(k);}}catch(_){}}
class P2PSocket {
 constructor(_base,onmessage,onclose,onopen){this.onmessage=onmessage;this.onclose=onclose;this.onopen=onopen;this.readyState=CONNECTING;this.peers=new Map();this.pending=[];this.roomId=null;this.authority=null;this.isHost=false;this.stopped=false;this.hostAnnounced=false;this.offlineSince=0;this.retryTimer=null;this.deadlineTimer=null;this.heartbeat=null;this.peer=null;this.generation=0;this.creationAttempts=0;this.recovering=false;this.tabId=Math.random().toString(36).slice(2);purge();}
 emit(msg){this.onmessage?.({data:JSON.stringify(msg)});}
 error(message){this.emit({type:'error',message});}
 peerOptions(){const c=root.POCKET_PEER_CONFIG||{};return {...c,config:{iceServers:[...(root.POCKET_ICE_SERVERS||[{urls:'stun:stun.l.google.com:19302'}]),...(root.POCKET_TURN_SERVERS||[])]}};}
 acquireHostLock(id){const key='pocket_p2p_active_'+id;try{const old=JSON.parse(localStorage.getItem(key)||'null');if(old&&Date.now()-old.time<12000&&old.id!==this.tabId){this.error('⚠️ 另一個分頁正在主持這個房間');return false;}localStorage.setItem(key,JSON.stringify({id:this.tabId,time:Date.now()}));this.heartbeat=setInterval(()=>localStorage.setItem(key,JSON.stringify({id:this.tabId,time:Date.now()})),4000);return true;}catch(_){return true;}}
 unlock(){clearInterval(this.heartbeat);try{const k='pocket_p2p_active_'+this.roomId,v=JSON.parse(localStorage.getItem(k)||'null');if(v?.id===this.tabId)localStorage.removeItem(k);}catch(_){}}
 create(name){if(this.roomId||this.stopped)return;this.isHost=true;this.hostName=String(name||'房主');this.startNewHost();}
 startNewHost(){if(this.roomId)try{localStorage.removeItem(hostKey(this.roomId))}catch(_){}this.roomId=randomCode();this.authority=new root.PocketGomokuAuthority(this.roomId,this.hostName,(to,msg)=>this.deliver(to,msg));this.persistHost();this.startPeer();}
 persistHost(){if(!this.isHost||!this.authority)return;this.authority.onChange=()=>this.saveHost();this.saveHost();}
 saveHost(){if(!this.isHost||!this.authority)return;try{localStorage.setItem(hostKey(this.roomId),JSON.stringify({room:this.authority.exportState(),savedAt:Date.now()}));}catch(_){}}
 restore(id){if(this.roomId||this.stopped)return false;id=String(id).toUpperCase();try{const saved=JSON.parse(localStorage.getItem(hostKey(id))||'null');if(!saved||saved.room?.id!==id||saved.ended||Date.now()-saved.savedAt>RETAIN){localStorage.removeItem(hostKey(id));return false;}if(!this.acquireHostLock(id))return false;this.roomId=id;this.isHost=true;this.recovering=true;this.authority=root.PocketGomokuAuthority.restore(saved.room,(to,msg)=>this.deliver(to,msg));this.persistHost();this.startPeer();return true;}catch(e){console.warn('Host restore failed',e);return false;}}
 clearHost(){try{localStorage.removeItem(hostKey(this.roomId));}catch(_){}this.unlock();}
 join(id){if(this.roomId||this.stopped)return;id=String(id||'').toUpperCase().trim();if(!/^[A-Z2-9]{8}$/.test(id)){this.error('房間號碼需為 8 位英數字');return;}this.roomId=id;this.isHost=false;this.startPeer();}
 startPeer(){if(this.stopped)return;const generation=++this.generation;this.peer?.destroy?.();this.peer=null;if(!root.Peer){this.error('缺少本地 PeerJS 程式庫，請檢查 vendor/peerjs.min.js');return;}
  const id=this.isHost?hostId(this.roomId):makeGuestId();const p=new root.Peer(id,this.peerOptions());this.peer=p;
  p.on('open',()=>{if(generation!==this.generation||this.stopped)return;this.creationAttempts=0;if(this.isHost){this.hostAnnounced=true;this.readyState=OPEN;this.onopen?.();this.emit({type:'room_created',roomId:this.roomId,role:'black',resumeToken:this.authority.players.black.resumeToken,roomState:this.authority.snapshot()});}
   else this.connectGuest();});
  p.on('connection',conn=>{if(!this.isHost||conn.peer===hostId(this.roomId)||!String(conn.peer).startsWith('pocketgame-v1-guest-')){conn.close();return;}this.bind(conn.peer,conn);});
  p.on('disconnected',()=>{if(this.stopped||generation!==this.generation||p.destroyed)return;this.error('⚠️ 信令暫時離線，既有對戰連線不受影響');this.signalReconnect(p,generation);});
  p.on('error',err=>{if(generation!==this.generation||this.stopped)return;const t=err?.type||'';
    if(this.isHost&&t==='unavailable-id'){if(this.recovering){this.error('⚠️ 舊房號尚未釋放，正在等待恢復…');this.reopenPeer(3000);}else if(++this.creationAttempts<8){this.authority?.dispose?.();this.startNewHost();}else this.error('建立房間失敗，請稍後再試');return;}
    if(!this.isHost&&(t==='peer-unavailable'||t==='network'||t==='server-error')){this.awaitHost();return;}
    this.error('⚠️ PeerJS 信令錯誤：'+String(t||err?.message||'unknown'));});
  p.on('close',()=>{if(this.stopped||generation!==this.generation)return;if(this.isHost)this.reopenPeer(1500);else this.awaitHost();});
 }
 signalReconnect(p,g){if(this.stopped||this.generation!==g)return;clearTimeout(this.signalTimer);this.signalTimer=setTimeout(()=>{if(this.stopped||this.generation!==g)return;try{if(p.disconnected&&!p.destroyed)p.reconnect();}catch(_){this.reopenPeer(1500);}},1200);}
 reopenPeer(delay){if(this.stopped)return;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(this.stopped)return;if(this.isHost&&this.peers.size&&[...this.peers.values()].some(x=>x.open)){this.signalReconnect(this.peer,this.generation);return;}this.startPeer();},delay);}
 connectGuest(){if(this.stopped||this.isHost||[...this.peers.values()].some(x=>x.open))return;const conn=this.peer?.connect(hostId(this.roomId),{reliable:true,serialization:'json'});if(conn)this.bind('host',conn);this.connectTimeout=setTimeout(()=>{if(!this.stopped&&!this.peers.get('host')?.open){this.disposePeer('host');this.awaitHost();}},18000);}
 bind(id,conn){const old=this.peers.get(id);if(old&&old!==conn)this.disposePeer(id);this.peers.set(id,conn);
  conn.on('open',()=>{if(this.stopped||this.peers.get(id)!==conn)return;clearTimeout(this.connectTimeout);if(this.isHost){return;}this.everConnected=true;this.hostPaused=false;this.clearOffline();this.readyState=OPEN;this.onopen?.();for(const message of this.pending.splice(0))this.send(message);});
  conn.on('data',m=>{if(this.stopped||this.peers.get(id)!==conn)return;let data=m;if(typeof m==='string'){try{data=JSON.parse(m)}catch{return;}}if(!data||typeof data!=='object')return;if(this.isHost)this.authority?.receive(id,data);else if(data.type==='host_paused'){this.hostPaused=true;this.awaitHost(true);}else if(data.type==='room_ended'){this.ended(data.message||'房主已離開，房間已結束');}else this.emit(data);});
  conn.on('close',()=>this.connectionLost(id,conn));conn.on('error',()=>this.connectionLost(id,conn));
  const inspect=()=>{if(this.stopped||this.peers.get(id)!==conn)return;const s=conn.peerConnection?.connectionState;if(s==='failed'||s==='closed')this.connectionLost(id,conn);else if(s==='disconnected'){if(!this.isHost)this.error('⚠️ 與房主連線不穩，等待恢復…');clearTimeout(conn._disconnectTimer);conn._disconnectTimer=setTimeout(()=>{if(conn.peerConnection?.connectionState==='disconnected')this.connectionLost(id,conn);},12000);}else if(s==='connected')clearTimeout(conn._disconnectTimer);};
  if(conn.peerConnection)conn.peerConnection.addEventListener('connectionstatechange',inspect);
 }
 connectionLost(id,conn){if(this.stopped||this.peers.get(id)!==conn)return;this.disposePeer(id,conn);if(this.isHost)this.authority?.disconnect(id);else {this.readyState=CONNECTING;this.awaitHost();}}
 disposePeer(id,conn=this.peers.get(id)){if(!conn||this.peers.get(id)!==conn)return;this.peers.delete(id);clearTimeout(conn._disconnectTimer);try{conn.close()}catch(_){}}
 awaitHost(paused=false){if(this.stopped||this.isHost)return;paused=paused||this.hostPaused;if(!this.offlineSince){this.offlineSince=Date.now();
  // A guest that never reached this host and holds no saved seat is most likely using a wrong/ended code: give up sooner.
  let known=this.everConnected;try{known=known||!!localStorage.getItem('pocket_room_session_'+this.roomId);}catch(_){}
  this.deadlineTimer=setTimeout(()=>this.ended(known?'房主已離線，房間已結束':'找不到房間，或房主目前不在線'),known?WAIT:FRESH_WAIT);}this.error(paused?'⚠️ 房主離開了頁面，等待返回中（約 75 秒後結束房間）…':'⚠️ 與房主連線不穩，等待恢復…');clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(this.stopped||this.isHost)return;if(!this.peer||this.peer.destroyed)this.startPeer();else if(this.peer.disconnected)this.signalReconnect(this.peer,this.generation);else if(!this.peers.get('host')?.open){this.disposePeer('host');this.connectGuest();}},Math.min(2000+Math.floor((Date.now()-this.offlineSince)/5000)*500,8000));}
 clearOffline(){this.offlineSince=0;clearTimeout(this.deadlineTimer);clearTimeout(this.retryTimer);this.deadlineTimer=this.retryTimer=null;}
 deliver(to,msg){if(to==='host')this.emit(msg);else{const c=this.peers.get(to);if(c?.open)c.send(msg);}}
 send(raw){if(this.stopped)return;let msg;try{msg=JSON.parse(raw)}catch{return;}if(msg.type==='create_room'){this.create(msg.name);return;}
  if(this.isHost){if(msg.type==='leave_room'){for(const c of this.peers.values())if(c.open)c.send({type:'room_ended',message:'房主已離開，房間已結束'});this.clearHost();}this.authority?.receive('host',msg);return;}
  const c=this.peers.get('host');if(c?.open)c.send(msg);else if(this.pending.length<10&&!this.pending.some(x=>x===raw))this.pending.push(raw);
 }
 pause(){if(!this.isHost)return;this.saveHost();for(const c of this.peers.values())if(c.open)try{c.send({type:'host_paused'})}catch(_){}}
 ended(message){if(this.stopped)return;this.emit({type:'room_ended',message});this.close();}
 close(){if(this.stopped)return;this.stopped=true;this.readyState=CLOSED;clearTimeout(this.retryTimer);clearTimeout(this.deadlineTimer);clearTimeout(this.signalTimer);clearTimeout(this.connectTimeout);this.unlock();for(const [id,c] of [...this.peers])this.disposePeer(id,c);try{this.peer?.destroy()}catch(_){}this.authority?.dispose?.();this.onclose?.();}
}
root.PocketP2PSocket=P2PSocket;
})(window);
