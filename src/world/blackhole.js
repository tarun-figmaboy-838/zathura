import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';

// The journey's destination: a black hole drawn on a camera-facing quad.
//  - gravitational lensing: the nebula behind it is re-sampled along bent rays (Einstein ring)
//  - event-horizon shadow + photon ring
//  - a swirling, Doppler-brightened accretion disk, plus its lensed far side arching over the top
export function createBlackHole(skyCube, { position, radius = 450, normal = new THREE.Vector3(0, 1, 0.24) } = {}) {
  const uniforms = {
    uSky: { value: skyCube },
    uCenter: { value: position.clone() },
    uR: { value: radius },
    uTime: { value: 0 },
    uN: { value: normal.clone().normalize() },
    uIntensity: { value: 1 },
    uDisk: { value: 1 },        // brightness of the glowing parts only (disk, arcs, photon ring)
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform vec3 uCenter; uniform float uR;
      varying vec3 vWorld;
      void main() {
        vec3 toCam = normalize(cameraPosition - uCenter);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = cross(toCam, right);
        vec3 wp = uCenter + (right * position.x + up * position.y) * uR * 18.0;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube uSky;
      uniform vec3 uCenter, uN;
      uniform float uR, uTime, uIntensity, uDisk;
      varying vec3 vWorld;
      ${VALUE3}

      float gauss(float x) { return exp(-x * x); }   // never pow() a negative base: NaN spreads via bloom

      // Hot gas at disk radius r (in horizon radii) and azimuth phi: white-hot at the inner edge,
      // cooling through gold to deep orange; fine streaks drawn out along the orbit, sheared by
      // the faster inner rotation.
      vec3 diskColor(float r, float phi, out float a) {
        float spin = phi + uTime * 1.6 / (r * sqrt(r));
        vec3 q = vec3(cos(spin) * 2.2, sin(spin) * 2.2, r * 9.0);   // stretched along the orbit
        float n = fbm3(q) * 0.75 + vnoise(q * 3.0) * 0.25;
        float streaks = 0.62 + 0.38 * sin(r * 46.0 + n * 9.0);
        float temp = clamp((r - 1.65) / 4.3, 0.0, 1.0);
        vec3 col = mix(vec3(1.0, 0.97, 0.92), vec3(1.0, 0.72, 0.36), smoothstep(0.0, 0.3, temp));
        col = mix(col, vec3(0.9, 0.34, 0.1), smoothstep(0.3, 1.0, temp));
        a = smoothstep(1.55, 1.85, r) * (1.0 - smoothstep(4.4, 6.6, r));
        return col * (0.45 + 0.9 * n) * streaks * (3.0 / pow(r, 1.35));
      }

      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        vec3 oc = uCenter - cameraPosition;
        float D = length(oc);
        vec3 c = oc / D;
        float cosT = clamp(dot(rd, c), -1.0, 1.0);
        float th = acos(cosT);
        float angR = asin(min(uR / D, 0.999));
        float x = th / angR;                       // distance from centre in shadow radii
        vec3 perp = rd - c * cosT;
        float pl = length(perp);
        perp = pl > 1e-6 ? perp / pl : vec3(1.0, 0.0, 0.0);

        // lensed background
        float thE = angR * 2.3;
        float beta = th - thE * thE / max(th, 1e-5);
        vec3 col = textureCube(uSky, normalize(c * cos(beta) + perp * sin(beta))).rgb;

        // basis in the disk plane, and the disk's "up" as seen on screen
        vec3 N = uN;
        vec3 U = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
        vec3 V = cross(N, U);
        vec3 nScreen = normalize(N - c * dot(N, c) + vec3(1e-5));

        // the disk's far side, bent by gravity into a halo around the shadow: a broad bright arch
        // over the top and a thinner, fainter one underneath
        float side = dot(perp, nScreen);
        float over_ = max(side, 0.0), under = max(-side, 0.0);
        float outer = mix(1.35, 2.3, over_) * (1.0 - 0.35 * under);
        float arcBand = smoothstep(1.02, 1.12, x) * (1.0 - smoothstep(outer - 0.3, outer, x));
        if (arcBand > 0.0) {
          float ang = atan(dot(perp, cross(c, nScreen)), side);
          float a2;
          vec3 arc = diskColor(1.7 + (x - 1.05) * 2.4, ang * 1.1 + 3.14159, a2);
          float spinSide = dot(perp, cross(c, nScreen));             // Doppler on the lensed image too
          float beam = 0.5 + 0.9 * smoothstep(-0.9, 0.9, spinSide);
          col += arc * arcBand * a2 * beam * (0.35 + 0.65 * over_ + 0.25 * under) * uDisk;
        }

        // direct image of the near disk (ray / plane intersection), hidden behind the horizon
        vec3 O = -oc;
        float denom = dot(rd, N);
        if (abs(denom) > 1e-5) {
          float t = -dot(O, N) / denom;
          if (t > 0.0) {
            vec3 P = O + rd * t;
            float r = length(P) / uR;
            float tc = dot(oc, rd);
            float b2 = D * D - tc * tc;
            bool blocked = b2 < uR * uR && tc < t;
            if (!blocked && r < 7.0) {
              float a;
              vec3 dc = diskColor(r, atan(dot(P, V), dot(P, U)), a);
              // Doppler beaming: gas moving toward us is brighter and bluer, receding gas dimmer, redder
              vec3 vel = normalize(cross(N, P));
              float toward = dot(vel, -rd);
              float doppler = 0.3 + 1.7 * smoothstep(-0.95, 0.95, toward);
              dc *= mix(vec3(1.15, 0.78, 0.6), vec3(0.92, 0.98, 1.12), smoothstep(-0.6, 0.6, toward));
              col = mix(col, col * 0.25 + dc * doppler * 1.3 * uDisk, a * 0.94);
            }
          }
        }

        // photon ring and the shadow itself
        // the photon ring: a thin, sharp rim of light just outside the shadow
        col += vec3(1.0, 0.9, 0.75) * gauss((x - 1.035) * 34.0) * 3.4 * uDisk;
        col += vec3(1.0, 0.78, 0.5) * gauss((x - 1.07) * 11.0) * 0.4 * uDisk;
        col *= smoothstep(0.97, 1.01, x);

        float alpha = 1.0 - smoothstep(6.0, 9.0, x);
        gl_FragColor = vec4(col * uIntensity, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -6;
  const _v = new THREE.Vector3();
  return {
    object: mesh,
    uniforms,
    get position() { return uniforms.uCenter.value; },
    update(time) { uniforms.uTime.value = time; },
    blocksRay(origin, dir) {
      if (!mesh.visible) return false;
      _v.copy(uniforms.uCenter.value).sub(origin);
      const tca = _v.dot(dir);
      return tca > 0 && _v.lengthSq() - tca * tca < radius * radius * 2.2;
    },
  };
}
