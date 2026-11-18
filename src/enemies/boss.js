import * as THREE from 'three';
import { addPanelDetail } from '../ship/ship.js';
import { damp, intercept, rand, segmentPointDistSq, segOut } from '../core/math.js';

export const TURRET_HP = 10;
export const CORE_HP = 60;
const TURRET_R = 4.2;
const CORE_R = 4.4;
const SHIELD_R = 6.0;
const BOLT_SPEED = 130;
const BARRAGE_SPEED = 62;
// armoured hull as spheres in the boss's local space (Three.js axes: nose is -Z)
const HULL = [[0, 0, 12, 9.5], [0, 0, 0, 11], [0, 0, -12, 8], [12.5, 0, -2, 4], [-12.5, 0, -2, 4], [12.5, 0, 9, 4], [-12.5, 0, 9, 4]];
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

function shieldMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vView; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash, uFade;
      varying vec3 vN; varying vec3 vView; varying vec3 vP;
      void main() {
        float fres = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vView)))), 2.2);
        vec3 p = normalize(vP);
        float hex = abs(sin(p.x * 18.0 + uTime) * sin(p.y * 18.0) * sin(p.z * 18.0 - uTime));
        float lines = smoothstep(0.85, 1.0, hex);
        float a = (fres * 0.9 + lines * 0.25 + uFlash * (0.4 + fres)) * uFade;
        gl_FragColor = vec4(vec3(1.0, 0.32, 0.12) * a * 1.8, 1.0);
      }`,
  });
}

// The Warden carrier. Phase 1: four turrets fire aimed bursts while a shield protects the core.
// Phase 2: the core is exposed; the carrier speeds up and fires telegraphed radial barrages.
// It launches raiders from its hangar throughout.
export class Boss {
  constructor(scene, gltf) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    const n = (name) => this.model.getObjectByName(name);
    const mats = new Set();
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = true; mats.add(o.material); } });
    this.hullMats = [...mats].filter((m) => ['BossHull', 'BossPlate', 'BossMark'].includes(m.name));
    this.hullMats.forEach((m) => { m.envMapIntensity = 1.3; addPanelDetail(m, { scale: 0.6, seam: 0.45, grime: 0.3, chips: 0.25, soot: [16, 22, 0.8] }); });
    this.coreMat = [...mats].find((m) => m.name === 'BossCore');
    this.glowMat = [...mats].find((m) => m.name === 'BossGlow');
    this.coreBase = this.coreMat.emissiveIntensity;
    this.core = n('Core');
    this.hangar = n('Hangar');
    this.turrets = [0, 1, 2, 3].map((i) => ({
      index: i, head: n(`TurretHead_${i}`), muzzle: n(`TurretMuzzle_${i}`), hp: TURRET_HP, alive: true, nextShot: 0, burst: 0,
      pos: new THREE.Vector3(), part: { isBossPart: true, kind: 'turret', index: i },
    }));
    this.parts = {
      core: { isBossPart: true, kind: 'core' },
      shield: { isBossPart: true, kind: 'shield' },
      hull: { isBossPart: true, kind: 'hull' },
    };
    this.shieldMat = shieldMaterial();
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(SHIELD_R, 40, 24), this.shieldMat);
    this.shield.renderOrder = 6;
    this.root.add(this.shield);
    this.corePos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.root.visible = false;
    this.active = false;
    this.defeated = false;
    scene.add(this.root);
  }

  get position() { return this.root.position; }

  get integrity() {
    const hp = this.turrets.reduce((s, t) => s + Math.max(0, t.hp), 0) + Math.max(0, this.coreHp);
    return hp / (TURRET_HP * 4 + CORE_HP);
  }

  get turretsLeft() { return this.turrets.filter((t) => t.alive).length; }

  spawn(ship, time, angle = rand(0, Math.PI * 2)) {
    for (const t of this.turrets) {
      t.hp = TURRET_HP;
      t.alive = true;
      t.head.visible = true;
      t.nextShot = time + 3 + t.index * 0.6;
      t.burst = 0;
    }
    this.coreHp = CORE_HP;
    this.phase = 'turrets';
    this.active = true;
    this.dying = false;
    this.defeated = false;
    this.root.visible = true;
    this.model.visible = true;
    this.shield.visible = true;
    this.shield.scale.setScalar(1);
    this.shieldMat.uniforms.uFade.value = 1;
    this.shieldCollapse = 0;
    this.flash = 0;
    this.coreFlash = 0;
    this.angle = angle;
    this.entry = 1;
    this.nextLaunch = time + 10;
    this.volleyT = time + 3;
    this.volleyIdx = 0;
    this.nextBarrage = 0;
    this.charge = 0;
    this.rings = [];
    this.holdAngle = null;   // angle battles: park the carrier at this orbit angle
    this.place(ship, 0);
    this.root.quaternion.identity();
  }

  despawn() {
    this.active = false;
    this.root.visible = false;
  }

  place(ship, dt) {
    const k = 1 + this.entry * 1.8;
    _a.set(Math.sin(this.angle) * 80 * k, -4, Math.cos(this.angle) * 66 * k).add(ship.position);
    const prev = _b.copy(this.root.position);
    if (dt > 0) {
      this.root.position.lerp(_a, 1 - Math.exp(-3 * dt));
      this.vel.copy(this.root.position).sub(prev).divideScalar(dt);
    } else {
      this.root.position.copy(_a);
      this.vel.set(0, 0, 0);
    }
  }

  // ctx: { ship, shipAlive, bolts, raiders, fx, audio, launchRaider(pos, dir), onBarrageWarning(), onDefeated() }
  update(dt, t, ctx) {
    if (!this.active) return;
    const ship = ctx.ship;
    this.shieldMat.uniforms.uTime.value = t;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.coreFlash = Math.max(0, this.coreFlash - dt * 6);
    for (const m of this.hullMats) m.emissive.setRGB(this.flash * 1.2, this.flash * 0.5, this.flash * 0.2);

    if (this.dying) { this.dieUpdate(dt, t, ctx); return; }

    // sweep in from far out, then circle the ship (faster once the core is exposed)
    this.entry = Math.max(0, this.entry - dt / 3.5);
    if (this.holdAngle !== null) {
      const d = Math.atan2(Math.sin(this.holdAngle - this.angle), Math.cos(this.holdAngle - this.angle));
      this.angle += Math.max(-0.8 * dt, Math.min(0.8 * dt, d));
    } else this.angle += (this.phase === 'core' ? 0.17 : 0.1) * dt;
    this.place(ship, dt);
    _c.set(Math.cos(this.angle) * 80, 0, -Math.sin(this.angle) * 66).normalize();
    _m.lookAt(this.root.position, _b.copy(this.root.position).add(_c), UP);
    this.root.quaternion.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-2 * dt));
    this.root.updateMatrixWorld(true);
    this.core.getWorldPosition(this.corePos);

    // shield bubble: shown in phase 1, collapses outward when the last turret dies
    if (this.phase === 'turrets') {
      this.shield.position.copy(this.core.position);
      this.shieldMat.uniforms.uFlash.value = Math.max(0, this.shieldMat.uniforms.uFlash.value - dt * 4);
    } else if (this.shield.visible) {
      this.shieldCollapse += dt;
      this.shield.scale.setScalar(1 + this.shieldCollapse * 3);
      this.shieldMat.uniforms.uFade.value = Math.max(0, 1 - this.shieldCollapse * 1.6);
      if (this.shieldCollapse > 0.7) this.shield.visible = false;
    }

    const ready = this.entry < 0.15 && ctx.shipAlive;
    // turrets track the ship and fire lead-aimed bursts
    for (const tr of this.turrets) {
      if (!tr.alive) continue;
      tr.head.getWorldPosition(tr.pos);
      _a.copy(ship.position);
      tr.head.parent.worldToLocal(_a).sub(tr.head.position);
      const want = Math.atan2(-_a.x, -_a.z);
      let d = want - tr.head.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      tr.head.rotation.y += Math.max(-2.5 * dt, Math.min(2.5 * dt, d));
      if (ready && tr.burst > 0 && t > tr.nextShot) {
        tr.muzzle.getWorldPosition(_b);
        intercept(_b, this.vel, ship.position, ship.velocity, BOLT_SPEED, _c);
        _c.sub(_b).normalize();
        _c.x += rand(-0.03, 0.03);
        _c.z += rand(-0.03, 0.03);
        ctx.bolts.spawn(_b, _c.normalize(), this.vel, BOLT_SPEED, this.quiz ? 3 : 5);
        ctx.fx.enemyMuzzle(_b, _c, this.vel);
        ctx.audio.enemyShot(_b);
        tr.burst--;
        tr.nextShot = t + 0.22;
      }
    }
    // turrets take turns: one two-shot volley at a time, slower as turrets are destroyed
    const alive = this.turretsLeft;
    if (ready && alive && t > this.volleyT) {
      for (let k = 0; k < 4; k++) {
        const tr = this.turrets[(this.volleyIdx + k) % 4];
        if (!tr.alive) continue;
        tr.burst = 2;
        tr.nextShot = t;
        this.volleyIdx = (tr.index + 1) % 4;
        break;
      }
      // angle battles: a lighter volley every few seconds while the player thinks
      this.volleyT = t + (this.quiz ? rand(2.8, 3.8) : rand(1.1, 1.5) * Math.sqrt(4 / alive));
    }
    // angle battles, core phase: the exposed core takes over the shooting
    if (this.quiz && ready && !alive && t > this.volleyT) {
      for (let i = 0; i < 2; i++) {
        _c.copy(ship.position).sub(this.corePos).normalize();
        _c.x += rand(-0.03, 0.03);
        _c.z += rand(-0.03, 0.03);
        ctx.bolts.spawn(this.corePos, _c.normalize(), this.vel, BOLT_SPEED * (1 + i * 0.1), 3);
      }
      ctx.audio.enemyShot(this.corePos);
      this.volleyT = t + rand(2.8, 3.8);
    }

    // core phase: charge up (telegraphed), then three spinning radial rings
    let charging = 0;
    if (!this.quiz && this.phase === 'core' && ready) {
      if (this.charge <= 0 && !this.rings.length && t > this.nextBarrage) {
        this.charge = 1.7;
        ctx.onBarrageWarning();
      }
      if (this.charge > 0) {
        this.charge -= dt;
        charging = 1;
        if (this.charge <= 0) { this.rings = [0, 0.35, 0.7]; this.ringT = 0; this.ringSpin = rand(0, 1); }
      }
      if (this.rings.length) {
        this.ringT += dt;
        while (this.rings.length && this.ringT >= this.rings[0]) {
          const k = this.rings.shift();
          const count = 18;
          for (let i = 0; i < count; i++) {
            const a = ((i + this.ringSpin + k * 1.7) / count) * Math.PI * 2;
            _c.set(Math.sin(a), 0, Math.cos(a));
            _b.copy(this.corePos).addScaledVector(_c, 5);
            _b.y = ship.position.y + 1;
            ctx.bolts.spawn(_b, _c, this.vel, BARRAGE_SPEED, 5);
          }
          ctx.audio.warp(this.corePos);
          ctx.fx.ring(this.corePos, 26, 0.5);
        }
        if (!this.rings.length) this.nextBarrage = t + rand(6, 8);
      }
    }

    // core glow: steady pulse, frantic while charging, flashes when hit
    const pulse = charging ? (Math.sin(t * 40) > 0 ? 2.6 : 1.2) : 0.85 + 0.15 * Math.sin(t * 3);
    this.coreMat.emissiveIntensity = this.coreBase * (pulse + this.coreFlash * 1.5) * (this.phase === 'core' ? 1.3 : 0.8);

    // hangar launches
    if (!this.quiz && ready && t > this.nextLaunch && ctx.raiders.count < (this.phase === 'core' ? 2 : 1)) {
      this.hangar.getWorldPosition(_b);
      _c.set(0, 0, -1).applyQuaternion(this.root.quaternion);
      ctx.launchRaider(_b.clone(), _c.clone());
      this.nextLaunch = t + (this.phase === 'core' ? 9 : 12);
    }
  }

  dieUpdate(dt, t, ctx) {
    this.dieT += dt;
    this.root.position.addScaledVector(this.vel, dt * 0.3);
    this.coreMat.emissiveIntensity = this.coreBase * (Math.sin(t * 50) > 0 ? 3 : 0.4);
    if ((this.popT -= dt) <= 0 && this.dieT < 2.8) {
      this.popT = rand(0.1, 0.2);
      const h = HULL[Math.floor(Math.random() * HULL.length)];
      _a.set(h[0] + rand(-h[3], h[3]) * 0.6, rand(0, 3), h[2] + rand(-h[3], h[3]) * 0.6);
      this.root.localToWorld(_a);
      ctx.fx.explosion(_a, rand(1.3, 2.4), this.vel, { scrap: true });
      ctx.audio.explosion(_a, 1.4);
      ctx.shake(0.25);
    }
    if (this.dieT >= 2.8) {
      ctx.fx.explosion(this.corePos, 7, this.vel, { scrap: true, chain: 6 });
      ctx.audio.explosion(this.corePos, 4);
      ctx.shake(1.2);
      ctx.flash(0.7);
      this.despawn();
      this.defeated = true;
      ctx.onDefeated();
    }
  }

  // nearest boss part hit by segment a→b
  segmentHit(a, b, out) {
    if (!this.active || this.dying) return null;
    let best = null;
    let bestD = Infinity;
    const test = (center, r, part) => {
      if (segmentPointDistSq(a, b, center) > r * r) return;
      const d = a.distanceToSquared(center);
      if (d < bestD) { bestD = d; best = part; out.copy(a).lerp(b, segOut.t); }
    };
    // weak points first: the core shield must never swallow a shot aimed at a turret
    for (const tr of this.turrets) if (tr.alive) test(tr.pos, TURRET_R, tr.part);
    if (!best) {
      if (this.phase === 'turrets') { if (!this.quiz) test(this.corePos, SHIELD_R, this.parts.shield); }
      else test(this.corePos, CORE_R, this.parts.core);
    }
    // no hull blocking: from the top view bolts visibly travel over the deck to the far turrets
    return best;
  }

  // returns 'turret' | 'turretDown' | 'core' | 'coreExposed' | 'defeated' | 'shield' | 'hull'
  damage(part, amount) {
    if (part.kind === 'turret') {
      const tr = this.turrets[part.index];
      if (!tr.alive) return 'hull';
      tr.hp -= amount;
      this.flash = 0.6;
      if (tr.hp > 0) return 'turret';
      tr.alive = false;
      tr.head.visible = false;
      if (this.turretsLeft === 0) { this.phase = 'core'; this.nextBarrage = 0; return 'coreExposed'; }
      return 'turretDown';
    }
    if (part.kind === 'core') {
      this.coreHp -= amount;
      this.coreFlash = 1;
      this.flash = 0.4;
      if (this.coreHp > 0) return 'core';
      this.dying = true;
      this.dieT = 0;
      this.popT = 0;
      return 'defeated';
    }
    if (part.kind === 'shield') this.shieldMat.uniforms.uFlash.value = 1;
    return part.kind;
  }

  // angle battles: return fire after a wrong answer (turret bursts, or aimed shots from the core)
  punish(t, ctx) {
    let k = 0;
    for (const tr of this.turrets) {
      if (!tr.alive) continue;
      tr.burst = 2;
      tr.nextShot = t + 0.12 * k++;
    }
    if (k) return;
    for (let i = 0; i < 4; i++) {
      _c.copy(ctx.ship.position).sub(this.corePos).normalize();
      _c.x += rand(-0.04, 0.04);
      _c.z += rand(-0.04, 0.04);
      ctx.bolts.spawn(this.corePos, _c.normalize(), this.vel, BOLT_SPEED * (1 + i * 0.08), 5);
    }
    ctx.audio.warp(this.corePos);
  }

  // live weak points for lock-on / aim assist
  weakPoints() {
    if (!this.active || this.dying) return [];
    if (this.phase === 'core') return [{ obj: this.parts.core, pos: this.corePos, vel: this.vel }];
    return this.turrets.filter((t) => t.alive).map((t) => ({ obj: t.part, pos: t.pos, vel: this.vel }));
  }
}
