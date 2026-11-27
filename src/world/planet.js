import * as THREE from 'three';
import { SIMPLEX3 } from '../shaders/noise.js';

const RING_DENSITY = /* glsl */ `
  float ringDensity(float r) {            // r in planet radii
    if (r < 1.32 || r > 2.35) return 0.0;
    float x = (r - 1.32) / (2.35 - 1.32);
    float d = 0.55 + 0.25 * sin(x * 90.0) + 0.15 * sin(x * 233.0 + 1.3) + 0.1 * sin(x * 517.0);
    d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.92, x);
    d *= 1.0 - 0.9 * smoothstep(0.015, 0.0, abs(x - 0.62));
    d *= 1.0 - 0.5 * smoothstep(0.03, 0.0, abs(x - 0.3));
    return clamp(d, 0.0, 1.0);
  }`;

const C = (r, g, b) => new THREE.Vector3(r, g, b);

// Realistic presets: 0 banded gas giant, 1 ocean world, 2 cracked ice moon, 3 rust desert world.
// atmoK is how much sunlit limb haze the world has (0 = airless).
export const PLANET_STYLES = {
  gas: { style: 0, c1: C(0.72, 0.5, 0.32), c2: C(0.4, 0.22, 0.14), c3: C(0.92, 0.84, 0.7), c4: C(0.42, 0.48, 0.58), atmo: C(1.0, 0.75, 0.5), atmoK: 0.6, rings: true },
  ocean: { style: 1, c1: C(0.13, 0.26, 0.1), c2: C(0.5, 0.42, 0.28), c3: C(0.015, 0.06, 0.2), c4: C(0.95, 0.96, 1.0), atmo: C(0.35, 0.6, 1.0), atmoK: 1.0, rings: false },
  ice: { style: 2, c1: C(0.6, 0.64, 0.68), c2: C(0.4, 0.46, 0.53), c3: C(0.32, 0.2, 0.13), c4: C(0, 0, 0), atmo: C(0.6, 0.75, 0.9), atmoK: 0.15, rings: false },
  desert: { style: 3, c1: C(0.6, 0.3, 0.15), c2: C(0.78, 0.52, 0.32), c3: C(0.2, 0.12, 0.09), c4: C(0.92, 0.92, 0.95), atmo: C(1.0, 0.65, 0.45), atmoK: 0.35, rings: false },
};

// A solid world the route flies past: sun-lit surface with a dark night side, ocean glint,
// clouds, thin day-side atmosphere and optional shadowed rings. It "fades in" by blending from
// the sky behind it (never see-through), and is only shown within ~6.5 km.
export function createPlanet(sunDir, skyCube, { position, radius = 900, preset = 'gas', tilt = [0.32, 0.4, -0.38] } = {}) {
  const P = PLANET_STYLES[preset];
  const group = new THREE.Group();
  group.position.copy(position);
  const tiltG = new THREE.Group();
  tiltG.rotation.set(...tilt);
  group.add(tiltG);

  // light each world from a direction that shows a sunlit three-quarter face to the route
  // (a point on the route ahead of the camera), biased toward the real sun
  const light = new THREE.Vector3(0, 0, position.z + 3000).sub(position).normalize().multiplyScalar(0.65)
    .addScaledVector(sunDir, 0.35).add(new THREE.Vector3(0, 0.25, 0)).normalize();
  const uniforms = {
    uSunDir: { value: light },
    uSky: { value: skyCube },
    uTime: { value: 0 },
    uCenter: { value: group.position },
    uRadius: { value: radius },
    uRingNormal: { value: new THREE.Vector3(0, 1, 0).applyQuaternion(tiltG.quaternion) },
    uRings: { value: P.rings ? 1 : 0 },
    uStyle: { value: P.style },
    uC1: { value: P.c1 }, uC2: { value: P.c2 }, uC3: { value: P.c3 }, uC4: { value: P.c4 },
    uAtmo: { value: P.atmo },
    uAtmoK: { value: P.atmoK },
    uFade: { value: 1 },
  };

  const planetMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vPosL; varying vec3 vNormalW; varying vec3 vWorld;
      void main() {
        vPosL = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform samplerCube uSky;
      uniform vec3 uSunDir, uCenter, uRingNormal, uC1, uC2, uC3, uC4, uAtmo;
      uniform float uTime, uRadius, uRings, uFade, uAtmoK;
      uniform int uStyle;
      varying vec3 vPosL; varying vec3 vNormalW; varying vec3 vWorld;
      ${SIMPLEX3}
      ${RING_DENSITY}
      void main() {
        vec3 p = normalize(vPosL);
        vec3 albedo;
        float water = 0.0, cloud = 0.0;
        if (uStyle == 0) {                                   // gas giant: turbulent bands and a storm
          float turb = fbm(p * vec3(2.5, 9.0, 2.5) + vec3(uTime * 0.004, 0.0, 0.0));
          float lat = p.y + turb * 0.06;
          albedo = mix(uC2, uC1, sin(lat * 26.0) * 0.5 + 0.5);
          albedo = mix(albedo, uC3, (sin(lat * 71.0 + turb * 6.0) * 0.5 + 0.5) * 0.35 * smoothstep(0.2, 0.6, abs(p.y)));
          albedo = mix(albedo, uC4, smoothstep(0.75, 0.95, abs(p.y)) * 0.6);
          float spot = smoothstep(0.24, 0.02, length((p - normalize(vec3(0.55, -0.32, 0.77))) * vec3(0.8, 1.6, 0.8)));
          albedo = mix(albedo, vec3(0.7, 0.3, 0.15), spot * 0.8);
        } else if (uStyle == 1) {                            // ocean world
          float land = fbm(p * 2.2 + 4.0);
          float hills = fbm(p * 8.0) * 0.5 + 0.5;
          float isLand = smoothstep(0.03, 0.06, land);
          vec3 ground = mix(uC1, uC2, clamp(smoothstep(0.08, 0.45, land) + hills * 0.25, 0.0, 1.0));
          vec3 sea = mix(uC3 * 1.8, uC3, smoothstep(-0.25, 0.03, land));
          albedo = mix(sea, ground, isLand);
          water = 1.0 - isLand;
          albedo = mix(albedo, uC4, smoothstep(0.8, 0.88, abs(p.y) + hills * 0.05));
          cloud = smoothstep(0.12, 0.6, fbm(p * 3.4 + vec3(uTime * 0.008, 0.0, 0.0))) * 0.85;
        } else if (uStyle == 2) {                            // ice moon: pale ice with dark cracks
          float n = fbm(p * 3.0);
          albedo = mix(uC2, uC1, smoothstep(-0.45, 0.45, n));
          float lineae = pow(1.0 - abs(snoise(p * 5.0)), 26.0) + pow(1.0 - abs(snoise(p * 11.0 + 3.0)), 30.0) * 0.6;
          albedo = mix(albedo, uC3, clamp(lineae, 0.0, 1.0) * 0.55);
        } else {                                             // rust desert: dunes, dark plains, canyons, polar ice
          float n = fbm(p * 2.4);
          albedo = mix(uC1, uC2, smoothstep(-0.35, 0.45, n));
          albedo = mix(albedo, uC3, smoothstep(0.2, 0.55, fbm(p * 5.0 + 3.0)) * 0.55);
          float canyon = pow(1.0 - abs(snoise(p * 3.0 + 8.0)), 40.0);
          albedo *= 1.0 - canyon * 0.5;
          albedo = mix(albedo, uC4, smoothstep(0.86, 0.93, abs(p.y) + n * 0.05));
        }

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = uSunDir;
        float ndl = dot(N, L);
        float diff = smoothstep(-0.04, 1.0, ndl) * max(ndl + 0.04, 0.0) * 1.04;
        if (uRings > 0.5) {
          float t = dot(uCenter - vWorld, uRingNormal) / dot(L, uRingNormal);
          if (t > 0.0) diff *= 1.0 - 0.75 * ringDensity(length(vWorld + L * t - uCenter) / uRadius);
        }
        vec3 col = albedo * diff * 2.3;
        // clouds sit above the surface and are brighter than the ground beneath
        col = mix(col, vec3(0.95) * diff * 2.6, cloud);
        // sun glint on open water
        vec3 H = normalize(L + V);
        col += vec3(1.0, 0.92, 0.8) * pow(max(dot(N, H), 0.0), 90.0) * water * (1.0 - cloud) * step(0.0, ndl) * 2.5;
        // thin atmosphere: only the sunlit limb scatters light, the night side stays dark
        float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        col += uAtmo * rim * smoothstep(-0.15, 0.5, ndl) * uAtmoK * 1.3;
        col += albedo * 0.006;                                 // faint nebula fill on the night side
        vec3 sky = textureCube(uSky, -V).rgb;
        gl_FragColor = vec4(mix(sky, col, uFade), 1.0);
      }`,
  });
  tiltG.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 160, 96), planetMat));

  if (P.atmoK > 0.2) {
    const atmoMat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uCenter, uAtmo; uniform float uRadius, uFade, uAtmoK;
        varying vec3 vWorld;
        void main() {
          vec3 rd = normalize(vWorld - cameraPosition);
          vec3 closest = cameraPosition + rd * dot(uCenter - cameraPosition, rd);
          float h = length(closest - uCenter);
          float x = (h - uRadius) / (uRadius * 0.045);
          if (x < 0.0) discard;
          float glow = exp(-x * 3.5) * (1.0 - smoothstep(0.8, 1.0, x));
          float light = smoothstep(-0.2, 0.7, dot(normalize(closest - uCenter), uSunDir));
          gl_FragColor = vec4(uAtmo * glow * light * uAtmoK * 1.2 * uFade, 1.0);
        }`,
    });
    tiltG.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.045, 96, 48), atmoMat));
  }

  if (P.rings) {
    const ringMat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uCenter, uRingNormal, uC3; uniform float uRadius, uFade;
        varying vec3 vWorld;
        ${RING_DENSITY}
        void main() {
          float r = length(vWorld - uCenter) / uRadius;
          float d = ringDensity(r);
          if (d <= 0.001) discard;
          vec3 oc = vWorld - uCenter;
          float b = dot(oc, uSunDir);
          float shadow = (b < 0.0 && b * b - (dot(oc, oc) - uRadius * uRadius) > 0.0) ? 0.05 : 1.0;
          float lit = 0.25 + 0.75 * abs(dot(uRingNormal, uSunDir));
          vec3 col = mix(uC3 * 0.55, uC3 * 0.9, fract(r * 37.0) * 0.5 + d * 0.5);
          gl_FragColor = vec4(col * lit * shadow * 1.4, d * 0.85 * uFade);
        }`,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.3, radius * 2.4, 256, 1), ringMat);
    ring.rotation.x = -Math.PI / 2;
    tiltG.add(ring);
  }

  const _n = new THREE.Vector3();
  const api = {
    object: group,
    radius,
    enabled: true,
    k: 1,                 // 0..1: follows `enabled` over about a second, so switching never pops
    lastT: null,
    update(camera, time) {
      uniforms.uTime.value = time;
      const dt = api.lastT === null ? 0 : Math.min(0.1, Math.max(0, time - api.lastT));
      api.lastT = time;
      api.k += ((api.enabled ? 1 : 0) - api.k) * Math.min(1, dt * 2.2);
      // only worlds within ~6.5 km ahead are shown, so the route never feels crowded
      const ahead = camera.position.z - group.position.z;
      const f = Math.min(1, Math.max(0, (6500 - ahead) / 1500)) * api.k;
      uniforms.uFade.value = f;
      group.visible = f > 0.001;
    },
    blocksRay(origin, dir) {
      if (!group.visible) return false;
      const oc = _n.copy(origin).sub(group.position);
      const b = oc.dot(dir);
      const c = oc.lengthSq() - radius * radius;
      return b < 0 && b * b - c > 0;
    },
  };
  return api;
}
