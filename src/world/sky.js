import * as THREE from 'three';
import { SIMPLEX3 } from '../shaders/noise.js';

// Deep space, baked once into an HDR cube map: mostly black, a dense field of point stars, a
// faint galactic band with dark dust lanes, a few small emission nebulae, and real-looking
// galaxies (an inclined Andromeda-like spiral with a companion, a face-on spiral, an edge-on
// disk, and two more below the battle plane), placed where the game's cameras look.
//
// The visible background and the image-based lighting come from two bakes of the same shader:
// the lighting bake (uEnv = 1, low resolution, then PMREM-blurred) adds a soft coloured fill so
// the hull still picks up gentle space colours now that the visible sky is dark.
const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uEnv;
  varying vec3 vDir;
  ${SIMPLEX3}

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  // one layer of point stars: a jittered point per 3D cell around the unit sphere
  vec3 starLayer(vec3 d, float scale, float density, float size, float bright) {
    vec3 cell = floor(d * scale);
    vec3 h = hash33(cell);
    if (h.x > density) return vec3(0.0);
    vec3 sp = normalize((cell + hash33(cell + 17.31)) / scale + d * 1e-4);
    float ang = length(d - sp);
    float b = bright * (0.12 + 7.0 * pow(clamp(h.y, 0.0, 1.0), 7.0));            // many faint, a few brilliant
    float ka = ang / size;
    float core = exp(-ka * ka);
    float glow = exp(-ang / (size * 3.5)) * 0.06 * smoothstep(0.85, 1.0, h.y);
    vec3 tint = mix(vec3(1.0, 0.74, 0.52), vec3(0.68, 0.8, 1.0), h.z);   // warm to blue-white
    return mix(tint, vec3(1.0), 0.45) * (core + glow) * b;
  }

  // gnomonic projection of d onto the sky plane around c, in units of the angular radius R,
  // rotated by rot: x along the major axis
  vec2 skyPlane(vec3 d, vec3 c, float R, float rot, out float cd) {
    cd = dot(d, c);
    vec3 up = abs(c.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(cross(up, c));
    vec3 v = cross(c, u);
    vec3 p = d / max(cd, 1e-3) - c;
    vec2 q = vec2(dot(p, u), dot(p, v)) / tan(R);
    float cr = cos(rot), sr = sin(rot);
    return vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  }

  // spiral galaxy: axis = minor/major ratio (1 = face-on), twist = arm winding
  vec3 spiral(vec3 d, vec3 c, float R, float axis, float rot, float twist, vec3 coreCol, vec3 armCol, vec3 knotCol, float seed) {
    float cd;
    if (dot(d, c) < cos(R * 1.45)) return vec3(0.0);
    vec2 q = skyPlane(d, c, R, rot, cd);
    vec2 g = vec2(q.x, q.y / axis);                    // de-projected disk
    float r = length(g);
    if (r > 1.6) return vec3(0.0);
    float a = atan(g.y, g.x);
    float wind = 2.0 * (a - log(r + 0.015) * twist) + seed;
    float arm = pow(clamp(0.5 + 0.5 * cos(wind), 0.0, 1.0), 2.5);
    float n = fbm(vec3(g * 5.0, seed)) * 0.5 + 0.5;
    float n2 = fbm(vec3(g * 20.0, seed + 5.0)) * 0.5 + 0.5;
    float disk = exp(-r / 0.36) * (1.0 - smoothstep(0.8, 1.2, r));
    float inner = smoothstep(0.05, 0.22, r);
    float arms = mix(0.22, 1.0, arm * (0.5 + 0.75 * n));
    // dust lanes trail the arms; on an inclined disk the near side is darker
    float dust = pow(clamp(0.5 + 0.5 * cos(wind + 0.6), 0.0, 1.0), 7.0) * inner * (1.0 - smoothstep(0.55, 1.0, r)) * (0.5 + 0.5 * n2);
    dust *= mix(1.0, 1.0 + 0.8 * (1.0 - smoothstep(-0.4, 0.0, q.y)), 1.0 - axis);
    float rq = length(q);
    float b1 = rq / 0.065, b2 = rq / 0.2;
    float bulge = exp(-b1 * b1) * 2.4 + exp(-b2 * b2) * 0.5;
    vec3 col = armCol * disk * arms * 1.5 + coreCol * bulge;
    col *= 1.0 - clamp(dust * 0.8, 0.0, 0.85) * smoothstep(0.0, 0.4, disk * 3.0) * (1.0 - smoothstep(0.6, 2.0, bulge));
    col += knotCol * smoothstep(0.7, 0.9, n2) * arm * inner * disk * 3.2;      // star-forming knots
    col += armCol * 0.045 * exp(-r / 0.6) * (1.0 - smoothstep(0.9, 1.5, r));   // faint outer halo
    return col;
  }

  // edge-on disk galaxy with a bright bulge and a dark central dust lane
  vec3 edgeOn(vec3 d, vec3 c, float R, float rot, vec3 coreCol, vec3 diskCol, float seed) {
    float cd;
    if (dot(d, c) < cos(R * 1.3)) return vec3(0.0);
    vec2 q = skyPlane(d, c, R, rot, cd);
    float n = fbm(vec3(q * 12.0, seed)) * 0.5 + 0.5;
    float hy = q.y / 0.055, ly = q.y / 0.016;
    float disk = exp(-abs(q.x) / 0.33) * exp(-hy * hy) * (1.0 - smoothstep(0.8, 1.1, abs(q.x)));
    float bulge = exp(-length(q * vec2(1.0, 1.5)) / 0.085) * 1.7;
    float lane = 1.0 - 0.88 * exp(-ly * ly) * (1.0 - smoothstep(0.1, 0.95, abs(q.x))) * (0.7 + 0.3 * n);
    vec3 col = (diskCol * disk * (0.6 + 0.7 * n) + coreCol * bulge) * lane;
    col += diskCol * 0.05 * exp(-length(q / vec2(0.8, 0.22)));
    return col;
  }

  // smooth elliptical galaxy (a companion)
  vec3 elliptical(vec3 d, vec3 c, float R, float axis, float rot, vec3 col0) {
    float cd;
    if (dot(d, c) < cos(R * 1.4)) return vec3(0.0);
    vec2 q = skyPlane(d, c, R, rot, cd);
    float r = length(vec2(q.x, q.y / axis));
    return col0 * (exp(-r / 0.11) * 1.3 + exp(-r / 0.35) * 0.18) * (1.0 - smoothstep(0.85, 1.35, r));
  }

  // small, faint emission nebula: rose hydrogen glow edged with blue
  vec3 nebula(vec3 d, vec3 c, float R, vec3 colA, vec3 colB, float seed) {
    float cd = dot(d, c);
    if (cd < cos(R)) return vec3(0.0);
    float x = acos(clamp(cd, -1.0, 1.0)) / R;
    float n = fbm(d * 7.0 + seed) * 0.5 + 0.5;
    float n2 = fbm(d * 16.0 - seed) * 0.5 + 0.5;
    float m = (1.0 - smoothstep(0.25, 1.0, x)) * smoothstep(0.42, 0.78, n);
    float fil = pow(clamp(1.0 - abs(fbm(d * 11.0 + seed * 2.0)), 0.0, 1.0), 6.0);
    return mix(colA, colB, smoothstep(0.35, 0.75, n2)) * m * (0.25 + n2 + fil * 0.8);
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0012, 0.0015, 0.003);

    // faint galactic band: diffuse glow, dark dust rifts, and denser stars
    vec3 bandAxis = normalize(vec3(0.25, 1.0, 0.35));
    float bb = dot(d, bandAxis);
    float band = exp(-bb * bb * 16.0);
    float cl = fbm(d * 2.6) * 0.5 + 0.5;
    float rift = smoothstep(0.48, 0.78, fbm(d * 5.5 + 4.0) * 0.5 + 0.5);
    col += mix(vec3(0.15, 0.12, 0.11), vec3(0.08, 0.1, 0.17), cl) * band * (0.35 + 0.8 * cl) * (1.0 - rift * 0.8) * 0.3;

    // a couple of small nebulae
    col += nebula(d, normalize(vec3(0.62, 0.32, -0.72)), 0.16, vec3(0.95, 0.14, 0.32), vec3(0.25, 0.4, 1.0), 3.0) * 0.16;
    col += nebula(d, normalize(vec3(-0.78, -0.28, 0.45)), 0.2, vec3(0.85, 0.2, 0.6), vec3(0.2, 0.55, 1.0), 9.0) * 0.12;

    // galaxies
    col += spiral(d, normalize(vec3(-0.5, 0.15, -0.86)), 0.3, 0.34, 0.62, 2.4,
      vec3(1.0, 0.82, 0.6), vec3(0.6, 0.72, 1.0), vec3(1.0, 0.42, 0.72), 1.0) * 0.75;           // inclined hero spiral
    col += elliptical(d, normalize(vec3(-0.42, 0.04, -0.91)), 0.028, 0.75, 0.4, vec3(1.0, 0.9, 0.76)) * 0.55;   // companion
    col += spiral(d, normalize(vec3(0.42, 0.4, -0.82)), 0.1, 0.9, 2.0, 2.9,
      vec3(1.0, 0.78, 0.9), vec3(0.75, 0.58, 1.0), vec3(1.0, 0.4, 0.9), 7.0) * 0.6;              // face-on, violet
    col += edgeOn(d, normalize(vec3(-0.24, -0.2, -0.95)), 0.12, -0.28, vec3(1.0, 0.88, 0.7), vec3(0.75, 0.8, 1.0), 4.0) * 0.55;
    col += spiral(d, normalize(vec3(0.38, -0.9, -0.2)), 0.22, 0.72, 1.1, 2.6,
      vec3(1.0, 0.84, 0.68), vec3(0.6, 0.74, 1.0), vec3(0.9, 0.5, 1.0), 12.0) * 0.42;           // below the battles
    col += spiral(d, normalize(vec3(-0.52, -0.8, 0.3)), 0.13, 0.5, -0.7, 2.2,
      vec3(1.0, 0.7, 0.85), vec3(0.85, 0.55, 1.0), vec3(1.0, 0.35, 0.7), 21.0) * 0.48;

    // stars: dense faint field (thicker in the band), mid layer, and sparse bright ones
    col += starLayer(d, 260.0, 0.05 + 0.2 * band, 0.00085, 0.45);
    col += starLayer(d, 95.0, 0.06, 0.0012, 0.9);
    col += starLayer(d, 38.0, 0.035, 0.0017, 2.0);

    // the sun's glow
    float sd = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.62, 0.32) * pow(sd, 8.0) * 0.06 + vec3(1.0, 0.85, 0.6) * pow(sd, 90.0) * 0.5;

    // lighting bake only: a soft coloured fill (cool above, violet below, warm toward the sun)
    if (uEnv > 0.5) {
      col += mix(vec3(0.07, 0.045, 0.11), vec3(0.06, 0.1, 0.18), d.y * 0.5 + 0.5) + vec3(1.0, 0.62, 0.36) * pow(sd, 3.0) * 0.18;
    }
    // never let a NaN reach the cube map: the bloom pass would spread it over the whole screen
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

export function createSky(renderer, scene, sunDir) {
  const bakeScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSunDir: { value: sunDir }, uEnv: { value: 0 } },
    vertexShader,
    fragmentShader,
  });
  bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 96, 48), mat));

  // visible sky: sharp enough for single-pixel stars
  const rt = new THREE.WebGLCubeRenderTarget(1536, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  new THREE.CubeCamera(1, 1000, rt).update(renderer, bakeScene);

  // lighting: small bake with the soft fill, blurred by PMREM
  mat.uniforms.uEnv.value = 1;
  const rtEnv = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(1, 1000, rtEnv).update(renderer, bakeScene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(rtEnv.texture).texture;
  pmrem.dispose();
  rtEnv.dispose();
  mat.dispose();

  scene.background = rt.texture;
  scene.environment = env;
  scene.environmentIntensity = 1.6;
  scene.backgroundIntensity = 1.0;
  return { cube: rt.texture, env };
}
