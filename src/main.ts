/**
 * App orchestration: camera loop -> sticker detection -> grid fitting ->
 * tracking/state -> solver -> UI (overlay + 3D preview + move list).
 */

import { Frame, detectStickers, sampleLab } from "./vision/detect";
import { DetectedFace, fitFaces } from "./vision/grids";
import { CubeTracker } from "./vision/tracker";
import { Cube3D } from "./render/cube3d";
import { colorCountsOk, solve } from "./cube/solve";
import { applyMove, SOLVED } from "./cube/sim";
import { FACES, Face } from "./cube/geom";
import { labToRgb } from "./vision/color";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const overlay = $<HTMLCanvasElement>("overlay");
const detector = $<HTMLCanvasElement>("detector");
const statusEl = $("status");
const btnCam = $<HTMLButtonElement>("btn-cam");
const btnRescan = $<HTMLButtonElement>("btn-rescan");
const btnNext = $<HTMLButtonElement>("btn-next");
const btnUndo = $<HTMLButtonElement>("btn-undo");
const chkAuto = $<HTMLInputElement>("chk-autodetect");
const scanPanel = $("scan-panel");
const solvePanel = $("solve-panel");
const scanBar = $("scan-bar");
const miniFaces = $("mini-faces");
const nextMoveEl = $("next-move");
const moveListEl = $("move-list");

const DETECT_W = 384;

type Mode = "idle" | "scan" | "solving" | "done";

const app = {
  mode: "idle" as Mode,
  tracker: new CubeTracker(),
  cube3d: null as Cube3D | null,
  facelets: SOLVED.join(""),
  solution: [] as string[],
  moveIdx: 0,
  history: [] as string[],
  /** current face of interest for the expected move */
  lastFaces: [] as DetectedFace[],
  lastLetters: [] as (Face | null)[],
  /** scale detection -> video coords */
  scale: 1,
};

function setStatus(s: string) { statusEl.textContent = s; }

function faceCss(f: Face | null): string {
  if (!f) return "#3a3a4a";
  const lab = app.tracker.faceColorLab(f);
  if (!lab) return "#888";
  const [r, g, b] = labToRgb(lab);
  return `rgb(${r},${g},${b})`;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    setStatus(`camera error: ${e instanceof Error ? e.message : e}`);
    return;
  }
  btnCam.disabled = true;
  btnRescan.disabled = false;
  chkAuto.disabled = false;
  app.mode = "scan";
  setStatus("scanning — rotate the cube slowly");
  requestAnimationFrame(tick);
}

function tick() {
  if (video.readyState < 2) { requestAnimationFrame(tick); return; }
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) { requestAnimationFrame(tick); return; }

  // detection frame (downscaled)
  const dw = DETECT_W, dh = Math.round((vh / vw) * DETECT_W);
  if (detector.width !== dw || detector.height !== dh) { detector.width = dw; detector.height = dh; }
  const dctx = detector.getContext("2d", { willReadFrequently: true })!;
  dctx.drawImage(video, 0, 0, dw, dh);
  const img = dctx.getImageData(0, 0, dw, dh);
  const frame: Frame = { width: dw, height: dh, data: img.data };

  const stickers = detectStickers(frame);
  const faces = fitFaces(stickers, (x, y) => sampleLab(frame, x, y));
  app.scale = vw / dw;
  app.lastFaces = faces;

  const { letters, events } = app.tracker.update(faces);
  app.lastLetters = letters;

  drawOverlay(faces, letters);

  if (app.mode === "scan") scanStep();
  else if (app.mode === "solving") solveStep(events);

  requestAnimationFrame(tick);
}

// ---------- scan phase ----------

function scanStep() {
  const res = app.tracker.facelets();
  const pct = res ? Math.round((res.seen / 54) * 100) : 0;
  scanBar.style.width = `${pct}%`;
  setStatus(`scanning — ${res?.seen ?? 0}/54 stickers`);
  drawMiniFaces();

  if (res && res.seen === 54 && !colorCountsOk(res.str)) {
    setStatus("color mismatch — keep rotating slowly in better light");
    return;
  }
  if (res && res.seen === 54 && colorCountsOk(res.str)) {
    setStatus("solving…");
    solve(res.str)
      .then((moves) => {
        app.facelets = res.str;
        app.solution = moves;
        app.moveIdx = 0;
        app.history = [];
        app.mode = "solving";
        scanPanel.hidden = true;
        solvePanel.hidden = false;
        btnNext.disabled = false;
        btnUndo.disabled = true;
        renderMoveList();
        updateNextMove();
        setStatus("solve along with the camera");
      })
      .catch((e) => setStatus(`invalid scan (${e}) — keep rotating`));
  }
}

function drawMiniFaces() {
  if (miniFaces.childElementCount !== 6) {
    miniFaces.innerHTML = "";
    for (const f of FACES) {
      const g = document.createElement("div");
      g.className = "mini-face";
      g.dataset.face = f;
      for (let i = 0; i < 9; i++) {
        const c = document.createElement("div");
        c.className = "cell";
        g.appendChild(c);
      }
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = f;
      g.appendChild(lbl);
      miniFaces.appendChild(g);
    }
  }
  const res = app.tracker.facelets();
  if (!res) return;
  FACES.forEach((f, fi) => {
    const g = miniFaces.children[fi] as HTMLElement;
    for (let i = 0; i < 9; i++) {
      const ch = res.str[fi * 9 + i];
      const cell = g.children[i] as HTMLElement;
      cell.style.background = ch === "?" ? "#262633" : faceCss(ch as Face);
    }
  });
}

// ---------- solve phase ----------

function expectedMove(): string | null {
  return app.moveIdx < app.solution.length ? app.solution[app.moveIdx] : null;
}

function expectedDir(move: string): "cw" | "ccw" | "2" {
  return move.includes("2") ? "2" : move.includes("'") ? "ccw" : "cw";
}

function solveStep(events: { face: Face; dir: "cw" | "ccw" | "2" }[]) {
  const exp = expectedMove();
  if (!exp) return;
  if (!chkAuto.checked) return;
  for (const ev of events) {
    if (ev.face !== exp[0]) continue;
    const need = expectedDir(exp);
    if (need === "2") {
      if (ev.dir !== "ccw") advanceMove(); // any quarter turn counts toward 180
      else flash("wrong direction");
    } else if (ev.dir === need) advanceMove();
    else flash(`${ev.face}${ev.dir === "cw" ? "" : "'"} — expected ${exp}`);
    break;
  }
}

function advanceMove() {
  const mv = expectedMove();
  if (!mv) return;
  app.history.push(mv);
  app.facelets = applyMove(app.facelets.split(""), mv).join("");
  app.moveIdx++;
  btnUndo.disabled = false;
  renderMoveList();
  updateNextMove();
  if (!expectedMove()) {
    app.mode = "done";
    setStatus("solved!");
    app.cube3d?.previewMove(null);
  }
}

function undoMove() {
  const mv = app.history.pop();
  if (!mv) return;
  const inv = mv.includes("2") ? mv : mv.includes("'") ? mv[0] : mv[0] + "'";
  app.facelets = applyMove(app.facelets.split(""), inv).join("");
  app.moveIdx--;
  if (app.mode === "done") app.mode = "solving";
  if (app.history.length === 0) btnUndo.disabled = true;
  renderMoveList();
  updateNextMove();
}

function renderMoveList() {
  moveListEl.innerHTML = "";
  app.solution.forEach((m, i) => {
    const li = document.createElement("li");
    li.textContent = m;
    if (i < app.moveIdx) li.className = "done";
    else if (i === app.moveIdx) li.className = "now";
    moveListEl.appendChild(li);
  });
}

function updateNextMove() {
  const mv = expectedMove();
  if (!mv) { nextMoveEl.innerHTML = "✓"; app.cube3d?.previewMove(null); return; }
  const f = mv[0] as Face;
  const arrow = expectedDir(mv) === "cw" ? "↻" : expectedDir(mv) === "ccw" ? "↺" : "↻↻";
  nextMoveEl.innerHTML = `<span class="chip" style="background:${faceCss(f)}"></span> ${mv} <small>${arrow}</small>`;
  app.cube3d?.setState(app.facelets, (ff) => {
    const lab = app.tracker.faceColorLab(ff);
    return lab ? labToRgb(lab) : null;
  });
  app.cube3d?.previewMove(mv);
}

let flashTimer = 0;
function flash(msg: string) {
  setStatus(msg);
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => setStatus("solve along with the camera"), 1200);
}

// ---------- overlay ----------

function drawOverlay(faces: DetectedFace[], letters: (Face | null)[]) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (overlay.width !== vw || overlay.height !== vh) { overlay.width = vw; overlay.height = vh; }
  const ctx = overlay.getContext("2d")!;
  ctx.clearRect(0, 0, vw, vh);
  const s = app.scale;

  faces.forEach((face, i) => {
    const letter = letters[i] ?? null;
    // cell polygons
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const c = face.cells[a][b];
        const w = Math.hypot(face.axisA[0], face.axisA[1]) * 0.45;
        const h = Math.hypot(face.axisB[0], face.axisB[1]) * 0.45;
        ctx.beginPath();
        ctx.ellipse(c.x * s, c.y * s, w * s, h * s, Math.atan2(face.axisA[1], face.axisA[0]), 0, Math.PI * 2);
        ctx.fillStyle = faceCss(app.tracker.classify(c.lab));
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    // letter label at centroid
    ctx.font = `bold ${Math.round(28 * s)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(letter ?? "?", face.centroid[0] * s + 2, face.centroid[1] * s + 2);
    ctx.fillStyle = "#fff";
    ctx.fillText(letter ?? "?", face.centroid[0] * s, face.centroid[1] * s);
  });

  // next-move arrow on the expected face
  if (app.mode === "solving") {
    const mv = expectedMove();
    if (mv) {
      const fi = letters.indexOf(mv[0] as Face);
      if (fi >= 0) drawArrow(ctx, faces[fi], expectedDir(mv), s);
    }
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, face: DetectedFace, dir: "cw" | "ccw" | "2", s: number) {
  const [cx, cy] = face.centroid;
  const r = Math.max(Math.hypot(face.axisA[0], face.axisA[1]), Math.hypot(face.axisB[0], face.axisB[1])) * 1.7 * s;
  const ccw = app.tracker.mirrored ? dir === "cw" : dir === "ccw";
  const a0 = -Math.PI / 2 - 0.5, a1 = -Math.PI / 2 + 1.1;
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 8 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx * s, cy * s, r, ccw ? -a1 : a0, ccw ? -a0 : a1, ccw);
  ctx.stroke();
  // arrowhead
  const ea = ccw ? -a0 : a1;
  const tipX = cx * s + r * Math.cos(ea), tipY = cy * s + r * Math.sin(ea);
  const tang = ea + (ccw ? -Math.PI / 2 : Math.PI / 2);
  const sz = 16 * s;
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.moveTo(tipX + sz * Math.cos(tang), tipY + sz * Math.sin(tang));
  ctx.lineTo(tipX + sz * 0.5 * Math.cos(tang + 2.4), tipY + sz * 0.5 * Math.sin(tang + 2.4));
  ctx.lineTo(tipX + sz * 0.5 * Math.cos(tang - 2.4), tipY + sz * 0.5 * Math.sin(tang - 2.4));
  ctx.fill();
  if (dir === "2") {
    ctx.fillStyle = "#ffd23f";
    ctx.font = `bold ${Math.round(20 * s)}px ui-monospace, monospace`;
    ctx.fillText("×2", cx * s, cy * s - r - 14 * s);
  }
}

// ---------- wire up ----------

btnCam.addEventListener("click", () => {
  app.cube3d = new Cube3D($<HTMLCanvasElement>("cube3d"));
  startCamera();
});
btnRescan.addEventListener("click", () => {
  app.tracker.reset();
  app.mode = "scan";
  app.moveIdx = 0;
  app.history = [];
  app.solution = [];
  solvePanel.hidden = true;
  scanPanel.hidden = false;
  scanBar.style.width = "0%";
  setStatus("scanning — rotate the cube slowly");
});
btnNext.addEventListener("click", advanceMove);
btnUndo.addEventListener("click", undoMove);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && app.mode === "solving") { e.preventDefault(); advanceMove(); }
  if (e.key === "Backspace") undoMove();
});
