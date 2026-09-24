/**
 * Conversion between our 54-char facelet state and cubing.js KPattern,
 * plus the solve() call (two-phase solver via cubing/search).
 *
 * cubing.js piece orderings were derived empirically from its move
 * permutations (scripts/check-moves.mjs verifies all six moves).
 */

import { cube3x3x3 } from "cubing/puzzles";
import { KPattern, KPuzzle, KPatternData } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import {
  CORNER_FACELETS,
  EDGE_FACELETS,
  faceletIndex,
} from "./geom";

// cubing.js piece orderings (piece index -> position name)
const CUBING_CORNERS = ["URF", "UBR", "ULB", "UFL", "DFR", "DLF", "DBL", "DRB"];
const CUBING_EDGES = ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"];
const POS_CORNER = Object.fromEntries(CUBING_CORNERS.map((n, i) => [n, i]));
const POS_EDGE = Object.fromEntries(CUBING_EDGES.map((n, i) => [n, i]));

const UD = new Set(["U", "D"]);
const FB = new Set(["F", "B"]);
const key = (s: string) => s.split("").sort().join("");

const CORNER_BY_COLORS = Object.fromEntries(
  Object.keys(CORNER_FACELETS).map((n) => [key(n), n])
);
const EDGE_BY_COLORS = Object.fromEntries(
  Object.keys(EDGE_FACELETS).map((n) => [key(n), n])
);

/** The edge's "primary" color: the U/D one, else the F/B one. */
const primaryColor = (piece: string) =>
  piece.split("").find((c) => UD.has(c)) ?? piece.split("").find((c) => FB.has(c))!;

export interface PatternData {
  CORNERS: { pieces: number[]; orientation: number[] };
  EDGES: { pieces: number[]; orientation: number[] };
  CENTERS: { pieces: number[]; orientation: number[]; orientationMod: number[] };
}

/**
 * Convert a 54-char facelet string (U R F D L B order, row-major per face)
 * into cubing.js KPattern orbit data. Throws on an inconsistent cube.
 */
export function faceletsToPatternData(f: string): PatternData {
  const cornerPieces = new Array<number>(8);
  const cornerOri = new Array<number>(8);
  for (const [pos, triple] of Object.entries(CORNER_FACELETS)) {
    const cols = triple.map(([face, p]) => f[faceletIndex(face, p)]);
    const piece = CORNER_BY_COLORS[key(cols.join(""))];
    if (!piece) throw new Error(`invalid corner colors at ${pos}: ${cols}`);
    const i = POS_CORNER[pos];
    cornerPieces[i] = POS_CORNER[piece];
    cornerOri[i] = cols.findIndex((c) => UD.has(c));
  }

  const edgePieces = new Array<number>(12);
  const edgeOri = new Array<number>(12);
  for (const [pos, pair] of Object.entries(EDGE_FACELETS)) {
    const cols = pair.map(([face, p]) => f[faceletIndex(face, p)]);
    const piece = EDGE_BY_COLORS[key(cols.join(""))];
    if (!piece) throw new Error(`invalid edge colors at ${pos}: ${cols}`);
    const i = POS_EDGE[pos];
    edgePieces[i] = POS_EDGE[piece];
    edgeOri[i] = cols[0] === primaryColor(piece) ? 0 : 1;
  }

  return {
    CORNERS: { pieces: cornerPieces, orientation: cornerOri },
    EDGES: { pieces: edgePieces, orientation: edgeOri },
    CENTERS: {
      pieces: [0, 1, 2, 3, 4, 5],
      orientation: [0, 0, 0, 0, 0, 0],
      orientationMod: [1, 1, 1, 1, 1, 1],
    },
  };
}

let kpuzzlePromise: Promise<KPuzzle> | null = null;
const getPuzzle = () => (kpuzzlePromise ??= cube3x3x3.kpuzzle());

/**
 * Solve a facelet string. Returns the solution as move tokens
 * (e.g. ["R", "U'", "F2"]). Throws if the state is inconsistent.
 */
export async function solve(facelets: string): Promise<string[]> {
  const kp = await getPuzzle();
  const pattern = new KPattern(kp, faceletsToPatternData(facelets) as unknown as KPatternData);
  const alg = await experimentalSolve3x3x3IgnoringCenters(pattern);
  return alg.toString().trim().split(/\s+/).filter(Boolean);
}

/** Sanity-check a facelet string: 9 stickers per face letter. */
export function colorCountsOk(facelets: string): boolean {
  const counts: Record<string, number> = {};
  for (const c of facelets) counts[c] = (counts[c] ?? 0) + 1;
  return "URFDLB".split("").every((f) => counts[f] === 9);
}
