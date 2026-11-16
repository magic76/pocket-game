// Connect Four committed moves must visibly fall from above the entire board.
// Test the real draw method in a lightweight DOM harness (no browser dependency).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const js=fs.readFileSync(path.join(__dirname,'..','public','js','app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','public','css','style.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const start=js.indexOf('    drawConnect4Board(engine, onColClick, animateLastMove = false) {');
const end=js.indexOf('    drawUTTTBoard(engine, onCellClick) {',start);
assert(start>0&&end>start,'connect4 draw method must exist');
const method=js.slice(start,end);
const timers=[];

class FakeElement {
  constructor(tag) {
    this.tag=tag;this.children=[];this.events={};
    this.offsetWidth=42;this.offsetHeight=42;this.offsetLeft=5;this.offsetTop=5;
    this.style={setProperty:(k,v)=>this.style[k]=v};
    this.classes=new Set();
    this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c)};
  }
  set innerHTML(_v){this.children=[];}
  set className(value){this._className=value;}
  get className(){return this._className;}
  appendChild(child){
    if(this.tag==='board'&&child.className==='connect4-cell') {
      const idx=this.children.length;
      child.offsetLeft=10+(idx%7)*56;
      child.offsetTop=10+Math.floor(idx/7)*56;
    }
    this.children.push(child);
    child.parent=this;
  }
  addEventListener(type,listener){this.events[type]=listener;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
}
let reduceMotion=false;
const document={createElement:tag=>new FakeElement(tag)};
const window={matchMedia:()=>({matches:reduceMotion})};
const draw=vm.runInNewContext('({'+method+'}).drawConnect4Board',{
  document,window,setTimeout:fn=>timers.push(fn)
},{filename:'connect4-draw.js'});

function setup(r,c) {
  const board=new FakeElement('board');
  const grid=Array.from({length:6},()=>Array(7).fill(null));
  grid[r][c]='red';
  const engine={rows:6,cols:7,board:grid,lastMove:{r,c,color:'red'},winningCells:[]};
  const context={dom:{boardEl:board}};
  return {board,engine,context};
}
function fallingDisc(board) {
  return board.children.find(child=>String(child.className||'').includes('gravity-falling'));
}
function inspect(r,expectedCells=42) {
  const {board,engine,context}=setup(r,3);
  draw.call(context,engine,()=>{},true);
  assert.equal(board.children.length,expectedCells+1,'temporary overlay is board-level child');
  const overlay=fallingDisc(board);
  assert(overlay,'falling disc should be rendered outside its circular cell');
  assert.equal(overlay.style.left,'183px','disc must align with chosen column');
  const expectedY=15+r*56;
  assert.equal(overlay.style.top,expectedY+'px');
  assert.equal(overlay.style['--connect4-drop-start'],'-'+(expectedY+50)+'px');
  assert.equal(overlay.style.width,'42px');
  assert.equal(overlay.style.height,'42px');
  const final=board.children[r*7+3].children[0];
  assert(final.classes.has('gravity-target'),'final disc hidden during fall');
  assert.equal(typeof overlay.events.animationend,'function');
  overlay.events.animationend();
  assert(!final.classes.has('gravity-target'),'final disc revealed at touchdown');
  assert.equal(fallingDisc(board),undefined,'overlay disposed after touchdown');
  assert.equal(board.children.length,expectedCells);
  return {board,engine,context};
}
inspect(5); // longest fall from board top to bottom row
inspect(0); // short fall into the top row of a nearly filled column
console.log('PASS Connect4 full-height gravity paths and final-row reveal');

{
  const {board,engine,context}=setup(5,3);
  draw.call(context,engine,()=>{},false);
  assert.equal(board.children.length,42,'resync/reload should not replay last move');
  assert.equal(fallingDisc(board),undefined);
  reduceMotion=true;
  draw.call(context,engine,()=>{},true);
  assert.equal(board.children.length,42,'reduced-motion mode shows the final disc directly');
  assert.equal(fallingDisc(board),undefined);
  reduceMotion=false;
  console.log('PASS Connect4 resync and reduced-motion behavior');
}
{
  const {board,engine,context}=setup(5,3);
  draw.call(context,engine,()=>{},true);
  assert(fallingDisc(board),'overlay must exist before timeout');
  timers.at(-1)();
  assert.equal(board.children.length,42,'fallback must reveal static disc if animationend fails');
  console.log('PASS Connect4 animationend fallback');
}

assert(css.includes('position: relative;\n    width: 100%;\n    height: 100%;\n    background: #1e3a8a;'),'board must anchor the absolute overlay');
assert(css.includes('.connect4-disc.gravity-falling'),'falling layer style must be defined');
assert(css.includes('@keyframes connect4GravityFall'),'gravity keyframe must exist');
assert(css.includes('translateY(var(--connect4-drop-start))'),'motion must start above board');
assert(css.includes('prefers-reduced-motion: reduce'),'reduced motion must be supported');
assert(js.includes("this.renderOnlineBoard(this.selectedGame === 'connect4')"),'online accepted moves animate');
assert(js.includes("this.renderLocalBoard(true)"),'local/AI accepted moves animate');
assert(js.includes('renderLocalBoard(animateConnect4 = false)'), 'initial and resync renders must stay static');
assert(html.includes('css/style.css?v=connect4-gravity-1'),'stylesheet cache-busted');
assert(html.includes('js/app.js?v=connect4-gravity-1'),'controller cache-busted');
console.log('PASS Connect4 CSS, wiring and cache-busting');
