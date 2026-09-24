/**
 * Standalone demo of the full app UI — drives the real Cube3D component
 * through a scramble + solution with a mock webcam panel, timer, and
 * move list. Used for the README GIF and for testing without a camera.
 */

import { Cube3D } from "./render/cube3d";
import { applyMove, SOLVED } from "./cube/sim";
import { Face } from "./cube/geom";

const STD: Record<Face, [number, number, number]> = {
  U: [245, 245, 245], R: [200, 45, 55], F: [0, 160, 80],
  D: [255, 215, 60], L: [255, 140, 40], B: [40, 90, 220],
};
const CSS: Record<Face, string> = {
  U: "#f2f2f5", R: "#d03440", F: "#12a05c",
  D: "#f5cf3c", L: "#f08c28", B: "#3264dc",
};

const SCRAMBLE = "R U R' U' R' F R F'";
const MOVES = "F R' F' R U R U' R'".split(" ");

const cube = new Cube3D(document.getElementById("cube3d") as HTMLCanvasElement);
const nextMoveEl = document.getElementById("next-move")!;
const moveListEl = document.getElementById("move-list")!;
const timerEl = document.getElementById("timer")!;
const statusEl = document.getElementById("status")!;

let state = applyMove(SOLVED.slice(), SCRAMBLE).join("");
let idx = 0;
let t0 = performance.now();

cube.syncOrientation(["U", "R", "F"]);
cube.setState(state, (f) => STD[f]);

// ---------- fake webcam feed: dark frame + detection overlay ----------

const CELL_COLORS = Object.values(CSS);

function drawFakeCam() {
  const cv = document.getElementById("fakecam") as HTMLCanvasElement;
  cv.width = 640; cv.height = 480;
  const ctx = cv.getContext("2d")!;

  const g = ctx.createRadialGradient(320, 220, 60, 320, 240, 420);
  g.addColorStop(0, "#26262e");
  g.addColorStop(1, "#141419");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 480);

  // iso cube corner: three parallelogram faces sharing corner C
  const T = [320, 95], eL = [-150, 82], eR = [150, 82], eD = [0, 150];
  const faces = [
    { o: T, a: eL, b: eR, letter: "U" },
    { o: [T[0] + eL[0], T[1] + eL[1]], a: eD, b: eR, letter: "F" },
    { o: [T[0] + eR[0], T[1] + eR[1]], a: eL, b: eD, letter: "R" },
  ];

  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  for (const f of faces) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const cx = f.o[0] + (f.a[0] * (i + 0.5)) / 3 + (f.b[0] * (j + 0.5)) / 3;
        const cy = f.o[1] + (f.a[1] * (i + 0.5)) / 3 + (f.b[1] * (j + 0.5)) / 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 20, 15, Math.atan2(f.a[1], f.a[0]) * 0.5, 0, Math.PI * 2);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = CELL_COLORS[Math.floor(rand() * 6)];
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    const cx = f.o[0] + (f.a[0] + f.b[0]) / 2;
    const cy = f.o[1] + (f.a[1] + f.b[1]) / 2;
    ctx.font = "bold 30px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(f.letter, cx + 2, cy + 2);
    ctx.fillStyle = "#fff";
    ctx.fillText(f.letter, cx, cy);
  }

  // direction arc on the R face
  const rc = [T[0] + eR[0] + (eL[0] + eD[0]) / 2, T[1] + eR[1] + (eL[1] + eD[1]) / 2];
  ctx.beginPath();
  ctx.ellipse(rc[0], rc[1], 105, 105, 0, -1.2, 1.5);
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 7;
  ctx.stroke();
  const ex = rc[0] + Math.cos(1.5) * 105, ey = rc[1] + Math.sin(1.5) * 105;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - 18, ey - 24);
  ctx.lineTo(ex + 14, ey - 16);
  ctx.closePath();
  ctx.fillStyle = "#ffd23f";
  ctx.fill();
}

// ---------- UI ----------

function fmt(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
setInterval(() => { timerEl.textContent = fmt(performance.now() - t0); }, 100);

function render() {
  moveListEl.innerHTML = "";
  MOVES.forEach((m, i) => {
    const li = document.createElement("li");
    li.textContent = m;
    if (i < idx) li.className = "done";
    else if (i === idx) li.className = "now";
    else if (i === idx + 1) li.className = "next";
    moveListEl.appendChild(li);
  });
  const mv = MOVES[idx];
  if (!mv) {
    nextMoveEl.innerHTML = "✓";
    cube.previewMoves(null, null);
    statusEl.textContent = "solved!";
    return;
  }
  const nxt = MOVES[idx + 1];
  const arrow = mv.includes("2") ? "↻↻" : mv.includes("'") ? "↺" : "↻";
  const then = nxt
    ? `<span class="then">then <span class="chip" style="background:${CSS[nxt[0] as Face]}"></span>${nxt}</span>`
    : "";
  nextMoveEl.innerHTML =
    `<span class="chip" style="background:${CSS[mv[0] as Face]}"></span> ${mv} <small>${arrow}</small> ${then}`;
  cube.previewMoves(mv, nxt ?? null);
}

function step() {
  render();
  window.setTimeout(() => {
    // recolor right as the turn-out finishes (~40% of the 1.5 s period)
    if (MOVES[idx]) {
      state = applyMove(state.split(""), MOVES[idx]).join("");
      cube.setState(state, (f) => STD[f]);
    }
    idx++;
    if (idx > MOVES.length + 1) { // brief solved pause, then rescramble
      idx = 0;
      state = applyMove(SOLVED.slice(), SCRAMBLE).join("");
      cube.setState(state, (f) => STD[f]);
      t0 = performance.now();
      statusEl.textContent = "solving — move auto-detect on";
    }
  }, 620);
  window.setTimeout(step, 2200);
}

drawFakeCam();
step();
