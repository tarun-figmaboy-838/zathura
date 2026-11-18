import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';
import { rng, segmentPointDistSq } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// Adds fine procedural rock detail (albedo breakup + derivative bump) on top of the
// Blender-baked vertex colours, in each rock's own object space so it sticks to it.
function addRockDetail(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRockPos;\n${VALUE3}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rockH = fbm3(vRockPos * 5.0);
        float rockFine = vnoise(vRockPos * 31.0);
        diffuseColor.rgb *= (0.7 + 0.55 * rockH + 0.14 * rockFine) * 1.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float bumpH = rockH + rockFine * 0.2;
        float bumpFade = 1.0 - smoothstep(120.0, 700.0, length(vViewPosition));
        normal = perturbNormalH(-vViewPosition, normal, vec2(dFdx(bumpH), dFdy(bumpH)) * 1.6 * bumpFade, faceDirection);`);
  };
}

function gauss(r) {
  return (r() + r() + r() + r() - 2) * 0.866;
}

export class AsteroidField {
  // tints: optional list of colours, one picked per rock (lets a field look icy, rusty, brighter)
  constructor(scene, gltf, { count = 520, radius = 1300, clear = 110, seed = 42, managed = false, capacity = 0, tints = null } = {}) {
    // Asteroid_N = 5k-tri hero mesh, Asteroid_N_lod = 1.3k-tri distant mesh
    const byName = {};
    gltf.scene.traverse((o) => { if (o.isMesh) byName[o.name] = o.geometry; });
    const variants = Object.keys(byName).filter((n) => !n.endsWith('_lod')).sort();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.9 });
    addRockDetail(this.material);
    this.radius = radius;
    this.clear = clear;
    this.tints = tints;
    this.rocks = [];
    this.time = 0;
    this.r = rng(seed);
    // managed: no ambient belt, no wrapping or respawning; the game spawns meteoroids and
    // they are removed once they fall behind the ship (onPassed)
    this.managed = managed;
    this.onPassed = null;

    const perVariant = managed ? Math.ceil(capacity / variants.length) + 6 : Math.ceil(count / variants.length) + 30;
    const makeMesh = (geo) => {
      const mesh = new THREE.InstancedMesh(geo, this.material, perVariant);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.setColorAt(0, _c.setRGB(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.pools = variants.map((name) => {
      const high = makeMesh(byName[name]);
      const low = makeMesh(byName[`${name}_lod`] || byName[name]);
      const slots = [];
      for (let i = 0; i < perVariant; i++) {
        const rock = {
          alive: false, fragment: false, respawnAt: 0,
          pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0),
          base: new THREE.Quaternion(), angle: 0, spin: 0, size: 1, radius: 1, hp: 1, flash: 0, owner: this,
          tint: new THREE.Color(1, 1, 1),
        };
        slots.push(rock);
        this.rocks.push(rock);
      }
      return { high, low, slots };
    });

    const r = this.r;
    if (managed) return;
    for (let i = 0; i < count; i++) this.spawn(this.fieldPosition(new THREE.Vector3(), null), this.randomSize());
    // a few hero rocks for scale, close to the start
    const heroes = [[-160, 30, -420, 70], [260, -60, -300, 42], [-380, -40, 120, 55], [120, 80, 340, 38]];
    for (const [x, y, z, s] of heroes) this.spawn(new THREE.Vector3(x, y, z), s, null, false, r() < 0.5 ? 0 : 3);
  }

  randomSize() {
    const r = this.r;
    return r() < 0.06 ? 30 + r() * 45 : 2.2 + 20 * Math.pow(r(), 3.2);
  }

  fieldPosition(out, center, minDist = this.clear) {
    const r = this.r;
    const a = r() * Math.PI * 2;
    const d = minDist + Math.pow(r(), 0.75) * (this.radius - minDist);
    out.set(Math.cos(a) * d, gauss(r) * 200, Math.sin(a) * d);
    if (center) { out.x += center.x; out.z += center.z; }
    return out;
  }

  spawn(pos, size, vel = null, fragment = false, variant = -1) {
    const pools = variant >= 0 ? [this.pools[variant]] : this.pools;
    const start = Math.floor(this.r() * pools.length);
    for (let k = 0; k < pools.length; k++) {
      const pool = pools[(start + k) % pools.length];
      // slots waiting to respawn (respawnAt > 0) stay reserved
      const rock = pool.slots.find((s) => !s.alive && s.respawnAt === 0);
      if (!rock) continue;
      const r = this.r;
      rock.alive = true;
      rock.fragment = fragment;
      rock.respawnAt = 0;
      rock.pos.copy(pos);
      if (vel) rock.vel.copy(vel); else rock.vel.set(gauss(r), gauss(r) * 0.4, gauss(r)).multiplyScalar(1.5);
      rock.axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      rock.base.setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
      rock.angle = 0;
      rock.spin = (r() - 0.5) * (fragment ? 2.5 : 0.6) / Math.max(1, Math.sqrt(size) * 0.5);
      rock.size = size;
      rock.radius = size * 0.8;
      rock.hp = Math.ceil(size * 0.6);
      rock.flash = 0;
      if (this.tints) rock.tint.copy(this.tints[Math.floor(r() * this.tints.length)]);
      return rock;
    }
    return null;
  }

  // Simulates every rock, then packs the live ones into the hero or distant mesh of
  // their variant by camera distance, so dead slots and far rocks cost almost nothing.
  update(dt, time, center, eye) {
    this.time = time;
    const R = this.radius;
    this.pools.forEach((pool, variant) => {
      let nh = 0, nl = 0;
      for (const rock of pool.slots) {
        if (!rock.alive) {
          if (rock.respawnAt > 0 && time > rock.respawnAt) {
            rock.respawnAt = 0;
            this.spawn(this.fieldPosition(_v, center, 700), this.randomSize(), null, false, variant);
          }
          continue;
        }
        rock.pos.addScaledVector(rock.vel, dt);
        if (this.managed) {
          if (rock.pos.z > center.z + 40) {
            rock.alive = false;
            if (!rock.fragment) this.onPassed?.(rock);
            continue;
          }
        } else {
          // wrap around the ship so the belt feels endless
          if (rock.pos.x - center.x > R) rock.pos.x -= 2 * R; else if (rock.pos.x - center.x < -R) rock.pos.x += 2 * R;
          if (rock.pos.z - center.z > R) rock.pos.z -= 2 * R; else if (rock.pos.z - center.z < -R) rock.pos.z += 2 * R;
        }
        rock.angle += rock.spin * dt;
        _q.setFromAxisAngle(rock.axis, rock.angle).multiply(rock.base);
        _m.compose(rock.pos, _q, _s.setScalar(rock.size));
        if (rock.flash > 0) rock.flash = Math.max(0, rock.flash - dt * 7);
        const f = rock.flash;
        _c.setRGB(rock.tint.r * (1 + f * 4), rock.tint.g * (1 + f * 2.2), rock.tint.b * (1 + f * 1.2));
        const lodDist = 120 + rock.size * 10;
        if (rock.pos.distanceToSquared(eye) < lodDist * lodDist) {
          pool.high.setMatrixAt(nh, _m);
          pool.high.setColorAt(nh++, _c);
        } else {
          pool.low.setMatrixAt(nl, _m);
          pool.low.setColorAt(nl++, _c);
        }
      }
      pool.high.count = nh;
      pool.low.count = nl;
      for (const mesh of [pool.high, pool.low]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    });
  }

  // Nearest rock hit by segment a→b (projectile sweep). Returns { rock, t } or null.
  segmentHit(a, b, out) {
    let best = null;
    let bestT = Infinity;
    const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5, mz = (a.z + b.z) * 0.5;
    const half = a.distanceTo(b) * 0.5;
    for (const rock of this.rocks) {
      if (!rock.alive) continue;
      const reach = rock.radius + half;
      const dx = rock.pos.x - mx, dy = rock.pos.y - my, dz = rock.pos.z - mz;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      const d2 = segmentPointDistSq(a, b, rock.pos);
      if (d2 < rock.radius * rock.radius) {
        const t = a.distanceToSquared(rock.pos);
        if (t < bestT) { bestT = t; best = rock; }
      }
    }
    if (best && out) {
      // approximate impact point on the rock surface facing the shooter
      out.copy(a).sub(best.pos).normalize().multiplyScalar(best.radius * 0.95).add(best.pos);
    }
    return best;
  }

  // Distance along a ray to the first rock (for turret aim), or Infinity.
  raycast(origin, dir, minDist = 0) {
    let best = Infinity;
    for (const rock of this.rocks) {
      if (!rock.alive) continue;
      _v.copy(rock.pos).sub(origin);
      const tca = _v.dot(dir);
      if (tca < 0) continue;
      const d2 = _v.lengthSq() - tca * tca;
      const r2 = rock.radius * rock.radius;
      if (d2 > r2) continue;
      const thc = Math.sqrt(r2 - d2);
      let t = tca - thc;
      if (t < minDist) t = tca + thc;
      if (t > minDist && t < best) best = t;
    }
    return best;
  }

  blocksRay(origin, dir) {
    return this.raycast(origin, dir, 0) < Infinity;
  }

  damage(rock, amount) {
    rock.hp -= amount;
    rock.flash = 1;
    if (rock.hp > 0) return false;
    this.destroy(rock);
    return true;
  }

  destroy(rock) {
    rock.alive = false;
    rock.respawnAt = rock.fragment || this.managed ? 0 : this.time + 6 + this.r() * 6;
    if (rock.size > 7) {
      const n = 2 + Math.floor(this.r() * 3);
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(this.r() - 0.5, this.r() - 0.5, this.r() - 0.5).normalize();
        const pos = rock.pos.clone().addScaledVector(dir, rock.size * 0.4);
        const vel = rock.vel.clone().addScaledVector(dir, 6 + this.r() * 14);
        this.spawn(pos, rock.size * (0.3 + this.r() * 0.18), vel, true);
      }
    }
  }

  get liveCount() { let n = 0; for (const r of this.rocks) if (r.alive && !r.fragment) n++; return n; }

  clearAll() { for (const r of this.rocks) { r.alive = false; r.respawnAt = 0; } }

  // Push every rock out of a sphere (keeps the station and launch lane clear).
  clearAround(pos, radius) {
    for (const rock of this.rocks) {
      if (rock.alive && rock.pos.distanceTo(pos) < radius + rock.radius) this.fieldPosition(rock.pos, pos, radius + 150);
    }
  }

  // First rock overlapping a sphere (ship collision), or null.
  overlap(pos, radius) {
    for (const rock of this.rocks) {
      if (!rock.alive) continue;
      const rr = rock.radius + radius;
      if (rock.pos.distanceToSquared(pos) < rr * rr) return rock;
    }
    return null;
  }
}
