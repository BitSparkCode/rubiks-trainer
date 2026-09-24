/**
 * Sticker detection: segment saturated pixels, erode to split adjacent
 * stickers, connected components -> sticker candidates.
 * Pure TypeScript on a downscaled frame (no OpenCV dependency).
 */

import { Lab, rgbToLab } from "./color";

export interface Sticker {
  x: number;      // centroid, detection-image coords
  y: number;
  area: number;
  lab: Lab;       // mean color sampled at centroid
  w: number;
  h: number;
}

export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

const SAT_MIN = 0.32;
const VAL_MIN = 60;
const ERODE_PASSES = 1;
const MIN_AREA = 30;
const MAX_AREA_FRAC = 0.02;   // of image
const MIN_FILL = 0.45;        // area / bounding box
const MAX_ASPECT = 2.4;

function buildMask(frame: Frame): Uint8Array {
  const { width: w, height: h, data } = frame;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    mask[i] = max > VAL_MIN && (max - min) / max > SAT_MIN ? 1 : 0;
  }
  return mask;
}

function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w];
    }
  return out;
}

/** mean RGB in a small disk around (cx, cy) */
function sampleColor(frame: Frame, cx: number, cy: number, radius = 3): [number, number, number] {
  const { width: w, height: h, data } = frame;
  let r = 0, g = 0, b = 0, n = 0;
  const r2 = radius * radius;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++)
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/** Sample the Lab color at an arbitrary point (used for predicted cells). */
export function sampleLab(frame: Frame, x: number, y: number): Lab {
  const [r, g, b] = sampleColor(frame, x, y, 3);
  return rgbToLab(r, g, b);
}

export function detectStickers(frame: Frame): Sticker[] {
  const { width: w, height: h } = frame;
  let mask = buildMask(frame);
  for (let i = 0; i < ERODE_PASSES; i++) mask = erode(mask, w, h);

  // connected components via union-find
  const parent = new Int32Array(w * h);
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const active: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    parent[i] = i;
    active.push(i);
    const x = i % w;
    if (x > 0 && mask[i - 1]) union(i, i - 1);
    if (x < w - 1 && mask[i + 1]) union(i, i + 1);
    if (i >= w && mask[i - w]) union(i, i - w);
    if (i < w * (h - 1) && mask[i + w]) union(i, i + w);
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  interface Acc { n: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number }
  const comps = new Map<number, Acc>();
  for (const i of active) {
    const r = find(i);
    let a = comps.get(r);
    if (!a) { a = { n: 0, sx: 0, sy: 0, x0: w, x1: 0, y0: h, y1: 0 }; comps.set(r, a); }
    const x = i % w, y = (i / w) | 0;
    a.n++; a.sx += x; a.sy += y;
    a.x0 = Math.min(a.x0, x); a.x1 = Math.max(a.x1, x);
    a.y0 = Math.min(a.y0, y); a.y1 = Math.max(a.y1, y);
  }

  const maxArea = w * h * MAX_AREA_FRAC;
  const stickers: Sticker[] = [];
  for (const a of comps.values()) {
    const bw = a.x1 - a.x0 + 1, bh = a.y1 - a.y0 + 1;
    if (a.n < MIN_AREA || a.n > maxArea) continue;
    const aspect = Math.max(bw / bh, bh / bw);
    if (aspect > MAX_ASPECT) continue;
    if (a.n / (bw * bh) < MIN_FILL) continue;
    const cx = a.sx / a.n, cy = a.sy / a.n;
    const [r, g, b] = sampleColor(frame, cx, cy, Math.max(2, Math.min(bw, bh) / 5));
    stickers.push({ x: cx, y: cy, area: a.n, lab: rgbToLab(r, g, b), w: bw, h: bh });
  }
  return stickers;
}
