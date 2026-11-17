import * as THREE from 'three';
import { damp } from '../core/math.js';

const BLIPS = 12;
const RING = 12.5;   // ring radius in ship units (the ship is ~14 long)

// Holographic radar ring projected around the cannon. A bright wedge and a beam show where the
// barrels point, a hollow notch shows where they are turning to, red/gold blips mark enemy
// bearings, and every shot sends a ping out along the wedge. It brightens while firing so the
// player can read the cannon's angle at a glance.
export class Radar {
  constructor(ship) {
    this.blips = Array.from({ length: BLIPS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.uniforms = {
      uR: { value: RING },
      uYaw: { value: 0 },
      uWant: { value: 0 },
      uBase: { value: 0 },
      uActive: { value: 0 },
      uPing: { value: 0 },
      uHeat: { value: 0 },
      uLock: { value: 0 },
      uTime: { value: 0 },
      uBlips: { value: this.blips },
    };
    const geo = new THREE.PlaneGeometry(RING * 3.2, RING * 3.2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uR, uYaw, uWant, uBase, uActive, uPing, uHeat, uLock, uTime;
        uniform vec4 uBlips[${BLIPS}];
        varying vec2 vP;
        const float TAU = 6.2831853;
        float angDiff(float a, float b) { float d = a - b; return abs(atan(sin(d), cos(d))); }
        float band(float r, float a, float b, float soft) { return smoothstep(a - soft, a, r) * (1.0 - smoothstep(b, b + soft, r)); }
        void main() {
          float r = length(vP);
          if (r < 6.6 || r > uR * 1.6) discard;
          float ang = atan(-vP.x, -vP.y);   // same convention as the turret yaw: 0 = nose, + = left
          float hull = smoothstep(6.6, 7.6, r);

          // static ring, inner guide and tick marks every 15 deg (long ones every 90 deg)
          float ring = exp(-pow((r - uR) * 3.2, 2.0)) + exp(-pow((r - uR * 0.66) * 6.0, 2.0)) * 0.25;
          float seg = ang / TAU * 24.0;
          float dTick = abs(fract(seg + 0.5) - 0.5) * (TAU / 24.0) * r;
          float major = 1.0 - step(0.08, abs(fract(seg / 6.0 + 0.5) - 0.5));
          float tick = (1.0 - smoothstep(0.05, 0.14, dTick)) * band(r, uR - (major > 0.5 ? 1.9 : 0.9), uR - 0.15, 0.1);

          // cannon wedge with a sweep that fades out behind it, the firing beam and the notch
          float dA = angDiff(ang, uYaw);
          float wedge = (1.0 - smoothstep(0.03, 0.2, dA)) * smoothstep(uR * 0.6, uR, r) * (1.0 - smoothstep(uR, uR + 0.15, r));
          float sweep = exp(-dA * 7.0) * band(r, uR * 0.7, uR, 0.4) * 0.35;
          float perp = r * sin(min(dA, 1.5));
          float beam = (1.0 - smoothstep(0.05, 0.22, perp)) * step(dA, 1.0)
                     * smoothstep(uR * 0.98, uR + 0.3, r) * (1.0 - smoothstep(uR * 1.15, uR * 1.58, r));
          float notch = (1.0 - smoothstep(0.035, 0.075, dA)) * band(r, uR - 1.7, uR + 0.9, 0.2);
          float dW = angDiff(ang, uWant);
          float want = (1.0 - smoothstep(0.012, 0.035, dW)) * band(r, uR + 0.7, uR + 1.9, 0.15) * step(0.06, angDiff(uWant, uYaw));

          // ping travelling outward along the wedge on each shot
          float pr = mix(uR * 1.45, uR * 0.62, uPing);
          float ping = exp(-pow((r - pr) * 2.2, 2.0)) * (1.0 - smoothstep(0.15, 0.5, dA)) * uPing;

          // enemy blips just outside the ring
          vec3 blipCol = vec3(0.0);
          for (int i = 0; i < ${BLIPS}; i++) {
            vec4 b = uBlips[i];
            if (b.y <= 0.0) continue;
            vec2 bp = vec2(-sin(b.x), -cos(b.x)) * (uR + 1.4);
            float d = length(vP - bp);
            float pulse = 0.75 + 0.25 * sin(uTime * 8.0 + float(i));
            vec3 c = b.z > 0.5 ? vec3(1.0, 0.75, 0.2) : vec3(1.0, 0.22, 0.12);
            blipCol += c * (exp(-d * d * 2.2) * 1.6 + exp(-d * d * 0.25) * 0.25) * b.y * pulse;
          }

          vec3 cyan = vec3(0.3, 0.82, 1.0);
          vec3 aim = mix(vec3(0.8, 0.96, 1.0), vec3(1.0, 0.5, 0.12), max(uHeat * 0.8, uLock));
          float idle = 0.35 + 0.65 * uActive;
          vec3 col = cyan * (ring * 0.7 + tick * 0.8) * uBase * idle
                   + aim * (wedge * 0.55 + sweep + beam * 1.1 + notch * 1.8) * (0.25 * uBase + uActive)
                   + aim * ping * 1.4
                   + cyan * want * 1.1 * uBase
                   + blipCol * uBase;
          gl_FragColor = vec4(col * hull, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    // centred on the turret, in the ship's frame (not the banking visual), slightly below the deck
    const mount = ship.nodes.TurretMount;
    this.mesh.position.set(0, 0.15, mount ? mount.position.z : 1);
    ship.root.add(this.mesh);
    this.active = 0;
    this.base = 0;
  }

  // o: { yaw, want, firing, shot, aiming, top, heat, locked, show, time }
  update(dt, o) {
    const u = this.uniforms;
    const wantActive = o.firing ? 1 : o.aiming ? 0.6 : 0;
    // snaps on when firing starts, lingers a moment after the trigger is released
    this.active = wantActive > this.active ? damp(this.active, wantActive, 18, dt) : damp(this.active, wantActive, 2.2, dt);
    const wantBase = !o.show ? 0 : o.top ? 1 : Math.min(1, this.active * 1.4);
    this.base = damp(this.base, wantBase, o.show ? 6 : 10, dt);
    u.uActive.value = this.active;
    u.uBase.value = this.base;
    u.uYaw.value = o.yaw;
    u.uWant.value = o.want;
    u.uHeat.value = o.heat;
    u.uLock.value = damp(u.uLock.value, o.locked ? 1 : 0, 8, dt);
    u.uTime.value = o.time;
    u.uPing.value = o.shot ? 1 : Math.max(0, u.uPing.value - dt * 3.2);
    this.mesh.visible = this.base > 0.004 || this.active > 0.004;
  }

  // bearings (same convention as the turret yaw) of up to 12 contacts; kind 1 = weak point
  setBlips(list) {
    for (let i = 0; i < BLIPS; i++) {
      const b = list[i];
      if (b) this.blips[i].set(b.angle, b.strength, b.kind, 0);
      else this.blips[i].y = 0;
    }
  }
}
