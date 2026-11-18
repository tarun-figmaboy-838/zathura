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
const T_HOSE = [1.15, 1.75];
const T_CLAMP = [1.5, 2.1];
const T_LIFT = [2.15, 3.3];
const T_RETRACT = [2.7, 3.3];
const T_IGNITE = 3.35;
const T_BOOST = 3.95;
const TUNNEL_TIME = 2.6;      // the ride through the wormhole after the horizon
const FOLLOW_TIME = 0.85;     // the camera chasing the ship through the horizon
const ONE = new THREE.Vector3(1, 1, 1);
const RISE = 1.35;          // camera leaves the cockpit and swings out to the release shot
// captain's eye inside the docked ship (ship space), and the outside shot of the release
const EYE = new THREE.Vector3(0, 0.95, -2.3);
const RELEASE_POS = new THREE.Vector3(16, 8, -20);
const RELEASE_TARGET = new THREE.Vector3(0, 0.5, 5);
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
    this.followFrom = new THREE.Vector3();
    this.followRoll = 0;
    this.followT = 0;
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
    // start in the captain's seat (also when relaunching straight from a menu)
    s.model.visible = false;
    this.shot(EYE, _t.set(0, EYE.y - 5.2, -40));
    this.fov = 62;
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
      // first-person from the captain's seat: the cockpit art frames the view and the 3D world
      // shows through its windshield; a gentle breathing head motion keeps it alive
      s.model.visible = false;
      _p.copy(EYE).add(_v.set(Math.sin(time * 0.31) * 0.04, Math.sin(time * 0.52) * 0.025, 0));
      _t.set(Math.sin(time * 0.11) * 1.2, EYE.y - 5.2, -40);
      this.shot(_p, _t);
      this.fov = 62 * (this.rig.camera.aspect < 1 ? 1.15 : 1);
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
    const done = this.skipping ? this.fade >= 1 : this.stage === 'tunnel' && this.tunnelT >= TUNNEL_TIME;
    if (done) {
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
        this.stage = 'follow';
        this.crossT = t;
        this.followT = 0;
        this.followFrom.copy(this.holdPos);
        this.followRoll = this.roll;
        this.audio.horizon();
      }
    } else if (this.stage === 'follow') {
      // we follow it in: the ship, still a dark stretched silhouette, keeps falling and the camera
      // chases it through the horizon; the black fills the view as the bright ring rushes outward
      this.followT += dt;
      const k = clamp(this.followT / FOLLOW_TIME, 0, 1);
      this.speed = lerp(95, 260, k);
      s.thrust = 0.3;
      this.distort = 1 - 0.5 * k;
      if (this.followT >= FOLLOW_TIME && !this.skipping) this.enterTunnel();
    }
    if (this.stage === 'tunnel') {
      // through the wormhole: full burn, a gentle corkscrew, the lens warping with the speed
      this.tunnelT += dt;
      this.speed = 900;
      s.thrust = 0.6;          // engines on, but gently: the boost beams and full glow flooded the frame
      s.boost = 0;
      s.visual.rotation.z = Math.sin(this.tunnelT * 1.8) * 0.2;
      s.visual.rotation.x = Math.sin(this.tunnelT * 1.3) * 0.05;
      this.distort = 0.45 + 0.15 * Math.sin(this.tunnelT * 3);
      this.rig.addShake(dt * 0.6);
      s.setRedshift(Math.max(0, 1 - this.tunnelT / 0.5));
      s.visual.scale.lerp(ONE, 1 - Math.exp(-5 * dt));
      if (this.tunnelT > 1.0) this.blackhole.object.visible = false;
    }
    s.velocity.copy(this.dir).multiplyScalar(this.speed);
    sp.addScaledVector(s.velocity, dt);
    _m.lookAt(sp, _w.copy(sp).add(this.dir), UP);
    s.root.quaternion.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-5 * dt));
  }

  enterTunnel() {
    const s = this.ship;
    this.stage = 'tunnel';
    this.tunnelT = 0;
    s.model.visible = true;
    // the wormhole opens from the centre of the black, where the ship is heading; its first rings
    // still glow in the accretion disk's gold before turning cyan
    this.wormhole?.start(1, 0, { reveal: 0.9, heat: 1 });
    this.audio.boostWhoosh();
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
    if (t < RISE) {
      const k = ease(t / RISE);
      // cubic Bezier: straight up out of the canopy first, then out to the front-right
      const u = 1 - k;
      _a.copy(this.fromPos);
      _b.set(this.fromPos.x, this.fromPos.y + 5, this.fromPos.z + 0.5);
      _c.copy(RELEASE_POS).add(_e.set(-4, 3, 6));
      _p.copy(_a).multiplyScalar(u * u * u).addScaledVector(_b, 3 * u * u * k).addScaledVector(_c, 3 * u * k * k).addScaledVector(RELEASE_POS, k * k * k);
      _t.copy(this.fromTarget).lerp(RELEASE_TARGET, ease(t / RISE * 1.15));
      if (!s.model.visible && _p.y > 1.6) s.model.visible = true;
      this.fov = lerp(this.fromFov, 46, k);
      this.shot(_p, _t);
      return;
    }
    if (this.stage === 'pad' && t < T_IGNITE) {
      // the release: hoses drop, clamps open and the ship lifts off the station's pad
      s.model.visible = true;
      const k = (t - RISE) / (T_IGNITE - RISE);
      _p.copy(RELEASE_POS).add(_v.set(-2.5 * k, 0.8 * k, 1.5 * k));
      _t.copy(RELEASE_TARGET).lerp(_w.set(0, sp.y + 0.6, 0), 0.5);
      this.fov = 46;
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
      this.fov = this.stage === 'pad' ? lerp(lens.fov, lens.fov + 4, ease(span(t, T_IGNITE, T_BOOST))) : lerp(lens.fov + 4, Math.max(70, lens.fov + 4), k);
      const kb = ease((t - T_IGNITE) / 0.7);
      if (kb < 1) {
        _p.lerp(_v.copy(RELEASE_POS).add(_w.set(-2.5, 0.8, 1.5)), 1 - kb);
        _t.lerp(_w.copy(RELEASE_TARGET).lerp(_a.set(0, sp.y + 0.6, 0), 0.5), 1 - kb);
        this.fov = lerp(46, this.fov, kb);
      }
      this.shot(_p, _t);
      return;
    }
    if (this.stage === 'follow') {
      const k = ease(clamp(this.followT / FOLLOW_TIME, 0, 1));
      _a.copy(sp).addScaledVector(this.dir, -17).addScaledVector(UP, 6.5);           // where the tunnel shot begins
      _p.copy(this.followFrom).lerp(_a, k);
      _t.copy(bh).lerp(_b.copy(sp).addScaledVector(this.dir, 60).addScaledVector(UP, 5.5), k);
      this.fov = lerp(this.fov, 68, 1 - Math.exp(-3 * dt));
      this.shot(_p, _t, this.followRoll * (1 - k));
      return;
    }
    if (this.stage === 'tunnel') {
      const right = _v.crossVectors(this.dir, UP).normalize();
      // above and behind, so the ship sits low in the frame and the tunnel's far end shows over it
      _p.copy(sp).addScaledVector(this.dir, -17).addScaledVector(UP, 6.5).addScaledVector(right, Math.sin(this.tunnelT * 0.9) * 1.2);
      _t.copy(sp).addScaledVector(this.dir, 60).addScaledVector(UP, 5.5);
      this.fov = lerp(this.fov, 68, 1 - Math.exp(-3 * dt));
      this.shot(_p, _t, Math.sin(this.tunnelT * 0.8) * 0.12);
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
