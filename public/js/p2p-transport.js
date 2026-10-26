/* WebSocket-compatible transport adapter for app.js; phase 1 supports Gomoku only. */
(function(root){
const OPEN=1, CLOSED=3;
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]}; // demo STUN; production should use managed STUN/TURN
const makeCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');
class P2PSocket {
  constructor(signalBase, onmessage, onclose, onopen) {
    this.readyState=0;this.onmessage=onmessage;this.onclose=onclose;this.onopen=onopen;
    this.peers=new Map();this.authority=null;this.isHost=false;this.roomId=null;
    this.base=signalBase;this.signaling=null;this.pending=[];this.readyState=OPEN;
  }
  emit(msg){this.onmessage?.({data:JSON.stringify(msg)});}
  async signal(roomId,isHost){
    if(this.signaling)this.signaling.close();
    this.roomId=roomId;this.isHost=isHost;
    const ws=new WebSocket(`${this.base.replace(/\/$/,'')}/signal/${roomId}`);
    this.signaling=ws;
    ws.onmessage=async({data})=>{
      let m;try{m=JSON.parse(data)}catch{return}
      if(m.type==='signal_ready')ws.send(JSON.stringify({type:isHost?'register_host':'register_guest'}));
      if(m.type==='host_registered') {this.emit({type:'room_created',roomId:this.roomId,role:'black',resumeToken:this.authority.players.black.resumeToken,roomState:this.authority.snapshot()});}
      if(m.type==='guest_registered'){this.peerId=m.id;}
      if(m.type==='guest_arrived'&&this.isHost)await this.offer(m.id);
      if(m.type==='relay')await this.processSignal(m.from,m.payload);
      if(m.type==='guest_gone'&&this.isHost){this.peers.get(m.id)?.pc.close();this.peers.delete(m.id);this.authority?.disconnect(m.id);}
      if(m.type==='host_gone'){this.emit({type:'error',message:'房主離線，房間暫停'});this.close();}
      if(m.type==='signal_error'){this.emit({type:'error',message:m.message});this.close();}
    };
    ws.onclose=()=>{if(this.readyState!==CLOSED)this.close();};
    ws.onerror=()=>this.emit({type:'error',message:'信令連線失敗'});
  }
  sendSignal(to,payload){if(this.signaling?.readyState===OPEN)this.signaling.send(JSON.stringify({type:'relay',to,payload}));}
  makePeer(id){
    const pc=new RTCPeerConnection(ICE);const peer={pc,channel:null,candidates:[]};this.peers.set(id,peer);
    pc.onicecandidate=e=>{if(e.candidate)this.sendSignal(id,{candidate:e.candidate.toJSON()});};
    pc.ondatachannel=e=>this.bindChannel(id,e.channel);
    pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState) && this.isHost){this.authority?.disconnect(id);}};
    return peer;
  }
  bindChannel(id,ch){
    const peer=this.peers.get(id);peer.channel=ch;
    ch.onopen=()=>{
      if(this.isHost)return;
      this.readyState=OPEN;this.onopen?.();this.pending.splice(0).forEach(m=>this.send(m));
    };
    ch.onmessage=e=>{
      let msg;try{msg=JSON.parse(e.data)}catch{return}
      if(this.isHost)this.authority?.receive(id,msg);else this.emit(msg);
    };
    ch.onclose=()=>{if(this.isHost)this.authority?.disconnect(id);else this.close();};
  }
  async offer(id){const p=this.makePeer(id);this.bindChannel(id,p.pc.createDataChannel('game',{ordered:true}));await p.pc.setLocalDescription(await p.pc.createOffer());this.sendSignal(id,{description:p.pc.localDescription.toJSON()});}
  async processSignal(id,payload){
    let p=this.peers.get(id);if(!p)p=this.makePeer(id);
    if(payload.description){await p.pc.setRemoteDescription(payload.description);if(payload.description.type==='offer'){await p.pc.setLocalDescription(await p.pc.createAnswer());this.sendSignal(id,{description:p.pc.localDescription.toJSON()});}}
    if(payload.candidate){ if(!p.pc.remoteDescription)p.candidates.push(payload.candidate);else try{await p.pc.addIceCandidate(payload.candidate)}catch(e){console.warn('ICE candidate error',e)} }
    if(p.pc.remoteDescription && p.candidates.length){for(const c of p.candidates.splice(0))try{await p.pc.addIceCandidate(c)}catch(e){console.warn('ICE candidate error',e)}}
  }
  send(raw){
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='create_room'){
      if(this.authority)return;
      const code=makeCode();this.authority=new root.PocketGomokuAuthority(code,String(msg.name||'房主'),(id,m)=>{
        if(id==='host')this.emit(m);else {const ch=this.peers.get(id)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify(m));}
      });
      this.signal(code,true);
      return;
    }
    if(this.isHost){this.authority?.receive('host',msg);return;}
    const ch=this.peers.get('host')?.channel;
    if(ch?.readyState==='open')ch.send(raw);else this.pending.push(raw);
  }
  join(roomId){this.signal(roomId,false);}
  close(){if(this.readyState===CLOSED)return;this.readyState=CLOSED;try{this.signaling?.close()}catch{};for(const p of this.peers.values())p.pc.close();this.peers.clear();this.onclose?.();}
}
root.PocketP2PSocket=P2PSocket;
})(window);
