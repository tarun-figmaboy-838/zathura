import * as THREE from 'three';
import { clamp } from '../core/math.js';

const _p = new THREE.Vector3();
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// The battle radar drawn on the plane around the ship's cannon, kept deliberately clean:
//  - a see-through radar ring with tick marks and a slow sweep (nothing blocks the view)
//  - the cannon beam: a bright cyan line from the cannon to the ring, exactly where the cannon
//    points (this is the reference line); its extension through the ship is a faint dotted line
//  - the line to the enemy (warm red), with a faint dotted extension when the rule needs it
//  - the given angle (orange arc) and the angle x the player has turned the cannon (white arc,
//    following the cannon's beam live, its label counting the degrees);
//    right-angle questions add the usual little square in the corner; "around a point" adds a third
//    dotted ray and a second given angle; triangle questions draw the third side with the two given
//    angles at its corners
//  - the cannon's beam as the joystick turns it; after FIRE it lights green (hit) or red (miss)
// Numbers are crisp HTML labels placed in world units.
export class AngleOverlay {
  constructor(scene, labelRoot) {
    this.u = {
      uPx: { value: 0.1 }, uRing: { value: 31 }, uTLen: { value: 27 }, uR: { value: 13 }, uMax: { value: 34 },
      uAxis: { value: 0 }, uT: { value: 0 }, uP: { value: 0 }, uHasP: { value: 0 }, uExtR: { value: 0 }, uExtT: { value: 0 },
      uKnown: { value: new THREE.Vector2() }, uUnknown: { value: new THREE.Vector2() }, uRight: { value: new THREE.Vector2() },
      uKnown2: { value: new THREE.Vector2() }, uTri: { value: new THREE.Vector4() }, uTriOn: { value: 0 }, uTriR: { value: 4 },
      uDraw: { value: 0 }, uAlpha: { value: 0 }, uTime: { value: 0 },
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
        uniform float uPx, uRing, uTLen, uR, uMax, uAxis, uT, uP, uHasP, uExtR, uExtT, uDraw, uAlpha, uTime, uAimOn, uResult, uFlash, uTriOn, uTriR;
        uniform vec2 uKnown2;
        uniform vec4 uTri;
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
        float segDist(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }
        // inside the (smaller) angle between unit directions a and b, seen from the corner
        float wedge(vec2 w, vec2 a, vec2 b) {
          float s = sign(a.x * b.y - a.y * b.x);
          return step(0.0, (a.x * w.y - a.y * w.x) * s) * step(0.0, (w.x * b.y - w.y * b.x) * s);
        }
        float gauss(float x) { return exp(-x * x); }   // never pow() a negative base: NaN would spread via bloom
        void over(inout vec4 acc, vec3 c, float a) { a = clamp(a, 0.0, 1.0); acc.rgb = mix(acc.rgb, c, a); acc.a += a * (1.0 - acc.a); }
        // (perpendicular distance, position along) for the line through the centre at angle a
        vec2 lineCoord(vec2 p, float a) { vec2 v = dirOf(a); return vec2(abs(p.x * v.y - p.y * v.x), dot(p, v)); }

        // every line is a thin stroke of a fixed screen width (uPx = world units per pixel) with a
        // dark outline under it, so it reads on bright stars and on empty space alike. Colours stay
        // at or below 1.0, so the lines stay crisp instead of blooming into halos.
        float band(float d, float wPx) { float h = 0.5 * wPx * uPx; return 1.0 - smoothstep(h - 0.6 * uPx, h + 0.6 * uPx, d); }
        void stroke(inout vec4 acc, float d, float wPx, vec3 c, float a) {
          over(acc, vec3(0.0, 0.015, 0.04), 0.6 * a * band(d, wPx + 3.0));
          over(acc, c, a * band(d, wPx));
        }
        float along(vec2 lc, float from, float to) { return smoothstep(from, from + 0.4, lc.y) * (1.0 - smoothstep(to - 0.4, to, lc.y)); }
        float dots(vec2 lc, float from, float to) {
          float sp = 9.0 * uPx;
          float k = (fract(lc.y / sp) - 0.5) * sp;
          return band(length(vec2(lc.x, k)), 2.6) * step(from, lc.y) * step(lc.y, to);
        }

        void main() {
          float r = length(vP);
          if (r > uMax) discard;
          float ang = atan(-vP.x, -vP.y);
          vec3 cyan = vec3(0.2, 0.85, 1.0);           // saturated: ACES tone mapping washes pale colours out
          vec3 enemy = vec3(1.0, 0.13, 0.08);
          vec3 orange = vec3(1.0, 0.68, 0.22);
          vec3 white = vec3(1.0);
          vec3 good = vec3(0.4, 1.0, 0.55);
          vec4 acc = vec4(0.0);
          float ring = uRing * uDraw;

          // radar glass: dims the stars inside the ring (and softly just outside it) so the lines stand out
          over(acc, vec3(0.008, 0.02, 0.045), 0.58 * (1.0 - smoothstep(uRing - 1.0, uRing + 6.0, r)));
          stroke(acc, abs(r - ring), 2.0, cyan, 0.9);
          float t10 = abs(fract(ang / TAU * 36.0 + 0.5) - 0.5) * (TAU / 36.0) * r;
          float t30 = abs(fract(ang / TAU * 12.0 + 0.5) - 0.5) * (TAU / 12.0) * r;
          over(acc, cyan, 0.55 * band(t10, 1.4) * step(ring - 7.0 * uPx, r) * step(r, ring));
          over(acc, cyan, 0.9 * band(t30, 1.8) * step(ring - 13.0 * uPx, r) * step(r, ring));

          // dotted extensions and the perpendicular (only the ones the rule needs)
          if (uExtR > 0.5) over(acc, cyan, 0.8 * dots(lineCoord(vP, uAxis + 3.14159265), 5.0, ring - 0.6));
          if (uExtT > 0.5) over(acc, enemy, 0.8 * dots(lineCoord(vP, uT + 3.14159265), 5.0, ring - 0.6));
          if (uHasP > 0.5) over(acc, cyan, 0.8 * dots(lineCoord(vP, uP), 5.0, ring - 0.6));

          // the asked and given angles: a light fill and a thin arc
          float ku = arcPos(ang, uUnknown);
          float kk = arcPos(ang, uKnown);
          float kk2 = arcPos(ang, uKnown2);
          float disc = step(5.0, r) * (1.0 - smoothstep(uR - 0.4, uR, r));
          vec3 uCol = mix(white, good, step(0.5, uResult) * max(uFlash, 0.6));
          over(acc, uCol, 0.08 * inside(ku, uDraw) * disc);
          over(acc, orange, 0.1 * inside(kk, uDraw) * disc);
          over(acc, orange, 0.1 * inside(kk2, uDraw) * disc);
          stroke(acc, abs(r - uR), 2.5, uCol, inside(ku, uDraw));
          stroke(acc, abs(r - uR), 2.5, orange, inside(kk, uDraw));
          stroke(acc, abs(r - uR), 2.5, orange, inside(kk2, uDraw));
          // triangle: the third side, the given angles at its two far corners, corner knobs
          if (uTriOn > 0.5) {
            vec2 P = uTri.xy, Q = uTri.zw;
            stroke(acc, segDist(vP, P, Q), 2.0, white, uDraw);
            vec2 wp = vP - P, wq = vP - Q;
            float inP = wedge(wp, normalize(-P), normalize(Q - P));
            float inQ = wedge(wq, normalize(-Q), normalize(P - Q));
            float lp = length(wp), lq = length(wq);
            over(acc, orange, 0.16 * inP * (1.0 - smoothstep(uTriR - 0.4, uTriR, lp)) * uDraw);
            over(acc, orange, 0.16 * inQ * (1.0 - smoothstep(uTriR - 0.4, uTriR, lq)) * uDraw);
            stroke(acc, abs(lp - uTriR), 2.5, orange, inP * uDraw);
            stroke(acc, abs(lq - uTriR), 2.5, orange, inQ * uDraw);
            float knob = min(lp, lq);
            over(acc, vec3(0.02, 0.1, 0.22), band(knob, 11.0) * uDraw);
            over(acc, white, band(knob, 6.0) * uDraw);
          }
          // right-angle questions: the textbook square in the corner between the two lines
          if (abs(uRight.y) > 0.01) {
            vec2 ax = dirOf(uRight.x), ay = dirOf(uRight.x + sign(uRight.y) * 1.5707963);
            vec2 sq = vec2(dot(vP, ax), dot(vP, ay));
            float S = uR * 0.62;
            stroke(acc, abs(sq.x - S), 2.0, white, step(0.0, sq.y) * step(sq.y, S) * uDraw);
            stroke(acc, abs(sq.y - S), 2.0, white, step(0.0, sq.x) * step(sq.x, S) * uDraw);
          }

          // the line to the enemy
          vec3 tCol = mix(enemy, good, step(0.5, uResult) * max(uFlash, 0.6));
          vec2 tc = lineCoord(vP, uT);
          stroke(acc, tc.x, 2.5, tCol, along(tc, 4.5, uTLen * uDraw));
          // the cannon beam (reference line): a little bolder than the rest, a dot where it meets the ring
          vec2 rc = lineCoord(vP, uAxis);
          over(acc, cyan, 0.14 * band(rc.x, 9.0) * along(rc, 4.5, ring));
          stroke(acc, rc.x, 3.2, cyan, along(rc, 4.5, ring));
          float tip = length(vP - dirOf(uAxis) * ring);
          over(acc, vec3(0.0, 0.015, 0.04), 0.7 * band(tip, 12.0));
          over(acc, cyan, band(tip, 8.0));

          // the player's answer: a beam turning from the cannon line by the picked angle
          if (uAimOn > 0.5) {
            vec2 aimArc = vec2(uAim.x, uAim.y * uAim.z);
            vec3 aCol = uResult > 0.5 ? good : uResult < -0.5 ? enemy : vec3(0.85, 1.0, 1.0);
            float ka = arcPos(ang, aimArc);
            over(acc, aCol, 0.14 * inside(ka, 1.0) * step(5.0, r) * (1.0 - smoothstep(uR * 0.8, uR * 0.8 + 0.5, r)));
            vec2 ac = lineCoord(vP, aimArc.x + aimArc.y);
            over(acc, aCol, (0.12 + 0.2 * uFlash) * band(ac.x, 10.0) * along(ac, 4.5, ring));
            stroke(acc, ac.x, 3.2, aCol, along(ac, 4.5, ring));
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
    this.lbKnown2 = make('ang-label known');
    this.triP = new THREE.Vector2();
    this.triQ = new THREE.Vector2();
    this.lbUnknown = make('ang-label unknown', 'x');
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
    this.lastX = null;
    u.uRing.value = len;
    u.uTLen.value = tLen;
    u.uExtR.value = q.type === 'opposite' || q.type === 'linear' ? 1 : 0;   // the straight line through the ship
    u.uExtT.value = q.type === 'opposite' ? 1 : 0;
    u.uAxis.value = q.rYaw;
    u.uT.value = q.tYaw;
    u.uHasP.value = q.pYaw !== undefined ? 1 : 0;
    u.uP.value = q.pYaw ?? 0;
    u.uKnown.value.set(q.known.from, q.known.sweep);
    u.uKnown2.value.set(q.known2 ? q.known2.from : 0, q.known2 ? q.known2.sweep : 0);
    this.lbKnown2.textContent = q.given2 ? `${q.given2}°` : '';
    u.uTriOn.value = q.tri ? 1 : 0;
    if (q.tri) {
      // law of sines: VP / sin(c) = VQ / sin(b); the triangle fills most of the radar
      const D = Math.PI / 180;
      let vq = len * 0.82;
      let vp = (vq * Math.sin(q.tri.c * D)) / Math.sin(q.tri.b * D);
      const k = Math.min(1, (len * 0.9) / Math.max(vp, vq));
      vp *= k; vq *= k;
      this.triP.set(-Math.sin(q.rYaw) * vp, -Math.cos(q.rYaw) * vp);
      this.triQ.set(-Math.sin(q.tYaw) * vq, -Math.cos(q.tYaw) * vq);
      u.uTri.value.set(this.triP.x, this.triP.y, this.triQ.x, this.triQ.y);
      u.uTriR.value = Math.min(5.5, 0.28 * Math.min(vp, vq));
      // keep the "?" arc at the ship well inside the triangle
      const pq = this.triP.distanceTo(this.triQ);
      const h = (vp * vq * Math.sin(q.answer * D)) / pq;
      arcR = Math.min(arcR, h * 0.55);
    }
    u.uR.value = arcR;
    u.uUnknown.value.set(q.unknown.from, q.unknown.sweep);
    // only right-angle questions get a marker (the square); a straight line needs none
    u.uRight.value.set(q.rYaw, q.type === 'complement' ? q.s : 0);
    u.uAimOn.value = 0;
    u.uResult.value = 0;
    u.uFlash.value = 0;
    this.lbKnown.textContent = `${q.given}°`;
    u.uMax.value = Math.max(len + 7, tLen + 2.5);          // the enemy line may run past the radar ring
    this.mesh.scale.setScalar(u.uMax.value + 0.5);
    this.mesh.visible = true;
  }

  // the cannon's live turn: its beam is `sweep` radians (signed) from the cannon's line, and the x
  // arc runs between them with its label counting x (whole degrees)
  live(sweep, x) {
    const u = this.u;
    u.uUnknown.value.set(this.q.rYaw, sweep);
    u.uAim.value.set(this.q.rYaw, sweep, 1);
    u.uAimOn.value = x ? 1 : 0;
    if (x === this.lastX) return;
    this.lastX = x;
    const xv = document.createElement('i');
    xv.textContent = 'x';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = ` = ${x}°`;
    this.lbUnknown.replaceChildren(xv, num);
  }

  // back to aiming after a miss
  clearResult() {
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
    // muted: hidden during a focus shot on a talking craft (comes back with the battle view)
    u.uAlpha.value = this.on && !this.muted ? Math.min(1, u.uAlpha.value + dt * 4) : Math.max(0, u.uAlpha.value - dt * 5);
    u.uDraw.value = this.on ? ease(this.t / 0.7) : u.uDraw.value;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 1.2);
    this.mesh.visible = u.uAlpha.value > 0.003;

    const W = window.innerWidth, H = window.innerHeight;
    // labels are sized in world units, so they keep their place in the picture on any screen
    const pxPerUnit = H / (2 * camera.position.distanceTo(center) * Math.tan((camera.fov * Math.PI) / 360));
    const uPx = `${pxPerUnit.toFixed(2)}px`;
    if (uPx !== this.lastU) { this.lastU = uPx; this.labelRoot.style.setProperty('--u', uPx); }
    u.uPx.value = 1 / pxPerUnit;
    this.ringPx = u.uRing.value * pxPerUnit;   // the ring's radius on screen (the comms bubble keeps clear of it)
    const place = (el, yaw, radius, show) => placeAt(el, -Math.sin(yaw) * radius, -Math.cos(yaw) * radius, show);
    // x/z: world offset from the centre of the radar
    const placeAt = (el, x, z, show) => {
      if (!show || !this.q || u.uAlpha.value < 0.05) { el.style.display = 'none'; return; }
      _p.set(center.x + x, center.y, center.z + z).project(camera);
      el.style.display = 'block';
      el.style.opacity = Math.min(1, u.uAlpha.value * 1.2) * (this.t > 0.5 ? 1 : 0);
      // left/top (not transform) so the label's own pulse animation can't move it
      el.style.left = `${(_p.x * 0.5 + 0.5) * W}px`;
      el.style.top = `${(-_p.y * 0.5 + 0.5) * H}px`;
    };
    const q = this.q;
    const R = u.uR.value;
    if (q) {
      // each number sits just outside its own arc, on the arc's middle
      place(this.lbUnknown, u.uUnknown.value.x + u.uUnknown.value.y / 2, R + 3.4, u.uResult.value <= 0.5);
      if (q.tri) {
        // triangle: each given angle sits inside its corner, along the corner's bisector
        const corner = (el, A, B) => {
          const ax = -A.x, az = -A.y, la = Math.hypot(ax, az);
          const bx = B.x - A.x, bz = B.y - A.y, lb = Math.hypot(bx, bz);
          let mx = ax / la + bx / lb, mz = az / la + bz / lb;
          const lm = Math.hypot(mx, mz) || 1;
          const d = u.uTriR.value + 2.6;
          placeAt(el, A.x + (mx / lm) * d, A.y + (mz / lm) * d, true);
        };
        corner(this.lbKnown, this.triP, this.triQ);
        corner(this.lbKnown2, this.triQ, this.triP);
      } else {
        place(this.lbKnown, q.known.from + q.known.sweep / 2, R + 3.4, true);
        place(this.lbKnown2, q.known2 ? q.known2.from + q.known2.sweep / 2 : 0, R + 3.4, !!q.known2);
      }
    }
  }
}
