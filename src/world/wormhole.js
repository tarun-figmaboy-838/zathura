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
      uWarm: { value: 1 }, uFlash: { value: 0 }, uReveal: { value: 1 }, uHeat: { value: 0 },
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
        uniform float uTime, uAlpha, uSpeed, uAspect, uWarm, uFlash, uReveal, uHeat;
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
          float deep = smoothstep(0.9, 3.2, z);
          float nearFade = 1.0 - 0.65 * smoothstep(0.6, 1.5, r);   // gas right beside us is a soft blur

          // swirling gas, domain-warped so it tears into wisps and filaments (not graphic hoops)
          vec3 q = vec3(cos(tw) * 1.6, sin(tw) * 1.6, z * 1.1 - tr * 1.2);
          vec3 w = vec3(fbm3(q), fbm3(q + vec3(5.2, 1.3, 2.7)), 0.0);
          float gas = fbm3(q * 1.25 + w * 2.4);
          float wisp = fbm3(vec3(cos(tw * 2.0) * 2.6, sin(tw * 2.0) * 2.6, z * 2.3 - tr * 2.2) + w * 1.6);

          // energy rings: depth bands bent and broken by the gas, so each is an uneven, glowing shell
          float zr = z * 2.4 - tr * 3.0 + (gas - 0.5) * 2.2;
          float k = fract(zr) - 0.5;
          float shell = exp(-k * k * 22.0) * smoothstep(0.3, 0.75, wisp);
          float core = exp(-k * k * 120.0) * smoothstep(0.45, 0.8, wisp);   // a hotter thin seam inside each shell

          vec3 cool = mix(vec3(0.1, 0.62, 1.0), vec3(0.18, 0.3, 0.95), smoothstep(0.35, 0.75, gas));
          vec3 hot = mix(vec3(0.62, 0.25, 1.0), vec3(1.0, 0.32, 0.1), uWarm);
          vec3 ringC = mix(cool, hot, deep);
          ringC = mix(ringC, mix(vec3(1.0, 0.74, 0.34), vec3(1.0, 0.42, 0.12), deep), uHeat);   // straight out of the hole: the disk's gold

          vec3 col = vec3(0.004, 0.007, 0.026);                                  // the dark of the tube
          vec3 neb = mix(vec3(0.03, 0.1, 0.32), vec3(0.18, 0.05, 0.28), deep);
          col += neb * gas * gas * 1.4 * smoothstep(0.04, 0.6, r);                // dim nebula on the walls
          col += ringC * (shell * 0.75 + core * 0.9) * smoothstep(0.03, 0.12, r) * nearFade;
          col += vec3(0.85, 0.95, 1.0) * core * wisp * 0.25 * smoothstep(0.05, 0.25, r) * nearFade;

          // magenta-red and cyan smears of light at the edges (light stretched by the speed)
          float sl = a / TAU * 14.0;
          float sh = hash12(vec2(floor(sl), 4.2));
          float smear = smoothstep(0.55, 1.0, vnoise(vec3(floor(sl) * 1.7, z * 0.6 - tr * 2.2, 0.5)))
                      * (1.0 - smoothstep(0.1, 0.5, abs(fract(sl) - 0.5))) * smoothstep(0.45, 1.2, r);
          col += mix(vec3(0.1, 0.55, 1.0), vec3(0.95, 0.12, 0.4), step(0.6, sh)) * smear * 0.4;

          // light streaks: two layers of lanes, varied in length and brightness, soft across
          for (int i = 0; i < 2; i++) {
            float fi = float(i);
            float lane = a / TAU * (70.0 + fi * 47.0);
            float h = hash12(vec2(floor(lane), 1.7 + fi * 9.1));
            float sz = fract(z * (0.06 + fi * 0.05) - tr * (0.22 + 0.35 * h) + h * 10.0);
            float len = 0.08 + 0.25 * hash12(vec2(floor(lane), 3.3 + fi));
            float streak = step(0.74, h) * smoothstep(0.0, 0.015, sz) * (1.0 - smoothstep(len * 0.3, len, sz))
                         * (1.0 - smoothstep(0.04, 0.3, abs(fract(lane) - 0.5))) * smoothstep(0.08, 0.5, r);
            col += mix(vec3(0.45, 0.82, 1.0), vec3(1.0, 0.4, 0.62), smoothstep(0.8, 0.97, h)) * streak * (0.5 + 0.5 * h);
          }

          // dust and sparks flying past, motion-blurred along the tunnel
          vec2 cell = vec2(a / TAU * 46.0, z * 1.4 - tr * 2.2);
          vec2 id = floor(cell), f = fract(cell);
          vec2 sp = vec2(hash12(id + 3.1), hash12(id + 7.7));
          vec2 dd = (f - sp) * vec2(1.0, 0.16);
          col += vec3(0.85, 0.95, 1.0) * step(0.83, hash12(id)) * exp(-dot(dd, dd) * 900.0) * 1.2 * smoothstep(0.06, 0.3, r);
          vec2 cell2 = vec2(a / TAU * 140.0, z * 5.0 - tr * 5.0);              // fine stars in the walls
          vec2 id2 = floor(cell2), f2 = fract(cell2) - 0.5;
          col += vec3(0.7, 0.85, 1.0) * step(0.9, hash12(id2)) * exp(-dot(f2, f2) * 60.0) * 0.35 * smoothstep(0.05, 0.4, r);

          // the far end glows
          col += mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.72, 0.55), uWarm * 0.6) * exp(-r * r * 260.0) * 1.0;
          col += uFlash;
          // opening from the centre: outside the opening it is the black of the hole, not the sky
          float open = 1.0 - smoothstep(uReveal * 2.4 - 0.35, uReveal * 2.4, r);
          gl_FragColor = vec4(col * open, uAlpha);
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
  // reveal: seconds to open from the centre of the screen (0 = fade in); heat: 1 = first rings in
  // the black hole's gold, cooling over the first moments of the ride
  start(warm, seconds = 0, { reveal = 0, heat = 0 } = {}) {
    const u = this.u;
    u.uWarm.value = warm;
    u.uAlpha.value = reveal ? 1 : 0;
    u.uReveal.value = reveal ? 0 : 1;
    u.uHeat.value = heat;
    this.reveal = reveal;
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
    if (this.reveal) u.uReveal.value = Math.min(1, u.uReveal.value + dt / this.reveal);
    u.uHeat.value = Math.max(0, u.uHeat.value - dt / 1.4);
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
