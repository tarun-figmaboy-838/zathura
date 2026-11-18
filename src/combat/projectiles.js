import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();
const _hit = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const PLAYER_BOLTS = {
  core: new THREE.Color(5, 3, 1.4),
  sheath: new THREE.Color(1.6, 0.55, 0.12),
  head: new THREE.Vector3(4.0, 2.2, 0.8),
  coreRadius: 0.14,
  sheathRadius: 0.42,
  maxLen: 10,
  life: 2.6,
  headSize: 2.2,
  minPx: 7,
};

// Pooled plasma bolts: an HDR core (bloom does the glow), a wider soft sheath, and a
// glowing head with a minimum on-screen size so bolts stay readable at range.
// One instance per team, with its own look.
export class Projectiles {
  constructor(scene, options = {}) {
    const o = { ...PLAYER_BOLTS, capacity: 140, ...options };
    this.o = o;
    const capacity = o.capacity;
    const make = (radius, sides, color, opacity) => {
      const geo = new THREE.CylinderGeometry(radius, radius, 1, sides, 1);
      geo.rotateX(Math.PI / 2);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
      }), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, ZERO);
      scene.add(mesh);
      return mesh;
    };
    this.core = make(o.coreRadius, 6, o.core, 1);
    this.sheath = make(o.sheathRadius, 8, o.sheath, 0.55);
    this.list = Array.from({ length: capacity }, () => ({
      alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, traveled: 0, damage: 1,
    }));
    this.cursor = 0;

    this.headPos = new Float32Array(capacity * 3);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage));
    headGeo.setDrawRange(0, 0);
    this.headGeo = headGeo;
    this.headMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 800 }, uMinPx: { value: o.minPx }, uSize: { value: o.headSize }, uColor: { value: o.head } },
      vertexShader: /* glsl */ `
        uniform float uScale, uMinPx, uSize;
        varying float vBoost;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float px = uSize * uScale / -mv.z;
          vBoost = clamp(px / uMinPx, 0.35, 1.0);
          gl_PointSize = max(px, uMinPx);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vBoost;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = exp(-d * d * 9.0);
          float halo = exp(-d * d * 2.5) * 0.35;
          gl_FragColor = vec4(uColor * (core + halo) * vBoost, 1.0);
        }`,
    });
    const heads = new THREE.Points(headGeo, this.headMat);
    heads.frustumCulled = false;
    heads.renderOrder = 4;
    scene.add(heads);
  }

  setViewport(scale) { this.headMat.uniforms.uScale.value = scale; }

  // ghost: a shot that cannot hit ships (a wrong answer's volley must never land by accident)
  spawn(pos, dir, inheritVel, speed = 560, damage = 1, ghost = false) {
    const p = this.list[this.cursor];
    this.cursor = (this.cursor + 1) % this.list.length;
    p.alive = true;
    p.pos.copy(pos);
    p.prev.copy(pos);
    p.vel.copy(dir).multiplyScalar(speed).add(inheritVel);
    p.life = this.o.life;
    p.traveled = 0;
    p.damage = damage;
    p.ghost = ghost;
  }

  clear() {
    this.list.forEach((p, i) => {
      p.alive = false;
      this.core.setMatrixAt(i, ZERO);
      this.sheath.setMatrixAt(i, ZERO);
    });
    this.core.instanceMatrix.needsUpdate = this.sheath.instanceMatrix.needsUpdate = true;
    this.headGeo.setDrawRange(0, 0);
  }

  // hitTest(prev, pos, outPoint) returns whatever was hit (or null); onHit(target, point, bolt)
  update(dt, hitTest, onHit) {
    let heads = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (!p.alive) continue;
      p.prev.copy(p.pos);
      p.pos.addScaledVector(p.vel, dt);
      p.traveled += p.vel.length() * dt;
      p.life -= dt;
      const target = p.life > 0 ? hitTest(p.prev, p.pos, _hit, p) : null;
      if (target) onHit(target, _hit, p);
      if (p.life <= 0 || target) {
        p.alive = false;
        this.core.setMatrixAt(i, ZERO);
        this.sheath.setMatrixAt(i, ZERO);
        continue;
      }
      const len = Math.min(this.o.maxLen, p.traveled + 0.5);
      _d.copy(p.vel).normalize();
      _q.setFromUnitVectors(Z, _d);
      _c.copy(p.pos).addScaledVector(_d, -len * 0.5);
      _m.compose(_c, _q, _s.set(1, 1, len));
      this.core.setMatrixAt(i, _m);
      this.sheath.setMatrixAt(i, _m);
      this.headPos[heads * 3] = p.pos.x;
      this.headPos[heads * 3 + 1] = p.pos.y;
      this.headPos[heads * 3 + 2] = p.pos.z;
      heads++;
    }
    this.core.instanceMatrix.needsUpdate = true;
    this.sheath.instanceMatrix.needsUpdate = true;
    this.headGeo.setDrawRange(0, heads);
    this.headGeo.attributes.position.needsUpdate = true;
  }
}
