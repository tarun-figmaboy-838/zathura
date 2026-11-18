import * as THREE from 'three';
import { rand } from '../core/math.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function randomDir(out) {
  for (;;) {
    out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    const l = out.lengthSq();
    if (l > 0.0001 && l <= 1) return out.multiplyScalar(1 / Math.sqrt(l));
  }
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// CPU-simulated point sprites with size/colour/alpha over life. One system per blend mode.
class Particles {
  constructor(scene, capacity, blending) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(this.pos, 3));
    geo.setAttribute('aColor', attr(this.col, 3));
    geo.setAttribute('aSize', attr(this.size, 1));
    geo.setAttribute('aAlpha', attr(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const additive = blending === THREE.AdditiveBlending;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * uScale / -mv.z, 512.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(${additive ? '0.0' : '0.35'}, 1.0, d);
          gl_FragColor = vec4(vColor, a * a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
    this.list = Array.from({ length: capacity }, () => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1,
      s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), drag: 1, a0: 1,
    }));
    this.cursor = 0;
  }

  emit(pos, vel, life, s0, s1, c0, c1, drag = 1.5, alpha = 1) {
    const p = this.list[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = p.max = life;
    p.s0 = s0; p.s1 = s1;
    p.c0.copy(c0); p.c1.copy(c1);
    p.drag = drag;
    p.a0 = alpha;
  }

  update(dt) {
    let n = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      const t = 1 - p.life / p.max;
      const e = 1 - (1 - t) * (1 - t);
      this.pos[n * 3] = p.pos.x; this.pos[n * 3 + 1] = p.pos.y; this.pos[n * 3 + 2] = p.pos.z;
      this.col[n * 3] = p.c0.r + (p.c1.r - p.c0.r) * t;
      this.col[n * 3 + 1] = p.c0.g + (p.c1.g - p.c0.g) * t;
      this.col[n * 3 + 2] = p.c0.b + (p.c1.b - p.c0.b) * t;
      this.size[n] = p.s0 + (p.s1 - p.s0) * e;
      this.alpha[n] = p.a0 * Math.pow(1 - t, 1.4);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

// Tumbling rock chunks thrown out by explosions.
class Debris {
  constructor(scene, geometry, material, capacity = 160) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, ZERO);
    scene.add(this.mesh);
    this.list = Array.from({ length: capacity }, () => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, life: 0, max: 1,
    }));
    this.cursor = 0;
  }

  emit(pos, vel, size, life) {
    const d = this.list[this.cursor];
    this.cursor = (this.cursor + 1) % this.list.length;
    d.alive = true;
    d.pos.copy(pos); d.vel.copy(vel); d.size = size; d.life = d.max = life;
    d.rot.set(rand(0, 6), rand(0, 6), rand(0, 6));
    d.spin.set(rand(-4, 4), rand(-4, 4), rand(-4, 4));
  }

  update(dt) {
    this.list.forEach((d, i) => {
      if (!d.alive) return;
      d.life -= dt;
      if (d.life <= 0) { d.alive = false; this.mesh.setMatrixAt(i, ZERO); return; }
      d.pos.addScaledVector(d.vel, dt);
      d.rot.addScaledVector(d.spin, dt);
      const shrink = Math.min(1, d.life / 0.6);
      _q.setFromEuler(_e.set(d.rot.x, d.rot.y, d.rot.z));
      _m.compose(d.pos, _q, _s.setScalar(d.size * shrink));
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const C = (r, g, b) => new THREE.Color(r, g, b);
// HDR but bounded: overlapping additive sprites stack up fast, and values far above ~10
// turn the bloom's low mips into visible blocks.
const FIRE0 = C(3.2, 1.9, 0.8), FIRE1 = C(0.9, 0.18, 0.03);
const SPARK0 = C(6, 3.8, 1.6), SPARK1 = C(1.6, 0.35, 0.05);
const SMOKE0 = C(0.07, 0.065, 0.07), SMOKE1 = C(0.03, 0.03, 0.035);
const FLASH0 = C(4, 3, 2), FLASH1 = C(1.2, 0.6, 0.2);
const MUZ0 = C(5, 3.2, 1.4), MUZ1 = C(1.4, 0.5, 0.1);
const GREEN0 = C(1.6, 5, 1.4), GREEN1 = C(0.2, 1.2, 0.2);
const WARP0 = C(3.5, 5, 4), WARP1 = C(0.3, 1.2, 0.6);
const RCS0 = C(0.55, 0.58, 0.62), RCS1 = C(0.12, 0.13, 0.15);
export const SHIP_CORE = C(3, 5, 2.5);

// Explosions, impacts, muzzle flashes, dynamic lights and shockwaves.
export class Effects {
  constructor(scene, rockGeometry, rockMaterial) {
    this.fire = new Particles(scene, 3500, THREE.AdditiveBlending);
    this.smoke = new Particles(scene, 1600, THREE.NormalBlending);
    this.debris = new Debris(scene, rockGeometry, rockMaterial);
    // glowing-edged hull scrap for destroyed ships
    const scrapGeo = new THREE.BoxGeometry(1, 0.2, 0.7);
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x2a2b30, metalness: 0.8, roughness: 0.45, emissive: 0xff4a10, emissiveIntensity: 0.5 });
    this.scrap = new Debris(scene, scrapGeo, scrapMat, 140);
    this.pending = [];

    this.lights = Array.from({ length: 3 }, () => {
      const l = new THREE.PointLight(0xffa060, 0, 80, 2);
      scene.add(l);
      return { l, t: 0, max: 1, peak: 0 };
    });
    this.lightCursor = 0;

    const ringTex = canvasTexture(256, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, s * 0.32, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.55, 'rgba(255,220,180,0.9)');
      grd.addColorStop(1, 'rgba(255,160,90,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    });
    this.rings = Array.from({ length: 6 }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: C(1.6, 1.1, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.visible = false;
      scene.add(sp);
      return { sp, t: 0, max: 0.6, size: 10 };
    });
    this.ringCursor = 0;

    const flashTex = canvasTexture(128, (g, s) => {
      g.translate(s / 2, s / 2);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,200,120,0.8)');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd;
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.beginPath();
        g.moveTo(0, -5); g.lineTo(s / 2, 0); g.lineTo(0, 5);
        g.fill();
      }
      g.beginPath(); g.arc(0, 0, s * 0.22, 0, Math.PI * 2); g.fill();
    });
    this.flashes = Array.from({ length: 4 }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: C(5, 3.5, 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.visible = false;
      scene.add(sp);
      return { sp, t: 0 };
    });
    this.flashCursor = 0;
    this.muzzleLight = new THREE.PointLight(0xffb070, 0, 30, 2);
    scene.add(this.muzzleLight);
  }

  // Pixels per world unit at distance 1; returned so other point systems can share it.
  setViewport(heightPx, fovDeg) {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.fire.material.uniforms.uScale.value = scale;
    this.smoke.material.uniforms.uScale.value = scale;
    return scale;
  }

  light(pos, peak, duration, color = 0xffa060) {
    const L = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    L.l.position.copy(pos);
    L.l.color.set(color);
    L.peak = peak; L.t = duration; L.max = duration;
  }

  // color: optional [r, g, b] (default: the warm blast colour)
  ring(pos, size, duration = 0.6, color = null) {
    const R = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    if (color) R.sp.material.color.setRGB(...color); else R.sp.material.color.setRGB(1.6, 1.1, 0.8);
    R.sp.position.copy(pos);
    R.sp.visible = true;
    R.t = R.max = duration;
    R.size = size;
  }

  // opts.scrap: metal debris instead of rock; opts.core: colour of the initial flash;
  // opts.chain: number of delayed secondary blasts
  explosion(pos, scale = 1, baseVel = null, opts = {}) {
    const bv = baseVel || _v.set(0, 0, 0);
    const base = bv.clone();
    const dir = new THREE.Vector3();
    const vel = new THREE.Vector3();
    this.fire.emit(pos, base, 0.22, 7 * scale, 13 * scale, opts.core || FLASH0, FLASH1, 0, 1);
    if (opts.chain) {
      for (let i = 0; i < opts.chain; i++) {
        this.pending.push({
          t: 0.12 + i * rand(0.1, 0.22),
          pos: pos.clone().add(randomDir(new THREE.Vector3()).multiplyScalar(scale * rand(1, 2.5))),
          vel: base.clone(),
          scale: scale * rand(0.35, 0.6),
        });
      }
    }
    if (opts.scrap) {
      for (let i = 0; i < Math.min(26, Math.round(8 + 5 * scale)); i++) {
        randomDir(dir);
        vel.copy(dir).multiplyScalar(rand(10, 40) * Math.sqrt(scale)).add(base);
        this.scrap.emit(_v.copy(pos).addScaledVector(dir, scale * 0.6), vel, rand(0.25, 0.8) * Math.sqrt(scale), rand(2.5, 4.5));
      }
    }
    const nFire = Math.min(90, Math.round(26 * scale));
    for (let i = 0; i < nFire; i++) {
      randomDir(dir);
      vel.copy(dir).multiplyScalar(rand(3, 16) * scale).add(base);
      this.fire.emit(_v.copy(pos).addScaledVector(dir, rand(0, 1.5) * scale), vel, rand(0.6, 1.4), rand(1.6, 3) * scale, rand(5, 9) * scale, FIRE0, FIRE1, 2.2, 0.55);
    }
    for (let i = 0; i < Math.min(60, 18 + 10 * scale); i++) {
      randomDir(dir);
      vel.copy(dir).multiplyScalar(rand(30, 90) * Math.sqrt(scale)).add(base);
      this.fire.emit(pos, vel, rand(0.3, 0.9), rand(0.35, 0.7), 0.15, SPARK0, SPARK1, 1.2, 1);
    }
    for (let i = 0; i < Math.min(50, Math.round(16 * scale)); i++) {
      randomDir(dir);
      vel.copy(dir).multiplyScalar(rand(1.5, 7) * scale).add(base);
      this.smoke.emit(_v.copy(pos).addScaledVector(dir, rand(0, 2) * scale), vel, rand(1.6, 3.4), rand(2.5, 4) * scale, rand(9, 15) * scale, SMOKE0, SMOKE1, 0.8, 0.75);
    }
    for (let i = 0; !opts.scrap && !opts.noDebris && i < Math.min(18, Math.round(4 + 3 * scale)); i++) {
      randomDir(dir);
      vel.copy(dir).multiplyScalar(rand(8, 30) * Math.sqrt(scale)).add(base);
      this.debris.emit(_v.copy(pos).addScaledVector(dir, scale), vel, rand(0.25, 0.7) * scale, rand(2.2, 4));
    }
    this.light(pos, 6000 * scale, 0.5 + 0.1 * scale);
    this.ring(pos, 18 * scale, 0.5 + 0.08 * scale);
  }

  impact(pos, normalish) {
    const dir = new THREE.Vector3();
    const vel = new THREE.Vector3();
    for (let i = 0; i < 9; i++) {
      randomDir(dir).addScaledVector(normalish, 1.2).normalize();
      vel.copy(dir).multiplyScalar(rand(20, 55));
      this.fire.emit(pos, vel, rand(0.2, 0.5), rand(0.25, 0.5), 0.1, SPARK0, SPARK1, 2, 1);
    }
    this.fire.emit(pos, vel.set(0, 0, 0), 0.12, 2.2, 3.5, FIRE0, FIRE1, 0, 1);
    for (let i = 0; i < 2; i++) {
      randomDir(dir).addScaledVector(normalish, 1).normalize();
      this.smoke.emit(pos, vel.copy(dir).multiplyScalar(rand(2, 5)), rand(0.8, 1.4), 1.2, 3.5, SMOKE0, SMOKE1, 1, 0.5);
    }
    this.light(pos, 400, 0.12);
  }

  muzzle(pos, dir, shipVel) {
    const F = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    F.sp.position.copy(pos).addScaledVector(dir, 0.6);
    F.sp.material.rotation = Math.random() * Math.PI;
    F.sp.scale.setScalar(rand(2.2, 3.0));
    F.sp.visible = true;
    F.t = 0.05;
    const vel = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      vel.copy(dir).multiplyScalar(rand(20, 45)).add(shipVel);
      this.fire.emit(pos, vel, 0.08, 0.9, 1.6, MUZ0, MUZ1, 6, 1);
    }
    this.smoke.emit(pos, vel.copy(dir).multiplyScalar(4).add(shipVel), 0.7, 0.4, 1.8, SMOKE0, SMOKE1, 3, 0.35);
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 55;
  }

  enemyMuzzle(pos, dir, shipVel) {
    const vel = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      vel.copy(dir).multiplyScalar(rand(15, 35)).add(shipVel);
      this.fire.emit(pos, vel, 0.08, 0.7, 1.4, GREEN0, GREEN1, 6, 1);
    }
  }

  // hyperspace arrival: flash, ring, and sparks streaming back along the arrival heading
  warp(pos, dir) {
    const vel = new THREE.Vector3();
    this.fire.emit(pos, vel.set(0, 0, 0), 0.35, 6, 22, WARP0, WARP1, 0, 1);
    for (let i = 0; i < 30; i++) {
      vel.copy(dir).multiplyScalar(-rand(60, 220)).add(randomDir(_v).multiplyScalar(12));
      this.fire.emit(pos, vel, rand(0.2, 0.5), rand(0.4, 0.8), 0.1, WARP0, WARP1, 3, 1);
    }
    this.ring(pos, 30, 0.5);
    this.light(pos, 3000, 0.4, 0x9fffb0);
  }

  hullHit(pos, normalish) {
    this.impact(pos, normalish);
    const vel = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      vel.copy(randomDir(_v)).addScaledVector(normalish, 1).multiplyScalar(rand(4, 10));
      this.smoke.emit(pos, vel, rand(1, 2), 1, 4, SMOKE0, SMOKE1, 1, 0.6);
    }
  }

  // trailing smoke + odd spark from a badly damaged hull
  damageSmoke(pos, shipVel, severity) {
    const vel = new THREE.Vector3().copy(shipVel).multiplyScalar(0.6).add(randomDir(_v).multiplyScalar(2));
    this.smoke.emit(pos, vel, rand(1.2, 2.2), 0.8, 4 + severity * 3, SMOKE0, SMOKE1, 0.6, 0.35 + severity * 0.3);
    if (Math.random() < 0.15 * severity) {
      this.fire.emit(pos, vel.add(randomDir(_v).multiplyScalar(25)), 0.3, 0.4, 0.1, SPARK0, SPARK1, 2, 1);
    }
  }

  // short reaction-control puff (intro undocking)
  rcs(pos, dir, inheritVel) {
    const vel = new THREE.Vector3();
    for (let i = 0; i < 5; i++) {
      vel.copy(dir).multiplyScalar(rand(12, 22)).add(randomDir(_v).multiplyScalar(2.5)).add(inheritVel);
      this.smoke.emit(pos, vel, rand(0.35, 0.7), 0.25, 1.6, RCS0, RCS1, 3.5, 0.55);
    }
  }

  update(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        this.explosion(p.pos, p.scale, p.vel, { noDebris: true });
        this.onSecondary?.(p.pos, p.scale);
      }
    }
    this.fire.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.scrap.update(dt);
    for (const L of this.lights) {
      if (L.t <= 0) { L.l.intensity = 0; continue; }
      L.t -= dt;
      const k = Math.max(0, L.t / L.max);
      L.l.intensity = L.peak * k * k;
    }
    for (const R of this.rings) {
      if (!R.sp.visible) continue;
      R.t -= dt;
      if (R.t <= 0) { R.sp.visible = false; continue; }
      const k = 1 - R.t / R.max;
      R.sp.scale.setScalar(R.size * (0.2 + 0.8 * Math.sqrt(k)));
      R.sp.material.opacity = (1 - k) * (1 - k);
    }
    for (const F of this.flashes) {
      if (!F.sp.visible) continue;
      F.t -= dt;
      if (F.t <= 0) F.sp.visible = false;
    }
    this.muzzleLight.intensity *= Math.exp(-dt * 30);
  }
}
