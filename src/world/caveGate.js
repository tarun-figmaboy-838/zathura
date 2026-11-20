import * as THREE from 'three';
import { GateBase, seeded } from './gateBase.js';

// A journey gate: a giant asteroid with a cave bored right through it. The outside is a lumpy,
// faceted rock; the tunnel inside is rough-walled and lined with glowing crystals that flash past,
// with bigger crystal clusters around the cave mouth so you see where to fly from far away.
// The tunnel's walls never come inside a radius of 44 (the lane plus the ship fit in 38).

const L = 115;          // half the length of the tunnel
const RMAX = 165;       // the asteroid's widest radius
const TUN = 50;         // the tunnel's radius (its rough walls only go outward from here)

// crystal colours per sector
const LOOKS = [[0.35, 1.3, 1.6], [0.5, 1.6, 0.9], [1.4, 0.45, 1.6], [1.7, 0.35, 0.25]];

const lump = (a, z) => 0.5 * Math.sin(3 * a + 1.3 + z * 0.02) + 0.3 * Math.sin(7 * a - z * 0.05 + 2) + 0.2 * Math.sin(13 * a + z * 0.09);

export class CaveGate extends GateBase {
  constructor(scene) {
    super(scene, L);
    const r = seeded(97);
    // the outside: a long tube that bulges into a rock and closes onto the tunnel at both mouths
    const outer = new THREE.CylinderGeometry(1, 1, 2 * L, 160, 70, true).rotateX(Math.PI / 2);
    const p = outer.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getY(i), p.getX(i)), z = p.getZ(i);
      const shape = Math.sqrt(Math.max(0, 1 - (z / L) ** 2));
      const rad = TUN + (RMAX - TUN) * shape * (1 + 0.24 * lump(a, z));
      p.setXYZ(i, Math.cos(a) * rad, Math.sin(a) * rad * (1 - 0.15 * shape), z);
    }
    outer.computeVertexNormals();
    // the tunnel: rough walls, only ever pushed outward, smooth where they meet the mouths
    const inner = new THREE.CylinderGeometry(1, 1, 2 * L, 96, 60, true).rotateX(Math.PI / 2);
    const q = inner.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const a = Math.atan2(q.getY(i), q.getX(i)), z = q.getZ(i);
      const fade = 1 - (Math.abs(z) / L) ** 4;
      const rad = TUN + 10 * fade * (0.5 + 0.5 * lump(a * 2, z * 3));
      q.setXYZ(i, Math.cos(a) * rad, Math.sin(a) * rad, z);
    }
    inner.computeVertexNormals();
    this.rock = new THREE.MeshStandardMaterial({ color: 0x9a8c80, roughness: 0.9, metalness: 0, flatShading: true, envMapIntensity: 1.1 });
    this.wall = new THREE.MeshStandardMaterial({ color: 0x2c2724, roughness: 0.95, metalness: 0, flatShading: true, side: THREE.BackSide,
      envMapIntensity: 0.3, emissive: 0x000000 });
    this.group.add(new THREE.Mesh(outer, this.rock), new THREE.Mesh(inner, this.wall));

    // crystals: along the tunnel walls (leaning with the flight so they never poke into the lane)
    // and in clusters around both mouths
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(...LOOKS[0]), toneMapped: false });
    const geo = new THREE.OctahedronGeometry(1, 0).scale(0.32, 1, 0.32);
    const crystals = new THREE.InstancedMesh(geo, this.glow, 120);
    const m = new THREE.Matrix4(), quat = new THREE.Quaternion();
    let n = 0;
    const put = (pos, dir, len) => {
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      m.compose(pos, quat, new THREE.Vector3(len, len, len));
      crystals.setMatrixAt(n++, m);
    };
    for (let i = 0; i < 64; i++) {
      const a = r() * Math.PI * 2, z = -L + 12 + r() * (2 * L - 24), len = 5 + r() * 6;
      const out = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const base = out.clone().multiplyScalar(TUN + 7).setZ(z);
      put(base, out.clone().negate().multiplyScalar(0.55).add(new THREE.Vector3(0, 0, r() < 0.5 ? 1 : -1)), len);
    }
    for (const zEnd of [L, -L]) {
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, rad = TUN + 6 + r() * 26, len = 6 + r() * 12;
        const out = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
        put(out.clone().multiplyScalar(rad).setZ(zEnd * (1 - 0.06 * r())), out.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0, Math.sign(zEnd) * 0.9)), len);
      }
    }
    crystals.count = n;
    this.group.add(crystals);
  }

  setLook(i) {
    this.base = new THREE.Color(...LOOKS[i]);
    this.glow.color.copy(this.base);
    this.wall.emissive.copy(this.base).multiplyScalar(0.04);      // a faint crystal light on the walls
  }

  animate(dt, time, near) {
    this.glow.color.copy(this.base).multiplyScalar(0.8 + 0.25 * Math.sin(time * 3) + 0.3 * near);
    this.group.rotation.z += dt * 0.03;                           // the rock turns slowly about the tunnel
  }
}
