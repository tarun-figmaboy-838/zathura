import * as THREE from 'three';
import { SIMPLEX3 } from '../shaders/noise.js';

// Procedural nebula, baked once into an HDR cube map. The same cube map becomes the
// scene background AND (through PMREM) the image-based lighting for every PBR material,
// so the hull picks up nebula colours in its reflections.
const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  varying vec3 vDir;
  ${SIMPLEX3}
  void main() {
    vec3 d = normalize(vDir);
    vec3 q = vec3(fbm(d * 1.6), fbm(d * 1.6 + vec3(5.2, 1.3, 2.8)), fbm(d * 1.6 + vec3(1.7, 9.2, 3.4)));
    float n  = fbm(d * 2.2 + q * 1.8) * 0.5 + 0.5;
    float n2 = fbm(d * 4.5 - q * 1.2 + 3.0) * 0.5 + 0.5;

    vec3 bandAxis = normalize(vec3(0.25, 1.0, 0.35));
    float b = dot(d, bandAxis);
    float band = exp(-b * b * 5.0);

    float neb = smoothstep(0.3, 0.9, n) * (0.3 + 1.05 * band);
    vec3 cDeep = vec3(0.02, 0.1, 0.42);
    vec3 cMag  = vec3(0.62, 0.05, 0.55);
    vec3 cWarm = vec3(1.0, 0.5, 0.12);
    vec3 cTeal = vec3(0.02, 0.6, 0.62);
    vec3 col = mix(cDeep, cMag, smoothstep(0.35, 0.7, n2));
    col = mix(col, cTeal, smoothstep(0.55, 0.85, fbm(d * 3.0 + q * 2.0 + 9.0) * 0.5 + 0.5) * 0.75);
    col = mix(col, cWarm, smoothstep(0.6, 0.95, n * n2 * 1.7) * 0.9);
    vec3 c = col * neb * 1.1;

    float fil = pow(1.0 - abs(fbm(d * 6.0 + q * 3.0)), 9.0);
    c += col * fil * neb * 2.3;

    float dust = smoothstep(0.05, 0.5, fbm(d * 5.0 + q * 2.5 + 7.0));
    c *= 1.0 - dust * 0.8 * band;

    // unresolved star haze along the galactic band
    float haze = pow(max(snoise(d * 90.0) * 0.5 + 0.5, 0.0), 10.0);
    c += vec3(0.75, 0.8, 1.0) * haze * (0.04 + band * 0.25);
    c += vec3(0.6, 0.7, 1.0) * band * 0.012;
    c += vec3(0.003, 0.004, 0.009);

    float sd = max(dot(d, uSunDir), 0.0);
    c += vec3(1.0, 0.62, 0.32) * pow(sd, 6.0) * 0.10 + vec3(1.0, 0.85, 0.6) * pow(sd, 90.0) * 0.6;
    gl_FragColor = vec4(c, 1.0);
  }`;

export function createSky(renderer, scene, sunDir) {
  const bakeScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSunDir: { value: sunDir } },
    vertexShader,
    fragmentShader,
  });
  bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 96, 48), mat));

  const rt = new THREE.WebGLCubeRenderTarget(1536, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCam = new THREE.CubeCamera(1, 1000, rt);
  cubeCam.update(renderer, bakeScene);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(rt.texture).texture;
  pmrem.dispose();
  mat.dispose();

  scene.background = rt.texture;
  scene.environment = env;
  scene.environmentIntensity = 1.6;
  scene.backgroundIntensity = 1.0;
  return { cube: rt.texture, env };
}
