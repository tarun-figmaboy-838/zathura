import * as THREE from 'three';

// Shared pieces for the drones built in code (phageDrone.js, swarmDrone.js).

export const mat = (name, props) => Object.assign(new THREE.MeshStandardMaterial(props), { name });

const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// a tapered rod from point a (radius r0) to point b (radius r1)
export function rod(a, b, r0, r1, seg = 8) {
  _d.subVectors(b, a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg).translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _d.normalize());
  return g.applyQuaternion(_q).translate(a.x, a.y, a.z);
}

// a cartoon camera eye looking along -Z with its front at `at`: a socket, a rim, a glowing iris,
// a pupil ring and a tilted lid over the top (lid: how high its edge sits, in eye radii).
// M needs plate, dark and glow materials.
export function eye(parent, { at, r, lid = 0.3, tilt = -0.22, M, name = 'Eye' }) {
  const g = new THREE.Group();
  g.name = name;
  g.position.copy(at);
  parent.add(g);
  const add = (geo, m) => g.add(new THREE.Mesh(geo, m));
  add(new THREE.CylinderGeometry(r, r, r * 0.9, 32).rotateX(Math.PI / 2).translate(0, 0, r * 0.45), M.dark);
  add(new THREE.TorusGeometry(r, r * 0.17, 10, 36).translate(0, 0, -0.02), M.plate);
  add(new THREE.CircleGeometry(r * 0.68, 32).rotateY(Math.PI).translate(0, 0, -0.03), M.glow);
  add(new THREE.RingGeometry(r * 0.22, r * 0.33, 28).rotateY(Math.PI).translate(0, 0, -0.045), M.dark);
  add(new THREE.CircleGeometry(r * 0.86, 28, 0, Math.PI).rotateZ(tilt).translate(0, lid * r, 0).rotateY(Math.PI)
    .translate(0, 0, -0.06), M.plate);
  return g;
}

// an empty marking where shots leave (Gun_L / Gun_R) and a small barrel behind it, along -Z
export function gun(parent, side, at, M, { r = 0.12, len = 0.7 } = {}) {
  parent.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(r * 1.9, 14, 10).translate(at.x, at.y, at.z), M.plate), { name: `GunMount_${side}` }));
  parent.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 10).rotateX(-Math.PI / 2)
    .translate(at.x, at.y, at.z - len / 2), M.dark), { name: `Barrel_${side}` }));
  const muzzle = new THREE.Object3D();
  muzzle.name = `Gun_${side}`;
  muzzle.position.set(at.x, at.y, at.z - len - 0.05);
  parent.add(muzzle);
}

// a small engine facing +Z with its glow disc (EngineGlow_L / EngineGlow_R: the plumes attach there)
export function engine(parent, side, at, M, r = 0.26) {
  parent.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r * 0.9, r * 1.6, 14).rotateX(Math.PI / 2)
    .translate(at.x, at.y, at.z), M.plate), { name: `Nozzle_${side}` }));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(r, 14), M.glow);
  glow.name = `EngineGlow_${side}`;
  glow.position.set(at.x, at.y, at.z + r * 0.82);
  parent.add(glow);
}
