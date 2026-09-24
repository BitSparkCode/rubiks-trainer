/**
 * Facelet-level cube simulator.
 *
 * state: string[54] — each entry is the letter of the face whose color the
 * sticker belongs to (solved = "UUU...RRR...FFF...DDD...LLL...BBB").
 *
 * Move tables verified against cubing.js move definitions
 * (see scripts/check-moves.mjs).
 */

import { Face, FACE_INDEX } from "./geom";

/** new[i] = old[ROT[i]] rotates a face's 3x3 grid clockwise (viewed at the face). */
const ROT = [6, 3, 0, 7, 4, 1, 8, 5, 2];

/**
 * Side strips for each clockwise face turn. Each entry is a list of 4 strips
 * of 3 facelet offsets; strip s receives strip s-1's values (the last strip
 * feeds the first). Ordering of indices inside a strip is spatially aligned.
 */
const STRIPS: Record<Face, [Face, number][][]> = {
  U: [
    [["F", 0], ["F", 1], ["F", 2]],
    [["L", 0], ["L", 1], ["L", 2]],
    [["B", 0], ["B", 1], ["B", 2]],
    [["R", 0], ["R", 1], ["R", 2]],
  ],
  D: [
    [["F", 6], ["F", 7], ["F", 8]],
    [["R", 6], ["R", 7], ["R", 8]],
    [["B", 6], ["B", 7], ["B", 8]],
    [["L", 6], ["L", 7], ["L", 8]],
  ],
  R: [
    [["U", 2], ["U", 5], ["U", 8]],
    [["B", 6], ["B", 3], ["B", 0]],
    [["D", 2], ["D", 5], ["D", 8]],
    [["F", 2], ["F", 5], ["F", 8]],
  ],
  L: [
    [["U", 0], ["U", 3], ["U", 6]],
    [["F", 0], ["F", 3], ["F", 6]],
    [["D", 0], ["D", 3], ["D", 6]],
    [["B", 8], ["B", 5], ["B", 2]],
  ],
  F: [
    [["U", 6], ["U", 7], ["U", 8]],
    [["R", 0], ["R", 3], ["R", 6]],
    [["D", 2], ["D", 1], ["D", 0]],
    [["L", 8], ["L", 5], ["L", 2]],
  ],
  B: [
    [["U", 2], ["U", 1], ["U", 0]],
    [["L", 0], ["L", 3], ["L", 6]],
    [["D", 6], ["D", 7], ["D", 8]],
    [["R", 8], ["R", 5], ["R", 2]],
  ],
};

const off = (f: Face, i: number) => FACE_INDEX[f] * 9 + i;

export function applyMoveOnce(state: string[], move: Face): string[] {
  const next = state.slice();
  const base = FACE_INDEX[move] * 9;
  for (let i = 0; i < 9; i++) next[base + i] = state[base + ROT[i]];
  const strips = STRIPS[move].map((s) => s.map(([f, i]) => off(f, i)));
  for (let s = 0; s < 4; s++)
    for (let j = 0; j < 3; j++) next[strips[s][j]] = state[strips[(s + 3) % 4][j]];
  return next;
}

export function applyMove(state: string[], move: string): string[] {
  const face = move[0] as Face;
  const suffix = move.slice(1);
  const times = suffix === "'" ? 3 : suffix === "2" ? 2 : 1;
  for (let t = 0; t < times; t++) state = applyMoveOnce(state, face);
  return state;
}

export function applyAlg(state: string[], alg: string): string[] {
  for (const mv of alg.trim().split(/\s+/).filter(Boolean)) state = applyMove(state, mv);
  return state;
}

export const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB".split("");

/** Rotate a 3x3 grid CW ("cw"), CCW ("ccw") or 180 ("2"). */
export function rotGrid<T>(g: T[], dir: "cw" | "ccw" | "2"): T[] {
  const r = <U>(a: U[]): U[] => [a[6], a[3], a[0], a[7], a[4], a[1], a[8], a[5], a[2]];
  if (dir === "cw") return r(g);
  if (dir === "ccw") return r(r(r(g)));
  return r(r(g));
}
