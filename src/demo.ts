/**
 * Standalone demo of the 3D solver view — cycles a scramble + solution so
 * the README GIF shows the real component (arrows, turn animation,
 * lookahead ghost). Also useful for manual testing without a webcam.
 */

import { Cube3D } from "./render/cube3d";
import { applyMove, SOLVED } from "./cube/sim";
import { Face } from "./cube/geom";

const STD: Record<Face, [number, number, number]> = {
  U: [245, 245, 245], R: [200, 45, 55], F: [0, 160, 80],
  D: [255, 215, 60], L: [255, 140, 40], B: [40, 90, 220],
};

const SCRAMBLE = "R U R' U' R' F R F'";
const SOLUTION = "F R' F' R U R U' R'"; // inverse-ish demo sequence

let state = applyMove(SOLVED.slice(), SCRAMBLE).join("");
const cube = new Cube3D(document.getElementById("c") as HTMLCanvasElement);
const cap = document.getElementById("cap")!;
const moves = SOLUTION.split(" ");
let idx = 0;

// fixed pleasant orientation: U on top slot, R bottom-right, F bottom-left
cube.syncOrientation(["U", "R", "F"]);

function step() {
  const cur = moves[idx % moves.length];
  const nxt = moves[(idx + 1) % moves.length];
  cube.setState(state, (f) => STD[f]);
  cube.previewMoves(cur, nxt);
  cap.textContent = `next: ${cur}   then: ${nxt}`;
  // perform the move on the model state after the hint plays
  window.setTimeout(() => { state = applyMove(state.split(""), cur).join(""); }, 1200);
  idx++;
  window.setTimeout(step, 2200);
}
step();
