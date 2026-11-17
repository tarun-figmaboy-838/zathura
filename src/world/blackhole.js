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

      // swirling plasma at disk radius r (in horizon radii) and azimuth phi
      vec3 diskColor(float r, float phi, out float a) {
        float spin = phi + uTime * 2.4 / (r * sqrt(r));
        vec3 q = vec3(cos(spin) * r * 1.6, sin(spin) * r * 1.6, r * 2.3);
        float n = fbm3(q * 1.3) * 0.7 + vnoise(q * 4.0) * 0.3;
        float streak = 0.55 + 0.45 * sin(r * 11.0 - spin * 3.0 + n * 6.0);
        vec3 hot = vec3(1.0, 0.96, 0.88);
        vec3 gold = vec3(1.0, 0.55, 0.12);
        vec3 rose = vec3(0.95, 0.18, 0.55);
        vec3 violet = vec3(0.35, 0.2, 1.0);
        vec3 col = mix(hot, gold, smoothstep(1.7, 2.6, r));
        col = mix(col, rose, smoothstep(2.8, 4.3, r));
        col = mix(col, violet, smoothstep(4.4, 6.3, r));
        a = smoothstep(1.55, 1.9, r) * (1.0 - smoothstep(5.2, 6.8, r));
        return col * (0.35 + 1.3 * n * streak) * (3.2 / pow(r, 1.15));
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

        // lensed far side of the disk, bent up and over the shadow
        float side = dot(perp, nScreen);
        float arcBand = smoothstep(1.02, 1.15, x) * (1.0 - smoothstep(1.3, 2.6, x));
        if (arcBand > 0.0) {
          float ang = atan(dot(perp, cross(c, nScreen)), side);
          float a2;
          vec3 arc = diskColor(1.75 + (x - 1.05) * 2.6, ang * 1.2 + 3.14159, a2);
          col += arc * arcBand * a2 * (0.45 + 0.75 * smoothstep(-0.3, 0.8, side)) * uDisk;
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
              vec3 vel = normalize(cross(N, P));
              float doppler = 0.55 + 0.9 * max(0.0, dot(vel, -rd) * 0.5 + 0.5);
              col = mix(col, col * 0.3 + dc * doppler * 1.4 * uDisk, a * 0.92);
            }
          }
        }

        // photon ring and the shadow itself
        col += vec3(1.0, 0.85, 0.65) * exp(-pow((x - 1.04) * 26.0, 2.0)) * 3.0 * uDisk;
        col += vec3(0.6, 0.4, 1.0) * exp(-pow((x - 1.1) * 7.0, 2.0)) * 0.35 * uDisk;
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
