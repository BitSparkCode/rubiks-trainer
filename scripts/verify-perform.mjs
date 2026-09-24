// verify that the 3D rotation in performMove/commitTurn produces the same
// facelet permutation as sim.applyMoveOnce
import * as THREE from "three";
import { FACELET_POS, NORMAL } from "../src/cube/geom.js";
import { applyMove, SOLVED } from "../src/cube/sim.js";

const AXIS_VEC = {
  U: [0,1,0], D: [0,-1,0], R: [1,0,0], L: [-1,0,0], F: [0,0,1], B: [0,0,-1],
};

function performPerm(face, dir, half) {
  const n = new THREE.Vector3(...AXIS_VEC[face]);
  const angle = (half ? Math.PI : Math.PI/2) * dir;
  const q = new THREE.Quaternion().setFromAxisAngle(n, angle);
  const result = new Array(54);
  for (let i = 0; i < 54; i++) {
    const { face: f, pos } = FACELET_POS[i];
    const inLayer = pos[0]*n.x + pos[1]*n.y + pos[2]*n.z === 1;
    if (!inLayer) { result[i] = i; continue; }
    const nv = new THREE.Vector3(...NORMAL[f]);
    const p = new THREE.Vector3(pos[0]*0.98 + nv.x*0.47, pos[1]*0.98 + nv.y*0.47, pos[2]*0.98 + nv.z*0.47);
    const p2 = p.clone().applyQuaternion(q);
    const n2 = nv.clone().applyQuaternion(q).round();
    let best = -1, bd = Infinity;
    for (let j = 0; j < 54; j++) {
      const { face: f2, pos: pos2 } = FACELET_POS[j];
      const nn = NORMAL[f2];
      if (nn[0] !== n2.x || nn[1] !== n2.y || nn[2] !== n2.z) continue;
      const d = p2.distanceToSquared(new THREE.Vector3(pos2[0]*0.98+nn[0]*0.47, pos2[1]*0.98+nn[1]*0.47, pos2[2]*0.98+nn[2]*0.47));
      if (d < bd) { bd = d; best = j; }
    }
    result[best] = i;
  }
  return result;
}

let fail = 0;
for (const face of "URFDLB") {
  for (const [suffix, dir, half] of [["", -1, false], ["'", 1, false], ["2", -1, true]]) {
    const perm = performPerm(face, dir, half);
    const out = new Array(54);
    for (let i = 0; i < 54; i++) out[i] = SOLVED[perm[i]];
    const sim = applyMove(SOLVED.slice(), face + suffix).join("");
    const ok = out.join("") === sim;
    if (!ok) fail++;
    console.log(face + suffix, ok ? "MATCH" : "MISMATCH");
  }
}
process.exit(fail ? 1 : 0);
