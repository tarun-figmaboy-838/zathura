import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';

// A gate at the end of a journey: a planet broken in two. The break is a natural crack, not a
// straight cut: its edges are jagged like mountain ridges, the crack winds a little above and below
// the flight lane, and its walls are rugged cliffs. The broken faces show the inside: dark crust,
// thin glowing veins, a molten layer and a small bright core. The ship flies into the crack;
// passing the planet's centre returns true from update() so the game can flash and start the level.
//
// A dark planet with a thin glowing crack stays out of the way: the rocks in front of it read
// clearly. Each sector has its own colours. Interface: show / hide / update / state / group / radius.

export const PLANET_LOOKS = [
  { crust: 0x5a3a2c, glow: [1.0, 0.36, 0.08], core: [1.0, 0.82, 0.45] },    // sector 1: rusty rock, orange lava
  { crust: 0x3c4c5c, glow: [0.15, 0.75, 1.0], core: [0.7, 0.95, 1.0] },     // sector 2: icy crust, cyan glow
  { crust: 0x4a3458, glow: [0.95, 0.2, 0.85], core: [1.0, 0.75, 0.95] },    // sector 3: violet crust, magenta glow
  { crust: 0x2c2626, glow: [1.0, 0.12, 0.05], core: [1.0, 0.55, 0.3] },     // the Warden: charred, deep red
];

const R = 170;          // planet radius
const GAP = 42;         // the crack's walls never come closer than this to the lane's centre line
const DEPTH = 46;       // how far back the valleys between the ridges go
const OPEN = 8;         // how much further the halves drift apart as the ship closes in

const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// ridged noise: sharp crests like mountain ridges (1 on a crest, falling off into valleys)
function ridged(seed) {
  const r = rng(seed);
  const oct = Array.from({ length: 6 }, (_, i) => {
    const a = r() * Math.PI, f = 0.011 * 2 ** (i * 0.9);
    return { fy: Math.cos(a) * f, fz: Math.sin(a) * f, p: r() * 6.28, q: r() * 6.28, amp: 0.55 ** i };
  });
  const total = oct.reduce((t, o) => t + o.amp, 0);
  return (y, z) => {
    let v = 0;
    for (const o of oct) {
      const w = 0.6 * Math.sin(y * o.fy + z * o.fz + o.p) + 0.4 * Math.sin(y * o.fz * 1.3 - z * o.fy * 1.1 + o.q);
      v += o.amp * (1 - Math.abs(w)) ** 2;
    }
    return v / total;
  };
}

// where one half's broken face is, as an x position for each (y, z): the crack winds sideways away
// from the lane, and ridges reach toward the crack while the valleys between them go back
function cutSurface(side, seed) {
  const ridge = ridged(seed);
  const r = rng(seed + 99);
  const p1 = r() * 6.28, p2 = r() * 6.28;
  const wind = (y) => {
    const k = Math.min(1, Math.max(0, (Math.abs(y) - 35) / 75));     // straight through the lane
    return k * k * (3 - 2 * k) * (20 * Math.sin(y * 0.021 + p1) + 7 * Math.sin(y * 0.063 + p2));
  };
  return (y, z) => {
    const v = Math.min(1, Math.max(0, (ridge(y, z) - 0.2) / 0.55));
    return wind(y) + side * (GAP + DEPTH * (1 - v) ** 1.4);
  };
}

// one half: the part of a sphere on its side of the crack, with the band beyond the broken face
// folded onto the face's edge, so its rim follows the jagged ridge line exactly. The poles point
// across the crack (x = R cos theta) for an even edge, and the far side is never built.
function shellGeometry(side, cut) {
  let lo = Infinity, hi = -Infinity;                                       // how far the face reaches
  for (let y = -R; y <= R; y += 4) for (let z = -R; z <= R; z += 4) { const c = cut(y, z); lo = Math.min(lo, c); hi = Math.max(hi, c); }
  const t0 = side < 0 ? Math.acos(Math.min(1, (hi + 4) / R)) : 0;
  const t1 = side < 0 ? Math.PI : Math.acos(Math.max(-1, (lo - 4) / R));
  const g = new THREE.SphereGeometry(R, 256, 120, 0, Math.PI * 2, t0, t1 - t0).rotateZ(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rho = Math.hypot(y, z) || 1e-6;
    const c = cut((y / rho) * R, (z / rho) * R);                         // the edge for this direction
    if (side < 0 ? x <= c : x >= c) continue;
    const k = Math.sqrt(Math.max(0, R * R - c * c)) / rho;
    p.setXYZ(i, c, y * k, z * k);
  }
  return g;
}

// the broken face: a disk shaped by the same surface, its rim on the sphere
function faceGeometry(side, cut) {
  const g = new THREE.RingGeometry(0.5, R, 256, 70);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const gx = p.getX(i), gy = p.getY(i);
    const y = gy, z = side < 0 ? -gx : gx;                                // faces into the crack
    const rho = Math.hypot(y, z) || 1e-6;
    const edge = rho > R - 1e-3;
    const c = edge ? cut((y / rho) * R, (z / rho) * R) : cut(y, z);
    const k = Math.sqrt(Math.max(0, R * R - c * c)) / R;
    p.setXYZ(i, c, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

const faceVertex = /* glsl */ `
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vP = position;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const faceFragment = /* glsl */ `
  uniform float uTime, uR, uHeat;
  uniform vec3 uCrust, uGlow, uCore, uSun;
  varying vec3 vP;
  varying vec3 vN;
  ${VALUE3}
  void main() {
    float r = length(vP.yz) / uR;
    vec3 q = vP * 0.025;
    float n = fbm3(q + vec3(0.0, uTime * 0.04, 0.0));
    float n2 = vnoise(vP * 0.11);
    // rugged rock lit by the sun (the cliffs read in 3D), never fully black
    float lit = 0.3 + 0.7 * max(dot(normalize(vN), uSun), 0.0);
    vec3 col = uCrust * (0.4 + 0.7 * n + 0.15 * n2) * lit;
    // thin glowing veins, a little wider toward the middle
    float vein = smoothstep(0.018 + 0.03 * (1.0 - r), 0.0, abs(fbm3(q * 1.7 + 3.0) - 0.5));
    col += uGlow * vein * smoothstep(0.97, 0.5, r) * 0.7;
    // a molten layer and a small bright core, soft so the crack never glares
    col = mix(col, uGlow * (0.35 + 0.3 * n), smoothstep(0.46, 0.34, r + 0.06 * (n2 - 0.5)));
    col = mix(col, uCore * (0.9 + 0.35 * n), smoothstep(0.17, 0.06, r + 0.04 * (n - 0.5)));
    gl_FragColor = vec4(col * uHeat, 1.0);
  }`;

// the outside: dark rock with a few glowing cracks seeping out near the break
function surfaceMaterial(look) {
  const m = new THREE.MeshStandardMaterial({ color: look.crust, roughness: 0.95, metalness: 0, envMapIntensity: 0.45 });
  m.userData.glow = { value: new THREE.Color(...look.glow) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = m.userData.glow;
    shader.uniforms.uR = { value: R };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vP;\nuniform vec3 uGlow;\nuniform float uR;\n${VALUE3}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.5 + 0.8 * fbm3(vP * 0.02) + 0.15 * vnoise(vP * 0.09);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float crack = smoothstep(0.012, 0.0, abs(fbm3(vP * 0.014 + 7.0) - 0.5));
        float nearCut = 1.0 - smoothstep(0.0, 0.35 * uR, abs(abs(vP.x) - 60.0));
        totalEmissiveRadiance += uGlow * crack * nearCut * 0.6;`);
  };
  return m;
}

export class PlanetGate {
  constructor(scene, { rockGeometry = null, sunDir = new THREE.Vector3(0, 1, 0) } = {}) {
    this.radius = R;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.u = {
      uTime: { value: 0 }, uR: { value: R }, uHeat: { value: 1 }, uSun: { value: sunDir.clone().normalize() },
      uCrust: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uCore: { value: new THREE.Color() },
    };
    const faceMat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: faceVertex, fragmentShader: faceFragment });
    this.surface = surfaceMaterial(PLANET_LOOKS[0]);

    const cuts = [cutSurface(-1, 4242), cutSurface(1, 777)];
    this.halves = [-1, 1].map((side, i) => {
      const half = new THREE.Group();
      half.add(new THREE.Mesh(shellGeometry(side, cuts[i]), this.surface), new THREE.Mesh(faceGeometry(side, cuts[i]), faceMat));
      half.userData.side = side;
      this.group.add(half);
      return half;
    });

    // broken chunks floating in the crack, well above and below the flight lane
    this.chunks = [];
    if (rockGeometry) {
      this.chunkMat = new THREE.MeshStandardMaterial({ color: 0x3a302c, roughness: 0.95, envMapIntensity: 0.5 });
      const r = rng(31);
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(rockGeometry, this.chunkMat);
        const y = (i % 2 ? 1 : -1) * (70 + r() * 130);
        const mid = (cuts[0](y, 0) + cuts[1](y, 0)) / 2;                   // the middle of the crack there
        m.position.set(mid + (r() - 0.5) * 20, y, (r() - 0.5) * R * 1.4);
        m.scale.setScalar(3 + r() * 5);
        m.rotation.set(r() * 6, r() * 6, r() * 6);
        m.userData.spin = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.5);
        this.group.add(m);
        this.chunks.push(m);
      }
    }

    this.state = 'off';
    this.t = 0;
    this.flash = 0;
  }

  setLook(i) {
    const look = PLANET_LOOKS[Math.min(i, PLANET_LOOKS.length - 1)];
    this.u.uCrust.value.set(look.crust);
    this.u.uGlow.value.setRGB(...look.glow);
    this.u.uCore.value.setRGB(...look.core);
    this.surface.color.set(look.crust);
    this.surface.userData.glow.value.setRGB(...look.glow);
    this.chunkMat?.color.set(look.crust).multiplyScalar(0.7);
  }

  // pos: the planet's centre (on the lane); look: the sector (0..3)
  show(pos, look = 0) {
    this.setLook(look);
    this.group.position.copy(pos);
    this.group.visible = true;
    this.state = 'in';
    this.t = 0;
    this.flash = 0;
  }

  hide() {
    this.state = 'off';
    this.group.visible = false;
  }

  // returns true on the frame the ship passes the planet's centre
  update(dt, time, shipPos) {
    if (this.state === 'off') return false;
    this.t += dt;
    this.u.uTime.value = time;
    const dz = this.group.position.z - shipPos.z;          // negative while the planet is ahead
    let crossed = false;
    if (this.state === 'in' && dz > -1) {
      this.state = 'out';
      this.flash = 1;
      crossed = true;
    }
    // the halves drift apart as the ship closes in
    const near = Math.min(1, Math.max(0, 1 - (-dz - R) / 900));
    for (const h of this.halves) h.position.x = h.userData.side * OPEN * near;
    for (const c of this.chunks) {
      c.rotation.x += c.userData.spin.x * dt;
      c.rotation.y += c.userData.spin.y * dt;
    }
    this.flash = Math.max(0, this.flash - dt * 1.2);
    this.u.uHeat.value = 1 + 0.25 * near * near;     // the core warms a little as you arrive (no flash)
    if (this.state === 'out' && dz > R + 400) this.hide();
    return crossed;
  }
}
