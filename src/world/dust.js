import * as THREE from 'three';

// Drifting space dust around the camera, drawn as line segments stretched along the
// ship's velocity: the main cue for speed in empty space.
export function createDust(count = 650, size = 240) {
  const pos = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size, y = Math.random() * size, z = Math.random() * size, s = Math.random();
    pos.set([x, y, z, x, y, z], i * 6);
    end[i * 2] = 0; end[i * 2 + 1] = 1;
    seed[i * 2] = seed[i * 2 + 1] = s;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uSize: { value: size } },
    vertexShader: /* glsl */ `
      attribute float aEnd; attribute float aSeed;
      uniform vec3 uCam, uVel; uniform float uSize;
      varying float vAlpha;
      void main() {
        vec3 p = mod(position - uCam, uSize) - uSize * 0.5 + uCam;
        float d = length(p - uCam);
        float speed = length(uVel);
        vAlpha = smoothstep(uSize * 0.5, uSize * 0.2, d) * smoothstep(2.0, 10.0, d) * (0.25 + 0.75 * aSeed)
               * (0.35 + smoothstep(5.0, 80.0, speed) * 0.9);
        vec3 streak = uVel * 0.045 + normalize(uVel + vec3(0.0001, 0.0002, 0.0)) * 0.12;
        p -= streak * aEnd;
        vAlpha *= mix(1.0, 0.0, aEnd * 0.85);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() { gl_FragColor = vec4(vec3(0.65, 0.8, 1.0), vAlpha * 0.8); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return {
    object: lines,
    update(camera, velocity) {
      mat.uniforms.uCam.value.copy(camera.position);
      mat.uniforms.uVel.value.copy(velocity);
    },
  };
}
