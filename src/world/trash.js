import * as THREE from 'three';
import { segmentPointDistSq } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Space junk drifting through the journey lanes: cargo crates, fuel barrels, torn hull panels and
// dish fragments. One instanced mesh per shape; pieces tumble, can be shot (a spray of sparks and
// scrap) and hurt the ship if it flies into them.
export class SpaceTrash {
  constructor(scene, capacity = 40) {
    const metal = (c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.75, roughness: 0.42, envMapIntensity: 1.4 });
    this.kinds = [
      { geo: new THREE.BoxGeometry(1, 1, 1), mat: metal(0x8a6a3c), radius: 0.9 },                       // crate
      { geo: new THREE.CylinderGeometry(0.5, 0.5, 1.3, 14), mat: metal(0xb5452a), radius: 0.85 },        // barrel
      { geo: new THREE.BoxGeometry(1.8, 0.12, 1.1), mat: metal(0x9aa3ad), radius: 1.0 },                 // hull panel
      { geo: new THREE.CylinderGeometry(0.9, 0.2, 0.35, 16, 1, true), mat: metal(0xd8d2c4), radius: 0.95 }, // dish
    ];
    this.kinds.forEach((k) => {
      k.mat.side = THREE.DoubleSide;
      k.mesh = new THREE.InstancedMesh(k.geo, k.mat, capacity);
      k.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      k.mesh.frustumCulled = false;
      for (let i = 0; i < capacity; i++) k.mesh.setMatrixAt(i, ZERO);
      scene.add(k.mesh);
    });
    this.list = Array.from({ length: capacity * this.kinds.length }, (_, i) => ({
      alive: false, kind: i % this.kinds.length, slot: Math.floor(i / this.kinds.length),
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(),
      size: 1, radius: 1, hp: 1, isTrash: true,
    }));
    this.onPassed = null;
  }

  spawn(pos, size, vel) {
    const k = Math.floor(Math.random() * this.kinds.length);
    const p = this.list.find((x) => !x.alive && x.kind === k) || this.list.find((x) => !x.alive);
    if (!p) return null;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(1.6);
    p.size = size;
    p.radius = this.kinds[p.kind].radius * size;
    p.hp = p.maxHp = size > 1.6 ? 2 : 1;
    return p;
  }

  clearAll() { for (const p of this.list) this.kill(p); }

  kill(p) {
    p.alive = false;
    this.kinds[p.kind].mesh.setMatrixAt(p.slot, ZERO);
  }

  get liveCount() { let n = 0; for (const p of this.list) if (p.alive) n++; return n; }

  update(dt, shipPos) {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.pos.addScaledVector(p.vel, dt);
      p.rot.addScaledVector(p.spin, dt);
      if (p.pos.z > shipPos.z + 40) { this.kill(p); this.onPassed?.(p); continue; }
      _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
      _m.compose(p.pos, _q, _s.setScalar(p.size));
      this.kinds[p.kind].mesh.setMatrixAt(p.slot, _m);
    }
    for (const k of this.kinds) k.mesh.instanceMatrix.needsUpdate = true;
  }

  // nearest piece hit by segment a→b
  segmentHit(a, b, out) {
    let best = null, bestD = Infinity;
    for (const p of this.list) {
      if (!p.alive) continue;
      if (segmentPointDistSq(a, b, p.pos) > p.radius * p.radius * 1.4) continue;
      const d = a.distanceToSquared(p.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && out) out.copy(a).sub(best.pos).normalize().multiplyScalar(best.radius).add(best.pos);
    return best;
  }

  overlap(pos, radius) {
    for (const p of this.list) {
      if (!p.alive) continue;
      const r = p.radius + radius;
      if (p.pos.distanceToSquared(pos) < r * r) return p;
    }
    return null;
  }
}
