import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, rod, eye, gun, engine } from './droneParts.js';

// The phage drone (sector 2): a robot shaped like a bacteriophage virus, a faceted teal gem head
// with one big lime eye on a ribbed neck, and six jointed legs that paddle while it hovers. It
// matches its portrait, assets/ui/face-phage.webp. Node names the raider code relies on: Gun_L /
// Gun_R, EngineGlow_L / EngineGlow_R; Hinge_0..5 are the legs (phageRig moves them).
// Forward is -Z.

const LOOK = {
  hull: ['PhageShell', 'PhagePlate'],
  glow: 'PhageGlow',
  panel: { scale: 1.6, seam: 0.4, grime: 0.12, chips: 0.25, soot: [0, 0, 0] },
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function makePhageDrone() {
  const M = {
    shell: mat('PhageShell', { color: 0x2f7a72, metalness: 0.75, roughness: 0.3, flatShading: true }),
    plate: mat('PhagePlate', { color: 0x9aa4ad, metalness: 0.85, roughness: 0.28 }),
    dark: mat('PhageDark', { color: 0x0a0d0d, metalness: 0.3, roughness: 0.7 }),
    glow: mat('PhageGlow', { color: 0x000000, emissive: new THREE.Color(0.35, 1, 0.1), emissiveIntensity: 1.9, roughness: 0.5 }),
  };
  const root = new THREE.Group();
  root.name = 'PhageDrone';
  root.userData.look = LOOK;
  const mesh = (name, geo, m, parent = root) => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    parent.add(o);
    return o;
  };

  // the head: a faceted gem with one big eye, two little cannons under it, engines behind
  mesh('Head', new THREE.IcosahedronGeometry(1.45, 0).translate(0, 0.65, 0), M.shell);
  eye(root, { at: V(0, 0.72, -1.32), r: 0.62, lid: 0.3, tilt: 0.25, M });
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    gun(root, side, V(sx * 0.62, -0.32, -1.05), M);
    engine(root, side, V(sx * 0.45, 0.65, 1.3), M, 0.22);
  }

  // the ribbed neck and the six-sided base the legs hang from
  mesh('Neck', new THREE.CylinderGeometry(0.3, 0.3, 1.0, 12).translate(0, -1.15, 0), M.plate);
  mesh('NeckRibs', mergeGeometries([-0.82, -1.07, -1.32, -1.57].map((y) => new THREE.TorusGeometry(0.38, 0.085, 8, 24)
    .rotateX(Math.PI / 2).translate(0, y, 0))), M.plate);
  mesh('Base', new THREE.CylinderGeometry(0.85, 0.95, 0.28, 6).translate(0, -1.78, 0), M.shell);

  // six legs: thigh up to a knee, shin down to a glowing foot; each swings on its hinge
  const knee = V(1.25, 0.85, 0), foot = V(2.25, -0.9, 0), zero = V(0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const leg = new THREE.Group();
    leg.position.set(0, -1.78, 0);
    leg.rotation.y = (i + 0.5) * (Math.PI / 3);
    root.add(leg);
    const hinge = new THREE.Group();
    hinge.name = `Hinge_${i}`;
    hinge.position.x = 0.8;
    leg.add(hinge);
    mesh(`Thigh_${i}`, rod(zero, knee, 0.13, 0.1), M.plate, hinge);
    mesh(`Shin_${i}`, rod(knee, foot, 0.1, 0.06), M.plate, hinge);
    mesh(`Knee_${i}`, new THREE.SphereGeometry(0.16, 12, 8).translate(knee.x, knee.y, knee.z), M.shell, hinge);
    mesh(`Foot_${i}`, new THREE.SphereGeometry(0.17, 12, 8).translate(foot.x, foot.y, foot.z), M.glow, hinge);
  }
  return root;
}

// the legs paddle in a wave
export function phageRig(model) {
  const hinges = [0, 1, 2, 3, 4, 5].map((i) => model.getObjectByName(`Hinge_${i}`));
  return (dt, t, r) => {
    hinges.forEach((h, i) => { h.rotation.z = 0.2 * Math.sin(t * 5 + i * 1.05 + r.seed); });
  };
}
