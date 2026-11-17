import * as THREE from 'three';
import { clamp, damp } from './math.js';

const ease = (x) => x * x * (3 - 2 * x);

// Gameplay camera with three framings and smooth blends between them:
//  chase  – behind and above the ship, looking down the route
//  top    – straight down on the ship (nose pointing up the screen) for cannon battles
//  finale – trailing the ship as it dives toward a target point (the black hole)
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
    this.lag = new THREE.Vector3();
    this.plungePos = new THREE.Vector3();
    this.topZoom = 1;  // >1 pulls the top view higher (boss fight)
    this.zoom = 1;
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
      d.position.set(p.x, p.y + (150 * this.zoom) / Math.pow(narrow, 0.95), p.z + 0.001);
      d.up.set(0, 0, -1);
      d.lookAt(p.x, p.y, p.z);
      out.fov = 52;
    } else if (this.mode === 'plunge') {
      d.position.copy(this.plungePos);
      d.up.set(0, 1, 0);
      d.lookAt(this.focus);
      out.fov = 74;
    } else if (this.mode === 'finale') {
      const dir = this.lag.copy(this.focus).sub(p).normalize();
      d.position.copy(p).addScaledVector(dir, -20).add(new THREE.Vector3(0, 4.5, 0));
      d.up.set(0, 1, 0);
      d.lookAt(this.focus);
      out.fov = 70 + ship.boost * 14;
    } else {
      const speed = Math.max(0, -ship.velocity.z);
      const pull = 1 / Math.pow(narrow, 0.55);
      d.position.set(p.x * 0.8, p.y + 7.2 * pull, p.z + (24 + speed * 0.02) * pull);
      d.up.set(0, 1, 0);
      d.lookAt(p.x * 0.9, p.y + 2.2, p.z - 40);
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
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.02;
      c.rotateX(Math.sin(time * 71.3) * s);
      c.rotateY(Math.sin(time * 53.1 + 1.3) * s);
      c.rotateZ(Math.sin(time * 37.7 + 2.1) * s * 0.6);
    }
    c.updateMatrixWorld();
  }

  ray(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }
}
