/**
 * Three.js view of the tracked cube state, plus a looping animation
 * previewing the next move on the real cube.
 */

import * as THREE from "three";
import { Face, FACELET_POS, NORMAL } from "../cube/geom";

const AXIS_VEC: Record<string, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0), D: new THREE.Vector3(0, -1, 0),
  R: new THREE.Vector3(1, 0, 0), L: new THREE.Vector3(-1, 0, 0),
  F: new THREE.Vector3(0, 0, 1), B: new THREE.Vector3(0, 0, -1),
};

export class Cube3D {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private stickers: THREE.Mesh[] = [];
  private pivot = new THREE.Group();
  private anim: { axis: THREE.Vector3; dir: 1 | -1; half: boolean; t: number; running: boolean } | null = null;
  private cubies: THREE.Group;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(4.2, 3.4, 5.2);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(4, 8, 6);
    this.scene.add(dir);

    this.cubies = new THREE.Group();
    this.scene.add(this.cubies);

    // dark core
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(2.86, 2.86, 2.86),
      new THREE.MeshLambertMaterial({ color: 0x14141c })
    );
    this.cubies.add(core);

    // 54 sticker planes, one per facelet index
    const geo = new THREE.PlaneGeometry(0.88, 0.88);
    for (let i = 0; i < 54; i++) {
      const { face, pos } = FACELET_POS[i];
      const n = NORMAL[face];
      const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0] * 0.98 + n[0] * 0.47, pos[1] * 0.98 + n[1] * 0.47, pos[2] * 0.98 + n[2] * 0.47);
      m.lookAt(m.position.clone().add(new THREE.Vector3(n[0], n[1], n[2])));
      this.stickers.push(m);
      this.cubies.add(m);
    }

    this.cubies.add(this.pivot);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);

    // gentle auto-rotate
    const loop = () => {
      requestAnimationFrame(loop);
      this.cubies.rotation.y += 0.002;
      this.stepAnim();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private resize() {
    const el = this.renderer.domElement.parentElement!;
    const w = el.clientWidth || 300, h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** repaint stickers from a 54-char facelet state */
  setState(facelets: string, colorOf: (f: Face) => [number, number, number] | null) {
    for (let i = 0; i < 54; i++) {
      const rgb = colorOf(facelets[i] as Face) ?? [40, 40, 48];
      (this.stickers[i].material as THREE.MeshLambertMaterial).color.setRGB(
        rgb[0] / 255, rgb[1] / 255, rgb[2] / 255
      );
    }
  }

  /** start looping a hint animation for move like "R", "U'", "F2" */
  previewMove(move: string | null) {
    if (!move) { this.anim = null; this.pivot.rotation.set(0, 0, 0); return; }
    const face = move[0] as Face;
    const axis = AXIS_VEC[face].clone();
    // CW viewed at the face = rotation by -90° about the outward normal
    const dir = (move.includes("'") ? 1 : -1) as 1 | -1;
    const half = move.includes("2");
    this.anim = { axis, dir, half, t: 0, running: true };
  }

  private stepAnim() {
    if (!this.anim?.running) return;
    const a = this.anim;
    const maxAngle = (a.half ? Math.PI : Math.PI / 2) * a.dir;
    a.t += 0.016;
    const period = 1.6;
    const phase = (a.t % period) / period;
    // rotate out, hold, spring back — repeat
    const k = phase < 0.4 ? phase / 0.4 : phase < 0.7 ? 1 : 1 - (phase - 0.7) / 0.3;
    const angle = maxAngle * easeInOut(Math.min(1, Math.max(0, k)));

    // collect the layer's stickers into the pivot on first frame of the cycle
    const n = a.axis;
    if (this.pivot.children.length === 0) {
      for (let i = 0; i < 54; i++) {
        const { pos } = FACELET_POS[i];
        if (pos[0] * n.x + pos[1] * n.y + pos[2] * n.z === 1) this.pivot.add(this.stickers[i]);
      }
    }
    this.pivot.setRotationFromAxisAngle(n.clone().normalize(), angle);
    if (phase > 0.98) {
      while (this.pivot.children.length) this.cubies.add(this.pivot.children[0]);
      this.pivot.rotation.set(0, 0, 0);
    }
  }
}

function easeInOut(t: number) { return t * t * (3 - 2 * t); }
