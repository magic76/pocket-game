class BingoEngine {
  constructor(){ this.size=5; this.reset(); }
  reset(){ this.board=Array.from({length:25},(_,i)=>i+1); this.marked=[]; this.turn='black'; this.winner=null; this.lastMove=null; }
  loadState(s){ if(!s)return; this.board=s.board||this.board; this.marked=s.marked||[]; this.turn=s.turn||'black'; this.winner=s.winner||null; this.lastMove=s.lastMove||null; }
  makeMove(x,y){ const i=y*5+x; if(this.winner||i<0||i>24||this.marked.includes(i))return false; this.marked.push(i); this.lastMove={x,y}; const line=a=>a.every(n=>this.marked.includes(n)); for(let r=0;r<5;r++)if(line([0,1,2,3,4].map(c=>r*5+c))||line([0,1,2,3,4].map(c=>c*5+r)))this.winner=this.turn; if(line([0,6,12,18,24])||line([4,8,12,16,20]))this.winner=this.turn; this.turn=this.turn==='black'?'white':'black'; return true; }
}
window.BingoEngine=BingoEngine;
