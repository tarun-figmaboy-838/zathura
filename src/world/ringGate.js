import * as THREE from 'three';
import { GateBase, seeded } from './gateBase.js';

// A journey gate: a banded gas giant like Saturn, below the route, its rings round its equator at
// a gentle tilt. You fly in over the planet's top and dive through the dark gap between two ring
// bands (like the Cassini division); ice chunks line the gap's edges and sparkle as you shoot
// through. The ring plane crosses the lane at the gate's middle.

const B = (35 * Math.PI) / 180;                // the ring plane's tilt from flat...
const G = 0.35;                                // ...and its roll, so the rings cross the view on a slant
const CROSS = 385;                             // where (ring radius) the lane goes through the plane
const PR = 170;                                // the planet's radius
// the ring plane's normal, and the planet's centre: in that plane, CROSS from where the lane meets
// it (the gate's middle), on the low side, so the planet sits below and to the left of the route
const N = new THREE.Vector3(-Math.sin(G) * Math.cos(B), Math.cos(G) * Math.cos(B), Math.sin(B));
const C = new THREE.Vector3(0, 1, 0).addScaledVector(N, -N.y).normalize().multiplyScalar(-CROSS);
const GAP = [330, 440];                        // the gap (ring radii)
const RINGS = [208, 545];

// per sector: the planet's band colours and the rings' tint
const LOOKS = [
  { bands: ['#c9a27a', '#8f5f3e', '#e8d7b8', '#a87650', '#6b4630'], ring: [0.95, 0.82, 0.62] },
  { bands: ['#9fc4d8', '#5e86a3', '#dceaf2', '#7aa4bf', '#41617a'], ring: [0.75, 0.88, 1.0] },
  { bands: ['#c9a0d8', '#7c4f96', '#ead6f2', '#a476bd', '#553069'], ring: [0.95, 0.78, 1.0] },
  { bands: ['#c97a6a', '#7a3328', '#e8b8a8', '#a8503e', '#4a1e18'], ring: [1.0, 0.7, 0.6] },
];

// a banded gas-giant texture: wavy stripes with a little turbulence (made once per sector)
function bandTexture(colors, seed) {
  const W = 512, H = 256, r = seeded(seed);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rgb = colors.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  const img = g.createImageData(W, H);
  const ph = Array.from({ length: 6 }, () => r() * 6.28);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * Math.PI * 2;
      const v = y / H + 0.012 * Math.sin(u * 3 + ph[0] + y * 0.05) + 0.006 * Math.sin(u * 9 + ph[1]);
      const b = (Math.sin(v * 38 + ph[2]) * 0.5 + 0.5) * 0.6 + (Math.sin(v * 91 + ph[3]) * 0.5 + 0.5) * 0.4;
      const k = Math.min(rgb.length - 1.001, b * (rgb.length - 1));
      const i0 = Math.floor(k), f = k - i0;
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = rgb[i0][ch] * (1 - f) + rgb[i0 + 1][ch] * f;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ringVertex = /* glsl */ `
  varying float vR;
  void main() { vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ringFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec2 uGap;
  uniform float uFlash, uFade;
  varying float vR;
  void main() {
    float x = vR;
    float d = 0.55 + 0.25 * sin(x * 0.21) + 0.15 * sin(x * 0.53 + 1.3) + 0.1 * sin(x * 1.37);
    d *= smoothstep(${RINGS[0].toFixed(1)}, ${(RINGS[0] + 14).toFixed(1)}, x) * smoothstep(${RINGS[1].toFixed(1)}, ${(RINGS[1] - 40).toFixed(1)}, x);
    d *= 1.0 - smoothstep(uGap.x - 6.0, uGap.x + 4.0, x) * smoothstep(uGap.y + 6.0, uGap.y - 4.0, x);   // the gap
    vec3 col = uTint * (0.55 + 0.45 * sin(x * 0.09)) * (1.0 + uFlash);
    gl_FragColor = vec4(col, clamp(d, 0.0, 1.0) * 0.8 * uFade);
  }`;

export class RingGate extends GateBase {
  constructor(scene, { rockGeometry = null } = {}) {
    super(scene, 140);
    this.keepOut = C.z + PR + 40;                  // keep scenery out of the planet, which reaches toward you
    const n = N;
    const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);

    this.planetMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.4 });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(PR, 96, 64), this.planetMat);
    planet.position.copy(C);
    planet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);   // its stripes follow the rings
    this.planet = planet;
    this.group.add(planet);

    this.u = { uTint: { value: new THREE.Color() }, uGap: { value: new THREE.Vector2(...GAP) }, uFlash: { value: 0 }, uFade: { value: 1 } };
    const ring = new THREE.Mesh(new THREE.RingGeometry(RINGS[0], RINGS[1], 256, 4),
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: ringVertex, fragmentShader: ringFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.copy(C);
    ring.quaternion.copy(tilt);
    this.group.add(ring);

    // ice chunks lining both edges of the gap, turning slowly with the rings
    this.ice = null;
    if (rockGeometry) {
      const r = seeded(5);
      this.iceMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f0, roughness: 0.4, metalness: 0.1, envMapIntensity: 1.2 });
      const ice = new THREE.InstancedMesh(rockGeometry, this.iceMat, 220);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let i = 0; i < 220; i++) {
        const edge = i % 2 ? GAP[0] - 2 - r() * 10 : GAP[1] + 2 + r() * 12;
        const a = r() * Math.PI * 2;
        e.set(r() * 6, r() * 6, r() * 6);
        m.compose(new THREE.Vector3(Math.cos(a) * edge, Math.sin(a) * edge, (r() - 0.5) * 5), q.setFromEuler(e), new THREE.Vector3().setScalar(1.2 + r() * 3));
        ice.setMatrixAt(i, m);
      }
      this.ice = new THREE.Group();
      this.ice.position.copy(C);
      this.ice.quaternion.copy(tilt);
      this.ice.add(ice);
      this.group.add(this.ice);
    }
    this.textures = [];
  }

  setLook(i) {
    const L = LOOKS[i];
    this.textures[i] ??= bandTexture(L.bands, 11 + i);
    this.planetMat.map = this.textures[i];
    this.planetMat.needsUpdate = true;
    this.u.uTint.value.setRGB(...L.ring);
  }

  animate(dt, time) {
    this.planet.rotateY(dt * 0.03);
    if (this.ice) this.ice.rotateZ(dt * 0.015);
    this.u.uFlash.value = 0;
  }
}
