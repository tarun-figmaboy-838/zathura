import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The virus drone: a robot shaped like a virus (a spiked metal ball with one glowing eye), so the
// student only ever destroys machines. It matches its portrait, assets/ui/face-drone.webp.
// Built here in code, with the node names the raider code relies on: Gun_L / Gun_R (muzzles),
// EngineGlow_L / EngineGlow_R (plumes), Eye, and Shell (the spiked ball, which turns slowly).
// Forward is -Z, like the glTF models.

const R = 2.3;                      // the ball
const FRONT = new THREE.Vector3(0, 0, -1);
const BACK = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

// which materials flash when hit / pulse (see Raider in raiders.js)
const LOOK = {
  hull: ['DroneShell', 'DronePlate'],
  glow: 'DroneGlow',
  panel: { scale: 1.3, seam: 0.45, grime: 0.15, chips: 0.3, soot: [0, 0, 0] },
};

const mat = (name, props) => Object.assign(new THREE.MeshStandardMaterial(props), { name });

// a part along direction d: geometry made along +Y, moved out to distance `at`
function along(geo, d, at) {
  _q.setFromUnitVectors(_y, d);
  return geo.applyQuaternion(_q).translate(d.x * at, d.y * at, d.z * at);
}

export function makeVirusDrone() {
  const M = {
    shell: mat('DroneShell', { color: 0x5b5f6b, metalness: 0.7, roughness: 0.32 }),
    plate: mat('DronePlate', { color: 0x80858f, metalness: 0.8, roughness: 0.26 }),
    spike: mat('DroneSpike', { color: 0x8d929d, metalness: 0.85, roughness: 0.28 }),
    dark: mat('DroneDark', { color: 0x0b0b0e, metalness: 0.4, roughness: 0.35 }),
    glow: mat('DroneGlow', { color: 0x000000, emissive: new THREE.Color(1, 0.26, 0.06), emissiveIntensity: 3.6, roughness: 0.5 }),
  };
  const mesh = (name, geo, m, parent) => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    parent.add(o);
    return o;
  };

  const root = new THREE.Group();
  root.name = 'VirusDrone';
  root.userData.look = LOOK;

  // ---- the spiked ball (turns around the forward axis; the eye, guns and engines stay put)
  const shell = new THREE.Group();
  shell.name = 'Shell';
  root.add(shell);
  mesh('Body', new THREE.SphereGeometry(R, 48, 32), M.shell, shell);
  // spikes spread evenly (a Fibonacci sphere), leaving the eye and the engines clear
  const stalks = [], bulbs = [];
  const N = 36, d = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
    d.set(Math.cos(a) * r, y, Math.sin(a) * r);
    if (d.dot(FRONT) > 0.5 || d.dot(BACK) > 0.7) continue;
    stalks.push(along(new THREE.CylinderGeometry(0.08, 0.17, 0.95, 8).translate(0, 0.47, 0), d, R - 0.08));
    stalks.push(along(new THREE.CylinderGeometry(0.3, 0.36, 0.14, 14), d, R + 0.02));       // collar
    bulbs.push(along(new THREE.SphereGeometry(0.27, 14, 10), d, R + 0.98));
  }
  mesh('Spikes', mergeGeometries(stalks), M.spike, shell);
  mesh('SpikeTips', mergeGeometries(bulbs), M.glow, shell);

  // ---- the face: a band around the ball, one big eye with a cheeky lid, two little cannons
  const front = new THREE.Group();
  front.name = 'Front';
  root.add(front);
  mesh('Band', new THREE.TorusGeometry(R * 1.005, 0.1, 8, 72), M.plate, front);

  const eye = new THREE.Group();
  eye.name = 'Eye';
  eye.rotation.x = 0.32;              // looks a little up, so the top-down battle camera sees it
  front.add(eye);
  const z = -Math.sqrt(R * R - 0.95 * 0.95);                     // where the eye's rim meets the ball
  mesh('Socket', new THREE.CylinderGeometry(0.95, 0.95, 0.4, 40).rotateX(Math.PI / 2).translate(0, 0, z - 0.05), M.dark, eye);
  mesh('Bezel', new THREE.TorusGeometry(0.95, 0.17, 12, 48).translate(0, 0, z - 0.25), M.plate, eye);
  mesh('Iris', new THREE.CircleGeometry(0.62, 40).rotateY(Math.PI).translate(0, 0, z - 0.27), M.glow, eye);
  mesh('Pupil', new THREE.RingGeometry(0.2, 0.3, 32).rotateY(Math.PI).translate(0, 0, z - 0.29), M.dark, eye);
  // the lid: a half disc over the top of the eye, tilted for a smirk, and a brow plate on top
  mesh('Lid', new THREE.CircleGeometry(0.8, 32, 0, Math.PI).rotateZ(-0.22).translate(0, 0.25, 0).rotateY(Math.PI)
    .translate(0, 0, z - 0.31), M.plate, eye);
  mesh('Brow', new THREE.TorusGeometry(0.98, 0.15, 10, 24, Math.PI * 0.82).rotateZ(Math.PI * 0.09 + 0.22)
    .translate(0, 0, z - 0.2), M.plate, eye);

  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    const at = new THREE.Vector3(sx * 1.25, -0.75, -1.72);
    mesh(`GunMount_${side}`, new THREE.SphereGeometry(0.34, 16, 12).translate(at.x, at.y, at.z), M.plate, front);
    mesh(`Barrel_${side}`, new THREE.CylinderGeometry(0.11, 0.15, 0.85, 10).rotateX(Math.PI / 2)
      .translate(at.x, at.y, at.z - 0.42), M.dark, front);
    const muzzle = new THREE.Object3D();
    muzzle.name = `Gun_${side}`;
    muzzle.position.set(at.x, at.y, at.z - 0.88);
    front.add(muzzle);

    // engines on the back
    mesh(`Nozzle_${side}`, new THREE.CylinderGeometry(0.42, 0.3, 0.55, 16).rotateX(Math.PI / 2)
      .translate(sx * 0.65, 0, R - 0.12), M.plate, front);
    const glow = mesh(`EngineGlow_${side}`, new THREE.CircleGeometry(0.3, 16), M.glow, front);
    glow.position.set(sx * 0.65, 0, R + 0.16);
  }
  return root;
}
