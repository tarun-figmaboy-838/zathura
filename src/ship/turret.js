import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../core/math.js';

const DEG = Math.PI / 180;
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();

// The 360° dorsal cannon. Yaw is unlimited, pitch is clamped, and both axes turn at a
// limited traverse speed so the turret feels heavy and mechanical.
export class Turret {
  constructor(ship) {
    const n = ship.nodes;
    this.mount = n.TurretMount;
    this.yawNode = n.TurretYaw;
    this.pitchNode = n.TurretPitch;
    this.barrels = [n.Barrel_L, n.Barrel_R];
    this.muzzles = [n.Muzzle_L, n.Muzzle_R];
    this.rest = this.barrels.map((b) => b.position.clone());
    this.recoil = [0, 0];

    this.yaw = 0;
    this.pitch = 0;
    this.desiredYaw = 0;
    this.yawSpeed = 210 * DEG;
    this.pitchSpeed = 140 * DEG;
    // firing arc: barrels clear the hull far more broadside than over the nose or tail
    this.minPitchFore = -8 * DEG;
    this.minPitchSide = -30 * DEG;
    this.maxPitch = 85 * DEG;

    this.fireInterval = 0.105;
    this.nextShot = 0;
    this.barrelIndex = 0;
    this.heat = 0;
    this.overheated = false;
    this.onTarget = false;
    this.blocked = false;
    this.slew = 0;
  }

  update(dt, aimWorld) {
    _local.copy(aimWorld);
    this.mount.worldToLocal(_local);
    _local.sub(this.yawNode.position);
    this.desiredYaw = Math.atan2(-_local.x, -_local.z);
    const horiz = Math.max(Math.hypot(_local.x, _local.z) - 0.2, 0.001);
    const rawPitch = Math.atan2(_local.y - this.pitchNode.position.y, horiz);
    const minAtTarget = this.minPitchAt(this.desiredYaw);
    const desiredPitch = clamp(rawPitch, minAtTarget, this.maxPitch);
    this.blocked = rawPitch < minAtTarget - 2 * DEG;

    const prevYaw = this.yaw, prevPitch = this.pitch;
    const yawErr = wrapAngle(this.desiredYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + clamp(yawErr, -this.yawSpeed * dt, this.yawSpeed * dt));
    const pitchErr = desiredPitch - this.pitch;
    this.pitch += clamp(pitchErr, -this.pitchSpeed * dt, this.pitchSpeed * dt);
    // never let a depressed barrel sweep through the hull while traversing
    this.pitch = Math.max(this.pitch, this.minPitchAt(this.yaw));
    this.slew = dt > 0 ? (Math.abs(wrapAngle(this.yaw - prevYaw)) + Math.abs(this.pitch - prevPitch)) / dt : 0;
    this.yawNode.rotation.y = this.yaw;
    this.pitchNode.rotation.x = this.pitch;
    this.onTarget = !this.blocked && Math.abs(yawErr) < 2 * DEG && Math.abs(pitchErr) < 2 * DEG;

    for (let i = 0; i < 2; i++) {
      this.recoil[i] = damp(this.recoil[i], 0, 9, dt);
      this.barrels[i].position.copy(this.rest[i]);
      this.barrels[i].position.z += this.recoil[i];
    }

    this.heat = Math.max(0, this.heat - dt * (this.overheated ? 0.4 : 0.24));
    if (this.overheated && this.heat < 0.3) this.overheated = false;
  }

  reset() {
    this.heat = 0;
    this.overheated = false;
    this.nextShot = 0;
  }

  minPitchAt(yaw) {
    const side = Math.pow(Math.abs(Math.sin(yaw)), 1.5);
    return this.minPitchFore + (this.minPitchSide - this.minPitchFore) * side;
  }

  // Fires one barrel if the cooldown allows. Returns { position, direction } or null.
  tryFire(time, out) {
    if (this.overheated || time < this.nextShot) return null;
    this.nextShot = time + this.fireInterval;
    const i = this.barrelIndex;
    this.barrelIndex ^= 1;
    this.muzzles[i].getWorldPosition(out.position);
    this.barrels[i].getWorldQuaternion(_q);
    out.direction.set(0, 0, -1).applyQuaternion(_q);
    this.recoil[i] = 0.5;
    this.heat = Math.min(1, this.heat + 0.045); // ~5.5 s of sustained fire to overheat
    if (this.heat >= 1) this.overheated = true;
    return out;
  }

  // Where the barrels currently point, for the HUD's turret marker.
  aimPoint(out, distance) {
    this.pitchNode.getWorldPosition(out);
    this.pitchNode.getWorldQuaternion(_q);
    return out.add(_local.set(0, 0, -distance).applyQuaternion(_q));
  }
}
