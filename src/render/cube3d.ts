/**
 * Three.js view of the tracked cube.
 *
 * - mirrors the physical cube's orientation (the tracker reports which
 *   letter is on each visible screen slot; we rotate the model to match)
 * - a rotational arrow arc + looping turn animation shows the next move
 * - a faint "ghost" arrow shows the move after it, so the user can
 *   pre-position their fingers (lookahead)
 */

import * as THREE from "three";
import { Face, FACELET_POS, NORMAL } from "../cube/geom";

const AXIS_VEC: Record<Face, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0), D: new THREE.Vector3(0, -1, 0),
  R: new THREE.Vector3(1, 0, 0), L: new THREE.Vector3(-1, 0, 0),
  F: new THREE.Vector3(0, 0, 1), B: new THREE.Vector3(0, 0, -1),
};

// screen slots for the CW-sorted visible faces: top, bottom-right, bottom-left
const SLOT_NORMALS = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
];

const ACCENT = 0xffd23f;
const GHOST = 0x4f6c96;

export class Cube3D {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private stickers: THREE.Mesh[] = [];
  private cubies = new THREE.Group();
  private pivot = new THREE.Group();
  private arrow: THREE.Group | null = null;
  private ghostArrow: THREE.Group | null = null;
  private anim: { face: Face; dir: 1 | -1; half: boolean; t: number } | null = null;
  private targetQuat: THREE.Quaternion | null = null;
  private idleFrames = 0;
  private lastTime = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(4.6, 3.6, 5.6);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 8, 6);
    this.scene.add(dir);

    this.scene.add(this.cubies);
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(2.86, 2.86, 2.86),
      new THREE.MeshLambertMaterial({ color: 0x2b2b36 })
    );
    this.cubies.add(core);

    const geo = new THREE.PlaneGeometry(0.88, 0.88);
    for (let i = 0; i < 54; i++) {
      const { face, pos } = FACELET_POS[i];
      const n = NORMAL[face];
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide })
      );
      m.position.set(
        pos[0] * 0.98 + n[0] * 0.47,
        pos[1] * 0.98 + n[1] * 0.47,
        pos[2] * 0.98 + n[2] * 0.47
      );
      m.lookAt(m.position.clone().add(new THREE.Vector3(...n)));
      this.stickers.push(m);
      this.cubies.add(m);
    }
    this.cubies.add(this.pivot);
    this.cubies.rotation.x = -0.15; // slight downward tilt reads better

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    const el = this.renderer.domElement.parentElement!;
    const w = el.clientWidth || 300, h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** repaint stickers from the 54-char facelet state */
  setState(facelets: string, colorOf: (f: Face) => [number, number, number] | null) {
    for (let i = 0; i < 54; i++) {
      const rgb = colorOf(facelets[i] as Face) ?? [40, 40, 48];
      (this.stickers[i].material as THREE.MeshBasicMaterial).color.setRGB(
        rgb[0] / 255, rgb[1] / 255, rgb[2] / 255
      );
    }
  }

  /**
   * Rotate the model so its visible faces match the physical hold.
   * letters = letters on the CW-sorted screen slots (top, bottom-right,
   * bottom-left); null entries / partial views are ignored.
   */
  syncOrientation(letters: (Face | null)[]) {
    if (letters.length < 3 || letters.some((l) => l === null)) return;
    this.idleFrames = 0;
    const F = new THREE.Matrix4().makeBasis(
      AXIS_VEC[letters[0]!].clone(),
      AXIS_VEC[letters[1]!].clone(),
      AXIS_VEC[letters[2]!].clone()
    );
    const S = new THREE.Matrix4().makeBasis(
      SLOT_NORMALS[0].clone(), SLOT_NORMALS[1].clone(), SLOT_NORMALS[2].clone()
    );
    const M = S.clone().multiply(F.clone().invert());
    const q = new THREE.Quaternion().setFromRotationMatrix(M);
    if (!this.targetQuat) this.targetQuat = q;
    // keep on the same hemisphere for shortest-path slerp
    if (this.targetQuat.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    this.targetQuat = q;
  }

  /** show arrows + turn animation for the current move; ghost arrow for next */
  previewMoves(current: string | null, next: string | null) {
    this.releasePivot();
    this.setArrow(current, false);
    this.setArrow(next, true);
    if (!current) { this.anim = null; return; }
    const face = current[0] as Face;
    const dir = (current.includes("'") ? 1 : -1) as 1 | -1;
    this.anim = { face, dir, half: current.includes("2"), t: 0 };
  }

  private setArrow(move: string | null, ghost: boolean) {
    const key = ghost ? "ghostArrow" : "arrow";
    if (this[key]) { this.cubies.remove(this[key]!); this[key] = null; }
    if (!move) return;
    const face = move[0] as Face;
    this[key] = buildArrow(face, move.includes("'"), move.includes("2"), ghost);
    this.cubies.add(this[key]!);
  }

  private releasePivot() {
    while (this.pivot.children.length) this.cubies.add(this.pivot.children[0]);
    this.pivot.rotation.set(0, 0, 0);
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // smooth-rotate toward the physical orientation, else idle spin
    if (this.targetQuat) {
      this.cubies.quaternion.slerp(this.targetQuat, 1 - Math.pow(0.001, dt));
    } else if (++this.idleFrames > 60) {
      this.cubies.rotation.y += dt * 0.3;
    }

    // turn animation: turn out (0-40%), hold (40-65%), return (65-95%), rest
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const period = 1.5;
      const phase = (a.t % period) / period;
      const k = phase < 0.4 ? phase / 0.4 : phase < 0.65 ? 1 : phase < 0.95 ? 1 - (phase - 0.65) / 0.3 : 0;
      const angle = (a.half ? Math.PI : Math.PI / 2) * a.dir * easeInOut(Math.max(0, Math.min(1, k)));
      const n = AXIS_VEC[a.face];
      if (this.pivot.children.length === 0) {
        for (let i = 0; i < 54; i++) {
          const { pos } = FACELET_POS[i];
          if (pos[0] * n.x + pos[1] * n.y + pos[2] * n.z === 1) this.pivot.add(this.stickers[i]);
        }
      }
      this.pivot.setRotationFromAxisAngle(n, angle);
      if (phase > 0.97) this.releasePivot();

      // comet dot loops tail->head along the arrow arc: shows direction
      const markers = this.arrow?.userData.markers as
        | { curve: THREE.CatmullRomCurve3; mesh: THREE.Mesh }[]
        | undefined;
      if (markers) {
        const p = (a.t % 1.1) / 1.1;
        for (const m of markers) m.mesh.position.copy(m.curve.getPoint(p));
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

function easeInOut(t: number) { return t * t * (3 - 2 * t); }

/**
 * Build an arc arrow lying just outside `face`, wrapping around its center.
 * CCW when viewed from outside = increasing theta.
 */
function buildArrow(face: Face, ccw: boolean, half: boolean, ghost: boolean): THREE.Group {
  const n = AXIS_VEC[face];
  // in-plane orthonormal basis (u x v = n => theta+ is CCW viewed from outside)
  const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();

  const group = new THREE.Group();
  const color = ghost ? GHOST : ACCENT;
  const R = ghost ? 1.66 : 1.6;
  const tube = ghost ? 0.034 : 0.062;
  const lift = ghost ? 1.62 : 1.5;
  const mat = new THREE.MeshBasicMaterial({ color });
  const markers: { curve: THREE.CatmullRomCurve3; mesh: THREE.Mesh }[] = [];

  const spans: [number, number][] = half
    ? [[-2.4, 0.4], [Math.PI - 2.4, Math.PI + 0.4]] // two opposing arcs for 180°
    : [[-2.4, 0.4]];

  for (const [t0, t1] of spans) {
    const from = ccw ? t0 : t1;
    const to = ccw ? t1 : t0;
    const pts: THREE.Vector3[] = [];
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      pts.push(new THREE.Vector3()
        .addScaledVector(u, Math.cos(t) * R)
        .addScaledVector(v, Math.sin(t) * R)
        .addScaledVector(n, lift));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, tube, 12), mat));

    // arrowhead at the sweep end, pointing along the tangent
    const end = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const tang = end.clone().sub(prev).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.4, tube * 9, 12), mat);
    cone.position.copy(end);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tang);
    group.add(cone);

    // bright comet that travels the arc (main arrow only)
    if (!ghost) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xfff4c4 })
      );
      dot.position.copy(pts[0]);
      group.add(dot);
      markers.push({ curve, mesh: dot });
    }
  }
  group.userData.markers = markers;
  return group;
}
