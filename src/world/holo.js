import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// ------------------------------------------------------------------ target rings
// Flat holographic rings drawn under enemies in the top-view battles, with an arc showing the
// remaining health. They replace the floating health bars.
export class TargetRings {
  constructor(scene, capacity = 16) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.hp = new Float32Array(capacity);
    this.kind = new Float32Array(capacity);
    geo.setAttribute('aHp', new THREE.InstancedBufferAttribute(this.hp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aHp; attribute float aKind;
        varying vec2 vP; varying float vHp; varying float vKind;
        void main() {
          vP = position.xz; vHp = aHp; vKind = aKind;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vP; varying float vHp; varying float vKind;
        const float TAU = 6.2831853;
        // lock-on bracket: four corner marks that slowly turn and breathe
        void main() {
          float pulse = 0.92 + 0.08 * sin(uTime * 4.0);
          float c = cos(uTime * 0.6), s = sin(uTime * 0.6);
          vec2 p = vec2(c * vP.x - s * vP.y, s * vP.x + c * vP.y) / pulse;
          vec2 q = abs(p);
          float edge = 1.0 - smoothstep(0.035, 0.075, abs(max(q.x, q.y) - 0.82));   // the square's outline
          float arms = edge * smoothstep(0.46, 0.5, min(q.x, q.y));                   // keep only the corners
          vec3 col = vKind > 1.5 ? vec3(1.0, 0.85, 0.3) : vKind > 0.5 ? vec3(1.0, 0.72, 0.2) : vec3(1.0, 0.3, 0.18);
          gl_FragColor = vec4(col * arms * 1.6, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin(time) { this.n = 0; this.uniforms.uTime.value = time; }

  add(pos, radius, hp, kind = 0) {
    if (this.n >= this.capacity) return;
    _m.compose(_p.copy(pos), _q.identity(), _s.set(radius, 1, radius));
    this.mesh.setMatrixAt(this.n, _m);
    this.hp[this.n] = Math.max(0, Math.min(1, hp));
    this.kind[this.n] = kind;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aHp.needsUpdate = true;
    this.mesh.geometry.attributes.aKind.needsUpdate = true;
  }
}
