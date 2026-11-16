/* Browser rule-engine adapter: the same rule engines used by LAN server.js. */
(function(root) {
'use strict';
const TWO=['gomoku','reversi','xiangqi','chess','connect4','uttt'];
const TYPES=[...TWO,'checkers','blokus','bingo','carcassonne'];
const SEATS=['black','white','blue','green'];
const valid=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
const count=(g,n)=>g==='blokus'?(n===4?4:2):g==='checkers'?(n===3?3:2):g==='bingo'||g==='carcassonne'?(valid(n,2,4)?n:2):2;
const engine=(g,n)=>{
  switch(g) {
    case 'gomoku':return new root.GomokuEngine(15);
    case 'reversi':return new root.ReversiEngine(8);
    case 'xiangqi':return new root.XiangqiEngine();
    case 'chess':return new root.ChessEngine();
    case 'checkers':return new root.ChineseCheckersEngine(n);
    case 'connect4':return new root.Connect4Engine(7,6);
    case 'uttt':return new root.UltimateTicTacToeEngine();
    case 'blokus':return new root.BlokusEngine(n);
    default:return null;
  }
};
function state(g,e,n) {
  if(!e)return {};
  const s={board:e.board??null,subBoards:e.subBoards??null,mainBoard:e.mainBoard??null,
    activeBoard:e.activeBoard??null,turn:e.turn,winner:e.winner??null,
    lastMove:e.lastMove??null,capturedPieces:e.capturedPieces??null,
    winningLine:e.winningLine??null,winningCells:e.winningCells??null,
    castlingRights:e.castlingRights??null,enPassantTarget:e.enPassantTarget??null,
    playerCount:e.playerCount??n,size:e.size??null,playerPieces:e.playerPieces??null,
    scores:g==='reversi'?e.getCounts():e.scores??null,
    passedPlayers:e.passedPlayers?[...e.passedPlayers]:null,
    justFlipped:e.justFlipped??null,passedTurn:e.passedTurn??false,
    moveHistory:e.moveHistory??null};
  return s;
}
function restore(g,e,st) {
  e.loadState(st);
  if(g==='gomoku') e.moveHistory=Array.isArray(st.moveHistory)?st.moveHistory:[];
  if(g==='reversi'){e.justFlipped=Array.isArray(st.justFlipped)?st.justFlipped:[];e.passedTurn=st.passedTurn===true;}
  if(g==='connect4') e.winningCells=Array.isArray(st.winningCells)?st.winningCells:[];
}
function role(g,n,turn,e) {
  const two={
    gomoku:{black:'black',white:'white'}, reversi:{black:'black',white:'white'},
    xiangqi:{red:'black',black:'white'},chess:{white:'black',black:'white'},
    connect4:{red:'black',yellow:'white'},uttt:{X:'black',O:'white'}
  };
  if(two[g])return two[g][turn]||null;
  if(g==='checkers'||g==='blokus') return SEATS[e.players.indexOf(turn)]||null;
  if(g==='carcassonne') return ({red:'black',blue:'white',green:'blue',yellow:'green'})[turn]||null;
  if(g==='bingo') return turn;
  return null;
}
function apply(g,e,d) {
  switch(g) {
    case 'gomoku': case 'reversi': {
      const max=g==='gomoku'?14:7;
      return valid(d.x,0,max)&&valid(d.y,0,max)&&e.makeMove(d.x,d.y);
    }
    case 'connect4':return valid(d.col,0,6)&&e.makeMove(d.col);
    case 'uttt':return ['mainR','mainC','subR','subC'].every(k=>valid(d[k],0,2))&&e.makeMove(d.mainR,d.mainC,d.subR,d.subC);
    case 'xiangqi':case 'chess':{
      const mx=g==='xiangqi'?8:7,my=g==='xiangqi'?9:7;
      if(!d.from||!d.to||!valid(d.from.x,0,mx)||!valid(d.from.y,0,my)||!valid(d.to.x,0,mx)||!valid(d.to.y,0,my))return false;
      return e.makeMove(d.from.x,d.from.y,d.to.x,d.to.y);
    }
    case 'checkers':
      return valid(d.from,0,120)&&valid(d.to,0,120)&&e.makeMove(d.from,d.to);
    case 'blokus': {
      if(d.action==='pass'){if(e.getAIMove(e.turn))return false;e.passTurn();return true;}
      if(!valid(d.pieceId,0,20)||!valid(d.originY,0,e.size-1)||!valid(d.originX,0,e.size-1))return false;
      const piece=e.playerPieces[e.turn]?.find(p=>p.id===d.pieceId);
      if(!piece||piece.used||!Array.isArray(d.shape)||d.shape.length<1||d.shape.length>5)return false;
      if(!d.shape.every(pt=>Array.isArray(pt)&&pt.length===2&&valid(pt[0],-5,5)&&valid(pt[1],-5,5)))return false;
      const shape=root.BlokusEngine.normalize(d.shape);
      const orientations=root.BlokusEngine.getAllOrientations(piece.coords);
      if(!orientations.some(choice=>choice.length===shape.length&&choice.every((pt,i)=>pt[0]===shape[i][0]&&pt[1]===shape[i][1])))return false;
      return e.placePiece(d.pieceId,shape,d.originY,d.originX);
    }
    default:return false;
  }
}
root.PocketGameRules=Object.freeze({TYPES,SEATS,count,engine,state,restore,role,apply});
})(window);
