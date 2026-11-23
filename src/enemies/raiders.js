import * as THREE from 'three';
import { clamp, damp, intercept, rand, segmentPointDistSq, segOut } from '../core/math.js';
import { addPanelDetail } from '../ship/ship.js';

export const RAIDER_RADIUS = 5.6;
export const ENEMY_BOLT_SPEED = 330;
export const ENEMY_BOLT_DAMAGE = 7;
const AUTO_DAMAGE = 3;      // the light bursts held raiders fire on their own
const ARRIVE = 1.6;         // seconds to fly in and brake onto the spot

const UP = new THREE.Vector3(0, 1, 0);
// the raider ship model's materials (assets/models/raider.glb): weathered hull that flashes when hit,
// and the glow that pulses. Models built in code bring their own (virusDrone.js).
const SHIP_LOOK = {
  hull: ['RaiderHull', 'RaiderPlate', 'RaiderMark'],
  glow: 'RaiderGlow',
  panel: { scale: 1.6, seam: 0.45, grime: 0.3, chips: 0.5, soot: [2.0, 3.4, 0.8] },
};
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _des = new THREE.Vector3();
const _toShip = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _gun = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function randomDir(out) {
  for (;;) {
    out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    const l = out.lengthSq();
    if (l > 0.0001 && l <= 1) return out.multiplyScalar(1 / Math.sqrt(l));
  }
}

function makePlumeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main() {
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main() {
        float t = clamp(vPos.z, 0.0, 1.0);
        float fres = abs(dot(normalize(vN), normalize(vView)));
        float a = pow(1.0 - t, 2.0) * pow(fres, 2.0) * (0.85 + 0.15 * sin(uTime * 70.0 + vPos.z * 8.0));
        vec3 col = mix(vec3(1.0, 0.9, 0.75), vec3(1.0, 0.3, 0.08), smoothstep(0.0, 0.35, t));
        gl_FragColor = vec4(col * 2.0, a * 0.8);
      }`,
  });
}

// kind: { key, model, rig?(model) -> (dt, t, raider), trail: [r, g, b] } (see droneKinds.js)
class Raider {
  constructor(kind, scene, plumeMat, trails) {
    this.isRaider = true;
    this.alive = false;
    this.kind = kind.key;
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    const template = kind.model;
    this.model = template.clone(true);
    this.visual.add(this.model);

    // per-raider material copies so each one can flash when hit
    const cache = new Map();
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (!cache.has(o.material)) cache.set(o.material, o.material.clone());
      o.material = cache.get(o.material);
    });
    const mats = [...cache.values()];
    const look = template.userData.look || SHIP_LOOK;
    this.hullMats = mats.filter((m) => look.hull.includes(m.name));
    this.hullMats.forEach((m) => {
      m.envMapIntensity = 1.3;
      // clones don't carry onBeforeCompile, so weather each one (shared program cache key)
      addPanelDetail(m, look.panel);
    });
    this.glowMat = mats.find((m) => m.name === look.glow);
    this.glowBase = this.glowMat.emissiveIntensity;
    this.guns = [this.model.getObjectByName('Gun_L'), this.model.getObjectByName('Gun_R')];
    this.rig = kind.rig ? kind.rig(this.model) : null;      // how this kind moves (legs, spin...)

    const geo = new THREE.CylinderGeometry(0.05, 0.28, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (const name of ['EngineGlow_L', 'EngineGlow_R']) {
      const plume = new THREE.Mesh(geo, plumeMat);
      plume.scale.z = 2.6;
      plume.renderOrder = 2;
      this.model.getObjectByName(name).add(plume);
    }

    this.trail = trails.alloc(new THREE.Color(...kind.trail), 0.42, 0.75);
    this.root.scale.setScalar(1.35);
    this.root.visible = false;
    scene.add(this.root);

    this.vel = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.pip = new THREE.Vector3();
    this.jinkDir = new THREE.Vector3();
  }

  get position() { return this.root.position; }
}

// The hostile squadron: spawning, AI, steering, shooting and hit detection.
export class Raiders {
  // kinds: the enemy kinds (the virus drones, or the raider ship draft), `count` of each
  constructor(scene, kinds, trails) {
    this.trails = trails;
    this.plumeMat = makePlumeMaterial();
    this.list = kinds.flatMap((k) => Array.from({ length: k.count }, () => new Raider(k, scene, this.plumeMat, trails)));
  }

  get count() {
    let n = 0;
    for (const r of this.list) if (r.alive) n++;
    return n;
  }

  // kind: which kind to send (the first kind when not given)
  spawn(pos, lookAt, skill = 0, time = 0, arena = false, kind = this.list[0].kind) {
    const r = this.list.find((x) => !x.alive && x.kind === kind);
    if (!r) return null;
    r.alive = true;
    r.root.visible = true;
    r.root.position.copy(pos);
    _m.lookAt(pos, lookAt, UP);
    r.root.quaternion.setFromRotationMatrix(_m);
    r.visual.rotation.set(0, 0, 0);
    r.maxSpeed = Math.min(125, 92 + skill * 4);
    r.speed = r.maxSpeed;
    r.turnRate = Math.min(2.3, 1.45 + skill * 0.08);
    r.vel.set(0, 0, -1).applyQuaternion(r.root.quaternion).multiplyScalar(r.speed);
    r.maxHp = r.hp = 7 + Math.floor(skill / 2);
    r.state = 'approach';
    r.t = 0;
    randomDir(r.offset).multiplyScalar(rand(30, 75));
    r.burst = 0;
    r.nextShot = time + rand(1.2, 2.4);
    r.spread = Math.max(0.012, 0.038 - skill * 0.003);
    r.restMin = Math.max(0.5, 1.5 - skill * 0.09);
    r.restMax = Math.max(0.9, 2.6 - skill * 0.14);
    r.gunIdx = 0;
    r.flash = 0;
    r.jink = 0;
    r.whoosh = false;
    r.seed = Math.random() * 100;
    r.spin = (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 0.9);
    r.boltSpeed = ENEMY_BOLT_SPEED;
    r.hold = null;      // set to an offset from the ship to make it hover there (angle battles)
    r.holdT = 0;
    r.shots = 0;        // scripted shots still to fire at the ship
    r.shotDamage = ENEMY_BOLT_DAMAGE;
    r.nextAuto = 0;
    if (arena) {
      // top-view battle: slower, readable, circling close around the ship
      r.maxSpeed = r.speed = 46 + skill * 4;
      r.turnRate = 2.4 + skill * 0.12;
      r.boltSpeed = 150 + skill * 12;
      r.orbitR = rand(30, 46);
      r.orbitTime = rand(1.2, 3);
      r.orbitDir = Math.random() < 0.5 ? -1 : 1;
      r.nextShot = time + rand(1.5, 2.5);
      r.vel.setLength(r.speed);
    }
    this.trails.reset(r.trail);
    r.trail.intensity = 1;
    r.root.scale.setScalar(1.35);
    return r;
  }

  kill(r) {
    r.alive = false;
    r.root.visible = false;
  }

  clear() {
    for (const r of this.list) this.kill(r);
  }

  // ctx: { ship, shipAlive, field, bolts, fx, audio, onCrash(r), onRam(r) }
  update(dt, t, ctx) {
    this.plumeMat.uniforms.uTime.value = t;
    const ship = ctx.ship;
    const sp = ship.position;
    for (const r of this.list) {
      if (!r.alive) continue;
      if (r.rig) r.rig(dt, t, r);
      if (r.hold) { this.holdUpdate(r, dt, t, ctx); continue; }
      r.t += dt;
      const pos = r.root.position;
      const q = r.root.quaternion;
      _fwd.set(0, 0, -1).applyQuaternion(q);
      _toShip.subVectors(sp, pos);
      const dist = _toShip.length();
      let targetSpeed = r.maxSpeed;

      if (ctx.arena) {
        targetSpeed = this.arena(r, t, dist, ctx);
      } else if (r.state === 'approach') {
        _tgt.copy(sp).addScaledVector(ship.velocity, 0.6).add(r.offset);
        if (dist < 430 && _fwd.dot(_toShip) / dist > 0.82) { r.state = 'attack'; r.t = 0; }
      } else if (r.state === 'attack') {
        intercept(pos, r.vel, sp, ship.velocity, ENEMY_BOLT_SPEED, _aim);
        _tgt.copy(_aim);
        targetSpeed = r.maxSpeed * 0.78;
        if (ctx.shipAlive) this.tryFire(r, t, dist, ctx);
        if (dist < 65 || r.t > 7) {
          r.state = 'breakoff';
          r.t = 0;
          randomDir(_a).addScaledVector(_fwd, 1.4).normalize();
          r.target.copy(pos).addScaledVector(_a, rand(380, 560));
        }
      } else {
        _tgt.copy(r.target);
        targetSpeed = r.maxSpeed * 1.2;
        if (pos.distanceTo(r.target) < 70 || r.t > 4.5) {
          r.state = 'approach';
          r.t = 0;
          randomDir(r.offset).multiplyScalar(rand(30, 75));
        }
      }

      _des.subVectors(_tgt, pos).normalize();
      if (r.jink > 0) {
        r.jink -= dt;
        _des.addScaledVector(r.jinkDir, 0.9);
      }
      this.avoid(r, _fwd, dist, ctx);
      _des.normalize();

      // turn toward the desired heading at a limited rate
      const up = Math.abs(_des.y) > 0.96 ? _a.set(0, 1, 0).applyQuaternion(q) : UP;
      _m.lookAt(pos, _b.addVectors(pos, _des), up);
      _q.setFromRotationMatrix(_m);
      q.rotateTowards(_q, r.turnRate * dt);
      _fwd.set(0, 0, -1).applyQuaternion(q);
      r.speed = damp(r.speed, targetSpeed, 1.5, dt);
      r.vel.lerp(_a.copy(_fwd).multiplyScalar(r.speed), 1 - Math.exp(-3 * dt));
      pos.addScaledVector(r.vel, dt);

      _right.set(1, 0, 0).applyQuaternion(q);
      r.visual.rotation.z = damp(r.visual.rotation.z, -clamp(_des.dot(_right), -1, 1) * 1.5, 4, dt);

      r.flash = Math.max(0, r.flash - dt * 6);
      for (const m of r.hullMats) m.emissive.setRGB(r.flash * 1.6, r.flash * 0.7, r.flash * 0.3);
      const critical = r.hp / r.maxHp < 0.4 && Math.sin(t * 25) < 0;
      r.glowMat.emissiveIntensity = r.glowBase * (0.85 + 0.15 * Math.sin(t * 7 + r.seed)) * (critical ? 0.3 : 1);

      this.trails.push(r.trail, _a.copy(pos).addScaledVector(_fwd, -3.1), t);

      if (dist < 55 && !r.whoosh) { r.whoosh = true; ctx.audio.flyby(pos); } else if (dist > 140) r.whoosh = false;

      const rock = ctx.field.overlap(pos, RAIDER_RADIUS * 0.8);
      if (rock) { ctx.onCrash(r, rock); continue; }
      if (ctx.shipAlive && dist < RAIDER_RADIUS + ship.radius) ctx.onRam(r);
    }
    this.separate(dt);
  }

  // Angle battles: fly in from far out and brake onto a fixed spot next to the ship, then hover
  // there facing it (the question's geometry needs it to stay put) and fire short bursts.
  holdUpdate(r, dt, t, ctx) {
    const sp = ctx.ship.position;
    const pos = r.root.position;
    r.holdT += dt;
    const k = Math.min(1, r.holdT / ARRIVE);
    const out = 1 + 1.9 * Math.pow(1 - k, 3);          // starts ~2.9x further out, eases in
    const prev = _b.copy(pos);
    pos.copy(sp).addScaledVector(r.hold, out);
    r.vel.copy(pos).sub(prev).divideScalar(Math.max(dt, 1e-3));
    if (k >= 1) r.vel.copy(ctx.ship.velocity);
    // once in place it harasses the ship: a short burst every few seconds
    if (k >= 1 && ctx.shipAlive && r.shots <= 0 && t > r.nextAuto) {
      if (r.nextAuto > 0) { r.shots = 2 + (Math.random() < 0.4 ? 1 : 0); r.shotDamage = AUTO_DAMAGE; r.nextShot = t; }
      r.nextAuto = t + rand(2.6, 3.6);
    }
    _m.lookAt(pos, sp, UP);
    r.root.quaternion.slerp(_q.setFromRotationMatrix(_m), 1 - Math.exp(-6 * dt));
    r.visual.position.y = Math.sin(t * 2.2 + r.seed) * 0.35;
    r.visual.rotation.z = Math.sin(t * 1.3 + r.seed) * 0.12 + (1 - k) * 0.5 * Math.sin(r.seed);   // banks in on arrival
    r.visual.rotation.x = (1 - k) * 0.25;
    r.flash = Math.max(0, r.flash - dt * 6);
    // no red "danger" wash over the body (it turned every drone pink, unlike its portrait): only the
    // hit flash, and its own lights pulse a little
    for (const m of r.hullMats) m.emissive.setRGB(r.flash * 1.6, r.flash * 0.7, r.flash * 0.3);
    r.glowMat.emissiveIntensity = r.glowBase * (1 + 0.2 * Math.sin(t * 7 + r.seed));
    r.root.scale.setScalar(1.35 + 0.55 * k);       // grows to full size as it brakes into place
    // no contrail while riding along with the ship: it would be dragged into a long line
    r.trail.intensity = 0;
    if (r.shots > 0 && t >= r.nextShot && ctx.shipAlive) {
      r.root.updateMatrixWorld(true);
      const gun = r.guns[r.gunIdx];
      r.gunIdx ^= 1;
      gun.getWorldPosition(_gun);
      _dir.subVectors(sp, _gun).normalize().addScaledVector(randomDir(_c), 0.012).normalize();
      ctx.bolts.spawn(_gun, _dir, r.vel, r.boltSpeed, r.shotDamage);
      ctx.fx.enemyMuzzle(_gun, _dir, r.vel);
      ctx.audio.enemyShot(_gun);
      r.shots--;
      r.nextShot = t + 0.16;
    }
  }

  // a held raider is in place and can be asked about
  arrived(r) { return r.holdT >= ARRIVE + 0.2; }

  // a wrong answer (heavy = the time ran out): a heavier burst at the ship
  punish(r, t, heavy = false) {
    r.shots = heavy ? 6 : 4;
    r.shotDamage = heavy ? 10 : ENEMY_BOLT_DAMAGE;
    r.nextShot = t;
    r.nextAuto = t + rand(3, 4);
  }

  // steer around asteroids ahead, and away from the player's hull unless attacking
  avoid(r, fwd, distToShip, ctx) {
    const pos = r.root.position;
    const look = r.speed * 1.3 + 25;
    for (const rock of ctx.field.rocks) {
      if (!rock.alive) continue;
      _a.subVectors(rock.pos, pos);
      const along = _a.dot(fwd);
      const reach = rock.radius + 12;
      if (along < -reach || along > look + reach) continue;
      if (_a.lengthSq() - along * along > reach * reach) continue;
      _c.copy(fwd).multiplyScalar(along).sub(_a);
      if (_c.lengthSq() < 1e-4) _c.set(0, 1, 0);
      _c.normalize();
      _des.addScaledVector(_c, 3 * (1 - Math.max(0, along) / (look + reach)));
    }
    const near = ctx.arena ? distToShip < 22 : distToShip < 45 && r.state !== 'attack';
    if (near) _des.addScaledVector(_toShip, -2 / Math.max(distToShip, 1));
  }

  // top-view battle: circle the ship at a chosen radius, then make strafing attack runs
  arena(r, t, dist, ctx) {
    const ship = ctx.ship;
    const sp = ship.position;
    const pos = r.root.position;
    if (r.state !== 'attack') {
      const ang = Math.atan2(pos.x - sp.x, pos.z - sp.z) + r.orbitDir * 0.55;
      _tgt.set(sp.x + Math.sin(ang) * r.orbitR, sp.y, sp.z + Math.cos(ang) * r.orbitR);
      if (r.state !== 'orbit' && Math.abs(dist - r.orbitR) < 12) { r.state = 'orbit'; r.t = 0; }
      if (r.state === 'orbit' && r.t > r.orbitTime) { r.state = 'attack'; r.t = 0; }
      return r.maxSpeed;
    }
    intercept(pos, r.vel, sp, ship.velocity, r.boltSpeed, _aim);
    _tgt.copy(_aim);
    _tgt.y = sp.y;
    if (ctx.shipAlive) this.tryFire(r, t, dist, ctx);
    if (dist < 26 || r.t > 3.2) {
      r.state = 'orbit';
      r.t = 0;
      r.orbitR = rand(30, 46);
      r.orbitTime = rand(1.4, 3.4);
      if (Math.random() < 0.5) r.orbitDir *= -1;
      r.burst = 0;
    }
    return r.maxSpeed * 0.85;
  }

  separate(dt) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      if (!L[i].alive) continue;
      for (let j = i + 1; j < L.length; j++) {
        if (!L[j].alive) continue;
        _a.subVectors(L[i].root.position, L[j].root.position);
        const d = _a.length();
        if (d > 22 || d < 1e-3) continue;
        _a.multiplyScalar(((22 - d) / d) * dt * 2);
        L[i].root.position.add(_a);
        L[j].root.position.sub(_a);
      }
    }
  }

  tryFire(r, t, dist, ctx) {
    if (t < r.nextShot || dist > 520) return;
    _dir.subVectors(_aim, r.root.position).normalize();
    if (_fwd.dot(_dir) < 0.985) return;
    if (r.burst <= 0) {
      if (ctx.field.raycast(r.root.position, _dir, 0) < dist) { r.nextShot = t + 0.4; return; }
      r.burst = 3 + Math.floor(Math.random() * 3);
    }
    r.root.updateMatrixWorld(true);
    const gun = r.guns[r.gunIdx];
    r.gunIdx ^= 1;
    gun.getWorldPosition(_gun);
    _dir.subVectors(_aim, _gun).normalize();
    _dir.addScaledVector(randomDir(_c), r.spread).normalize();
    ctx.bolts.spawn(_gun, _dir, r.vel, r.boltSpeed, ENEMY_BOLT_DAMAGE);
    ctx.fx.enemyMuzzle(_gun, _dir, r.vel);
    ctx.audio.enemyShot(_gun);
    r.burst--;
    r.nextShot = t + (r.burst > 0 ? 0.14 : rand(r.restMin, r.restMax));
  }

  // returns true when the raider is destroyed
  damage(r, amount) {
    r.hp -= amount;
    r.flash = 1;
    if (Math.random() < 0.3) {
      r.jink = 0.6;
      randomDir(r.jinkDir);
    }
    if (r.hp > 0) return false;
    this.kill(r);
    return true;
  }

  segmentHit(a, b, out) {
    let best = null;
    let bestD = Infinity;
    for (const r of this.list) {
      if (!r.alive) continue;
      if (segmentPointDistSq(a, b, r.root.position) > RAIDER_RADIUS * RAIDER_RADIUS) continue;
      const da = a.distanceToSquared(r.root.position);
      if (da < bestD) {
        bestD = da;
        best = r;
        out.copy(a).lerp(b, segOut.t);
      }
    }
    return best;
  }

  raycast(origin, dir, minDist = 0) {
    let best = Infinity;
    for (const r of this.list) {
      if (!r.alive) continue;
      _a.subVectors(r.root.position, origin);
      const tca = _a.dot(dir);
      if (tca < 0) continue;
      const d2 = _a.lengthSq() - tca * tca;
      const r2 = RAIDER_RADIUS * RAIDER_RADIUS;
      if (d2 > r2) continue;
      const tt = tca - Math.sqrt(r2 - d2);
      if (tt > minDist && tt < best) best = tt;
    }
    return best;
  }
}
