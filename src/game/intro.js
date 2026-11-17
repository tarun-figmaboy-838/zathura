import * as THREE from 'three';
import { clamp } from '../core/math.js';

const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOut = (x) => { x = clamp(x, 0, 1); return 1 - (1 - x) * (1 - x); };
const span = (t, a, b) => (t - a) / (b - a);
const lerp = (a, b, k) => a + (b - a) * k;
const DEG = Math.PI / 180;
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
// infalling disk matter: white-hot to orange, rose and violet
const INFALL = [
  [new THREE.Color(3.2, 2.6, 1.8), new THREE.Color(1.2, 0.35, 0.08)],
  [new THREE.Color(3.0, 1.2, 0.5), new THREE.Color(0.9, 0.12, 0.3)],
  [new THREE.Color(2.0, 0.7, 2.4), new THREE.Color(0.3, 0.08, 0.8)],
];

const LIFT = 6.5;
// launch timeline (seconds after Play)
const T_HOSE = [0.15, 0.75];
const T_CLAMP = [0.5, 1.1];
const T_LIFT = [1.15, 2.3];
const T_RETRACT = [1.7, 2.3];
const T_IGNITE = 2.35;
const T_BOOST = 2.95;
const ZOOM_IN = 1.7;        // drone swoops in on the ship
const RCS_POINTS = [
  new THREE.Vector3(0, -0.7, -3.2), new THREE.Vector3(0, -0.8, 3.0),
  new THREE.Vector3(-4.2, -0.5, -0.5), new THREE.Vector3(4.2, -0.5, -0.5),
];

// Title-screen drone shot over the docked ship, then the short launch cinematic: the drone
// zooms in as the clamps open and the ship lifts off, pulls back as the engines fire, and
// follows the ship into the black hole. Crossing the horizon fades to white; update() then
// returns 'emerge' and the game starts on the other side.
export class Intro {
  constructor(station, ship, fx, audio, rig, blackhole) {
    this.station = station;
    this.ship = ship;
    this.fx = fx;
    this.audio = audio;
    this.rig = rig;
    this.blackhole = blackhole;
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
    this.fov = 50;
    this.fade = 0;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.camTarget = new THREE.Vector3();
    this.fromPos = new THREE.Vector3();
    this.fromTarget = new THREE.Vector3();
    this.fromFov = 50;
    this.holdPos = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
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
    this.fade = 0;
    this.skipping = false;
    this.distort = 0;
    this.roll = 0;
    this.cues.clear();
    this.pose(0, 0, 0);
  }

  start() {
    if (this.phase !== 'docked') return;
    this.phase = 'launch';
    this.t = 0;
    this.speed = 0;
    this.stage = 'pad';
    this.crossT = 0;
    this.fade = 0;
    this.skipping = false;
    this.distort = 0;
    this.roll = 0;
    this.infallT = 0;
    this.dir.set(0, 0, -1);
    this.cues.clear();
    this.fromPos.copy(this.camPos);
    this.fromTarget.copy(this.camTarget);
    this.fromFov = this.fov;
  }

  // jump straight to the far side of the black hole
  skip() {
    if (this.phase === 'launch') this.skipping = true;
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

  // returns 'emerge' on the frame the game should start
  update(dt, time) {
    if (this.phase === 'done') return null;
    const s = this.ship;
    if (this.phase === 'docked') {
      this.padAmber.emissiveIntensity = this.amberBase * (0.55 + 0.45 * Math.sin(time * 2.2));
      this.padRing.emissiveIntensity = this.ringBase * (0.7 + 0.3 * Math.sin(time * 1.4));
      // poster framing: the craft centre stage, the black hole's light behind it; the drone
      // drifts around slowly and zooms in and out
      const yaw = 0.24 + Math.sin(time * 0.08) * 0.12;
      const lens = this.lens(50, 21);
      const r = lens.dist + Math.sin(time * 0.13) * 2.5;
      const h = 4.6 + (lens.dist - 21) * 0.6 + Math.sin(time * 0.1) * 0.8;
      this.shot(_p.set(Math.sin(yaw) * r, h, Math.cos(yaw) * r), _t.set(0, 2.2, -8));
      this.fov = lens.fov;
      return null;
    }

    const t = (this.t += dt);
    const strobe = t < T_IGNITE ? (Math.sin(t * 16) > 0 ? 1.8 : 0.12) : 0.6;
    this.padAmber.emissiveIntensity = this.amberBase * strobe;
    this.padRing.emissiveIntensity = this.ringBase * (t < T_IGNITE ? 1.6 : 0.6);
    this.pose(span(t, ...T_HOSE), span(t, ...T_CLAMP), span(t, ...T_RETRACT));

    this.cue('klaxon', 0, () => this.audio.klaxon());
    this.cue('hiss', T_HOSE[0], () => this.audio.hiss());
    this.cue('clunk1', T_CLAMP[0], () => this.audio.clunk());
    this.cue('clunk2', T_CLAMP[1], () => this.audio.clunk());
    this.cue('lift', T_LIFT[0], () => this.audio.rcsBurst());

    const sp = s.root.position;
    if (s.docked && t >= T_LIFT[0]) {
      sp.y = LIFT * ease(span(t, ...T_LIFT));
      s.visual.rotation.x = Math.sin(t * 3.1) * 0.012;
      s.visual.rotation.z = Math.sin(t * 2.3) * 0.015;
      if ((this.rcsT -= dt) <= 0) {
        this.rcsT = 0.07;
        s.root.updateMatrixWorld(true);
        for (const p of RCS_POINTS) this.fx.rcs(_w.copy(p).applyMatrix4(s.root.matrixWorld), _v.set(0, -1, 0), s.velocity);
      }
    }
    this.cue('ignite', T_IGNITE, () => {
      s.docked = false;
      s.kinematic = true;    // flown by this cinematic from here on
      sp.y = LIFT;
      s.visual.rotation.set(0, 0, 0);
      this.audio.ignite();
      this.rig.addShake(0.5);
    });
    this.cue('boost', T_BOOST, () => { this.audio.boostWhoosh(); this.rig.addShake(0.4); });

    if (!s.docked) this.fly(dt, t);
    this.camera(dt, t);

    if (this.skipping) this.fade = Math.min(1, this.fade + dt / 0.25);
    else if (this.stage === 'crossed') this.fade = clamp((t - this.crossT - 0.1) / 0.35, 0, 1);
    const blackBeat = this.skipping || t - this.crossT > 0.7;
    if (this.fade >= 1 && blackBeat) {
      this.phase = 'done';
      return 'emerge';
    }
    return null;
  }

  // engines on: a gentle push, then a hard burn straight at the black hole and the plunge
  fly(dt, t) {
    const s = this.ship;
    const sp = s.root.position;
    const bh = this.blackhole.position;
    const R = this.blackhole.uniforms.uR.value;
    const toBH = _d.copy(bh).sub(sp);
    const dist = toBH.length();
    toBH.divideScalar(dist);

    if (this.stage === 'pad' && t >= T_BOOST) this.stage = 'dash';
    if (this.stage === 'pad') {
      this.speed = Math.min(30, this.speed + dt * 40);
      s.thrust = Math.min(0.8, s.thrust + dt * 2);
      s.boost = 0;
    } else if (this.stage === 'dash') {
      const k = t - T_BOOST;
      this.speed = Math.min(3600, this.speed + dt * (500 + k * 2200));
      s.thrust = 1.6;
      s.boost = Math.min(1, s.boost + dt * 2.5);
      this.dir.lerp(toBH, 1 - Math.exp(-4 * dt)).normalize();
      this.rig.addShake(dt * 1.6);
      if (dist < R * 4.2) {
        this.stage = 'plunge';
        this.holdPos.copy(this.camPos);
      }
    } else if (this.stage === 'plunge') {
      // Seen from outside, the falling ship slows and freezes at the horizon (time dilation),
      // is stretched along its fall (tides) and redshifts to a black silhouette, so it fades
      // into the shadow instead of popping through it.
      const k = clamp(1 - (dist - R) / (3.2 * R), 0, 1);
      this.speed = 1500 * Math.pow(1 - k, 1.6) + 95;
      s.visual.scale.set(1 - 0.55 * k, 1 - 0.55 * k, 1 + 3.2 * k * k);
      s.thrust = 0.55 * (1 - k);
      s.boost = 0;
      s.setRedshift(Math.pow(k, 1.3));
      this.distort = k;
      this.dir.copy(toBH);
      this.infall(dt, sp, toBH, R, k);
      if (dist < R * 1.03) {
        this.stage = 'crossed';
        this.crossT = t;
        s.model.visible = false;
        this.audio.horizon();
      }
    }
    if (this.stage === 'crossed') {
      s.velocity.set(0, 0, 0);
      return;
    }
    s.velocity.copy(this.dir).multiplyScalar(this.speed);
    sp.addScaledVector(s.velocity, dt);
    _m.lookAt(sp, _w.copy(sp).add(this.dir), UP);
    s.root.quaternion.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-5 * dt));
  }

  // glowing disk matter streaming past the ship and spiralling into the hole
  infall(dt, sp, toBH, R, k) {
    this.infallT -= dt;
    while (this.infallT <= 0) {
      this.infallT += 0.012;
      const side = _c.crossVectors(toBH, UP).normalize();
      const up = _e.crossVectors(side, toBH).normalize();
      const a = Math.random() * Math.PI * 2;
      const rad = 12 + Math.random() * 70;
      const along = -30 + Math.random() * 200;
      _w.copy(sp).addScaledVector(toBH, along).addScaledVector(side, Math.cos(a) * rad).addScaledVector(up, Math.sin(a) * rad);
      // fall toward the centre with a swirl around the line of sight
      _v.copy(this.blackhole.position).sub(_w).normalize().multiplyScalar(260 + 520 * k)
        .addScaledVector(side, -Math.sin(a) * 140).addScaledVector(up, Math.cos(a) * 140);
      const [c0, c1] = INFALL[Math.floor(Math.random() * INFALL.length)];
      this.fx.fire.emit(_w, _v, 0.5 + Math.random() * 0.7, 0.5 + Math.random() * 0.9, 0.15, c0, c1, 0.2, 0.9);
    }
  }

  // drone camera: zoom in close on the pad, ride the lift-off, pull back for the burn,
  // then hold back and watch the ship fall in
  camera(dt, t) {
    const s = this.ship;
    const sp = s.root.position;
    const bh = this.blackhole.position;
    const lens = this.lens(42, 16.8);
    const pull = lens.dist / 16.8;
    const close = _w.set(8.5 * pull, 3.4 * pull, 14.5 * pull).add(sp);
    const closeTarget = _r.set(0, 0.8, -1.5).add(sp);
    if (t < ZOOM_IN) {
      const k = ease(t / ZOOM_IN);
      _p.copy(this.fromPos).lerp(close, k);
      _t.copy(this.fromTarget).lerp(closeTarget, k);
      this.fov = lerp(this.fromFov, lens.fov, k);
      this.shot(_p, _t);
      return;
    }
    if (this.stage === 'pad' || this.stage === 'dash') {
      // offset in the ship's flight frame: close beside it, swinging back and up as it accelerates
      const k = this.stage === 'pad' ? 0 : ease((t - T_BOOST) / 1.1);
      const right = _v.crossVectors(this.dir, UP).normalize();
      const back = lerp(14.5 * pull, 30, k), side = lerp(8.5 * pull, 0.6, k), up = lerp(3.4 * pull, 6, k);
      _p.copy(sp).addScaledVector(this.dir, -back).addScaledVector(right, side).addScaledVector(UP, up);
      // turn the view from the ship toward the black hole (blend directions, not points)
      const look = _a.copy(closeTarget).sub(_p).normalize();
      look.lerp(_b.copy(bh).sub(_p).normalize(), ease((t - T_BOOST + 0.1) / 1.3) * 0.85).normalize();
      _t.copy(_p).addScaledVector(look, 60);
      this.fov = this.stage === 'pad' ? lerp(lens.fov, lens.fov + 4, ease(span(t, ZOOM_IN, T_BOOST))) : lerp(lens.fov + 4, Math.max(70, lens.fov + 4), k);
      this.shot(_p, _t);
      return;
    }
    // plunge: ride close behind the falling ship so its redshift and stretch are clearly seen,
    // stop just outside the horizon and watch it sink away into the shadow
    const R = this.blackhole.uniforms.uR.value;
    const toBH = _d.copy(bh).sub(sp).normalize();
    if (s.model.visible) {
      _p.copy(sp).addScaledVector(toBH, -lerp(24, 34, this.distort)).addScaledVector(UP, 4.5);
      const limit = R * 1.32;
      if (_p.distanceTo(bh) < limit) _p.sub(bh).setLength(limit).add(bh);
      this.holdPos.lerp(_p, 1 - Math.exp(-14 * dt));
    }
    this.fov = lerp(this.fov, 74, 1 - Math.exp(-2 * dt));
    // frame dragging: space itself is swirling around the hole, so the view slowly rolls
    this.roll += dt * (0.08 + 0.5 * this.distort * this.distort);
    this.shot(this.holdPos, bh, this.roll);
  }

  // Narrow windows: widen the lens first and back off only as much as still needed, so the
  // whole craft (about 19 units across) stays in frame without the drone flying into the station.
  lens(baseFov, baseDist, halfWidth = 9.5) {
    const a = this.rig.camera.aspect;
    const p = Math.max(1, 1.5 / a);
    const fov = Math.min(72, baseFov * (1 + (p - 1) * 0.35));
    const need = halfWidth / (Math.tan((fov * DEG) / 2) * a);
    return { fov, dist: Math.max(baseDist, need) };
  }

  shot(pos, target, roll = 0) {
    const d = this.dummy;
    d.position.copy(pos);
    d.up.set(0, 1, 0);
    d.lookAt(target);
    if (roll) d.rotateZ(roll);
    this.camPos.copy(d.position);
    this.camQuat.copy(d.quaternion);
    this.camTarget.copy(target);
  }

  applyCamera(camera, time) {
    if (this.phase === 'done') return;
    camera.position.copy(this.camPos);
    camera.quaternion.copy(this.camQuat);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    this.rig.applyShake(camera, time);
    camera.updateMatrixWorld();
  }
}
