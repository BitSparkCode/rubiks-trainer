/**
 * Fit projective (affine) 3x3 lattices over detected sticker centers.
 * The three visible faces of a cube each form a 3x3 grid; we find them
 * with a small RANSAC: pick a seed sticker + two neighbor vectors as a
 * candidate basis, count stickers that land on the lattice.
 */

import { Lab } from "./color";
import { Sticker } from "./detect";

export interface Cell {
  x: number;
  y: number;
  lab: Lab;
  found: boolean; // a real sticker blob was matched (vs. predicted point)
}

export interface DetectedFace {
  /** cells[i][j], i = steps along axisA, j = steps along axisB */
  cells: Cell[][];
  axisA: [number, number]; // lattice step vectors (image space)
  axisB: [number, number];
  origin: [number, number]; // image coords of cell (0,0)
  centroid: [number, number];
  stickerCount: number;
}

type P = [number, number];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);
const dist = (a: P, b: P) => len(sub(a, b));

/** Solve 2x2 system for coordinates of p in basis (u, v) relative to o. */
function coords(o: P, u: P, v: P, p: P): [number, number] {
  const det = u[0] * v[1] - u[1] * v[0];
  const d = sub(p, o);
  return [(d[0] * v[1] - d[1] * v[0]) / det, (u[0] * d[1] - u[1] * d[0]) / det];
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

export function fitFaces(
  stickers: Sticker[],
  sampler: (x: number, y: number) => Lab,
  maxFaces = 3
): DetectedFace[] {
  const pts = stickers.map((s) => [s.x, s.y] as P);
  const n = pts.length;
  if (n < 6) return [];

  // grid spacing estimate: median nearest-neighbor distance
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) if (i !== j) best = Math.min(best, dist(pts[i], pts[j]));
    if (isFinite(best)) nn.push(best);
  }
  const spacing = median(nn);
  if (spacing <= 4) return [];

  const inRange = (d: number) => d > spacing * 0.6 && d < spacing * 1.45;

  // adjacency at grid spacing
  const neighbors: number[][] = pts.map(() => []);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (inRange(dist(pts[i], pts[j]))) { neighbors[i].push(j); neighbors[j].push(i); }

  const used = new Set<number>();
  const faces: DetectedFace[] = [];

  for (let attempt = 0; attempt < 12 && faces.length < maxFaces; attempt++) {
    // seed: unused sticker with most unused neighbors
    let seed = -1, bestNb = 3;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const nb = neighbors[i].filter((j) => !used.has(j)).length;
      if (nb > bestNb) { bestNb = nb; seed = i; }
    }
    if (seed < 0) break;

    // try neighbor pairs as basis
    let best: { inliers: { idx: number; a: number; b: number }[]; u: P; v: P; win: [number, number] } | null = null;
    const nbs = neighbors[seed].filter((j) => !used.has(j));
    for (let a = 0; a < nbs.length; a++) {
      for (let b = a + 1; b < nbs.length; b++) {
        const u = sub(pts[nbs[a]], pts[seed]);
        const v = sub(pts[nbs[b]], pts[seed]);
        const cos = (u[0] * v[0] + u[1] * v[1]) / (len(u) * len(v));
        if (Math.abs(cos) > 0.75) continue; // want ~orthogonal axes

        // integer coords for all unused stickers
        const cand: { idx: number; a: number; b: number; res: number }[] = [];
        for (let i = 0; i < n; i++) {
          if (used.has(i)) continue;
          const [ca, cb] = coords(pts[seed], u, v, pts[i]);
          const ra = Math.round(ca), rb = Math.round(cb);
          if (Math.abs(ca - ra) > 0.35 || Math.abs(cb - rb) > 0.35) continue;
          if (Math.abs(ra) > 4 || Math.abs(rb) > 4) continue;
          cand.push({ idx: i, a: ra, b: rb, res: Math.abs(ca - ra) + Math.abs(cb - rb) });
        }
        // dedupe cells keeping smallest residual
        const byCell = new Map<string, { idx: number; a: number; b: number; res: number }>();
        for (const c of cand) {
          const k = `${c.a},${c.b}`;
          const cur = byCell.get(k);
          if (!cur || c.res < cur.res) byCell.set(k, c);
        }
        // best 3x3 window
        for (let oa = -4; oa <= 4; oa++)
          for (let ob = -4; ob <= 4; ob++) {
            const inl = [...byCell.values()].filter(
              (c) => c.a >= oa && c.a <= oa + 2 && c.b >= ob && c.b <= ob + 2
            );
            if (!best || inl.length > best.inliers.length)
              best = { inliers: inl, u, v, win: [oa, ob] };
          }
      }
    }

    if (!best || best.inliers.length < 6) { used.add(seed); continue; }

    // refine: origin + basis from inlier assignments (average offsets)
    const { u, v, win } = best;
    let origin: P = [0, 0];
    for (const c of best.inliers) {
      const rel = c.a - win[0] - 0; // origin corresponds to window corner
      const px = pts[c.idx][0] - rel * u[0] - (c.b - win[1]) * v[0];
      const py = pts[c.idx][1] - rel * u[1] - (c.b - win[1]) * v[1];
      origin[0] += px; origin[1] += py;
    }
    origin = [origin[0] / best.inliers.length, origin[1] / best.inliers.length];

    const cellOf = new Map<string, { idx: number; a: number; b: number }>();
    for (const c of best.inliers) cellOf.set(`${c.a - win[0]},${c.b - win[1]}`, { idx: c.idx, a: c.a - win[0], b: c.b - win[1] });

    const cells: Cell[][] = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < 3; i++) {
      cells[i] = [];
      for (let j = 0; j < 3; j++) {
        const x = origin[0] + i * u[0] + j * v[0];
        const y = origin[1] + i * u[1] + j * v[1];
        const hit = cellOf.get(`${i},${j}`);
        cells[i][j] = hit
          ? { x: pts[hit.idx][0], y: pts[hit.idx][1], lab: stickers[hit.idx].lab, found: true }
          : { x, y, lab: sampler(x, y), found: false };
        cx += x; cy += y;
      }
    }

    for (const c of best.inliers) used.add(c.idx);
    faces.push({
      cells,
      axisA: u,
      axisB: v,
      origin,
      centroid: [cx / 9, cy / 9],
      stickerCount: best.inliers.length,
    });
  }
  return faces;
}
