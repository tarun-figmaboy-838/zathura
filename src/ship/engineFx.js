import * as THREE from 'three';

// Additive, fresnel-softened exhaust plumes with shock diamonds, attached to each
// EngineGlow node from the Blender rig, plus a cyan light that washes the rear hull.
export class EngineFX {
  constructor(ship, scene) {
    this.ship = ship;
    this.uniforms = { uTime: { value: 0 }, uThrottle: { value: 0 }, uBoost: { value: 0 }, uRed: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vPos; varying vec3 vN; varying vec3 vView;
        void main() {
          vPos = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          vN = normalMatrix * normal;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uThrottle, uBoost, uRed;
        varying vec3 vPos; varying vec3 vN; varying vec3 vView;
        void main() {
          float t = clamp(vPos.z, 0.0, 1.0);
          float fres = abs(dot(normalize(vN), normalize(vView)));
          float core = pow(fres, 2.2);
          float flick = 0.85 + 0.15 * sin(uTime * 61.0 + vPos.z * 9.0);
          float diamonds = 0.75 + 0.25 * sin(t * 38.0 - uTime * 24.0);
          float a = pow(1.0 - t, 1.6) * core * flick * mix(1.0, diamonds, uBoost);
          vec3 hot = vec3(1.0, 0.95, 0.9);
          vec3 cold = mix(vec3(0.25, 0.6, 1.0), vec3(0.6, 0.35, 1.0), uBoost);
          vec3 col = mix(hot, cold, smoothstep(0.0, 0.3, t));
          col = mix(col, vec3(0.9, 0.08, 0.02), uRed);
          gl_FragColor = vec4(col * (0.5 + 2.2 * uThrottle + 2.5 * uBoost), a * (0.55 + 0.45 * uThrottle) * (1.0 - uRed));
        }`,
    });

    this.plumes = [];
    for (const name of ['EngineGlow_L', 'EngineGlow_R', 'EngineGlow_C']) {
      const node = ship.nodes[name];
      if (!node) continue;
      const r = name.endsWith('C') ? 0.55 : 0.44;
      const geo = new THREE.CylinderGeometry(r * 0.15, r, 1, 28, 1, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const plume = new THREE.Mesh(geo, mat);
      plume.castShadow = false;
      plume.renderOrder = 2;
      plume.position.z = 0.02;
      node.add(plume);
      this.plumes.push(plume);
    }

    this.light = new THREE.PointLight(0x66ccff, 0, 30, 2);
    this.light.position.set(0, 0.6, 12);
    ship.visual.add(this.light);
  }

  update(dt, time) {
    const s = this.ship;
    this.uniforms.uTime.value = time;
    this.uniforms.uThrottle.value = s.thrust;
    this.uniforms.uBoost.value = s.boost;
    this.uniforms.uRed.value = s.redshift;
    const len = 1.6 + s.thrust * 5 + s.boost * 7; // long hot boost plumes: the look we're keeping
    for (const p of this.plumes) p.scale.set(1, 1, len * (0.95 + Math.random() * 0.1));
    this.light.intensity = (3 + s.thrust * 22 + s.boost * 30) * (1 - s.redshift);
  }
}
