import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';

const _f = new THREE.Vector3();

// The ride through a black hole or a portal: a tunnel of swirling energy rings, light streaks and
// sparks rushing past, with a glowing far end. It is a camera-facing sheet placed just behind the
// ship, so the ship itself stays in front of it and is seen flying through.
//   warm: 1 = black hole (cyan walls, red-orange rings deep inside), ~0.35 = portal (cool blue-violet)
export class Wormhole {
  constructor(scene) {
    this.u = {
      uTime: { value: 0 }, uAlpha: { value: 0 }, uSpeed: { value: 1 }, uAspect: { value: 1 },
      uWarm: { value: 1 }, uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha, uSpeed, uAspect, uWarm, uFlash;
        varying vec2 vUv;
        ${VALUE3}
        const float TAU = 6.2831853;
        void main() {
          vec2 p = vUv * vec2(uAspect, 1.0);
          vec2 c = vec2(sin(uTime * 0.9) * 0.1, cos(uTime * 0.7) * 0.07);   // the tunnel bends
          vec2 d = p - c;
          float r = max(length(d), 1e-3);
          float a = atan(d.y, d.x);
          float z = min(0.42 / r, 14.0);              // depth along the tube; the centre is far away
          float tr = uTime * uSpeed;                  // distance travelled
          float tw = a + z * 0.35 - uTime * 0.6;      // the walls twist as they go

          float deep = smoothstep(0.9, 3.2, z);                 // the rings turn warm sooner, deeper in
          vec3 col = vec3(0.006, 0.01, 0.035);                 // dark space between the rings

          // the tunnel walls: a dim swirling nebula, blue near, violet deeper in
          float n = fbm3(vec3(cos(tw) * 1.4, sin(tw) * 1.4, z * 0.8 - tr * 0.9));
          vec3 wallC = mix(vec3(0.03, 0.09, 0.3), vec3(0.14, 0.05, 0.26), deep);
          col += wallC * n * n * 0.75 * smoothstep(0.05, 0.7, r);
          // soft colour smears rushing past at the edges (magenta-red and cyan, like light at speed)
          float sl = a / TAU * 14.0;
          float sh = hash12(vec2(floor(sl), 4.2));
          float smear = smoothstep(0.55, 1.0, vnoise(vec3(floor(sl) * 1.7, z * 0.6 - tr * 2.2, 0.5)))
                      * (1.0 - smoothstep(0.15, 0.5, abs(fract(sl) - 0.5))) * smoothstep(0.45, 1.2, r);
          col += mix(vec3(0.1, 0.55, 1.0), vec3(0.95, 0.12, 0.4), step(0.6, sh)) * smear * 0.45;

          // energy rings rushing toward the viewer: cyan close by, violet then red-orange deep inside;
          // each ring is torn into wispy, swirling filaments
          float zr = z * 2.6 - tr * 3.2;                       // rings every ~0.4 of depth: they bunch up in perspective
          float k = fract(zr) - 0.5;
          float band = exp(-k * k * 60.0);
          float wisp = fbm3(vec3(cos(tw) * 2.2, sin(tw) * 2.2, floor(zr) * 3.1 + uTime * 0.35));
          float fil = vnoise(vec3(cos(tw) * 7.0, sin(tw) * 7.0, z * 4.0 - tr * 3.0));
          float hoop = band * smoothstep(0.32, 0.72, wisp) * (0.55 + 0.45 * fil);
          vec3 hoopC = mix(vec3(0.18, 0.8, 1.0), mix(vec3(0.6, 0.25, 1.0), vec3(1.0, 0.33, 0.1), uWarm), deep);
          col += hoopC * hoop * 1.15 * smoothstep(0.03, 0.12, r) * (1.0 - 0.7 * smoothstep(0.6, 1.4, r));   // near rings soften as they rush past

          // light streaks rushing outward, thin across, long along the tunnel
          float lane = a / TAU * 90.0;
          float h = hash12(vec2(floor(lane), 1.7));
          float sz = fract(z * 0.08 - tr * (0.25 + 0.3 * h) + h * 10.0);
          float across = abs(fract(lane) - 0.5);
          float streak = step(0.7, h) * smoothstep(0.0, 0.02, sz) * (1.0 - smoothstep(0.02, 0.2, sz))
                       * (1.0 - smoothstep(0.06, 0.22, across)) * smoothstep(0.1, 0.55, r);
          col += mix(vec3(0.3, 0.78, 1.0), vec3(1.0, 0.32, 0.55), smoothstep(0.75, 0.95, h)) * streak * 0.9;

          // sparks flying past: one random point per cell of the tube wall
          vec2 cell = vec2(a / TAU * 40.0, z * 1.5 - tr * 2.0);
          vec2 id = floor(cell), f = fract(cell);
          vec2 sp = vec2(hash12(id + 3.1), hash12(id + 7.7));
          vec2 dd = (f - sp) * vec2(1.0, 0.35);
          col += vec3(0.85, 0.95, 1.0) * step(0.86, hash12(id)) * exp(-dot(dd, dd) * 420.0) * 1.3 * smoothstep(0.06, 0.3, r);

          // the far end glows
          col += mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.72, 0.55), uWarm * 0.6) * exp(-r * r * 260.0) * 1.0;
          col += uFlash;
          gl_FragColor = vec4(col, uAlpha);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;       // after the sky, stars and black hole; before the ship's glow and trails
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.target = 0;
    this.left = 0;
  }

  get active() { return this.mesh.visible; }

  // warm: palette (1 black hole, ~0.35 portal); seconds: how long the ride lasts (0 = until stop())
  start(warm, seconds = 0) {
    this.u.uWarm.value = warm;
    this.u.uAlpha.value = 0;
    this.target = 1;
    this.left = seconds;
    this.mesh.visible = true;
  }

  stop() { this.target = 0; }

  update(dt, time, camera) {
    if (!this.mesh.visible) return;
    if (this.left > 0 && (this.left -= dt) <= 0) this.stop();
    const u = this.u;
    u.uTime.value = time;
    u.uAlpha.value = this.target ? Math.min(1, u.uAlpha.value + dt / 0.35) : Math.max(0, u.uAlpha.value - dt / 0.25);
    // once it is mostly opaque it writes depth, so nothing behind it (planet rings, glows drawn later)
    // can show through; the ship and its effects are in front and still draw
    this.mesh.material.depthWrite = u.uAlpha.value > 0.6;
    u.uSpeed.value = 1.6;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 3);
    if (!this.target && u.uAlpha.value <= 0) { this.mesh.visible = false; return; }
    // a sheet filling the view 45 units ahead of the camera (behind the ship, in front of the world)
    const D = 45;
    const h = 2 * D * Math.tan((camera.fov * Math.PI) / 360);
    u.uAspect.value = camera.aspect;
    camera.getWorldDirection(_f);
    this.mesh.position.copy(camera.position).addScaledVector(_f, D);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.scale.set((h * camera.aspect) / 2, h / 2, 1);
  }
}
