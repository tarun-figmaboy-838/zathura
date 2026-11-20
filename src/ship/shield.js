import * as THREE from 'three';

const HITS = 6;
const _p = new THREE.Vector3();

// Energy shield bubble: invisible at rest, it lights up with a cellular pattern and an
// expanding ripple where a bolt lands, glows on recharge, and shifts red as it weakens.
export class ShieldFX {
  constructor(ship) {
    this.hits = Array.from({ length: HITS }, () => new THREE.Vector4(0, 0, 1, 99));
    this.cursor = 0;
    this.uniforms = {
      uHits: { value: this.hits },
      uStrength: { value: 1 },
      uPulse: { value: 0 },
      uDim: { value: 1 },          // < 1 in the angle battles, so a hit never hides the radar diagram
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
        void main() {
          vLocal = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          vN = normalMatrix * normal;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec4 uHits[${HITS}];
        uniform float uStrength, uPulse, uDim;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
        vec3 hash33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx);
        }
        float cellEdge(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          float f1 = 8.0, f2 = 8.0;
          for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int l = -1; l <= 1; l++) {
            vec3 g = vec3(float(l), float(j), float(k));
            vec3 r = g + hash33(i + g) - f;
            float d = dot(r, r);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
          }
          return sqrt(f2) - sqrt(f1);
        }
        float sq(float x) { return x * x; }   // never pow() a negative base: NaN spreads via bloom
        void main() {
          vec3 p = normalize(vLocal);
          float fres = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vView)))), 2.0);
          float edge = 1.0 - smoothstep(0.03, 0.1, cellEdge(p * 7.0));
          float glow = 0.0;
          for (int i = 0; i < ${HITS}; i++) {
            vec4 h = uHits[i];
            if (h.w > 1.6) continue;
            float d = distance(p, h.xyz);
            float ring = exp(-sq((d - h.w * 2.0) * 8.0)) * exp(-h.w * 2.2);
            float core = exp(-d * d * 18.0) * exp(-h.w * 6.0);
            float spread = exp(-d * d * 3.0) * exp(-h.w * 3.0) * edge;
            glow += ring * (0.5 + edge * 1.5) + core * 2.5 + spread;
          }
          float a = glow * mix(0.35, 1.0, uStrength) + uPulse * fres * (0.35 + edge) + fres * edge * 0.04 * uStrength;
          vec3 col = mix(vec3(1.0, 0.32, 0.22), vec3(0.3, 0.65, 1.0), uStrength);
          gl_FragColor = vec4(col * a * 2.2 * uDim, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
    this.mesh.scale.set(7.6, 3.6, 8.8);
    this.mesh.position.set(0, 0.6, 0);
    this.mesh.renderOrder = 5;
    this.mesh.castShadow = false;
    ship.visual.add(this.mesh);
  }

  hit(worldPoint) {
    this.mesh.updateWorldMatrix(true, false);
    _p.copy(worldPoint);
    this.mesh.worldToLocal(_p).normalize();
    this.hits[this.cursor].set(_p.x, _p.y, _p.z, 0);
    this.cursor = (this.cursor + 1) % HITS;
  }

  pulse() { this.uniforms.uPulse.value = 1; }
  set dim(v) { this.uniforms.uDim.value = v; }

  update(dt, strength) {
    for (const h of this.hits) h.w += dt;
    this.uniforms.uStrength.value = strength;
    this.uniforms.uPulse.value = Math.max(0, this.uniforms.uPulse.value - dt * 1.5);
  }
}
