import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';

// A wormhole as a real 3D funnel, anchored where it opens (inside the black hole, or behind a
// portal's ring): its mouth sits in the
// shadow (so a throat of light is seen opening inside the black as the ship falls in), it narrows
// into a long tube along the fall, and its far end glows. The ship and the camera fly down it, so
// the walls stream past around them: one continuous place, not a separate effect.
const _z = new THREE.Vector3(0, 0, 1);
export class WormholeTube {
  // R: mouth radius; throat: the tube's radius as a fraction of R; warm: 1 black hole, ~0.35 portal
  constructor(scene, R, { length = 5200, segments = 260, radial = 96, throat = 0.36, warm = 1 } = {}) {
    this.R = R;
    this.length = length;
    const pos = [], along = [], around = [], idx = [];
    // a funnel into a tube that closes at the far end into a point of light (no black hole at the end)
    const radius = (s) => R * (throat + (1.02 - throat) * (1 - smoothstep(0, R * 2.4, s))) * (1 - smoothstep(length * 0.86, length, s) * 0.97);
    for (let i = 0; i <= segments; i++) {
      const s = (i / segments) ** 1.35 * length;            // finer rings near the mouth
      const r = radius(s);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, s);
        along.push(s);
        around.push(j / radial);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j, b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    geo.setAttribute('aAround', new THREE.Float32BufferAttribute(around, 1));
    geo.setIndex(idx);
    this.u = { uTime: { value: 0 }, uAlpha: { value: 0 }, uLen: { value: length }, uR: { value: R }, uWarm: { value: warm }, uGold: { value: warm }, uExit: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aAlong, aAround;
        varying float vS, vA;
        varying vec3 vW;
        void main() {
          vS = aAlong; vA = aAround;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha, uLen, uR, uWarm, uGold, uExit;
        varying float vS, vA;
        varying vec3 vW;
        ${VALUE3}
        const float TAU = 6.2831853;
        void main() {
          float a = vA * TAU;
          float sn = vS / uR;                               // along the tube, in hole radii
          float tw = a + sn * 1.6 - uTime * 0.9;            // the walls twist
          vec3 q = vec3(cos(tw) * 1.6, sin(tw) * 1.6, sn * 1.6 - uTime * 1.1);
          vec3 w = vec3(fbm3(q), fbm3(q + vec3(5.2, 1.3, 2.7)), 0.0);
          float gas = fbm3(q * 1.25 + w * 2.4);
          float wisp = fbm3(vec3(cos(tw * 2.0) * 2.6, sin(tw * 2.0) * 2.6, sn * 4.0 - uTime * 2.0) + w * 1.6);
          // glowing shells of gas along the tube, bent and torn by the turbulence
          float zr = sn * 3.2 - uTime * 1.4 + (gas - 0.5) * 2.2;
          float k = fract(zr) - 0.5;
          float shell = exp(-k * k * 22.0) * smoothstep(0.3, 0.75, wisp);
          float seam = exp(-k * k * 120.0) * smoothstep(0.45, 0.8, wisp);
          // the throat still glows in the accretion disk's gold; deeper in it turns cyan and blue,
          // then violet and red-orange toward the far end
          float throat = smoothstep(0.2, 3.4, sn);
          float far = smoothstep(uLen * 0.3, uLen * 0.85, vS);
          vec3 gold = mix(vec3(1.0, 0.78, 0.4), vec3(1.0, 0.45, 0.14), gas);
          vec3 cool = mix(vec3(0.1, 0.62, 1.0), vec3(0.18, 0.3, 0.95), smoothstep(0.35, 0.75, gas));
          vec3 ringC = mix(mix(cool, gold, uGold), cool, throat);   // the black hole's mouth glows gold; a portal's stays cool
          ringC = mix(ringC, mix(vec3(0.6, 0.25, 1.0), vec3(1.0, 0.33, 0.1), uWarm), far * 0.75);
          vec3 col = vec3(0.004, 0.007, 0.026);
          col += mix(vec3(0.03, 0.1, 0.32), vec3(0.18, 0.05, 0.28), far) * gas * gas * 1.5;
          col += ringC * (shell * 0.8 + seam * 0.95);
          col += vec3(0.85, 0.95, 1.0) * seam * wisp * 0.25;
          // light streaks running along the walls
          float lane = vA * 70.0;
          float h = hash12(vec2(floor(lane), 1.7));
          float d = fract(sn * 0.35 + h * 10.0 + uTime * (0.4 + 0.6 * h));
          float streak = step(0.75, h) * smoothstep(0.0, 0.02, d) * (1.0 - smoothstep(0.05, 0.3, d))
                       * (1.0 - smoothstep(0.05, 0.3, abs(fract(lane) - 0.5)));
          col += mix(vec3(0.45, 0.82, 1.0), vec3(1.0, 0.4, 0.62), smoothstep(0.85, 0.97, h)) * streak * 0.8;
          // sparks and dust on the walls
          vec2 cell = vec2(vA * 60.0, sn * 6.0 + uTime * 3.0);
          vec2 id = floor(cell), f = fract(cell);
          vec2 sp = vec2(hash12(id + 3.1), hash12(id + 7.7));
          vec2 dd = (f - sp) * vec2(1.0, 0.25);
          col += vec3(0.85, 0.95, 1.0) * step(0.86, hash12(id)) * exp(-dot(dd, dd) * 500.0) * 1.1;
          // walls far from the eye dim into the dark; the far end of the tube glows
          float dist = distance(cameraPosition, vW);
          col *= 0.3 + 0.7 * exp(-dist / (uR * 7.0));
          col += vec3(0.9, 0.95, 1.0) * smoothstep(uLen * 0.82, uLen, vS) * 1.6;
          // depth: dark right at the mouth, glowing further in, so it reads as a hole with light
          // inside (not a flat disc pasted into the shadow)
          col *= 0.12 + 0.88 * smoothstep(0.0, uR * 1.8, vS);
          // the end of the ride: the light ahead swells until everything is white
          col = mix(col, vec3(1.0), uExit * uExit);
          float mouth = smoothstep(0.0, uR * 0.3, vS);      // a soft rim where it opens
          gl_FragColor = vec4(col, uAlpha * mouth);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;       // over the black hole's shadow, under the ship's glow and trails
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get active() { return this.mesh.visible && this.u.uAlpha.value > 0.01; }

  // the mouth at the hole's centre, the tube running along `axis` (the line of the fall)
  place(center, axis) {
    this.mesh.position.copy(center);
    this.mesh.quaternion.setFromUnitVectors(_z, axis.clone().normalize());
  }

  // once mostly opaque it writes depth, so nothing outside the walls (planet rings, glows) shows through
  set alpha(v) { this.u.uAlpha.value = v; this.mesh.visible = v > 0; this.mesh.material.depthWrite = v > 0.6; }
  set exit(v) { this.u.uExit.value = v; }
  get alpha() { return this.u.uAlpha.value; }

  update(time) { this.u.uTime.value = time; }
}

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
