/**
 * Cube geometry conventions.
 *
 * Cube space: right-handed coordinates, x = R, y = U, z = F.
 * Each of the 54 facelets is identified by (face, position) where position
 * is the cubie coordinate in {-1,0,1}^3 with the face's normal component = ±1.
 *
 * Facelet index = faceIndex * 9 + row * 3 + col  (face order U R F D L B,
 * row-major when viewing the face directly with U on top, D viewed from
 * below — the standard Kociemba/Reid ordering).
 */

export type Vec3 = [number, number, number];
export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];

export const FACE_INDEX: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

export const NORMAL: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/** Face whose normal is the given axis vector. */
export function faceOfNormal(v: Vec3): Face {
  for (const f of FACES) {
    const n = NORMAL[f];
    if (n[0] === v[0] && n[1] === v[1] && n[2] === v[2]) return f;
  }
  throw new Error(`no face for normal ${v}`);
}

/** Canonical in-face "row increasing" direction for each face (viewed directly). */
export const ROW_AXIS: Record<Face, Vec3> = {
  U: [0, 0, 1],
  D: [0, 0, -1],
  F: [0, -1, 0],
  B: [0, -1, 0],
  R: [0, -1, 0],
  L: [0, -1, 0],
};

/** Canonical in-face "col increasing" direction for each face (viewed directly). */
export const COL_AXIS: Record<Face, Vec3> = {
  U: [1, 0, 0],
  D: [1, 0, 0],
  F: [1, 0, 0],
  B: [-1, 0, 0],
  R: [0, 0, -1],
  L: [0, 0, 1],
};

export const OPPOSITE: Record<Face, Face> = {
  U: "D", D: "U", R: "L", L: "R", F: "B", B: "F",
};

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const eq = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Facelet index 0..53 for a cubie position on a face. */
export function faceletIndex(face: Face, pos: Vec3): number {
  const row = dot(pos, ROW_AXIS[face]) + 1;
  const col = dot(pos, COL_AXIS[face]) + 1;
  return FACE_INDEX[face] * 9 + row * 3 + col;
}

/** pos of every facelet index: [index] -> {face, pos} */
export const FACELET_POS: { face: Face; pos: Vec3 }[] = (() => {
  const out: { face: Face; pos: Vec3 }[] = new Array(54);
  for (const f of FACES) {
    const n = NORMAL[f];
    for (let r = -1; r <= 1; r++)
      for (let c = -1; c <= 1; c++) {
        const pos = add(n, add(scale(ROW_AXIS[f], r), scale(COL_AXIS[f], c)));
        out[faceletIndex(f, pos)] = { face: f, pos };
      }
  }
  return out;
})();

/** Kociemba corner facelet triples, position name -> facelet indices. */
const CORNER_FACELETS: Record<string, [Face, Vec3][]> = {};
/** Kociemba edge facelet pairs. */
const EDGE_FACELETS: Record<string, [Face, Vec3][]> = {};

function posFromName(name: string): Vec3 {
  const p: Vec3 = [0, 0, 0];
  for (const ch of name) {
    const n = NORMAL[ch as Face];
    p[0] += n[0]; p[1] += n[1]; p[2] += n[2];
  }
  return p;
}

const CORNERS = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
const EDGES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"];
for (const c of CORNERS)
  CORNER_FACELETS[c] = c.split("").map((ch) => {
    const f = ch as Face;
    return [f, posFromName(c)];
  });
for (const e of EDGES)
  EDGE_FACELETS[e] = e.split("").map((ch) => {
    const f = ch as Face;
    return [f, posFromName(e)];
  });

export { CORNER_FACELETS, EDGE_FACELETS, CORNERS, EDGES };
