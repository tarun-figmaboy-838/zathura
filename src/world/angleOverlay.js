import * as THREE from 'three';
import { clamp } from '../core/math.js';

const _p = new THREE.Vector3();
const DIR = (yaw, out) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// The angle diagram drawn on the battle plane around the ship's cannon: a dotted reference line,
// the red dashed line to the target, the given angle (orange), the asked angle "?" (white) with
// a ghost sweep that shows which turn to name, and, once an answer is picked, a ghost beam that
// turns by that angle and flashes green or red. The numbers are crisp HTML labels.
export class AngleOverlay {
  constructor(scene, labelRoot) {
    this.u = {
      uBack: { value: 40 }, uLen: { value: 38 }, uTLen: { value: 30 }, uR: { value: 15 },
      uAxis: { value: 0 }, uT: { value: 0 }, uP: { value: 0 }, uHasP: { value: 0 },
      uKnown: { value: new THREE.Vector2() }, uUnknown: { value: new THREE.Vector2() }, uRight: { value: new THREE.Vector2() },
      uDraw: { value: 0 }, uAlpha: { value: 0 }, uSweep: { value: 0 }, uSweepA: { value: 0 },
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
          // world-space offset from the diagram centre (the mesh is scaled to fit the diagram)
          vP = (modelMatrix * vec4(position, 1.0)).xz - modelMatrix[3].xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uBack, uLen, uTLen, uR, uAxis, uT, uP, uHasP, uDraw, uAlpha, uSweep, uSweepA, uAimOn, uResult, uFlash;
        uniform vec2 uKnown, uUnknown, uRight;
        uniform vec3 uAim;
        varying vec2 vP;
        const float TAU = 6.2831853;
        vec2 dirOf(float a) { return vec2(-sin(a), -cos(a)); }
        // 0..1 inside an arc (from, signed sweep), outside otherwise
        float arcPos(float a, vec2 arc) {
          if (abs(arc.y) < 1e-4) return -1.0;
          float d = arc.y > 0.0 ? mod(a - arc.x, TAU) : mod(arc.x - a, TAU);
          return d / abs(arc.y);
        }
        float inside(float k, float upto) { return step(0.0, k) * step(k, upto); }
        void over(inout vec4 acc, vec3 c, float a) { acc.rgb = mix(acc.rgb, c, clamp(a, 0.0, 1.0)); acc.a += a * (1.0 - acc.a); }
        // perpendicular distance to the line through the centre at angle a, and position along it
        vec2 lineCoord(vec2 p, float a) { vec2 v = dirOf(a); return vec2(abs(p.x * v.y - p.y * v.x), dot(p, v)); }

        void main() {
          float r = length(vP);
          if (r > uBack + 1.5) discard;
          float ang = atan(-vP.x, -vP.y);
          vec3 cyan = vec3(0.45, 0.92, 1.0) * 1.35;
          vec3 red = vec3(1.0, 0.16, 0.1) * 1.35;
          vec3 orange = vec3(1.0, 0.62, 0.16) * 1.8;
          vec3 white = vec3(1.0) * 1.7;
          vec3 good = vec3(0.3, 1.0, 0.45) * 1.9;
          vec4 acc = vec4(0.0);

          // dark glass disc so the diagram reads over the nebula, with a thin rim
          over(acc, vec3(0.012, 0.025, 0.06), 0.72 * (1.0 - smoothstep(uBack - 4.0, uBack, r)));
          over(acc, cyan * 0.7, 0.45 * exp(-pow((r - uBack + 0.8) * 2.2, 2.0)));

          float L = uLen * uDraw;
          // reference line: dotted, both ways (and the perpendicular for right-angle questions)
          vec2 lc = lineCoord(vP, uAxis);
          float dots = 1.0 - smoothstep(0.32, 0.48, length(vec2(lc.x, (fract(lc.y / 2.1) - 0.5) * 2.1)));
          over(acc, cyan, dots * step(abs(lc.y), L) * step(5.0, r));
          if (uHasP > 0.5) {
            vec2 pc = lineCoord(vP, uP);
            float pd = 1.0 - smoothstep(0.32, 0.48, length(vec2(pc.x, (fract(pc.y / 2.1) - 0.5) * 2.1)));
            over(acc, cyan, pd * step(0.0, pc.y) * step(pc.y, L) * step(5.0, r));
          }
          // line to the target: red dashes, through the ship and out the far side
          vec2 tc = lineCoord(vP, uT);
          float dash = step(fract(tc.y / 3.0), 0.6) * (1.0 - smoothstep(0.34, 0.6, tc.x));
          float tReach = step(-L, tc.y) * step(tc.y, uTLen * uDraw);
          vec3 tCol = mix(red, good, step(0.5, uResult) * uFlash);
          over(acc, tCol, dash * tReach * step(5.0, r));

          // the given angle: orange arc and a faint wedge
          float kk = arcPos(ang, uKnown);
          float inK = inside(kk, uDraw);
          over(acc, orange, 0.16 * inK * (1.0 - smoothstep(uR - 1.0, uR, r)) * step(5.0, r));
          over(acc, orange, inK * exp(-pow((r - uR) / 0.55, 2.0)));
          // the asked angle: white arc
          float ku = arcPos(ang, uUnknown);
          float inU = inside(ku, uDraw);
          vec3 uCol = mix(white, good, step(0.5, uResult) * uFlash);
          over(acc, uCol, inU * exp(-pow((r - uR) / 0.45, 2.0)));
          // ghost sweep through the asked angle: a translucent wedge led by a ghost cannon beam
          float sweepIn = inside(ku, uSweep);
          over(acc, vec3(0.75, 0.95, 1.0), 0.26 * uSweepA * sweepIn * (1.0 - smoothstep(uR - 0.5, uR + 0.5, r)) * step(5.0, r));
          float front = uUnknown.x + uUnknown.y * uSweep;
          vec2 fc = lineCoord(vP, front);
          over(acc, vec3(0.85, 1.0, 1.0) * 1.5, 0.75 * uSweepA * (1.0 - smoothstep(0.2, 0.5, fc.x)) * step(5.0, fc.y) * step(fc.y, uR + 7.0));
          // right angle (90 degrees) between the reference line and the perpendicular
          float kr = arcPos(ang, uRight);
          over(acc, white * 0.85, inside(kr, uDraw) * exp(-pow((r - uR * 1.75) / 0.3, 2.0)));

          // the player's answer: a ghost beam turning from the reference line by the picked angle
          if (uAimOn > 0.5) {
            vec2 aimArc = vec2(uAim.x, uAim.y * uAim.z);
            float ka = arcPos(ang, aimArc);
            vec3 aCol = uResult > 0.5 ? good : uResult < -0.5 ? red : vec3(0.75, 0.97, 1.0) * 1.4;
            float glow = 1.0 + uFlash * 0.8;
            over(acc, aCol, 0.24 * inside(ka, 1.0) * (1.0 - smoothstep(uR * 0.75, uR * 0.75 + 0.6, r)) * step(5.0, r));
            vec2 ac = lineCoord(vP, aimArc.x + aimArc.y);
            over(acc, aCol * glow, (1.0 - smoothstep(0.35, 0.75, ac.x)) * step(5.0, ac.y) * step(ac.y, uLen));
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
    u.uLen.value = len;
    u.uBack.value = len + 1;
    u.uTLen.value = tLen;
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
    this.mesh.scale.setScalar(len + 2.5);
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
      place(this.lbKnown, q.known.from + q.known.sweep / 2, R * 1.42, true);
      place(this.lbUnknown, q.unknown.from + q.unknown.sweep / 2, R * 1.42, u.uResult.value <= 0.5);
      // the whole-angle label (180° / 90°) sits at whichever end of its arc is further from the target
      if (q.whole) {
        const aT = Math.abs(q.answer * Math.PI / 180);
        const f = Math.abs(Math.abs(q.whole.sweep) * 0.08 - aT) > Math.abs(Math.abs(q.whole.sweep) * 0.92 - aT) ? 0.08 : 0.92;
        place(this.lbRight, q.whole.from + q.whole.sweep * f, R * 1.75 + 2.6, true);
      } else place(this.lbRight, 0, 0, false);
    }
  }
}
