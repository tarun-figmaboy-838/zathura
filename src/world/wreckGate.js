import * as THREE from 'three';
import { GateBase, seeded } from './gateBase.js';

// A journey gate: the broken-open hull of a giant derelict starship lying along the route. You fly
// in at its shattered bow and out of its stern, between rows of bare ribs and torn hull plates,
// past warning lamps that still flicker; a dead bridge tower rides on its back. Everything stays
// outside a radius of 52 around the lane (the lane plus the ship fit in 38).

const HL = 140;         // half its length
const HR = 60;          // the hull's radius

// per sector: the warning lamps' colour
const LOOKS = [[2.4, 1.2, 0.3], [0.4, 1.8, 2.4], [2.2, 0.5, 2.4], [2.6, 0.35, 0.25]];

export class WreckGate extends GateBase {
  constructor(scene) {
    super(scene, HL);
    const r = seeded(321);
    // a faint self-glow keeps its outline readable against space even with the sun behind it
    const hull = new THREE.MeshStandardMaterial({ color: 0x8a959e, metalness: 0.65, roughness: 0.5, envMapIntensity: 1.4, side: THREE.DoubleSide,
      emissive: 0x1e2830 });
    const rust = new THREE.MeshStandardMaterial({ color: 0xa8653a, metalness: 0.4, roughness: 0.75, envMapIntensity: 1.0, side: THREE.DoubleSide,
      emissive: 0x2a160c });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4248, metalness: 0.6, roughness: 0.6, envMapIntensity: 1.1 });
    this.lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(...LOOKS[0]), toneMapped: false });
    this.window = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.7), toneMapped: false });
    const body = new THREE.Group();
    body.rotation.z = 0.22;                       // it lies a little on its side
    this.group.add(body);
    const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); body.add(o); return o; };

    // ribs: arches round the lane, some snapped short; the bow end ones are the most broken
    this.lamps = [];
    for (let i = 0; i < 14; i++) {
      const z = -HL + 10 + i * 20;
      const bow = (z + HL) / (2 * HL);               // 0 stern .. 1 bow
      const arc = Math.PI * 2 * (bow > 0.8 ? 0.35 + r() * 0.3 : 0.65 + r() * 0.3);
      const rib = add(new THREE.TorusGeometry(HR, 2.4, 8, 72, arc), i % 3 ? hull : rust, 0, 0, z);
      rib.rotation.z = -Math.PI / 2 + (r() - 0.5) * 1.2;     // the gap mostly underneath
      if (i % 2 === 0) {
        const a = rib.rotation.z + arc * (0.2 + r() * 0.6);
        const l = add(new THREE.SphereGeometry(1.2, 8, 6), this.lamp, Math.cos(a) * (HR - 3), Math.sin(a) * (HR - 3), z);
        l.userData.phase = r() * 10;
        this.lamps.push(l);
      }
    }
    // torn hull plates between the ribs, with holes; none on the shattered bow
    for (let i = 0; i < 26; i++) {
      const z = -HL + 20 + Math.floor(r() * 10) * 20;
      const t0 = r() * Math.PI * 2, len = 0.5 + r() * 1.1;
      const plate = add(new THREE.CylinderGeometry(HR + 1.5, HR + 1.5, 16 + r() * 4, 16, 1, true, t0, len).rotateX(Math.PI / 2), r() < 0.3 ? rust : hull, 0, 0, z);
      plate.rotation.z = (r() - 0.5) * 0.2;
    }
    // spine and a broken keel; the dead bridge tower on top with a few lit windows
    add(new THREE.BoxGeometry(7, 6, 2 * HL), dark, 0, HR + 3, 0);
    add(new THREE.BoxGeometry(6, 5, HL * 0.9), dark, 0, -HR - 3, -HL * 0.45);
    add(new THREE.BoxGeometry(6, 5, HL * 0.5), dark, 0, -HR - 3, HL * 0.35).rotation.x = 0.08;
    add(new THREE.BoxGeometry(30, 22, 40), hull, 0, HR + 17, -HL * 0.55);
    add(new THREE.BoxGeometry(20, 12, 26), hull, 0, HR + 33, -HL * 0.6);
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(2.4, 1.4, 0.4), this.window, -7.5 + i * 3, HR + 34, -HL * 0.6 + 13.3);
    // the stern: two dead engine bells beside the exit
    for (const sx of [-1, 1]) {
      const bell = add(new THREE.CylinderGeometry(16, 24, 30, 24, 1, true).rotateX(Math.PI / 2), dark, sx * (HR + 22), -10, -HL - 6);
      bell.material = dark;
    }
    // big warning beacons round the broken bow, so you see where to fly in from far away
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      add(new THREE.SphereGeometry(3.6, 12, 8), this.lamp, Math.cos(a) * (HR + 5), Math.sin(a) * (HR + 5), HL - 12);
    }
    // drifting scraps around the bow
    this.scraps = [];
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2, rad = HR + 14 + r() * 50;
      const s = add(new THREE.BoxGeometry(4 + r() * 9, 0.6, 3 + r() * 7), r() < 0.5 ? hull : rust, Math.cos(a) * rad, Math.sin(a) * rad, HL - r() * 60);
      s.userData.spin = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5);
      this.scraps.push(s);
    }
  }

  setLook(i) { this.lamp.color.setRGB(...LOOKS[i]); this.lampBase = this.lamp.color.clone(); }

  animate(dt, time) {
    // the old lamps flicker on and off, each in its own rhythm
    for (const l of this.lamps) l.visible = Math.sin(time * 7 + l.userData.phase) + Math.sin(time * 2.3 + l.userData.phase * 2) > -0.4;
    this.lamp.color.copy(this.lampBase);
    for (const s of this.scraps) {
      s.rotation.x += s.userData.spin.x * dt * 0.6;
      s.rotation.y += s.userData.spin.y * dt * 0.6;
    }
  }
}
