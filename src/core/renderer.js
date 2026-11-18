import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.75);

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// Display-space lens effects: anamorphic sun streak, ghosts, chromatic aberration,
// vignette, grain and a full-screen flash for big hits.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uAberration: { value: 0.0018 },
    uGrain: { value: 0.03 },
    uFlash: { value: 0 },
    uDamage: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uSunVis, uAberration, uGrain, uFlash, uDamage;
    uniform vec2 uSun;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float ghost(vec2 uv, vec2 c, float r) {
      vec2 d = (uv - c) * vec2(uAspect, 1.0);
      float l = length(d);
      return smoothstep(r, r * 0.55, l) * (0.6 + 0.4 * smoothstep(r * 0.4, r, l));
    }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);

      if (uSunVis > 0.001) {
        vec2 sd = (vUv - uSun) * vec2(uAspect, 1.0);
        float streak = exp(-abs(sd.y) * 180.0) * exp(-abs(sd.x) * 2.2);
        col += vec3(1.0, 0.72, 0.45) * streak * 0.35 * uSunVis;
        vec2 axis = uSun - 0.5;
        col += vec3(0.30, 0.55, 1.00) * ghost(vUv, 0.5 - axis * 0.45, 0.05) * 0.10 * uSunVis;
        col += vec3(1.00, 0.55, 0.25) * ghost(vUv, 0.5 - axis * 0.9, 0.11) * 0.06 * uSunVis;
        col += vec3(0.55, 1.00, 0.70) * ghost(vUv, 0.5 + axis * 0.25, 0.025) * 0.12 * uSunVis;
        col += vec3(0.80, 0.40, 1.00) * ghost(vUv, 0.5 - axis * 1.35, 0.18) * 0.035 * uSunVis;
      }

      float vig = 1.0 - smoothstep(0.18, 0.75, r2 * 1.7);
      col *= mix(0.5, 1.0, vig);
      col += (hash(vUv * 1000.0 + fract(uTime * 7.0) * 100.0) - 0.5) * uGrain;
      float edgeMask = smoothstep(0.12, 0.62, r2 * 1.7);
      col = mix(col, col * vec3(1.3, 0.35, 0.3) + vec3(0.22, 0.0, 0.0), clamp(edgeMask * uDamage, 0.0, 0.85));
      col += uFlash * vec3(1.0, 0.85, 0.7);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(PIXEL_RATIO);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.55, 1.25);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    lens.uniforms.uAspect.value = w / h;
  };
  window.addEventListener('resize', resize);
  resize();
  return { composer, bloom, lens };
}
