import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The Warden as a giant virus drone: a big spiked purple-and-gold metal ball with one huge eye on
// top (the core) under a stern gold-edged brow and a little crown, and four turrets on short arms.
// It matches its portrait, assets/ui/face-warden-drone.webp. Built here in code with the node
// names the boss code relies on, at the same spots as the carrier's (the angle battles stay the
// same): Core, Hangar, TurretHead_0..3 (turn to aim) with TurretMuzzle_0..3, EngineGlow_0..3.
// Forward is -Z, like the glTF models.

const C = new THREE.Vector3(0, -2.5, 0);       // the ball's centre
const R = 7.6;
const CORE = new THREE.Vector3(0, 4.51, 1);    // the eye, looking up at the battle camera
const TURRETS = [[-4.2, 3.13, -8.5], [4.2, 3.13, -8.5], [-5.6, 3.95, 6.5], [5.6, 3.95, 6.5]].map((p) => new THREE.Vector3(...p));
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

// which materials flash when hit / glow as the core, and where it bursts when it dies
const LOOK = {
  hull: ['WardenShell', 'WardenPlate'],
  core: 'WardenCore',
  glow: 'WardenGlow',
  panel: { scale: 0.5, seam: 0.45, grime: 0.18, chips: 0.2, soot: [0, 0, 0] },
  pops: [[0, 0, 0, 6], [0, 0, -5, 3], [0, 0, 5, 3], [5, 0, 0, 3], [-5, 0, 0, 3],
    ...TURRETS.map((p) => [p.x, 0, p.z, 1.5])],
};

const mat = (name, props) => Object.assign(new THREE.MeshStandardMaterial(props), { name });

// geometry made along +Y, turned to direction d and moved out to distance `at` from point o
function along(geo, d, at, o = C) {
  _q.setFromUnitVectors(_y, d);
  return geo.applyQuaternion(_q).translate(o.x + d.x * at, o.y + d.y * at, o.z + d.z * at);
}

export function makeWardenDrone() {
  const M = {
    shell: mat('WardenShell', { color: 0x3d3556, metalness: 0.65, roughness: 0.32 }),
    plate: mat('WardenPlate', { color: 0x6c4ea0, metalness: 0.8, roughness: 0.28 }),
    gold: mat('WardenGold', { color: 0xd9a640, metalness: 1, roughness: 0.25 }),
    spike: mat('WardenSpike', { color: 0x8a8597, metalness: 0.85, roughness: 0.3 }),
    dark: mat('WardenDark', { color: 0x0b0a10, metalness: 0.3, roughness: 0.7 }),
    glow: mat('WardenGlow', { color: 0x000000, emissive: new THREE.Color(1, 0.1, 0.02), emissiveIntensity: 3.2, roughness: 0.5 }),
    core: mat('WardenCore', { color: 0x000000, emissive: new THREE.Color(1, 0.2, 0.04), emissiveIntensity: 4.6, roughness: 0.4 }),
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

  // ---- the ball, a gold band round its middle, and its spikes
  mesh('Body', new THREE.SphereGeometry(R, 64, 40).translate(C.x, C.y, C.z), M.shell);
  mesh('Band', new THREE.TorusGeometry(R * 1.006, 0.32, 10, 120).rotateX(Math.PI / 2).translate(C.x, C.y, C.z), M.gold);
  const eyeDir = CORE.clone().sub(C).normalize();
  const clear = [[eyeDir, 0.74], [new THREE.Vector3(0, 0, -1), 0.93], [new THREE.Vector3(0, 0, 1), 0.87],
    ...TURRETS.map((p) => [p.clone().sub(C).normalize(), 0.9])];
  const stalks = [], collars = [], bulbs = [];
  const N = 70, d = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    d.set(Math.cos(a) * r, y, Math.sin(a) * r);
    if (clear.some(([c, k]) => d.dot(c) > k)) continue;
    stalks.push(along(new THREE.CylinderGeometry(0.22, 0.5, 2.6, 10).translate(0, 1.3, 0), d, R - 0.2));
    collars.push(along(new THREE.CylinderGeometry(0.8, 0.95, 0.35, 16), d, R + 0.05));
    bulbs.push(along(new THREE.SphereGeometry(0.6, 16, 12), d, R + 2.7));
  }
  mesh('Spikes', mergeGeometries(stalks), M.spike);
  mesh('Collars', mergeGeometries(collars), M.plate);
  mesh('SpikeTips', mergeGeometries(bulbs), M.glow);

  // ---- the eye on top: socket, gold rim, the glowing core, and a stern brow with a little crown
  mesh('Socket', new THREE.CylinderGeometry(2.9, 2.9, 1.6, 48).translate(CORE.x, CORE.y - 0.4, CORE.z), M.dark);
  mesh('Bezel', new THREE.TorusGeometry(2.95, 0.5, 14, 64).rotateX(Math.PI / 2).translate(CORE.x, CORE.y + 0.44, CORE.z), M.gold);
  const core = new THREE.Group();
  core.name = 'Core';
  core.position.copy(CORE);
  root.add(core);
  mesh('Iris', new THREE.SphereGeometry(2.45, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, 0.34, 0), M.core, core);
  mesh('Pupil', new THREE.RingGeometry(0.7, 1.05, 40).rotateX(-Math.PI / 2).translate(0, 1.36, 0), M.dark, core);
  // the brow: a heavy plate over the back of the eye, edged in gold, tilted for a smug look
  const brow = new THREE.Group();
  brow.name = 'Brow';
  brow.rotation.y = 0.16;
  core.add(brow);
  mesh('Lid', new THREE.CircleGeometry(2.8, 40, Math.PI, Math.PI).rotateX(-Math.PI / 2).translate(0, 1.42, 0.85), M.plate, brow);
  mesh('LidEdge', new THREE.CylinderGeometry(0.24, 0.24, 5.6, 12).rotateZ(Math.PI / 2).translate(0, 1.46, 0.85), M.gold, brow);
  const crown = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.18 + 0.64 * (i / 6));                     // an arc behind the brow
    const x = Math.cos(a) * 4.4, z = CORE.z + Math.sin(a) * 4.4;
    const h = C.y + Math.sqrt(R * R - x * x - z * z) - 0.3;
    const out = new THREE.Vector3(x, 0, z - CORE.z).normalize().multiplyScalar(0.45).add(_y).normalize();
    crown.push(along(new THREE.ConeGeometry(0.5, i % 3 === 0 ? 2.2 : 1.6, 10).translate(0, 0.8, 0), out, 0, new THREE.Vector3(x, h, z)));
  }
  mesh('Crown', mergeGeometries(crown), M.gold);

  // ---- four turrets on short arms (the head turns to aim; the muzzle is where shots leave)
  TURRETS.forEach((p, i) => {
    const toward = p.clone().sub(C);
    const len = toward.length();
    toward.normalize();
    mesh(`TurretArm_${i}`, along(new THREE.CylinderGeometry(0.75, 1.15, len - R - 0.6, 14).translate(0, (len - R - 0.6) / 2, 0), toward, R - 0.5), M.plate);
    mesh(`TurretCollar_${i}`, along(new THREE.CylinderGeometry(1.6, 1.8, 0.5, 20), toward, R + 0.05), M.gold);
    mesh(`TurretBase_${i}`, new THREE.SphereGeometry(1.5, 24, 16).scale(1, 0.7, 1).translate(p.x, p.y - 0.7, p.z), M.plate);
    const head = new THREE.Group();
    head.name = `TurretHead_${i}`;
    head.position.copy(p);
    root.add(head);
    mesh(`TurretDome_${i}`, new THREE.SphereGeometry(1.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.shell, head);
    for (const sx of [-1, 1]) {
      mesh(`TurretBarrel_${i}_${sx}`, new THREE.CylinderGeometry(0.2, 0.26, 3, 10).rotateX(Math.PI / 2).translate(sx * 0.42, 0.5, -1.9), M.dark, head);
    }
    mesh(`TurretEye_${i}`, new THREE.CircleGeometry(0.36, 20).rotateY(Math.PI).translate(0, 0.55, -1.14), M.glow, head);
    const muzzle = new THREE.Object3D();
    muzzle.name = `TurretMuzzle_${i}`;
    muzzle.position.set(0, 0.5, -3.45);
    head.add(muzzle);
  });

  // ---- the hangar hatch at the front (small drones launch from here) and four engines behind
  const hatchZ = C.z - Math.sqrt(R * R - 1.6 * 1.6);
  mesh('HangarMouth', new THREE.CircleGeometry(1.6, 32).rotateY(Math.PI).translate(C.x, C.y, C.z - R - 0.02), M.dark);
  mesh('HangarRim', new THREE.TorusGeometry(1.6, 0.3, 10, 40).translate(C.x, C.y, hatchZ - 0.05), M.gold);
  const hangar = new THREE.Object3D();
  hangar.name = 'Hangar';
  hangar.position.set(C.x, C.y, C.z - R - 0.8);
  root.add(hangar);
  [[-1.9, 1.9], [1.9, 1.9], [-1.9, -1.9], [1.9, -1.9]].forEach(([x, y], i) => {
    const z = C.z + Math.sqrt(R * R - x * x - y * y);
    mesh(`Thruster_${i}`, new THREE.CylinderGeometry(1.0, 0.75, 1.2, 18).rotateX(Math.PI / 2).translate(x, C.y + y, z + 0.3), M.plate);
    mesh(`EngineGlow_${i}`, new THREE.CircleGeometry(0.8, 18).translate(x, C.y + y, z + 0.92), M.glow);
  });
  return root;
}
