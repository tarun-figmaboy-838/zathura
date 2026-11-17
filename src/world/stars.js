import * as THREE from 'three';
import { rng } from '../core/math.js';
import { PIXEL_RATIO } from '../core/renderer.js';

// Point stars on a huge sphere that follows the camera (parallax-free, like the skybox),
// with black-body tints, a power-law brightness spread and subtle twinkle.
export function createStars(count = 9000, radius = 18000) {
  const r = rng(1337);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const band = new THREE.Vector3(0.25, 1.0, 0.35).normalize();
  const tints = [
    new THREE.Color(0.62, 0.72, 1.0), new THREE.Color(0.85, 0.9, 1.0), new THREE.Color(1.0, 1.0, 1.0),
    new THREE.Color(1.0, 0.92, 0.78), new THREE.Color(1.0, 0.75, 0.5),
  ];
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // half the stars hug the galactic band
    for (;;) {
      v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      const l = v.length();
      if (l > 0.001 && l <= 1) { v.divideScalar(l); break; }
    }
    if (i % 2 === 0) {
      const b = v.dot(band);
      v.addScaledVector(band, -b * 0.85).normalize();
    }
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const bright = Math.pow(r(), 9) * 7 + 0.35 + r() * 0.4;
    const t = tints[Math.floor(r() * tints.length)];
    col.set([t.r * bright, t.g * bright, t.b * bright], i * 3);
    size[i] = 1.2 + Math.pow(r(), 6) * 3.2;
    phase[i] = r() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: PIXEL_RATIO } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute float aPhase;
      uniform float uTime, uPR;
      varying vec3 vColor;
      void main() {
        float tw = 0.8 + 0.2 * sin(uTime * (1.5 + fract(aPhase) * 3.0) + aPhase);
        vColor = aColor * tw;
        gl_PointSize = aSize * uPR;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a = a * a;
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return {
    object: points,
    update(camera, time) {
      points.position.copy(camera.position);
      mat.uniforms.uTime.value = time;
    },
  };
}
