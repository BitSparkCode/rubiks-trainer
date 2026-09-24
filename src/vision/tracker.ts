/**
 * CubeTracker — turns per-frame detected face grids into cube state.
 *
 * Responsibilities:
 *  - assign a face letter (U,R,F,D,L,B) to each visible face using its
 *    center color + cube-orientation continuity (24-rotation enumeration)
 *  - learn the 6 center colors incrementally (no manual calibration)
 *  - map each detected sticker cell to a canonical facelet index using
 *    neighbor-face directions, and accumulate color observations
 *  - detect quarter-turns of individual faces during the solve phase
 *
 * The letter assignment is arbitrary up to a whole-cube rotation: the first
 * confidently-seen triple gets (U,R,F). That is fine — the solver only
 * needs a self-consistent state, and move notation refers to faces by
 * their center color, which we display alongside.
 */

import {
  Face, FACES, NORMAL, Vec3, add, cross, dot, faceletIndex, scale,
} from "../cube/geom";
import { rotGrid } from "../cube/sim";
import { Lab, labDist, mixLab } from "./color";
import { DetectedFace } from "./grids";

export interface TurnEvent { face: Face; dir: "cw" | "ccw" | "2" }

interface FaceObs { lab: Lab | null; count: number; }

const CENTER_LEARN_RATE = 0.35;
const CLASSIFY_DIST = 26;      // Lab distance to a learned center
const CLASSIFY_MARGIN = 8;     // must beat 2nd-nearest by this much

/** All 24 valid ordered face triples for a given slot chirality. */
function buildTriples(sign: 1 | -1): Face[][] {
  const out: Face[][] = [];
  for (const a of FACES) for (const b of FACES) for (const c of FACES) {
    if (a === b || b === c || a === c) continue;
    if (dot(cross(NORMAL[b], NORMAL[c]), NORMAL[a]) === sign) out.push([a, b, c]);
  }
  return out;
}
const TRIPLES = buildTriples(-1);        // normal camera
const TRIPLES_MIRRORED = buildTriples(1); // mirrored camera

export class CubeTracker {
  centerColor = new Map<Face, Lab>();
  prevTriple: Face[] | null = null;
  obs: FaceObs[] = Array.from({ length: 54 }, () => ({ lab: null, count: 0 }));
  /** canonical letter grid stability, per face */
  private stable = new Map<Face, (Face | null)[]>();
  private pending = new Map<Face, { grid: (Face | null)[]; count: number }>();
  /** last axis assignment per letter: [uA, uB] cube dirs */
  private axisMem = new Map<Face, [Vec3, Vec3]>();
  mirrored = false;
  /** frames seen since last successful orientation (for mirror fallback) */
  private failStreak = 0;

  /** center color of the cube's face for a letter (undefined until learned) */
  faceColorLab(f: Face): Lab | undefined { return this.centerColor.get(f); }

  classify(lab: Lab): Face | null {
    let best: Face | null = null, bd = Infinity, sd = Infinity;
    for (const [f, c] of this.centerColor) {
      const d = labDist(lab, c);
      if (d < bd) { sd = bd; bd = d; best = f; } else if (d < sd) sd = d;
    }
    if (best && bd < CLASSIFY_DIST && sd - bd > CLASSIFY_MARGIN) return best;
    return null;
  }

  /** Process one frame. Returns detected turn events (solve phase). */
  update(rawFaces: DetectedFace[]): {
    letters: (Face | null)[];
    events: TurnEvent[];
    grids: Map<Face, (Face | null)[]>;
  } {
    const faces = rawFaces.slice(0, 3);
    if (faces.length === 0) return { letters: [], events: [], grids: new Map() };

    // sort faces clockwise on screen (screen coords: y down => increasing atan2 goes CW)
    const gc = centroidAll(faces);
    faces.sort((a, b) => Math.atan2(a.centroid[1] - gc[1], a.centroid[0] - gc[0])
      - Math.atan2(b.centroid[1] - gc[1], b.centroid[0] - gc[0]));

    const centers = faces.map((f) => f.cells[1][1].lab);
    const known = centers.map((c) => this.classify(c));

    const letters = this.assignLetters(known, faces.length);
    const events: TurnEvent[] = [];
    const grids = new Map<Face, (Face | null)[]>();

    if (!letters) {
      this.failStreak++;
      if (this.failStreak === 30) this.mirrored = !this.mirrored; // retry other chirality
      return { letters: known, events, grids };
    }
    this.failStreak = 0;

    // learn centers + map cells
    faces.forEach((face, i) => {
      const f = letters[i];
      if (!f) return;
      const cur = this.centerColor.get(f);
      this.centerColor.set(f, cur ? mixLab(cur, centers[i], CENTER_LEARN_RATE) : centers[i]);

      const axes = this.faceAxes(face, f, faces, letters);
      if (!axes) return;
      const [uA, uB] = axes;
      this.axisMem.set(f, axes);

      const n = NORMAL[f];
      const grid: (Face | null)[] = new Array(9).fill(null);
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          const cell = face.cells[a][b];
          const pos = add(n, add(scale(uA, a - 1), scale(uB, b - 1)));
          const idx = faceletIndex(f, pos);
          // accumulate raw color observation
          const o = this.obs[idx];
          o.lab = o.lab ? mixLab(o.lab, cell.lab, 0.3) : cell.lab;
          o.count++;
          grid[idx % 9] = this.classify(cell.lab);
        }
      grids.set(f, grid);
      const ev = this.detectTurn(f, grid);
      if (ev) events.push(ev);
    });

    return { letters, events, grids };
  }

  /**
   * Choose letters for the observed (CW-sorted) faces.
   * - 3 faces: enumerate the 24 valid triples, filter by known centers,
   *   prefer continuity with the previous orientation.
   * - 1-2 faces: enumerate ordered adjacent letters/pairs the same way.
   * Unknown center colors may only take letters not yet learned.
   */
  private assignLetters(known: (Face | null)[], count: number): (Face | null)[] | null {
    const learned = new Set(this.centerColor.keys());
    const triples = this.mirrored ? TRIPLES_MIRRORED : TRIPLES;
    const okLetter = (obs: Face | null, cand: Face) =>
      obs !== null ? cand === obs : !learned.has(cand);

    // candidate full triples consistent with the observations
    const cands: { triple: Face[]; assign: (Face | null)[] }[] = [];
    if (count === 3) {
      for (const t of triples)
        if (okLetter(known[0], t[0]) && okLetter(known[1], t[1]) && okLetter(known[2], t[2]))
          cands.push({ triple: t, assign: [t[0], t[1], t[2]] });
    } else if (count === 2) {
      for (const a of FACES) for (const b of FACES) {
        if (a === b || dot(NORMAL[a], NORMAL[b]) !== 0) continue; // must be adjacent
        if (!okLetter(known[0], a) || !okLetter(known[1], b)) continue;
        for (const t of triples)
          if (t.includes(a) && t.includes(b)) cands.push({ triple: t, assign: [a, b] });
      }
    } else if (count === 1) {
      for (const a of FACES) {
        if (!okLetter(known[0], a)) continue;
        for (const t of triples) if (t.includes(a)) cands.push({ triple: t, assign: [a] });
      }
    }
    if (cands.length === 0) return null;

    // continuity: pick candidate whose orientation is closest to previous
    let best = cands[0], bestScore = -Infinity;
    for (const c of cands) {
      let s = 0;
      if (this.prevTriple) {
        for (let k = 0; k < 3; k++) {
          let kk = 0;
          for (let i = 0; i < 3; i++) if (c.triple[(i + k) % 3] === this.prevTriple[i]) kk++;
          s = Math.max(s, kk);
        }
      }
      if (s > bestScore) { bestScore = s; best = c; }
    }
    this.prevTriple = best.triple;
    return best.assign;
  }

  /**
   * Determine cube-space directions of the lattice axes by matching
   * directions to visible neighbor faces.
   */
  private faceAxes(
    face: DetectedFace, f: Face, faces: DetectedFace[], letters: (Face | null)[]
  ): [Vec3, Vec3] | null {
    const aA = unit(face.axisA), aB = unit(face.axisB);
    const n = NORMAL[f];
    // constraint: axis -> cube dir
    let uA: Vec3 | null = null, uB: Vec3 | null = null;

    faces.forEach((g, j) => {
      const gf = letters[j];
      if (!gf || g === face) return;
      const d = unit2([g.centroid[0] - face.centroid[0], g.centroid[1] - face.centroid[1]]);
      const pA = d[0] * aA[0] + d[1] * aA[1];
      const pB = d[0] * aB[0] + d[1] * aB[1];
      const ng = NORMAL[gf];
      if (Math.abs(pA) > Math.abs(pB) * 1.25) uA = scale(ng, Math.sign(pA));
      else if (Math.abs(pB) > Math.abs(pA) * 1.25) uB = scale(ng, Math.sign(pB));
    });

    if (uA && uB) {
      if (dot(uA, uB) !== 0) { uB = null; } // conflicting constraints: refine below
      else return [uA, uB];
    }

    // Is the constrained axis the "col" axis? canonical (col,row) basis has
    // positive 2D orientation in image space (y down) when viewed frontally.
    const orient = aA[0] * aB[1] - aA[1] * aB[0];
    const aIsCol = this.mirrored ? orient < 0 : orient > 0;

    if (uA) uB = aIsCol ? cross(uA, n) : cross(n, uA);
    else if (uB) uA = aIsCol ? cross(n, uB) : cross(uB, n);
    else return this.axisMem.get(f) ?? null;
    return [uA, uB];
  }

  /** quarter-turn detection on a face's canonical letter grid */
  private detectTurn(f: Face, grid: (Face | null)[]): TurnEvent | null {
    const p = this.pending.get(f);
    if (p && gridsEqual(p.grid, grid)) p.count++;
    else this.pending.set(f, { grid, count: 1 });
    const pend = this.pending.get(f)!;
    if (pend.count < 2) return null; // need 2 consecutive equal frames

    const prev = this.stable.get(f);
    this.stable.set(f, grid);
    if (!prev || gridsEqual(prev, grid)) return null;

    for (const dir of ["cw", "ccw", "2"] as const) {
      if (gridsMatch(rotGrid(prev, dir), grid)) return { face: f, dir };
    }
    return null;
  }

  /** assemble the 54-char facelet string from accumulated observations */
  facelets(): { str: string; seen: number } | null {
    const chars: string[] = [];
    let seen = 0;
    for (const o of this.obs) {
      if (!o.lab || o.count < 2) { chars.push("?"); continue; }
      const f = this.classify(o.lab);
      if (!f) { chars.push("?"); continue; }
      chars.push(f); seen++;
    }
    if (seen < 54) return { str: chars.join(""), seen };
    return { str: chars.join(""), seen };
  }

  reset() {
    this.centerColor.clear();
    this.prevTriple = null;
    this.obs = Array.from({ length: 54 }, () => ({ lab: null, count: 0 }));
    this.stable.clear();
    this.pending.clear();
    this.axisMem.clear();
    this.failStreak = 0;
  }
}

function centroidAll(faces: DetectedFace[]): [number, number] {
  let x = 0, y = 0;
  for (const f of faces) { x += f.centroid[0]; y += f.centroid[1]; }
  return [x / faces.length, y / faces.length];
}

const unit = (v: [number, number]): [number, number] => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const unit2 = unit;

function gridsEqual(a: (Face | null)[], b: (Face | null)[]) {
  for (let i = 0; i < 9; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** match allowing unknown (null) cells: all known cells equal, ≥7 known */
function gridsMatch(expected: (Face | null)[], actual: (Face | null)[]) {
  let known = 0;
  for (let i = 0; i < 9; i++) {
    if (actual[i] === null) continue;
    known++;
    if (expected[i] !== actual[i]) return false;
  }
  return known >= 7;
}
