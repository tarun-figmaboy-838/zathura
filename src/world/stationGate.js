import * as THREE from 'three';

// A gate at the end of a journey (taking turns with the broken planet): a space station to fly
// through. A slowly turning habitat ring with lit windows, modules and blinking beacons, solar
// wings out to the sides, and in the middle a docking tunnel lined with rings of guide lights
// that race past as the ship flies through. The tunnel is open at both ends, so from far away you
// see straight through it: it never hides the rocks in front. Passing the tunnel's middle returns
// true from update(). Same interface as PlanetGate (show / hide / update / state / group / radius).

const TUBE_R = 44;       // the tunnel holds the whole lane (±30 by ±11, plus the ship)
const TUBE_L = 170;
const RING_R = 120;

// per sector: the stripes and guide lights
const LOOKS = [
  { stripe: 0xff8a2a, light: [0.25, 0.95, 1.3] },
  { stripe: 0x37c6ff, light: [0.2, 1.1, 0.95] },
  { stripe: 0xd04cff, light: [1.05, 0.4, 1.3] },
  { stripe: 0xff3b2e, light: [1.3, 0.35, 0.22] },
];

export class StationGate {
  constructor(scene) {
    this.radius = TUBE_L / 2;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const spin = new THREE.Group();                       // everything turns slowly about the tunnel
    this.group.add(spin);
    this.spin = spin;

    const M = {
      hull: new THREE.MeshStandardMaterial({ color: 0xc4cad4, metalness: 0.6, roughness: 0.42, envMapIntensity: 1.1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xff8a2a, metalness: 0.3, roughness: 0.5 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x1b2f6b, metalness: 0.5, roughness: 0.3, emissive: 0x0a1840, emissiveIntensity: 0.6 }),
      light: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3.0), toneMapped: false }),
      window: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.9), toneMapped: false }),
      beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false }),
    };
    this.M = M;
    const add = (geo, m, parent = spin) => { const o = new THREE.Mesh(geo, m); parent.add(o); return o; };

    // the docking tunnel: a dark open tube, ribs every 17 units, each with a ring of guide lights
    add(new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_L, 48, 1, true).rotateX(Math.PI / 2), M.dark);
    for (let z = -TUBE_L / 2; z <= TUBE_L / 2 + 0.1; z += 17) {
      add(new THREE.TorusGeometry(TUBE_R - 0.4, 1.4, 8, 64).translate(0, 0, z), M.hull);
      add(new THREE.TorusGeometry(TUBE_R - 1.9, 0.2, 6, 64).translate(0, 0, z + 0.8), M.light);
    }
    // its mouths: heavy collars with stripes
    for (const z of [-TUBE_L / 2, TUBE_L / 2]) {
      add(new THREE.TorusGeometry(TUBE_R + 3, 4.5, 16, 72).translate(0, 0, z), M.hull);
      add(new THREE.TorusGeometry(TUBE_R + 3, 4.6, 16, 72, Math.PI / 6).translate(0, 0, z), M.stripe);
      add(new THREE.TorusGeometry(TUBE_R + 3, 4.6, 16, 72, Math.PI / 6).rotateZ(Math.PI).translate(0, 0, z), M.stripe);
    }

    // the habitat ring around the tunnel's middle, on four spokes, with modules and windows
    add(new THREE.TorusGeometry(RING_R, 10, 24, 128), M.hull);
    add(new THREE.TorusGeometry(RING_R, 10.2, 24, 128, Math.PI / 10).rotateZ(Math.PI / 4), M.stripe);
    add(new THREE.TorusGeometry(RING_R, 10.2, 24, 128, Math.PI / 10).rotateZ(Math.PI * 1.25), M.stripe);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const spoke = add(new THREE.CylinderGeometry(3.2, 3.2, RING_R - TUBE_R - 4, 12), M.hull);
      spoke.position.set(Math.cos(a) * (TUBE_R + RING_R) / 2, Math.sin(a) * (TUBE_R + RING_R) / 2, 0);
      spoke.rotation.z = a - Math.PI / 2;
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const mod = add(new THREE.BoxGeometry(16, 12, 26), M.hull);
      mod.position.set(Math.cos(a) * (RING_R + 13), Math.sin(a) * (RING_R + 13), 0);
      mod.rotation.z = a;
    }
    const win = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.6, 0.4), M.window, 96);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2, side = i % 2 ? 1 : -1;
      e.set(0, 0, a);
      m4.compose(new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, side * 10.1), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      win.setMatrixAt(i, m4);
    }
    spin.add(win);

    // solar wings out to the left and right on long trusses
    for (const sx of [-1, 1]) {
      const truss = add(new THREE.BoxGeometry(150, 3, 3), M.hull);
      truss.position.set(sx * (RING_R + 85), 0, 0);
      for (let k = 0; k < 3; k++) {
        const p = add(new THREE.BoxGeometry(38, 0.8, 30), M.panel);
        p.position.set(sx * (RING_R + 35 + k * 44), 0, 0);
        p.rotation.x = 0.35;
      }
    }

    // blinking beacons on the ring
    this.beacons = [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2;
      const b = add(new THREE.SphereGeometry(2.2, 12, 8), M.beacon);
      b.position.set(Math.cos(a) * (RING_R + 21), Math.sin(a) * (RING_R + 21), 0);
      return b;
    });

    this.state = 'off';
    this.t = 0;
    this.flash = 0;
  }

  show(pos, look = 0) {
    const L = LOOKS[Math.min(look, LOOKS.length - 1)];
    this.M.stripe.color.set(L.stripe);
    this.M.light.color.setRGB(...L.light);
    this.lightBase = this.M.light.color.clone();
    this.group.position.copy(pos);
    this.group.visible = true;
    this.state = 'in';
    this.t = 0;
    this.flash = 0;
  }

  hide() {
    this.state = 'off';
    this.group.visible = false;
  }

  update(dt, time, shipPos) {
    if (this.state === 'off') return false;
    this.t += dt;
    const dz = this.group.position.z - shipPos.z;
    let crossed = false;
    if (this.state === 'in' && dz > -1) {
      this.state = 'out';
      this.flash = 1;
      crossed = true;
    }
    this.spin.rotation.z += dt * 0.12;
    const blink = Math.sin(time * 5) > 0.6;
    this.beacons.forEach((b, i) => { b.visible = i % 2 ? blink : !blink; });
    this.flash = Math.max(0, this.flash - dt * 1.2);
    // the guide lights pulse a little as the ship lines up for the tunnel (kept soft: no glare inside)
    const near = Math.min(1, Math.max(0, 1 - (-dz - this.radius) / 700));
    this.M.light.color.copy(this.lightBase).multiplyScalar(0.8 + 0.25 * near * (0.5 + 0.5 * Math.sin(time * 6)) + this.flash);
    if (this.state === 'out' && dz > this.radius + 400) this.hide();
    return crossed;
  }
}
