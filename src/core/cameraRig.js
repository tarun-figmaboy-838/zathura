import * as THREE from 'three';
import { clamp, damp } from './math.js';

const ease = (x) => x * x * (3 - 2 * x);
// top-view camera height. Wide: the radar fills the space between the question and the answers. Portrait: low enough that the radar fills ~90% of the width, high enough
// that the raider (up or down, along the long side of the screen) clears the question and answers
export const topHeight = (aspect) => (aspect >= 1 ? 82 : Math.max(135, 57 / aspect));
// the boss fight's zoom-out, sized so the Warden is framed as it was designed (at 108 / aspect^0.62)
export const bossZoom = (aspect) => 1.65 * (aspect >= 1 ? 1 : 108 / Math.pow(aspect, 0.62) / topHeight(aspect));
export const wideLayout = (aspect) => aspect >= 1.2;
// Wide screens, classic layout: the question bar on top, the answers in one row at the bottom, the
// radar centred between them and the enemy out in the open side space. Sizes are in units of the
// half view height.
export function battleFrame(aspect) {
  const ring = Math.min(0.64, aspect - 0.62);            // leaves room beside it for the enemy
  const dist = Math.min(ring + 0.42, aspect - 0.3);      // the enemy, well out in the side space
  return { ring, dist };
}

// Gameplay camera with three framings and smooth blends between them:
//  chase  – behind and above the ship, looking down the route
//  top    – straight down on the ship (nose pointing up the screen) for cannon battles
//  hold   – a parked drone that keeps `focus` in frame (the ending jump)
//  drone  – a shot driven from outside (game/director.js: introductions)
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.t = 1;
    this.dur = 1.3;
    this.from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
    this.target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 };
    this.dummy = new THREE.PerspectiveCamera();
    this.focus = new THREE.Vector3();
    this.shake = 0;
    this.raycaster = new THREE.Raycaster();
    this.plungePos = new THREE.Vector3();
    this.topZoom = 1;  // >1 pulls the top view higher (boss fight)
    this.zoom = 1;
    this.holdFov = 50;
    this.dronePos = new THREE.Vector3();
    this.droneTarget = new THREE.Vector3();
    this.droneUp = new THREE.Vector3(0, 1, 0);
    this.droneFov = 50;
  }

  setMode(mode, dur = 1.3) {
    if (mode === this.mode) return;
    const c = this.camera;
    this.from.pos.copy(c.position);
    this.from.quat.copy(c.quaternion);
    this.from.fov = c.fov;
    this.mode = mode;
    this.t = 0;
    this.dur = dur;
  }

  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  pose(ship, dt) {
    const d = this.dummy;
    const p = ship.position;
    const out = this.target;
    const narrow = Math.min(1, this.camera.aspect);
    if (this.mode === 'top') {
      this.zoom = damp(this.zoom, this.topZoom, 1.2, dt);
      const h = topHeight(this.camera.aspect) * this.zoom;
      d.position.set(p.x, p.y + h, p.z + 0.001);
      d.up.set(0, 0, -1);
      d.lookAt(p.x, p.y, p.z);
      out.fov = 52;
    } else if (this.mode === 'drone') {
      d.position.copy(this.dronePos);
      d.up.copy(this.droneUp);
      d.lookAt(this.droneTarget);
      out.fov = this.droneFov;
    } else if (this.mode === 'hold') {
      d.position.copy(this.plungePos);
      d.up.set(0, 1, 0);
      d.lookAt(this.focus);
      out.fov = this.holdFov;
    } else {
      // close enough that the ship reads clearly, still looking well down the route
      const speed = Math.max(0, -ship.velocity.z);
      const pull = 1 / Math.pow(narrow, 0.55);
      d.position.set(p.x * 0.8, p.y + 6.2 * pull, p.z + (19.5 + speed * 0.018) * pull);
      d.up.set(0, 1, 0);
      d.lookAt(p.x * 0.9, p.y + 2.0, p.z - 40);
      d.rotateZ(clamp(-ship.velocity.x * 0.004, -0.12, 0.12));
      out.fov = 62 + ship.boost * 10;
    }
    out.pos.copy(d.position);
    out.quat.copy(d.quaternion);
  }

  update(dt, ship, time) {
    this.pose(ship, dt);
    this.t = Math.min(1, this.t + dt / this.dur);
    const k = ease(this.t);
    const c = this.camera;
    c.position.lerpVectors(this.from.pos, this.target.pos, k);
    c.quaternion.slerpQuaternions(this.from.quat, this.target.quat, k);
    const fov = this.from.fov + (this.target.fov - this.from.fov) * k;
    if (this.t >= 1) this.from.fov = this.target.fov;
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
    if (this.t >= 1) { this.from.pos.copy(this.target.pos); this.from.quat.copy(this.target.quat); }
    this.shake = damp(this.shake, 0, 5, dt);
    this.applyShake(c, time);
    c.updateMatrixWorld();
  }

  applyShake(c, time) {
    if (this.shake <= 0.001) return;
    const s = this.shake * this.shake * 0.02;
    c.rotateX(Math.sin(time * 71.3) * s);
    c.rotateY(Math.sin(time * 53.1 + 1.3) * s);
    c.rotateZ(Math.sin(time * 37.7 + 2.1) * s * 0.6);
  }

  ray(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }
}
