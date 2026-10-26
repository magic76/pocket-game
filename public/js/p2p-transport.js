/* Pocket Game signaling is disposable; RTC channels are not. */
(function(root){
'use strict';
const OPEN=1, CONNECTING=0, CLOSED=3;
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const sleepTimeout=18000;
class P2PSocket{
 constructor(base,onmessage,onclose,onopen){
  this.base=base;this.onmessage=onmessage;this.onclose=onclose;this.onopen=onopen;
  this.readyState=CONNECTING;this.peers=new Map();this.pending=[];this.isHost=false;
  this.roomId=null;this.authority=null;this.signaling=null;this.generation=0;
  this.attempt=0;this.stopped=false;this.hostSecret=null;this.signalTimer=null;this.connectionTimer=null;
 }
 emit(msg){this.onmessage?.({data:JSON.stringify(msg)});}
 error(message){this.emit({type:'error',message});}
 async iceConfig(){
  try{const endpoint=root.POCKET_TURN_ENDPOINT||'/turn-credentials'; const res=await fetch(endpoint,{cache:'no-store'});
   if(res.ok){const data=await res.json();if(Array.isArray(data.iceServers)&&data.iceServers.length)return {iceServers:data.iceServers};}
  }catch(_){}return {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
 }
 create(name){
  if(this.roomId||this.stopped)return;
  const id=code();this.roomId=id;this.isHost=true;this.hostSecret=secret();
  this.authority=new root.PocketGomokuAuthority(id,String(name||'房主'),(to,msg)=>this.deliver(to,msg));
  this.connectSignal();
 }
 join(id){
  if(this.roomId||this.stopped)return;
  id=String(id||'').trim().toUpperCase();if(!/^[A-Z2-9]{8}$/.test(id)){this.error('房間號碼需為 8 位英數字');return;}
  this.roomId=id;this.isHost=false;this.connectSignal();
 }
 connectSignal(){
  if(this.stopped||!this.roomId)return;
  const generation=++this.generation;
  let url;
  try{const base=this.base.replace(/\/$/,'');url=`${base}/signal/${this.roomId}`;}catch(e){this.error('信令網址無效');return;}
  const ws=new WebSocket(url);this.signaling=ws;
  ws.onopen=()=>{if(this.generation!==generation)return;this.attempt=0;};
  ws.onmessage=async(e)=>{
   if(this.generation!==generation||this.stopped)return;
   let m;try{m=JSON.parse(e.data)}catch{return}
   try{
    // Guest whose DataChannel is still open (signaling-only reconnect): do not re-register. A new
    // register_guest makes the host send a fresh offer, which renegotiates and breaks the live channel.
    if(m.type==='signal_ready'&&!this.isHost&&this.peers.get('host')?.channel?.readyState==='open')return;
    if(m.type==='signal_ready')this.sendSignalRaw({type:this.isHost?'register_host':'register_guest',...(this.isHost?{secret:this.hostSecret}:{})});
    if(m.type==='host_registered'){
     if(!this.hostAnnounced){this.hostAnnounced=true;this.readyState=OPEN;this.onopen?.();this.emit({type:'room_created',roomId:this.roomId,role:'black',resumeToken:this.authority.players.black.resumeToken,roomState:this.authority.snapshot()});}
    }
    if(m.type==='guest_registered'){this.peerId=m.id;}
    if(m.type==='guest_arrived'&&this.isHost){await this.offer(m.id);}
    if(m.type==='relay')await this.processSignal(m.from,m.payload);
    if(m.type==='host_gone'&&!this.isHost){this.ended('房主已離開，房間已結束');}
    if(m.type==='signal_error'){
     if(m.fatal)this.ended(m.message||'房間已結束');else this.error(m.message||'信令暫時失敗');
    }
   }catch(err){console.warn('P2P signaling message failure',err);}
  };
  ws.onclose=()=>{if(this.generation!==generation||this.stopped)return;this.signaling=null;
   // Existing RTC DataChannels remain alive. Signal connection can be re-registered.
   clearTimeout(this.signalTimer);
   this.signalTimer=setTimeout(()=>this.connectSignal(),Math.min(1000*2**Math.min(this.attempt++,5),12000));
  };
  ws.onerror=()=>{};
 }
 sendSignalRaw(m){if(this.signaling?.readyState===OPEN)this.signaling.send(JSON.stringify(m));}
 sendSignal(to,payload){this.sendSignalRaw({type:'relay',to,payload});}
 async makePeer(id){
  let old=this.peers.get(id);if(old){try{old.channel?.close();old.pc.close();}catch(_){}this.peers.delete(id);}
  const ice=await this.iceConfig();
  if(this.stopped)return null;
  const pc=new RTCPeerConnection(ice),peer={pc,channel:null,candidates:[],disconnectedTimer:null,connectTimer:null};
  this.peers.set(id,peer);
  pc.onicecandidate=e=>{if(e.candidate)this.sendSignal(id,{candidate:e.candidate.toJSON()});};
  pc.ondatachannel=e=>this.bindChannel(id,e.channel);
  pc.onconnectionstatechange=()=>{
   if(this.peers.get(id)!==peer)return;
   const state=pc.connectionState;
   if(state==='connected'){clearTimeout(peer.disconnectedTimer);clearTimeout(peer.connectTimer);}
   if(state==='disconnected'){
    clearTimeout(peer.disconnectedTimer);
    peer.disconnectedTimer=setTimeout(()=>{if(pc.connectionState==='disconnected')this.markDisconnected(id);},12000);
   }
   if(state==='failed'||state==='closed')this.markDisconnected(id);
  };
  peer.connectTimer=setTimeout(()=>{if(pc.connectionState!=='connected'){
   if(!this.isHost)this.error('P2P 連線逾時，請換個網路重試，或啟用 TURN 中繼');
   this.markDisconnected(id);
  }},sleepTimeout);
  return peer;
 }
 markDisconnected(id){
  const peer=this.peers.get(id);if(!peer)return;
  // ICE 'failed' means the peer is gone even if the SCTP channel has not noticed yet.
  if(peer.channel?.readyState==='open'&&peer.pc.connectionState!=='failed')return;
  if(this.isHost){this.authority?.disconnect(id);}
  else if(!this.stopped){this.readyState=CONNECTING;this.error('與房主的對戰連線中斷，正在嘗試恢復');
   // signaling connection may still be open; new guest registration yields a new offer
   this.reconnectGuest();}
 }
 reconnectGuest(){
  if(this.stopped||this.isHost)return;
  for(const peer of this.peers.values()){clearTimeout(peer.connectTimer);clearTimeout(peer.disconnectedTimer);peer.pc.close();}
  this.peers.clear();this.readyState=CONNECTING;
  if(this.signaling){const s=this.signaling;this.generation++;this.signaling=null;s.close();}
  clearTimeout(this.signalTimer);this.signalTimer=setTimeout(()=>this.connectSignal(),800);
 }
 bindChannel(id,ch){
  const peer=this.peers.get(id);if(!peer)return;peer.channel=ch;
  ch.onopen=()=>{if(this.stopped)return;
   clearTimeout(peer.connectTimer);clearTimeout(peer.disconnectedTimer);
   if(!this.isHost){this.readyState=OPEN;this.onopen?.();this.pending.splice(0).forEach(m=>this.send(m));}
  };
  ch.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return}
   if(this.isHost)this.authority?.receive(id,msg);else this.emit(msg);
  };
  ch.onclose=()=>{if(this.stopped)return;if(this.isHost)this.authority?.disconnect(id);else this.reconnectGuest();};
 }
 async offer(id){const p=await this.makePeer(id);if(!p)return;
  this.bindChannel(id,p.pc.createDataChannel('game',{ordered:true}));
  await p.pc.setLocalDescription(await p.pc.createOffer());this.sendSignal(id,{description:p.pc.localDescription.toJSON()});
 }
 async processSignal(id,payload){
  if(!payload||typeof payload!=='object')return;
  // makePeer awaits /turn-credentials; offer + ICE candidates arrive back-to-back, so share one pending
  // peer per id instead of racing two RTCPeerConnections (the orphan one then timed out after 18 s).
  let p=this.peers.get(id);
  if(!p){this.making??=new Map();if(!this.making.has(id))this.making.set(id,this.makePeer(id).finally(()=>this.making.delete(id)));p=await this.making.get(id);}
  if(!p)return;
  if(payload.description){await p.pc.setRemoteDescription(payload.description);
   if(payload.description.type==='offer'){await p.pc.setLocalDescription(await p.pc.createAnswer());this.sendSignal(id,{description:p.pc.localDescription.toJSON()});}}
  if(payload.candidate){if(!p.pc.remoteDescription)p.candidates.push(payload.candidate);else try{await p.pc.addIceCandidate(payload.candidate)}catch(e){console.warn('ICE candidate error',e)}}
  if(p.pc.remoteDescription)for(const c of p.candidates.splice(0))try{await p.pc.addIceCandidate(c)}catch(e){console.warn('ICE candidate error',e)}
 }
 deliver(to,msg){if(to==='host')this.emit(msg);else {const ch=this.peers.get(to)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify(msg));}}
 send(raw){if(this.stopped)return;let msg;try{msg=JSON.parse(raw)}catch{return}
  if(msg.type==='create_room'){this.create(msg.name);return;}
  if(this.isHost){if(msg.type==='leave_room'){for(const peer of this.peers.values())if(peer.channel?.readyState==='open')peer.channel.send(JSON.stringify({type:'room_ended',message:'房主已離開，房間已結束'}));this.sendSignalRaw({type:'end_room',secret:this.hostSecret});}this.authority?.receive('host',msg);return;}
  const channel=this.peers.get('host')?.channel;
  if(channel?.readyState==='open')channel.send(raw);else if(this.pending.length<10)this.pending.push(raw);
 }
 ended(message){if(this.stopped)return;this.emit({type:'room_ended',message});this.close();}
 close(){if(this.stopped)return;this.stopped=true;this.readyState=CLOSED;clearTimeout(this.signalTimer);
  try{this.signaling?.close()}catch(_){};for(const p of this.peers.values()){clearTimeout(p.connectTimer);clearTimeout(p.disconnectedTimer);p.pc.close();}
  this.peers.clear();this.authority?.dispose?.();this.onclose?.();}
}
root.PocketP2PSocket=P2PSocket;
})(window);
