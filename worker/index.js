// Cloudflare Worker + one Durable Object per room. Only signaling, never game moves.
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/health')return Response.json({ok:true});
    const match=/^\/signal\/([A-Z2-9]{8})$/.exec(url.pathname);
    if(!match)return new Response('Not found',{status:404});
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  }
};
export class SignalRoom {
  constructor(state) {this.state=state;this.host=null;this.peers=new Map(); for(const ws of state.getWebSockets()) {const a=ws.deserializeAttachment()||{};if(a.role==='host')this.host=ws;else if(a.role==='guest'&&a.id)this.peers.set(a.id,ws);} }
  async fetch(request) {
    const pair=new WebSocketPair(); const [client,server]=Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({type:'signal_ready'}));
    return new Response(null,{status:101,webSocket:client});
  }
  webSocketMessage(ws,raw) {
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    if(!msg || typeof msg.type!=='string')return;
    const info=ws.deserializeAttachment?.()||{};
    if(msg.type==='register_host') {
      if(info.role)return;
      if(this.host && this.host!==ws) {ws.send(JSON.stringify({type:'signal_error',message:'房間已存在'}));return;}
      this.host=ws;ws.serializeAttachment({role:'host'});ws.send(JSON.stringify({type:'host_registered'}));return;
    }
    if(msg.type==='register_guest') {
      if(info.role)return;
      if(!this.host){ws.send(JSON.stringify({type:'signal_error',message:'房間不存在或房主已離線'}));return;}
      const id=crypto.randomUUID();this.peers.set(id,ws);ws.serializeAttachment({role:'guest',id});
      ws.send(JSON.stringify({type:'guest_registered',id}));this.host.send(JSON.stringify({type:'guest_arrived',id}));return;
    }
    if(msg.type==='relay') {
      if(typeof msg.payload!=='object'||!msg.payload||JSON.stringify(msg.payload).length>12000)return;
      if(info.role==='host' && typeof msg.to==='string')this.peers.get(msg.to)?.send(JSON.stringify({type:'relay',from:'host',payload:msg.payload}));
      else if(info.role==='guest' && this.host)this.host.send(JSON.stringify({type:'relay',from:info.id,payload:msg.payload}));
    }
  }
  webSocketClose(ws) {this.remove(ws);}
  webSocketError(ws) {this.remove(ws);}
  remove(ws) {
    const info=ws.deserializeAttachment?.()||{};
    if(info.role==='host'&&this.host===ws){this.host=null;for(const peer of this.peers.values())try{peer.send(JSON.stringify({type:'host_gone'}));}catch{}}
    if(info.role==='guest'){this.peers.delete(info.id);try{this.host?.send(JSON.stringify({type:'guest_gone',id:info.id}));}catch{}}
  }
}
