import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rod } from './droneParts.js';

// The Warden: a monster of a virus drone (a machine, never a living thing). A dark armoured ball
// covered in blade spikes, glowing red seams, two long swept-back horns, one huge red eye with a
// slit pupil under angry V-shaped armour brows and four small spider eyes, a toothed maw at the
// front (its hangar: small drones launch from it) whose jaws chomp, four mechanical claw arms
// reaching out from its sides, and four turrets on short arms. Built here in code with the node
// names the boss code relies on, at the same spots as the carrier's (the angle battles stay the
// same): Core, Hangar, TurretHead_0..3 (turn to aim) with TurretMuzzle_0..3, EngineGlow_0..3.
// model.userData.rig(dt, t) animates the jaws, claws, slit pupil and spider eyes. Forward is -Z.

const C = new THREE.Vector3(0, -2.5, 0);       // the ball's centre
const R = 7.6;
const CORE = new THREE.Vector3(0, 4.51, 1);    // the eye, looking up at the battle camera
const TURRETS = [[-4.2, 3.13, -8.5], [4.2, 3.13, -8.5], [-5.6, 3.95, 6.5], [5.6, 3.95, 6.5]].map((p) => new THREE.Vector3(...p));
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// which materials flash when hit / glow as the core, and where it bursts when it dies
const LOOK = {
  hull: ['WardenShell', 'WardenPlate'],
  core: 'WardenCore',
  glow: 'WardenGlow',
  panel: { scale: 0.5, seam: 0.55, grime: 0.22, chips: 0.25, soot: [0, 0, 0] },
  pops: [[0, 0, 0, 6], [0, 0, -5, 3], [0, 0, 5, 3], [5, 0, 0, 3], [-5, 0, 0, 3],
    ...TURRETS.map((p) => [p.x, 0, p.z, 1.5])],
};

const mat = (name, props) => Object.assign(new THREE.MeshStandardMaterial(props), { name });
const rng = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// geometry made along +Y, turned to direction d and moved out to distance `at` from point o
function along(geo, d, at, o = C) {
  _q.setFromUnitVectors(_y, d);
  return geo.applyQuaternion(_q).translate(o.x + d.x * at, o.y + d.y * at, o.z + d.z * at);
}
// a flat armour bar from a to b (w wide, h thick), its flat side up
function bar(a, b, w, h) {
  const d = b.clone().sub(a);
  const g = new THREE.BoxGeometry(w, h, d.length());
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().normalize());
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// a tapering horn through the points, radius r0 at the root down to a point
function horn(points, r0) {
  return points.slice(0, -1).map((p, i) => rod(p, points[i + 1], r0 * (1 - i / (points.length - 1)) + 0.04, r0 * (1 - (i + 1) / (points.length - 1)) + 0.04, 10));
}
// a point on the ball's top surface above (x, z)
const onTop = (x, z, lift = 0) => V(x, C.y + Math.sqrt(Math.max(0, R * R - x * x - z * z)) + lift, z);

export function makeWardenDrone() {
  const M = {
    shell: mat('WardenShell', { color: 0x221d2b, metalness: 0.7, roughness: 0.34 }),
    plate: mat('WardenPlate', { color: 0x3b2f4a, metalness: 0.8, roughness: 0.3 }),
    trim: mat('WardenTrim', { color: 0x8e1e18, metalness: 0.9, roughness: 0.28 }),
    blade: mat('WardenBlade', { color: 0x8a8494, metalness: 0.9, roughness: 0.22 }),
    bone: mat('WardenHorn', { color: 0x2a2430, metalness: 0.6, roughness: 0.4 }),
    dark: mat('WardenDark', { color: 0x07060a, metalness: 0.3, roughness: 0.7 }),
    glow: mat('WardenGlow', { color: 0x000000, emissive: new THREE.Color(1, 0.025, 0.015), emissiveIntensity: 1.35, roughness: 0.5 }),   // a true deep red (brighter washes to peach)
    core: mat('WardenCore', { color: 0x200000, emissive: new THREE.Color(1, 0.07, 0.02), emissiveIntensity: 1.5, roughness: 0.4 }),
  };
  const root = new THREE.Group();
  root.name = 'WardenDrone';
  root.userData.look = LOOK;
  const mesh = (name, geo, m, parent = root) => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    parent.add(o);
    return o;
  };
  const r = rng(1313);

  // ---- the armoured ball with glowing red seams
  mesh('Body', new THREE.SphereGeometry(R, 64, 40).translate(C.x, C.y, C.z), M.shell);
  mesh('Band', new THREE.TorusGeometry(R * 1.004, 0.22, 8, 120).rotateX(Math.PI / 2).translate(C.x, C.y, C.z), M.glow);
  mesh('BandTrim', mergeGeometries([0.55, -0.55].map((dy) => new THREE.TorusGeometry(Math.sqrt(R * R - dy * dy) * 1.01, 0.3, 8, 120)
    .rotateX(Math.PI / 2).translate(C.x, C.y + dy, C.z))), M.trim);

  // ---- blade spikes all over (clear of the eye, the maw, the turrets and the claws)
  const eyeDir = CORE.clone().sub(C).normalize();
  const clawDirs = [15, -20, 165, 200].map((deg) => { const a = (deg * Math.PI) / 180; return V(Math.cos(a), -0.3, -Math.sin(a)).normalize(); });
  const clear = [[eyeDir, 0.7], [V(0, 0, -1), 0.9], [V(0, 0, 1), 0.93], ...clawDirs.map((d) => [d, 0.93]),
    ...TURRETS.map((p) => [p.clone().sub(C).normalize(), 0.82])];
  const blades = [], tips = [], pores = [];
  const N = 80, d = V(0, 0, 0);
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    d.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    if (clear.some(([c, k]) => d.dot(c) > k)) continue;
    const len = 2.2 + r() * 2.6;
    blades.push(along(new THREE.ConeGeometry(0.62, len, 6).translate(0, len / 2, 0), d.clone(), R - 0.3));
    tips.push(along(new THREE.ConeGeometry(0.16, 0.7, 6).translate(0, len - 0.05, 0), d.clone(), R - 0.3));
    pores.push(along(new THREE.TorusGeometry(0.78, 0.12, 6, 18).rotateX(Math.PI / 2), d.clone(), R + 0.02));
  }
  mesh('Spikes', mergeGeometries(blades), M.blade);
  mesh('SpikeTips', mergeGeometries(tips), M.glow);
  mesh('Collars', mergeGeometries(pores), M.trim);

  // ---- two long horns sweeping back from behind the eye, glowing at the tips
  const horns = new THREE.Group();
  horns.name = 'Horns';
  root.add(horns);
  for (const sx of [-1, 1]) {
    const b = onTop(sx * 2.4, 3.4, -0.4);
    const pts = [b, b.clone().add(V(sx * 0.6, 2.6, 2.2)), b.clone().add(V(sx * 1.2, 3.8, 5.0)), b.clone().add(V(sx * 1.4, 3.6, 7.8)), b.clone().add(V(sx * 1.0, 2.2, 10.0))];
    const segs = horn(pts, 1.15);
    mesh(`Horn_${sx}`, mergeGeometries(segs.slice(0, -1)), M.bone, horns);
    mesh(`HornTip_${sx}`, segs[segs.length - 1], M.glow, horns);
    mesh(`HornRing_${sx}`, along(new THREE.TorusGeometry(1.15, 0.22, 8, 20).rotateX(Math.PI / 2), pts[1].clone().sub(pts[0]).normalize(), 0.4, pts[0]), M.trim, horns);
  }

  // ---- the eye on top: a toothed socket, the glowing red iris with a slit pupil, angry brows
  mesh('Socket', new THREE.CylinderGeometry(3.0, 3.0, 1.6, 48).translate(CORE.x, CORE.y - 0.4, CORE.z), M.dark);
  mesh('Bezel', new THREE.TorusGeometry(3.0, 0.5, 14, 64).rotateX(Math.PI / 2).translate(CORE.x, CORE.y + 0.44, CORE.z), M.trim);
  const teeth = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const at = V(CORE.x + Math.cos(a) * 3.0, CORE.y + 0.75, CORE.z + Math.sin(a) * 3.0);
    teeth.push(along(new THREE.ConeGeometry(0.28, 1.0, 5).translate(0, 0.4, 0), V(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6).normalize(), 0, at));
  }
  mesh('EyeTeeth', mergeGeometries(teeth), M.blade);
  const core = new THREE.Group();
  core.name = 'Core';
  core.position.copy(CORE);
  root.add(core);
  mesh('Iris', new THREE.SphereGeometry(2.5, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.34, 0), M.core, core);
  const pupil = new THREE.Group();
  pupil.name = 'Pupil';
  pupil.position.y = 1.38;
  core.add(pupil);
  mesh('Slit', new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2).scale(0.26, 1, 1.75), M.dark, pupil);
  mesh('SlitRing', new THREE.RingGeometry(1.25, 1.42, 40).rotateX(-Math.PI / 2).translate(0, 0.005, 0), M.dark, pupil);
  // the brows: two heavy red-edged armour plates in a V over the eye, scowling toward the front
  for (const sx of [-1, 1]) {
    const a = V(sx * 4.1, CORE.y + 1.65, CORE.z + 2.6), b = V(sx * 0.5, CORE.y + 1.0, CORE.z + 0.3);
    mesh(`Brow_${sx}`, bar(a, b, 1.5, 0.6), M.plate);
    mesh(`BrowEdge_${sx}`, bar(a.clone().add(V(0, 0.32, -0.55)), b.clone().add(V(0, 0.32, -0.55)), 0.4, 0.3), M.trim);
  }
  // four small spider eyes in front of the big one
  const minis = [];
  for (const [x, z, s] of [[-2.7, -2.2, 0.55], [2.7, -2.2, 0.55], [-1.3, -3.2, 0.42], [1.3, -3.2, 0.42]]) {
    const p = onTop(x, CORE.z + z, 0.05);
    mesh('MiniSocket', new THREE.SphereGeometry(s * 1.45, 14, 10).scale(1, 0.5, 1).translate(p.x, p.y - 0.1, p.z), M.dark);
    minis.push(mesh('MiniEye', new THREE.SphereGeometry(s, 14, 10).translate(p.x, p.y + 0.12, p.z), M.glow));
  }

  // ---- four big turrets on short arms: the parts to destroy. Each carries a glowing weak-spot
  // core on top (TurretCore_i, its own material so the one being asked about can flash) and a
  // hidden outline shell (TurretOutline_i) the game shows around the target. The head turns to
  // aim; the muzzle is where shots leave.
  TURRETS.forEach((p, i) => {
    const toward = p.clone().sub(C);
    const len = toward.length();
    toward.normalize();
    mesh(`TurretArm_${i}`, along(new THREE.CylinderGeometry(1.0, 1.5, len - R - 0.6, 14).translate(0, (len - R - 0.6) / 2, 0), toward, R - 0.5), M.plate);
    mesh(`TurretCollar_${i}`, along(new THREE.CylinderGeometry(2.0, 2.2, 0.6, 20), toward, R + 0.05), M.trim);
    mesh(`TurretBase_${i}`, new THREE.SphereGeometry(2.3, 24, 16).scale(1, 0.62, 1).translate(p.x, p.y - 0.9, p.z), M.plate);
    const head = new THREE.Group();
    head.name = `TurretHead_${i}`;
    head.position.copy(p);
    root.add(head);
    mesh(`TurretDome_${i}`, new THREE.SphereGeometry(2.0, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.shell, head);
    mesh(`TurretRim_${i}`, new THREE.TorusGeometry(2.0, 0.28, 8, 36).rotateX(Math.PI / 2).translate(0, 0.05, 0), M.trim, head);
    const coreMat = mat(`TurretCoreMat_${i}`, { color: 0x100000, emissive: new THREE.Color(1, 0.1, 0.03), emissiveIntensity: 1.2, roughness: 0.3 });
    mesh(`TurretCore_${i}`, new THREE.SphereGeometry(0.95, 20, 14).translate(0, 1.75, 0), coreMat, head);
    mesh(`TurretCoreCage_${i}`, new THREE.TorusGeometry(1.0, 0.13, 6, 24).translate(0, 1.75, 0), M.blade, head);
    for (const sx of [-1, 1]) {
      mesh(`TurretBarrel_${i}_${sx}`, new THREE.CylinderGeometry(0.32, 0.4, 4.4, 10).rotateX(Math.PI / 2).translate(sx * 0.7, 0.6, -2.8), M.dark, head);
      mesh(`TurretTip_${i}_${sx}`, new THREE.TorusGeometry(0.42, 0.12, 6, 14).translate(sx * 0.7, 0.6, -5.0), M.trim, head);
    }
    mesh(`TurretEye_${i}`, new THREE.CircleGeometry(0.5, 20).rotateY(Math.PI).translate(0, 0.75, -1.85), M.glow, head);
    const outline = mesh(`TurretOutline_${i}`, new THREE.SphereGeometry(2.75, 24, 14).scale(1, 0.8, 1).translate(0, 0.35, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.75, 0.1), side: THREE.BackSide, toneMapped: false }), head);
    outline.visible = false;
    const muzzle = new THREE.Object3D();
    muzzle.name = `TurretMuzzle_${i}`;
    muzzle.position.set(0, 0.6, -5.3);
    head.add(muzzle);
  });

  // ---- the maw at the front: a dark mouth (the hangar) between two toothed jaws that chomp
  const mouthZ = C.z - R + 0.35;
  mesh('HangarMouth', new THREE.CircleGeometry(2.4, 32).rotateY(Math.PI).translate(C.x, C.y, mouthZ - 0.5), M.dark);
  mesh('MawGlow', new THREE.CircleGeometry(1.0, 24).rotateY(Math.PI).translate(C.x, C.y, mouthZ - 0.45), M.glow);
  const jaws = [];
  for (const up of [1, -1]) {
    const jaw = new THREE.Group();
    jaw.name = up > 0 ? 'JawTop' : 'JawBottom';
    jaw.position.set(C.x, C.y, mouthZ - 0.4);
    root.add(jaw);
    mesh(`Lip_${up}`, new THREE.TorusGeometry(2.7, 0.42, 10, 28, Math.PI).rotateZ(up > 0 ? 0 : Math.PI), M.trim, jaw);
    const fangs = [];
    for (let i = 0; i < 7; i++) {
      const a = (up > 0 ? 0 : Math.PI) + ((i + 0.5) / 7) * Math.PI;
      const base = V(Math.cos(a) * 2.4, Math.sin(a) * 2.4, -0.1);
      const len = i === 1 || i === 5 ? 1.6 : 1.0;              // two long fangs
      fangs.push(along(new THREE.ConeGeometry(0.26, len, 6).translate(0, len / 2, 0), V(-Math.cos(a), -Math.sin(a), 0), 0, base));
    }
    mesh(`Fangs_${up}`, mergeGeometries(fangs), M.blade, jaw);
    jaws.push({ g: jaw, up });
  }
  const hangar = new THREE.Object3D();
  hangar.name = 'Hangar';
  hangar.position.set(C.x, C.y, C.z - R - 0.8);
  root.add(hangar);

  // ---- four mechanical claw arms reaching out from its sides
  const claws = clawDirs.map((dir, i) => {
    const shoulder = new THREE.Group();
    shoulder.name = `Claw_${i}`;
    shoulder.position.copy(C).addScaledVector(dir, R * 0.96);
    shoulder.rotation.y = Math.atan2(-dir.z, dir.x);              // local +X points out from the body
    root.add(shoulder);
    mesh(`ClawShoulder_${i}`, new THREE.SphereGeometry(1.1, 16, 12), M.trim, shoulder);
    mesh(`ClawUpper_${i}`, rod(V(0, 0, 0), V(4.4, 1.6, 0), 0.62, 0.45), M.plate, shoulder);
    const elbow = new THREE.Group();
    elbow.position.set(4.4, 1.6, 0);
    shoulder.add(elbow);
    mesh(`ClawElbow_${i}`, new THREE.SphereGeometry(0.62, 12, 10), M.glow, elbow);
    mesh(`ClawFore_${i}`, rod(V(0, 0, 0), V(4.2, -2.4, 0), 0.45, 0.32), M.plate, elbow);
    const wrist = new THREE.Group();
    wrist.position.set(4.2, -2.4, 0);
    elbow.add(wrist);
    mesh(`ClawWrist_${i}`, new THREE.SphereGeometry(0.5, 12, 10), M.trim, wrist);
    const fingers = [0, 1, 2].map((k) => {
      const f = new THREE.Group();
      f.rotation.x = (k / 3) * Math.PI * 2;
      wrist.add(f);
      const pivot = new THREE.Group();
      f.add(pivot);
      mesh(`ClawFinger_${i}_${k}`, mergeGeometries([rod(V(0, 0, 0), V(1.6, 0.7, 0), 0.22, 0.17, 6), rod(V(1.6, 0.7, 0), V(2.6, -0.1, 0), 0.17, 0.04, 6)]), M.blade, pivot);
      return pivot;
    });
    return { shoulder, elbow, fingers, phase: i * 1.7 };
  });

  // ---- four engines at the back (EngineGlow_*: the plumes attach there)
  [[-1.9, 1.9], [1.9, 1.9], [-1.9, -1.9], [1.9, -1.9]].forEach(([x, y], i) => {
    const z = C.z + Math.sqrt(R * R - x * x - y * y);
    mesh(`Thruster_${i}`, new THREE.CylinderGeometry(1.0, 0.75, 1.2, 18).rotateX(Math.PI / 2).translate(x, C.y + y, z + 0.3), M.plate);
    mesh(`EngineGlow_${i}`, new THREE.CircleGeometry(0.8, 18).translate(x, C.y + y, z + 0.92), M.glow);
  });

  // the monster moves: jaws chomp now and then, claws sway and snap, the slit pupil narrows and
  // widens, the spider eyes blink, the horns' tips pulse
  root.userData.rig = (dt, t) => {
    const chomp = Math.max(0, Math.sin(t * 1.6)) ** 4;
    for (const { g, up } of jaws) g.position.y = C.y + up * (0.15 + 0.9 * chomp);
    for (const c of claws) {
      const s = Math.sin(t * 1.3 + c.phase);
      c.shoulder.rotation.z = 0.12 * s;
      c.elbow.rotation.z = -0.25 * Math.sin(t * 1.3 + c.phase + 0.9);
      const grip = 0.35 * Math.max(0, Math.sin(t * 2.1 + c.phase)) ** 2;
      for (const f of c.fingers) f.rotation.z = -grip;
    }
    pupil.scale.x = 0.8 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.9));
    const blink = (t * 0.7) % 3 < 0.12;
    for (const m of minis) m.visible = !blink;
  };
  return root;
}
