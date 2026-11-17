import * as THREE from 'three';
import { clamp } from '../core/math.js';

const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOut = (x) => { x = clamp(x, 0, 1); return 1 - (1 - x) * (1 - x); };
const span = (t, a, b) => (t - a) / (b - a);
const DEG = Math.PI / 180;
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export const LAUNCH_HANDOVER = 7.2;   // seconds into the launch when control returns
const LAUNCH_END = 8.2;
const LIFT = 6.5;
const RCS_POINTS = [
  new THREE.Vector3(0, -0.7, -3.2), new THREE.Vector3(0, -0.8, 3.0),
  new THREE.Vector3(-4.2, -0.5, -0.5), new THREE.Vector3(4.2, -0.5, -0.5),
];

// Title-screen dock view and the launch cinematic: hoses drop, clamps open, the ship lifts
// off the round pad on its thrusters, the cradle columns retract, engines ignite, and the
// cinematic camera hands over to the gameplay camera.
export class Intro {
  constructor(station, ship, fx, audio, rig) {
    this.station = station;
    this.ship = ship;
    this.fx = fx;
    this.audio = audio;
    this.rig = rig;
    const n = (name) => station.getObjectByName(name);
    this.supports = ['FL', 'FR', 'RL', 'RR'].map((k) => ({ node: n(`Support_${k}`), y: n(`Support_${k}`).position.y }));
    this.clamps = ['FL', 'FR', 'RL', 'RR'].map((k) => ({ node: n(`Clamp_${k}`), sign: k.endsWith('L') ? 1 : -1 }));
    this.hoses = ['L', 'R'].map((k) => ({ node: n(`Umbilical_${k}`), sign: k === 'L' ? -1 : 1 }));
    const mats = {};
    station.traverse((o) => { if (o.isMesh) mats[o.material.name] = o.material; });
    this.padAmber = mats.PadAmber;
    this.padRing = mats.PadRing;
    this.amberBase = this.padAmber.emissiveIntensity;
    this.ringBase = this.padRing.emissiveIntensity;

    this.phase = 'docked';
    this.t = 0;
    this.blend = 0;
    this.fov = 50;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.dummy = new THREE.PerspectiveCamera();
    this.cues = new Set();
    this.rcsT = 0;
  }

  get active() { return this.phase !== 'done'; }

  dock() {
    const s = this.ship;
    s.reset();
    s.root.position.set(0, 0, 0);
    s.root.quaternion.identity();
    s.docked = true;
    this.phase = 'docked';
    this.t = 0;
    this.blend = 0;
    this.cues.clear();
    this.pose(0, 0, 0);
  }

  start() {
    if (this.phase !== 'docked') return;
    this.phase = 'launch';
    this.t = 0;
    this.cues.clear();
  }

  skip() {
    if (this.phase !== 'launch' || this.t >= LAUNCH_HANDOVER) return;
    const s = this.ship;
    this.t = LAUNCH_HANDOVER;
    this.pose(1, 1, 1);
    for (const c of ['klaxon', 'hiss', 'clunk1', 'clunk2', 'lift', 'ignite', 'boost', 'boostOff']) this.cues.add(c);
    s.docked = false;
    s.root.position.set(0, LIFT, -45);
    s.velocity.set(0, 0, -48);
    s.scripted = { fwd: 1, boost: false };
  }

  // hose swing, clamp opening, column retraction: each 0..1
  pose(hose, clampOpen, retract) {
    for (const h of this.hoses) h.node.rotation.z = h.sign * 75 * DEG * ease(hose);
    for (const c of this.clamps) c.node.rotation.z = c.sign * 70 * DEG * easeOut(clampOpen);
    for (const s of this.supports) s.node.position.y = s.y - 1.9 * ease(retract);
  }

  cue(name, t, fn) {
    if (this.t >= t && !this.cues.has(name)) { this.cues.add(name); fn(); }
  }

  // returns 'handover' on the frame control should return to the player
  update(dt, time) {
    if (this.phase === 'done') return null;
    const s = this.ship;
    let event = null;
    if (this.phase === 'docked') {
      this.padAmber.emissiveIntensity = this.amberBase * (0.55 + 0.45 * Math.sin(time * 2.2));
      this.padRing.emissiveIntensity = this.ringBase * (0.7 + 0.3 * Math.sin(time * 1.4));
      // slow cinematic drift around the pad, ship framed right of the title panel
      const yaw = -2.55 + Math.sin(time * 0.07) * 0.55;
      this.shot(_p.set(Math.sin(yaw) * 29, 6.5 + Math.sin(time * 0.11) * 1.5, Math.cos(yaw) * 29), _v.set(0, -0.6, 1.5), 0.2);
      this.fov = 50;
      return null;
    }

    const t = (this.t += dt);
    const strobe = t < 4.6 ? (Math.sin(t * 16) > 0 ? 1.8 : 0.12) : 0.6;
    this.padAmber.emissiveIntensity = this.amberBase * strobe;
    this.padRing.emissiveIntensity = this.ringBase * (t < 4.6 ? 1.6 : 0.6);
    this.pose(span(t, 0.5, 1.3), span(t, 1.2, 2.0), span(t, 2.9, 3.7));

    this.cue('klaxon', 0, () => this.audio.klaxon());
    this.cue('hiss', 0.5, () => this.audio.hiss());
    this.cue('clunk1', 1.2, () => this.audio.clunk());
    this.cue('clunk2', 2.0, () => this.audio.clunk());
    this.cue('lift', 2.2, () => this.audio.rcsBurst());

    if (t >= 2.2 && t < 4.0 && s.docked) {
      s.root.position.y = LIFT * ease(span(t, 2.2, 4.0));
      s.visual.rotation.x = Math.sin(t * 3.1) * 0.012;
      s.visual.rotation.z = Math.sin(t * 2.3) * 0.015;
      this.rcsT -= dt;
      if (this.rcsT <= 0) {
        this.rcsT = 0.07;
        s.root.updateMatrixWorld(true);
        for (const p of RCS_POINTS) this.fx.rcs(_w.copy(p).applyMatrix4(s.root.matrixWorld), _v.set(0, -1, 0), s.velocity);
      }
    }
    this.cue('ignite', 4.0, () => {
      s.docked = false;
      s.root.position.y = LIFT;
      s.velocity.set(0, 0.6, -6);
      s.scripted = { fwd: 1, boost: false };
      this.audio.ignite();
      this.rig.addShake(0.45);
    });
    this.cue('boost', 5.4, () => { s.scripted.boost = true; this.audio.boostWhoosh(); this.rig.addShake(0.3); });
    this.cue('boostOff', 6.6, () => { if (s.scripted) s.scripted.boost = false; });
    this.cue('handover', LAUNCH_HANDOVER, () => { s.scripted = null; event = 'handover'; });

    // camera: wide establishing shot, low liftoff shot, then a chase as it pulls away
    const sp = s.root.position;
    if (t < 2.2) {
      const k = ease(t / 2.2);
      this.shot(_p.set(-24 + 4 * k, 6.5 - 1.2 * k, -30 + 4 * k), _v.set(0, -0.2, 2), 0);
      this.fov = 50;
    } else if (t < 4.0) {
      const k = ease(span(t, 2.2, 4.0));
      this.shot(_p.set(11 - k, -1.0 + 0.5 * k, -15 + 1.5 * k), _v.copy(sp).add(_w.set(0, 1.2, 0)), 0);
      this.fov = 46;
    } else {
      const k = span(t, 4.0, LAUNCH_HANDOVER);
      this.shot(_p.copy(sp).add(_w.set(7 - 3 * k, 3.5, 18 + 6 * k)), _v.copy(sp).add(_w.set(0, 1, -30)), 0);
      this.fov = 58 + 8 * clamp(s.boost, 0, 1);
    }
    this.blend = ease(span(t, LAUNCH_HANDOVER, LAUNCH_END));
    if (t >= LAUNCH_END) this.phase = 'done';
    return event;
  }

  shot(pos, target, yawOffset) {
    const d = this.dummy;
    d.position.copy(pos);
    d.up.set(0, 1, 0);
    d.lookAt(target);
    if (yawOffset) d.rotateY(yawOffset);
    this.camPos.copy(d.position);
    this.camQuat.copy(d.quaternion);
  }

  // blend the cinematic pose over whatever the gameplay rig put in the camera
  applyCamera(camera) {
    if (this.phase === 'done') return;
    const b = this.blend;
    _p.copy(camera.position);
    _q.copy(camera.quaternion);
    camera.position.copy(this.camPos).lerp(_p, b);
    camera.quaternion.copy(this.camQuat).slerp(_q, b);
    const fov = this.fov + (camera.fov - this.fov) * b;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }
}
