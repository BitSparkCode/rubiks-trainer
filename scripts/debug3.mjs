// debug third scramble state validity
const FACE={U:0,R:1,F:2,D:3,L:4,B:5}; const idx=(f,i)=>FACE[f]*9+i;
const CF={URF:[idx('U',8),idx('R',0),idx('F',2)],UFL:[idx('U',6),idx('F',0),idx('L',2)],ULB:[idx('U',0),idx('L',0),idx('B',2)],UBR:[idx('U',2),idx('B',0),idx('R',2)],DFR:[idx('D',2),idx('F',8),idx('R',6)],DLF:[idx('D',0),idx('L',8),idx('F',6)],DBL:[idx('D',6),idx('B',8),idx('L',6)],DRB:[idx('D',8),idx('R',8),idx('B',6)]};
const EF={UR:[idx('U',5),idx('R',1)],UF:[idx('U',7),idx('F',1)],UL:[idx('U',3),idx('L',1)],UB:[idx('U',1),idx('B',1)],DR:[idx('D',5),idx('R',7)],DF:[idx('D',1),idx('F',7)],DL:[idx('D',3),idx('L',7)],DB:[idx('D',7),idx('B',7)],FR:[idx('F',5),idx('R',3)],FL:[idx('F',3),idx('L',5)],BL:[idx('B',5),idx('L',3)],BR:[idx('B',3),idx('R',5)]};
const FACE_ROT=[6,3,0,7,4,1,8,5,2];
const CYCLES={
U:[[['F',0],['F',1],['F',2]],[['L',0],['L',1],['L',2]],[['B',0],['B',1],['B',2]],[['R',0],['R',1],['R',2]]],
D:[[['F',6],['F',7],['F',8]],[['R',6],['R',7],['R',8]],[['B',6],['B',7],['B',8]],[['L',6],['L',7],['L',8]]],
R:[[['U',2],['U',5],['U',8]],[['B',6],['B',3],['B',0]],[['D',2],['D',5],['D',8]],[['F',2],['F',5],['F',8]]],
L:[[['U',0],['U',3],['U',6]],[['F',0],['F',3],['F',6]],[['D',0],['D',3],['D',6]],[['B',8],['B',5],['B',2]]],
F:[[['U',6],['U',7],['U',8]],[['R',0],['R',3],['R',6]],[['D',2],['D',1],['D',0]],[['L',8],['L',5],['L',2]]],
B:[[['U',2],['U',1],['U',0]],[['L',0],['L',3],['L',6]],[['D',6],['D',7],['D',8]],[['R',8],['R',5],['R',2]]]};
function apply(state,move){const m=move[0],suf=move.slice(1);const times=suf==="'"?3:suf==='2'?2:1;
  for(let t=0;t<times;t++){const next=state.slice();
    for(let i=0;i<9;i++)next[idx(m,i)]=state[idx(m,FACE_ROT[i])];
    const strips=CYCLES[m].map(s=>s.map(([f,i])=>idx(f,i)));
    for(let s=0;s<4;s++)for(let j=0;j<3;j++)next[strips[s][j]]=state[strips[(s+3)%4][j]];
    state=next;}return state;}
let st='UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB'.split('');
for(const mv of "D2 L2 B2 U' R2 F2 D' B' L' F' R' D U B2 L' D'".split(' ')) st=apply(st,mv);
const f=st.join(''); console.log(f);
const cmap=Object.fromEntries(Object.keys(CF).map(n=>[n.split('').sort().join(''),n]));
const emap=Object.fromEntries(Object.keys(EF).map(n=>[n.split('').sort().join(''),n]));
const seen={};
for(const [pos,fl] of Object.entries(CF)){const cols=fl.map(i=>f[i]);const k=cols.slice().sort().join('');const piece=cmap[k];if(!piece)console.log('corner fail',pos,cols.join(''));else{seen[piece]=(seen[piece]||0)+1;if(seen[piece]>1)console.log('dup corner',piece);}}
for(const [pos,fl] of Object.entries(EF)){const cols=fl.map(i=>f[i]);const k=cols.slice().sort().join('');const piece=emap[k];if(!piece)console.log('edge fail',pos,cols.join(''));else{seen[piece]=(seen[piece]||0)+1;if(seen[piece]>1)console.log('dup edge',piece);}}
