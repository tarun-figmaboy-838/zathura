import * as THREE from 'three';
import { VALUE3 } from '../shaders/noise.js';
import { damp } from '../core/math.js';

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DEEP_RED = new THREE.Color(0.55, 0.06, 0.03);

// "Used-future" surface: triplanar panel seams with per-panel tint/roughness variation,
// grime streaks that run aft, chipped paint exposing bare metal near seams, and carbon
// scoring behind the engines. All in object space, so no UVs are needed.
// soot: [startZ, endZ, amount] in the mesh's own space (+Z is aft for ship parts).
export function addPanelDetail(material, { scale = 1, seam = 0.5, grime = 0.22, chips = 0.5, soot = [5, 7.5, 0] } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPanelScale = { value: scale };
    shader.uniforms.uSeam = { value: seam };
    shader.uniforms.uGrime = { value: grime };
    shader.uniforms.uChips = { value: chips };
    shader.uniforms.uSoot = { value: new THREE.Vector3(...soot) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos; varying vec3 vObjN;
        uniform float uPanelScale, uSeam, uGrime, uChips;
        uniform vec3 uSoot;
        ${VALUE3}
        float panelEdge(vec2 p, out float cellR) {
          vec2 s = vec2(1.7, 0.9);
          vec2 q = p / s;
          float row = floor(q.y);
          q.x += hash12(vec2(row, 7.0)) * 0.8;
          vec2 c = floor(q);
          vec2 f = fract(q);
          cellR = hash12(c + 13.0);
          if (cellR > 0.72) { f = fract(f * vec2(2.0, 1.0)); s.x *= 0.5; }
          vec2 e = min(f, 1.0 - f) * s;
          return min(e.x, e.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 an = abs(normalize(vObjN));
        vec2 puv = (an.x > an.y && an.x > an.z) ? vObjPos.zy : (an.y > an.z ? vObjPos.zx : vObjPos.xy);
        float cellR;
        float edge = panelEdge(puv * uPanelScale, cellR);
        float aa = max(fwidth(edge), 1e-4);
        float seamMask = smoothstep(0.018 - aa, 0.018 + aa, edge);
        float grimeAmt = smoothstep(0.5, 0.85, fbm3(vObjPos * 1.6 + 3.0)) * uGrime;
        // streaks dragged aft by years of flight
        float streak = smoothstep(0.52, 0.78, fbm3(vec3(vObjPos.x * 6.0, vObjPos.y * 6.0, vObjPos.z * 0.35) + 11.0)) * uGrime;
        // chipped paint, more likely along panel seams
        float chipN = vnoise(vObjPos * 8.0) * 0.65 + vnoise(vObjPos * 27.0) * 0.35;
        float chip = smoothstep(0.7, 0.74, chipN + (1.0 - seamMask) * 0.3 + cellR * 0.06) * uChips;
        // carbon scoring behind the engines
        float soot = smoothstep(uSoot.x, uSoot.y, vObjPos.z) * (0.55 + 0.45 * fbm3(vObjPos * 2.3)) * uSoot.z;
        diffuseColor.rgb *= mix(1.0 - uSeam, 1.0, seamMask) * (0.93 + 0.14 * cellR) * (1.0 - grimeAmt) * (1.0 - streak * 0.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.19, 0.2), chip);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.022, 0.02), clamp(soot, 0.0, 0.9));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (cellR - 0.5) * 0.14 + (1.0 - seamMask) * 0.3 + grimeAmt * 0.6
          + streak * 0.2 + soot * 0.45 - chip * 0.15, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.9, chip);`);
  };
  material.customProgramCacheKey = () => `panel-${scale}-${seam}-${grime}-${chips}-${soot.join(',')}`;
}

export class Ship {
  constructor(gltf) {
    this.root = new THREE.Group();
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.model = gltf.scene;
    this.visual.add(this.model);

    this.nodes = {};
    this.materials = {};
    this.model.traverse((o) => {
      this.nodes[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        this.materials[o.material.name] = o.material;
      }
    });
    for (const n of ['EngineGlow_L', 'EngineGlow_R', 'EngineGlow_C', 'NavLight_L', 'NavLight_R', 'Beacon', 'TurretTrim', 'TurretLens']) {
      if (this.nodes[n]) this.nodes[n].castShadow = false;
    }

    const M = this.materials;
    addPanelDetail(M.HullPaint, { scale: 1.0, seam: 0.32, grime: 0.16, chips: 0.18, soot: [4.6, 7.2, 0.7] });
    addPanelDetail(M.Accent, { scale: 1.0, seam: 0.35, grime: 0.2, chips: 0.3, soot: [4.6, 7.2, 0.5] });
    addPanelDetail(M.Gunmetal, { scale: 2.2, seam: 0.4, grime: 0.2, chips: 0.4, soot: [-3.5, -1.5, 0.0] });
    M.HullPaint.envMapIntensity = 1.0;
    M.Gunmetal.envMapIntensity = 1.3;
    M.DarkMetal.envMapIntensity = 1.3;
    M.Glass.envMapIntensity = 2.2;
    M.Glass.roughness = 0.04;

    this.glowBase = M.EngineGlow.emissiveIntensity;
    this.cannonGlow = M.CannonGlow;
    this.cannonBase = M.CannonGlow ? M.CannonGlow.emissiveIntensity : 1;
    this.nav = ['NavRed', 'NavGreen', 'BeaconRed'].map((n) => ({ m: M[n], base: M[n].emissiveIntensity }));

    this.velocity = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.thrust = 0;
    this.boost = 0;
    this.radius = 6;
    this.docked = false;   // held by the station clamps: no physics, no bob
    this.kinematic = false; // moved by rail() / the finale instead of the free-flight model
    this.maneuver = { roll: 0, pitch: 0 };   // extra roll / pitch on top of the banking (a stunt through a gate)
    this.bankRoll = 0;
    this.bankPitch = 0;
    this.scripted = null;  // { fwd, boost } overrides the controls (launch cinematic)
    this.redshift = 0;     // 0..1 near a black hole: colours slide to deep red and fade to black
    this.base = new Map([...Object.values(this.materials)].map((m) => [m, {
      color: m.color.clone(), emissive: m.emissive.clone(), env: m.envMapIntensity ?? 1,
    }]));
  }

  // light climbing out of a deep gravity well loses energy: the ship reddens and darkens until
  // it is a black silhouette against the disk
  setRedshift(k) {
    if (k === this.redshift) return;
    this.redshift = k;
    const dim = Math.pow(1 - k, 1.6);
    for (const [m, b] of this.base) {
      m.color.copy(b.color).lerp(DEEP_RED, Math.min(1, k * 1.2)).multiplyScalar(dim);
      m.emissive.copy(b.emissive).lerp(DEEP_RED, k).multiplyScalar(dim);
      m.envMapIntensity = b.env * dim;
    }
  }

  get position() { return this.root.position; }

  reset() {
    this.velocity.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.thrust = 0;
    this.boost = 0;
    this.scripted = null;
    this.kinematic = false;
    this.model.visible = true;
    this.visual.rotation.set(0, 0, 0);
    this.maneuver.roll = this.maneuver.pitch = 0;
    this.bankRoll = this.bankPitch = 0;
    this.visual.scale.set(1, 1, 1);
    this.setRedshift(0);
  }

  // On-rails flight: the route carries the ship forward (-Z) at `speed`; steer (-1..1) slides it
  // around inside a lane of half-size `bounds` centred on `lane`.
  rail(dt, speed, steerX, steerY, lane, bounds) {
    const v = this.velocity;
    v.x = damp(v.x, steerX * 40, 5, dt);
    v.y = damp(v.y, steerY * 26, 5, dt);
    v.z = damp(v.z, -speed, 1.6, dt);
    const p = this.root.position;
    p.addScaledVector(v, dt);
    for (const ax of ['x', 'y']) {
      const lo = lane[ax] - bounds[ax], hi = lane[ax] + bounds[ax];
      if (p[ax] < lo) { p[ax] = lo; v[ax] = Math.max(0, v[ax]); }
      if (p[ax] > hi) { p[ax] = hi; v[ax] = Math.min(0, v[ax]); }
    }
    this.root.quaternion.identity();
    this.thrust = damp(this.thrust, Math.min(0.75, 0.15 + speed / 220), 3, dt);
    this.boost = damp(this.boost, speed > 200 ? 1 : 0, 3, dt);
    // banks into a turn and tips its nose with a climb or dive, plus any stunt on top
    this.bankRoll = damp(this.bankRoll, -v.x / 40 * 0.55, 6, dt);
    this.bankPitch = damp(this.bankPitch, v.y / 26 * 0.18, 6, dt);
    this.visual.rotation.z = this.bankRoll + this.maneuver.roll;
    this.visual.rotation.x = this.bankPitch + this.maneuver.pitch;
  }

  // cannon coils glow with heat and flash on each shot
  setCannonGlow(heat, flash) {
    if (!this.cannonGlow) return;
    const dim = 1 - this.redshift;
    this.cannonGlow.emissiveIntensity = this.cannonBase * (0.55 + heat * 1.6 + flash * 1.5) * dim * dim;
    this.cannonGlow.emissive.setRGB(1.0, (0.42 - heat * 0.3) * dim, 0.08 * dim);
  }

  update(dt, input, time, controllable) {
    const s = this.scripted;
    const ax = (n, p) => (controllable && !s ? input.axis(n, p) : 0);
    const fwdIn = s ? s.fwd : ax('KeyS', 'KeyW');
    const yawIn = ax('KeyD', 'KeyA');
    const pitchIn = ax('KeyF', 'KeyR');
    const rollIn = ax('KeyE', 'KeyQ');
    const vertIn = ax('KeyC', 'Space');
    const boosting = s ? s.boost : controllable && fwdIn > 0 && (input.down('ShiftLeft') || input.down('ShiftRight'));

    if (!this.kinematic) {
      this.boost = damp(this.boost, boosting ? 1 : 0, 3, dt);
      this.thrust = damp(this.thrust, Math.max(0, fwdIn) * (1 + this.boost), 4, dt);
    }

    const q = this.root.quaternion;
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _up.set(0, 1, 0).applyQuaternion(q);
    if (!this.docked && !this.kinematic) {
      const accel = fwdIn > 0 ? 42 + 110 * this.boost : fwdIn * 28;
      this.velocity.addScaledVector(_fwd, accel * dt);
      this.velocity.addScaledVector(_up, vertIn * 26 * dt);
      this.velocity.multiplyScalar(Math.exp(-0.55 * dt));
      this.root.position.addScaledVector(this.velocity, dt);
    }

    this.angVel.x = damp(this.angVel.x, pitchIn * 1.0, 5, dt);
    this.angVel.y = damp(this.angVel.y, yawIn * 1.1, 5, dt);
    this.angVel.z = damp(this.angVel.z, rollIn * 1.8, 5, dt);
    q.multiply(_qa.setFromAxisAngle(Y, this.angVel.y * dt));
    q.multiply(_qa.setFromAxisAngle(X, this.angVel.x * dt));
    q.multiply(_qa.setFromAxisAngle(Z, this.angVel.z * dt));
    q.normalize();

    // visual-only banking and a gentle idle bob
    const v = this.visual;
    if (!this.kinematic) {
      v.rotation.z = damp(v.rotation.z, this.angVel.y * 0.45, 4, dt);
      v.rotation.x = damp(v.rotation.x, vertIn * 0.08 - this.thrust * 0.025, 4, dt);
    }
    const bob = this.docked ? 0 : 1;
    v.position.y = Math.sin(time * 1.3) * 0.12 * bob;
    v.position.x = Math.sin(time * 0.9) * 0.06 * bob;

    this.materials.EngineGlow.emissiveIntensity = this.glowBase * (0.22 + this.thrust * 0.7 + this.boost * 0.6) * (0.94 + Math.random() * 0.06);
    const blink = (t, period, offset) => ((t + offset) % period < 0.12 ? 1 : 0.04);
    this.nav[0].m.emissiveIntensity = this.nav[0].base * blink(time, 1.4, 0);
    this.nav[1].m.emissiveIntensity = this.nav[1].base * blink(time, 1.4, 0.7);
    this.nav[2].m.emissiveIntensity = this.nav[2].base * blink(time, 2.2, 0.3);
    this.root.updateMatrixWorld(true);
  }
}
