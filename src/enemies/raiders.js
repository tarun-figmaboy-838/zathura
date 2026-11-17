import * as THREE from 'three';
import { clamp, damp, intercept, rand, segmentPointDistSq, segOut } from '../core/math.js';
import { addPanelDetail } from '../ship/ship.js';

export const RAIDER_RADIUS = 5.6;
export const ENEMY_BOLT_SPEED = 330;
export const ENEMY_BOLT_DAMAGE = 7;

const UP = new THREE.Vector3(0, 1, 0);
const TRAIL_COLOR = new THREE.Color(1.15, 0.38, 0.16);
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

class Raider {
  constructor(template, scene, plumeMat, trails) {
    this.isRaider = true;
    this.alive = false;
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
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
    this.hullMats = mats.filter((m) => ['RaiderHull', 'RaiderPlate', 'RaiderMark'].includes(m.name));
    this.hullMats.forEach((m) => {
      m.envMapIntensity = 1.3;
      // clones don't carry onBeforeCompile, so weather each one (shared program cache key)
      addPanelDetail(m, { scale: 1.6, seam: 0.45, grime: 0.3, chips: 0.5, soot: [2.0, 3.4, 0.8] });
    });
    this.glowMat = mats.find((m) => m.name === 'RaiderGlow');
    this.glowBase = this.glowMat.emissiveIntensity;
    this.guns = [this.model.getObjectByName('Gun_L'), this.model.getObjectByName('Gun_R')];

    const geo = new THREE.CylinderGeometry(0.05, 0.28, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (const name of ['EngineGlow_L', 'EngineGlow_R']) {
      const plume = new THREE.Mesh(geo, plumeMat);
      plume.scale.z = 2.6;
      plume.renderOrder = 2;
      this.model.getObjectByName(name).add(plume);
    }

    this.trail = trails.alloc(TRAIL_COLOR, 0.42, 0.75);
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
  constructor(scene, gltf, trails, capacity = 14) {
    this.trails = trails;
    this.plumeMat = makePlumeMaterial();
    this.list = Array.from({ length: capacity }, () => new Raider(gltf.scene, scene, this.plumeMat, trails));
  }

  get count() {
    let n = 0;
    for (const r of this.list) if (r.alive) n++;
    return n;
  }

  spawn(pos, lookAt, skill = 0, time = 0, arena = false) {
    const r = this.list.find((x) => !x.alive);
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
    r.boltSpeed = ENEMY_BOLT_SPEED;
    if (arena) {
      // top-view battle: slower, readable, circling close around the ship
      r.maxSpeed = r.speed = 46 + skill * 4;
      r.turnRate = 2.4 + skill * 0.12;
      r.boltSpeed = 150 + skill * 12;
      r.orbitR = rand(36, 60);
      r.orbitTime = rand(1.2, 3);
      r.orbitDir = Math.random() < 0.5 ? -1 : 1;
      r.nextShot = time + rand(1.5, 2.5);
      r.vel.setLength(r.speed);
    }
    this.trails.reset(r.trail);
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
    const near = ctx.arena ? distToShip < 20 : distToShip < 45 && r.state !== 'attack';
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
      if (r.state !== 'orbit' && Math.abs(dist - r.orbitR) < 14) { r.state = 'orbit'; r.t = 0; }
      if (r.state === 'orbit' && r.t > r.orbitTime) { r.state = 'attack'; r.t = 0; }
      return r.maxSpeed;
    }
    intercept(pos, r.vel, sp, ship.velocity, r.boltSpeed, _aim);
    _tgt.copy(_aim);
    _tgt.y = sp.y;
    if (ctx.shipAlive) this.tryFire(r, t, dist, ctx);
    if (dist < 24 || r.t > 3.2) {
      r.state = 'orbit';
      r.t = 0;
      r.orbitR = rand(36, 60);
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

  // lead pips: where the turret must aim (from `from`, bolts inheriting shipVel) to hit each raider
  computePips(from, shipVel, speed) {
    for (const r of this.list) if (r.alive) intercept(from, shipVel, r.root.position, r.vel, speed, r.pip);
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
