// One Durable Object per room. Signaling only; moves never pass through this Worker.
const isCode=s=>/^[A-Z2-9]{8}$/.test(s);
const originAllowed=(request,env)=>{
 const origin=request.headers.get('Origin');
 // Browsers omit Origin on same-origin GET fetches (e.g. /turn-credentials); trust Sec-Fetch-Site then.
 if(!origin)return request.method==='GET'&&request.headers.get('Sec-Fetch-Site')==='same-origin';
 if(origin===new URL(request.url).origin)return true;
 const permitted=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return permitted.includes(origin);
};
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({ok:true});
  if(url.pathname==='/turn-credentials'){
   if(!originAllowed(request,env))return new Response('Forbidden',{status:403});
   // Cloudflare TURN service: credentials supplied by provider-specific API, not embedded in client.
   // Set TURN_AUTH_URL & TURN_AUTH_TOKEN if your managed TURN provider supports this API shape.
   if(!env.TURN_AUTH_URL||!env.TURN_AUTH_TOKEN)return Response.json({iceServers:[{urls:'stun:stun.l.google.com:19302'}]},{headers:{'Cache-Control':'no-store'}});
   const upstream=await fetch(env.TURN_AUTH_URL,{headers:{Authorization:`Bearer ${env.TURN_AUTH_TOKEN}`}});
   if(!upstream.ok)return Response.json({error:'TURN unavailable'},{status:503});
   const data=await upstream.json();if(!Array.isArray(data.iceServers))return Response.json({error:'Invalid TURN response'},{status:502});
   return Response.json({iceServers:data.iceServers},{headers:{'Cache-Control':'no-store'}});
  }
  const match=/^\/signal\/([^/]+)$/.exec(url.pathname);
  if(!match||!isCode(match[1]))return env.ASSETS?env.ASSETS.fetch(request):new Response('Not found',{status:404});
  if(!originAllowed(request,env))return new Response('Forbidden',{status:403});
  if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
  return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
 }
};
export class SignalRoom{
 constructor(state){
  this.state=state;this.host=null;this.peers=new Map();
  for(const ws of state.getWebSockets()){
   const a=ws.deserializeAttachment()||{};
   if(a.role==='host')this.host=ws;
   else if(a.role==='guest'&&a.id)this.peers.set(a.id,ws);
  }
 }
 async fetch(){
  const pair=new WebSocketPair(),[client,server]=Object.values(pair);
  this.state.acceptWebSocket(server);server.send(JSON.stringify({type:'signal_ready'}));
  return new Response(null,{status:101,webSocket:client});
 }
 async webSocketMessage(ws,raw){
  if(typeof raw!=='string'||raw.length>16000)return;
  let msg;try{msg=JSON.parse(raw)}catch{return}
  if(!msg||typeof msg.type!=='string')return;
  const info=ws.deserializeAttachment?.()||{};
  if(msg.type==='register_host'){
   if(info.role)return;
   const supplied=msg.secret;
   if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied))return ws.send(JSON.stringify({type:'signal_error',fatal:true,message:'無效房主憑證'}));
   const stored=await this.state.storage.get('hostSecret');
   if(stored&&stored!==supplied)return ws.send(JSON.stringify({type:'signal_error',fatal:true,message:'房號已被使用'}));
   if(this.host&&this.host!==ws){try{this.host.close(4000,'Host reconnect');}catch(_){}}
   await this.state.storage.put('hostSecret',supplied);
   this.host=ws;ws.serializeAttachment({role:'host'});
   await this.state.storage.setAlarm(Date.now()+24*60*60*1000);
   ws.send(JSON.stringify({type:'host_registered'}));return;
  }
  if(msg.type==='register_guest'){
   if(info.role)return;
   if(!this.host)return ws.send(JSON.stringify({type:'signal_error',fatal:true,message:'房間不存在或房主已離線'}));
   if(this.peers.size>=12)return ws.send(JSON.stringify({type:'signal_error',fatal:true,message:'房間人數已滿'}));
   const id=crypto.randomUUID();this.peers.set(id,ws);ws.serializeAttachment({role:'guest',id});
   ws.send(JSON.stringify({type:'guest_registered',id}));
   try{this.host.send(JSON.stringify({type:'guest_arrived',id}));}catch(_){}
   return;
  }
  if(msg.type==='end_room'&&info.role==='host'){
   const stored=await this.state.storage.get('hostSecret');
   if(stored!==msg.secret)return;
   for(const peer of this.peers.values())try{peer.send(JSON.stringify({type:'host_gone'}));}catch(_){}
   await this.state.storage.delete('hostSecret');this.host=null;return;
  }
  if(msg.type==='relay'){
   if(!msg.payload||typeof msg.payload!=='object'||JSON.stringify(msg.payload).length>12000)return;
   if(info.role==='host'&&typeof msg.to==='string'){
    try{this.peers.get(msg.to)?.send(JSON.stringify({type:'relay',from:'host',payload:msg.payload}));}catch(_){}
   }else if(info.role==='guest'&&this.host){
    try{this.host.send(JSON.stringify({type:'relay',from:info.id,payload:msg.payload}));}catch(_){}
   }
  }
 }
 webSocketClose(ws){this.remove(ws);}
 webSocketError(ws){this.remove(ws);}
 remove(ws){const info=ws.deserializeAttachment?.()||{};
  if(info.role==='host'&&this.host===ws){this.host=null;
   // DO NOT notify guests host_gone on ordinary signaling loss: RTC may be healthy.
  }
  if(info.role==='guest'&&this.peers.get(info.id)===ws)this.peers.delete(info.id);
 }
 async alarm(){
  for(const ws of this.state.getWebSockets())try{ws.close(4001,'Room signal expired')}catch(_){}
  this.host=null;this.peers.clear();await this.state.storage.delete('hostSecret');
 }
}
