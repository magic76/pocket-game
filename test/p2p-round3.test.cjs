const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
class GomokuEngine{
 constructor(){this.reset()}
 reset(){this.board=Array.from({length:15},()=>Array(15).fill(null));this.turn='black';this.winner=null;this.lastMove=null;this.winningLine=null;this.moveHistory=[]}
 loadState(s){Object.assign(this,{board:s.board,turn:s.turn,winner:s.winner,lastMove:s.lastMove,winningLine:s.winningLine})}
 makeMove(x,y){if(this.board[y][x]||this.winner)return false;this.board[y][x]=this.turn;this.lastMove={x,y,color:this.turn};this.moveHistory.push(this.lastMove);this.turn=this.turn==='black'?'white':'black';return true}
}
const w={GomokuEngine};const ctx={window:w,crypto,setTimeout,clearTimeout,console};
vm.runInNewContext(fs.readFileSync(__dirname+'/../public/js/p2p-authority.js','utf8'),ctx);
const out=[];const deliver=(to,msg)=>out.push({to,msg});const auth=new w.PocketGomokuAuthority('ABCDEFGH','Host',deliver);
auth.join('guest',{name:'Guest'});const resume=auth.players.white.resumeToken;
auth.receive('host',{type:'move',x:7,y:7});auth.receive('guest',{type:'move',x:7,y:8});
const saved=JSON.parse(JSON.stringify(auth.exportState()));assert.equal(saved.engine.moveHistory.length,2);auth.dispose();
const restored=w.PocketGomokuAuthority.restore(saved,deliver);assert.equal(restored.engine.turn,'black');assert.equal(restored.players.white.connected,false);
restored.join('guest-new',{name:'Guest',resumeToken:resume});assert.equal(restored.players.white.connected,true);assert.equal(restored.players.white.peerId,'guest-new');
restored.receive('host',{type:'move',x:7,y:9});assert.equal(restored.version,3);restored.dispose();
console.log('PASS P2P authority export/restore and guest reclaim');
