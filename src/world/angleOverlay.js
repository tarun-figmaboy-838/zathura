import * as THREE from 'three';
import { clamp } from '../core/math.js';

const _p = new THREE.Vector3();
const DIR = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// The battle radar drawn on the plane around the ship's cannon, kept deliberately clean:
//  - a see-through radar ring with tick marks and a slow sweep (nothing blocks the view)
//  - the cannon beam: a bright cyan line from the cannon to the ring, exactly where the cannon
//    points (this is the reference line); its extension through the ship is a faint dotted line
//  - the line to the enemy (warm red), with a faint dotted extension when the rule needs it
//  - the given angle (orange arc) and the asked angle "?" (white arc with a gentle ghost sweep)
//  - after an answer: a beam that turns by the picked angle and lights green (hit) or red (miss)
// Numbers are crisp HTML labels placed in world units.
export class AngleOverlay {
  constructor(scene, labelRoot) {
    this.u = {
      uRing: { value: 31 }, uTLen: { value: 27 }, uR: { value: 13 }, uMax: { value: 34 },
      uAxis: { value: 0 }, uT: { value: 0 }, uP: { value: 0 }, uHasP: { value: 0 }, uExtR: { value: 0 }, uExtT: { value: 0 },
      uKnown: { value: new THREE.Vector2() }, uUnknown: { value: new THREE.Vector2() }, uRight: { value: new THREE.Vector2() },
      uDraw: { value: 0 }, uAlpha: { value: 0 }, uSweep: { value: 0 }, uSweepA: { value: 0 }, uTime: { value: 0 },
      uAim: { value: new THREE.Vector3() }, uAimOn: { value: 0 }, uResult: { value: 0 }, uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      // drawn in the opaque pass before the ships (renderOrder -1, no depth), so ships sit on top
      transparent: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          // world-space offset from the radar centre (the mesh is scaled to fit)
          vP = (modelMatrix * vec4(position, 1.0)).xz - modelMatrix[3].xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uRing, uTLen, uR, uMax, uAxis, uT, uP, uHasP, uExtR, uExtT, uDraw, uAlpha, uSweep, uSweepA, uTime, uAimOn, uResult, uFlash;
        uniform vec2 uKnown, uUnknown, uRight;
        uniform vec3 uAim;
        varying vec2 vP;
        const float TAU = 6.2831853;
        vec2 dirOf(float a) { return vec2(-sin(a), -cos(a)); }
        float arcPos(float a, vec2 arc) {
          if (abs(arc.y) < 1e-4) return -1.0;
          float d = arc.y > 0.0 ? mod(a - arc.x, TAU) : mod(arc.x - a, TAU);
          return d / abs(arc.y);
        }
        float inside(float k, float upto) { return step(0.0, k) * step(k, upto); }
        float gauss(float x) { return exp(-x * x); }   // never pow() a negative base: NaN would spread via bloom
        void over(inout vec4 acc, vec3 c, float a) { a = clamp(a, 0.0, 1.0); acc.rgb = mix(acc.rgb, c, a); acc.a += a * (1.0 - acc.a); }
        // (perpendicular distance, position along) for the line through the centre at angle a
        vec2 lineCoord(vec2 p, float a) { vec2 v = dirOf(a); return vec2(abs(p.x * v.y - p.y * v.x), dot(p, v)); }
        float solid(vec2 lc, float w, float from, float to) {
          return (1.0 - smoothstep(w, w + 0.18, lc.x)) * smoothstep(from, from + 0.4, lc.y) * (1.0 - smoothstep(to - 0.4, to, lc.y));
        }
        float dotted(vec2 lc, float from, float to) {
          float k = fract(lc.y / 1.7) - 0.5;
          return (1.0 - smoothstep(0.16, 0.26, length(vec2(lc.x, k * 1.7)))) * step(from, lc.y) * step(lc.y, to);
        }

        void main() {
          float r = length(vP);
          if (r > uMax) discard;
          float ang = atan(-vP.x, -vP.y);
          vec3 cyan = vec3(0.4, 0.92, 1.0);
          vec3 enemy = vec3(1.0, 0.36, 0.22);
          vec3 orange = vec3(1.0, 0.64, 0.18);
          vec3 white = vec3(1.0);
          vec3 good = vec3(0.35, 1.0, 0.5);
          vec4 acc = vec4(0.0);
          float ring = uRing * uDraw;

          // radar: a faint glass tint (lets the stars through), the ring, ticks, a slow sweep
          over(acc, vec3(0.02, 0.05, 0.1), 0.22 * (1.0 - smoothstep(uRing - 1.0, uRing, r)));
          over(acc, cyan * 1.2, 0.75 * gauss((r - ring) * 3.0));
          float t10 = abs(fract(ang / TAU * 36.0 + 0.5) - 0.5) * (TAU / 36.0) * r;
          float t30 = abs(fract(ang / TAU * 12.0 + 0.5) - 0.5) * (TAU / 12.0) * r;
          over(acc, cyan, 0.5 * (1.0 - smoothstep(0.06, 0.14, t10)) * step(ring - 0.9, r) * step(r, ring));
          over(acc, cyan, 0.8 * (1.0 - smoothstep(0.08, 0.16, t30)) * step(ring - 1.8, r) * step(r, ring));
          // slow radar sweep: a thin, faint line (never a wedge that could read as an angle)
          float sw = mod(uTime * 0.9 - ang, TAU) * r;
          over(acc, cyan, 0.16 * exp(-sw * 0.9) * step(4.0, r) * (1.0 - smoothstep(ring - 0.5, ring, r)));

          // dotted extensions and the perpendicular (only the ones the rule needs)
          if (uExtR > 0.5) over(acc, cyan, 0.7 * dotted(lineCoord(vP, uAxis + 3.14159265), 5.0, ring - 0.6));
          if (uExtT > 0.5) over(acc, enemy, 0.7 * dotted(lineCoord(vP, uT + 3.14159265), 5.0, ring - 0.6));
          if (uHasP > 0.5) over(acc, cyan, 0.7 * dotted(lineCoord(vP, uP), 5.0, ring - 0.6));

          // the asked and given angles
          float ku = arcPos(ang, uUnknown);
          float kk = arcPos(ang, uKnown);
          vec3 uCol = mix(white, good, step(0.5, uResult) * max(uFlash, 0.6));
          over(acc, uCol, 0.1 * inside(ku, uDraw) * step(5.0, r) * (1.0 - smoothstep(uR - 0.4, uR, r)));
          over(acc, orange, 0.12 * inside(kk, uDraw) * step(5.0, r) * (1.0 - smoothstep(uR - 0.4, uR, r)));
          over(acc, uCol * 1.4, inside(ku, uDraw) * gauss((r - uR) / 0.32));
          over(acc, orange * 1.5, inside(kk, uDraw) * gauss((r - uR) / 0.36));
          float kr = arcPos(ang, uRight);
          over(acc, white, 0.55 * inside(kr, uDraw) * gauss((r - uR * 1.6) / 0.22));
          // ghost sweep through "?": shows which turn to name
          float sweepIn = inside(ku, uSweep);
          over(acc, white, 0.16 * uSweepA * sweepIn * step(5.0, r) * (1.0 - smoothstep(uR - 0.4, uR, r)));

          // the line to the enemy
          vec3 tCol = mix(enemy, good, step(0.5, uResult) * max(uFlash, 0.6));
          vec2 tc = lineCoord(vP, uT);
          over(acc, tCol * 1.3, solid(tc, 0.16, 4.5, uTLen * uDraw));
          // the cannon beam (reference line): bright, with a soft glow and a dot where it meets the ring
          vec2 rc = lineCoord(vP, uAxis);
          float beamTo = uAimOn > 0.5 ? ring : ring;
          over(acc, cyan, 0.3 * solid(rc, 0.7, 4.5, beamTo));
          over(acc, cyan * 1.6, solid(rc, 0.2, 4.5, beamTo));
          over(acc, cyan * 1.8, 1.0 - smoothstep(0.55, 0.8, length(vP - dirOf(uAxis) * ring)));

          // the player's answer: a beam turning from the cannon line by the picked angle
          if (uAimOn > 0.5) {
            vec2 aimArc = vec2(uAim.x, uAim.y * uAim.z);
            vec3 aCol = uResult > 0.5 ? good : uResult < -0.5 ? enemy : vec3(0.85, 1.0, 1.0);
            float ka = arcPos(ang, aimArc);
            over(acc, aCol, 0.2 * inside(ka, 1.0) * step(5.0, r) * (1.0 - smoothstep(uR * 0.8, uR * 0.8 + 0.5, r)));
            vec2 ac = lineCoord(vP, aimArc.x + aimArc.y);
            over(acc, aCol * (1.5 + uFlash), solid(ac, 0.28, 4.5, ring));
            over(acc, aCol, 0.35 * solid(ac, 0.9, 4.5, ring));
          }
          gl_FragColor = vec4(acc.rgb, acc.a * uAlpha);
        }`,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.labelRoot = labelRoot;
    const make = (cls, html = '') => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      d.style.display = 'none';
      labelRoot.appendChild(d);
      return d;
    };
    this.lbKnown = make('ang-label known');
    this.lbUnknown = make('ang-label unknown', '?');
    this.lbRight = make('ang-label right');
    this.center = new THREE.Vector3();
    this.q = null;
    this.t = 0;
    this.on = false;
  }

  show(q, { len, tLen, arcR }) {
    const u = this.u;
    this.q = q;
    this.on = true;
    this.t = 0;
    u.uRing.value = len;
    u.uTLen.value = tLen;
    u.uExtR.value = q.type === 'complement' ? 0 : 1;   // straight line / opposite angles need it
    u.uExtT.value = q.type === 'opposite' ? 1 : 0;
    u.uR.value = arcR;
    u.uAxis.value = q.rYaw;
    u.uT.value = q.tYaw;
    u.uHasP.value = q.pYaw !== undefined ? 1 : 0;
    u.uP.value = q.pYaw ?? 0;
    u.uKnown.value.set(q.known.from, q.known.sweep);
    u.uUnknown.value.set(q.unknown.from, q.unknown.sweep);
    u.uRight.value.set(q.whole ? q.whole.from : 0, q.whole ? q.whole.sweep : 0);
    this.lbRight.textContent = q.whole ? q.whole.label : '';
    u.uAimOn.value = 0;
    u.uResult.value = 0;
    u.uFlash.value = 0;
    this.lbKnown.textContent = `${q.given}°`;
    u.uMax.value = Math.max(len, tLen) + 2.5;          // the enemy line may run past the radar ring
    this.mesh.scale.setScalar(u.uMax.value + 0.5);
    this.mesh.visible = true;
  }

  // ghost beam for a picked answer: turns `sweep` radians from `from`
  aim(from, sweep) {
    this.u.uAim.value.set(from, sweep, 0);
    this.u.uAimOn.value = 1;
    this.u.uResult.value = 0;
  }

  aimProgress(k) { this.u.uAim.value.z = k; }

  clearAim() {
    this.u.uAimOn.value = 0;
    this.u.uResult.value = 0;
    this.u.uFlash.value = 0;
  }

  // flash the result: the lines turn green on a hit, the answer beam turns red on a miss
  result(ok) {
    this.u.uResult.value = ok ? 1 : -1;
    this.u.uFlash.value = 1;
  }

  hide() {
    this.on = false;
  }

  update(dt, time, center, camera) {
    const u = this.u;
    this.center.copy(center);
    this.mesh.position.copy(center);
    this.t += dt;
    u.uTime.value = time;
    u.uAlpha.value = this.on ? Math.min(1, u.uAlpha.value + dt * 4) : Math.max(0, u.uAlpha.value - dt * 3);
    u.uDraw.value = this.on ? ease(this.t / 0.7) : u.uDraw.value;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 1.2);
    // ghost sweep: grow through the asked angle, hold, fade, repeat
    const cyc = (time % 2.4) / 2.4;
    u.uSweep.value = ease(cyc / 0.55);
    u.uSweepA.value = u.uAimOn.value > 0.5 ? 0 : (cyc < 0.8 ? 1 : 1 - (cyc - 0.8) / 0.2) * (this.t > 0.7 ? 1 : 0);
    this.mesh.visible = u.uAlpha.value > 0.003;

    const W = window.innerWidth, H = window.innerHeight;
    // labels are sized in world units, so they keep their place in the picture on any screen
    const pxPerUnit = H / (2 * camera.position.distanceTo(center) * Math.tan((camera.fov * Math.PI) / 360));
    this.labelRoot.style.setProperty('--u', `${pxPerUnit.toFixed(2)}px`);
    const place = (el, yaw, radius, show) => {
      if (!show || !this.q || u.uAlpha.value < 0.05) { el.style.display = 'none'; return; }
      DIR(yaw, _p).multiplyScalar(radius).add(center).project(camera);
      el.style.display = 'block';
      el.style.opacity = Math.min(1, u.uAlpha.value * 1.2) * (this.t > 0.5 ? 1 : 0);
      // left/top (not transform) so the label's own pulse animation can't move it
      el.style.left = `${(_p.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-_p.y * 0.5 + 0.5) * H}px`;
    };
    const q = this.q;
    const R = u.uR.value;
    if (q) {
      place(this.lbKnown, q.known.from + q.known.sweep / 2, R * 1.38, true);
      place(this.lbUnknown, q.unknown.from + q.unknown.sweep / 2, R * 1.38, u.uResult.value <= 0.5);
      // the whole-angle label (180° / 90°) sits at whichever end of its arc is further from the target
      if (q.whole) {
        const aT = Math.abs(q.answer * Math.PI / 180);
        const f = Math.abs(Math.abs(q.whole.sweep) * 0.08 - aT) > Math.abs(Math.abs(q.whole.sweep) * 0.92 - aT) ? 0.08 : 0.92;
        place(this.lbRight, q.whole.from + q.whole.sweep * f, R * 1.6 + 2.6, true);
      } else place(this.lbRight, 0, 0, false);
    }
  }
}
