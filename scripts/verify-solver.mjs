import { cube3x3x3 } from 'cubing/puzzles';
import { KPattern } from 'cubing/kpuzzle';
import { experimentalSolve3x3x3IgnoringCenters } from 'cubing/search';
import { Alg } from 'cubing/alg';

// face order U R F D L B
const FACE = { U:0, R:1, F:2, D:3, L:4, B:5 };
const idx = (f, i) => FACE[f]*9 + i;

// Kociemba corner/edge facelet tables (0-indexed per face)
const CORNER_FACELETS = {
  URF: [idx('U',8), idx('R',0), idx('F',2)],
  UFL: [idx('U',6), idx('F',0), idx('L',2)],
  ULB: [idx('U',0), idx('L',0), idx('B',2)],
  UBR: [idx('U',2), idx('B',0), idx('R',2)],
  DFR: [idx('D',2), idx('F',8), idx('R',6)],
  DLF: [idx('D',0), idx('L',8), idx('F',6)],
  DBL: [idx('D',6), idx('B',8), idx('L',6)],
  DRB: [idx('D',8), idx('R',8), idx('B',6)],
};
const EDGE_FACELETS = {
  UR: [idx('U',5), idx('R',1)], UF: [idx('U',7), idx('F',1)],
  UL: [idx('U',3), idx('L',1)], UB: [idx('U',1), idx('B',1)],
  DR: [idx('D',5), idx('R',7)], DF: [idx('D',1), idx('F',7)],
  DL: [idx('D',3), idx('L',7)], DB: [idx('D',7), idx('B',7)],
  FR: [idx('F',5), idx('R',3)], FL: [idx('F',3), idx('L',5)],
  BL: [idx('B',5), idx('L',3)], BR: [idx('B',3), idx('R',5)],
};

// cubing.js piece orderings (derived empirically)
const CUBING_CORNERS = ['URF','UBR','ULB','UFL','DFR','DLF','DBL','DRB'];
const CUBING_EDGES  = ['UF','UR','UB','UL','DF','DR','DB','DL','FR','FL','BR','BL'];
const POS_CORNER = Object.fromEntries(CUBING_CORNERS.map((n,i)=>[n,i]));
const POS_EDGE = Object.fromEntries(CUBING_EDGES.map((n,i)=>[n,i]));

const UD = new Set(['U','D']), FB = new Set(['F','B']);
const primaryColor = (piece) => piece.split('').find(c=>UD.has(c)) ?? piece.split('').find(c=>FB.has(c));

function faceletsToPatternData(f) {
  const cornerPieces = new Array(8), cornerOri = new Array(8);
  for (const [pos, fl] of Object.entries(CORNER_FACELETS)) {
    const cols = fl.map(i=>f[i]);
    const piece = Object.keys(CORNER_FACELETS).find(n=>n.split('').sort().join('')===cols.slice().sort().join(''));
    cornerPieces[POS_CORNER[pos]] = POS_CORNER[piece];
    cornerOri[POS_CORNER[pos]] = cols.findIndex(c=>UD.has(c));
  }
  const edgePieces = new Array(12), edgeOri = new Array(12);
  for (const [pos, fl] of Object.entries(EDGE_FACELETS)) {
    const cols = fl.map(i=>f[i]);
    const piece = Object.keys(EDGE_FACELETS).find(n=>n.split('').sort().join('')===cols.slice().sort().join(''));
    edgePieces[POS_EDGE[pos]] = POS_EDGE[piece];
    edgeOri[POS_EDGE[pos]] = cols[0]===primaryColor(piece) ? 0 : 1;
  }
  return {
    CORNERS: { pieces: cornerPieces, orientation: cornerOri },
    EDGES: { pieces: edgePieces, orientation: edgeOri },
    CENTERS: { pieces: [0,1,2,3,4,5], orientation: [0,0,0,0,0,0], orientationMod: [1,1,1,1,1,1] },
  };
}

// ---- facelet-level simulator ----
const FACE_ROT = [6,3,0,7,4,1,8,5,2]; // new[i] = old[FACE_ROT[i]] for CW
const CYCLES = {
  U: [[['F',0],['F',1],['F',2]],[['L',0],['L',1],['L',2]],[['B',0],['B',1],['B',2]],[['R',0],['R',1],['R',2]]],
  D: [[['F',6],['F',7],['F',8]],[['R',6],['R',7],['R',8]],[['B',6],['B',7],['B',8]],[['L',6],['L',7],['L',8]]],
  R: [[['U',2],['U',5],['U',8]],[['B',6],['B',3],['B',0]],[['D',2],['D',5],['D',8]],[['F',2],['F',5],['F',8]]],
  L: [[['U',0],['U',3],['U',6]],[['F',0],['F',3],['F',6]],[['D',0],['D',3],['D',6]],[['B',8],['B',5],['B',2]]],
  F: [[['U',6],['U',7],['U',8]],[['R',0],['R',3],['R',6]],[['D',2],['D',1],['D',0]],[['L',8],['L',5],['L',2]]],
  B: [[['U',2],['U',1],['U',0]],[['L',0],['L',3],['L',6]],[['D',6],['D',7],['D',8]],[['R',8],['R',5],['R',2]]],
};
// each cycle: [a,b,c,d] means new a = old b? define: CW move sends last -> first? We'll test.
function applyMoveFacelets(state, move) {
  const m = move[0]; const suf = move.slice(1);
  const times = suf==="'" ? 3 : suf==='2' ? 2 : 1;
  for (let t=0;t<times;t++) {
    const next = state.slice();
    // rotate face CW
    for (let i=0;i<9;i++) next[idx(m,i)] = state[idx(m,FACE_ROT[i])];
    // cycle strips: each strip gets previous strip's values (last->first)
    const strips = CYCLES[m].map(s=>s.map(([f,i])=>idx(f,i)));
    for (let s=0;s<4;s++) for (let j=0;j<3;j++) next[strips[s][j]] = state[strips[(s+3)%4][j]];
    state = next;
  }
  return state;
}

const solvedStr = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const kp = await cube3x3x3.kpuzzle();

async function test(scramble) {
  let st = solvedStr.split('');
  for (const mv of scramble.split(' ')) st = applyMoveFacelets(st, mv);
  const facelets = st.join('');
  const pd = faceletsToPatternData(facelets);
  const pat = new KPattern(kp, pd);
  // convention check: maybe pieces[] means position->piece; try direct first
  const sol = await experimentalSolve3x3x3IgnoringCenters(pat);
  const after = pat.applyAlg(sol);
  const ok = after.experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  console.log(scramble, '->', sol.toString(), ok ? 'SOLVED ✓' : 'FAILED ✗');
  return ok;
}

await test('R U R\' U\'');
await test('F R U\' R\' U\' R U R\' F\' R U R\' U\' R\' F R F\'');
await test('D2 L2 B2 U\' R2 F2 D\' B\' L\' F\' R\' D U B2 L\' D\'');
