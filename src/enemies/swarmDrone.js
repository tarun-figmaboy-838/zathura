import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, rod, eye, gun, engine } from './droneParts.js';

// The swarm drone (sector 3): three little spiked virus balls, each with its own eye, on arms
// around a silver hub with a glowing ring, like a fidget spinner; the trio circles the hub. It
// matches its portrait, assets/ui/face-swarm.webp. Node names the raider code relies on: Gun_L /
// Gun_R, EngineGlow_L / EngineGlow_R; Orbit (turns) and Mini_0..2 (swarmRig moves them).
// Forward is -Z.

const LOOK = {
  hull: ['SwarmShell', 'SwarmPlate'],
  glow: 'SwarmGlow',
  panel: { scale: 2.2, seam: 0.4, grime: 0.12, chips: 0.25, soot: [0, 0, 0] },
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ORBIT_R = 1.95;
const BALL_R = 0.78;

export function makeSwarmDrone() {
  const M = {
    shell: mat('SwarmShell', { color: 0x6a3d78, metalness: 0.65, roughness: 0.3, emissive: 0x1c0a24 }),
    plate: mat('SwarmPlate', { color: 0xb8bcc8, metalness: 0.9, roughness: 0.22 }),
    dark: mat('SwarmDark', { color: 0x0c0a0e, metalness: 0.3, roughness: 0.7 }),
    glow: mat('SwarmGlow', { color: 0x000000, emissive: new THREE.Color(1, 0.08, 0.8), emissiveIntensity: 1.8, roughness: 0.5 }),   // magenta (brighter washes to white)
  };
  const root = new THREE.Group();
  root.name = 'SwarmDrone';
  root.userData.look = LOOK;
  const mesh = (name, geo, m, parent = root) => {
    const o = new THREE.Mesh(geo, m);
    o.name = name;
    parent.add(o);
    return o;
  };

  // the hub: silver ball, glowing ring, its own eye, cannons and engines
  mesh('Hub', new THREE.SphereGeometry(0.8, 28, 20), M.plate);
  mesh('HubRing', new THREE.TorusGeometry(0.98, 0.09, 8, 40).rotateX(Math.PI / 2), M.glow);
  eye(root, { at: V(0, 0.08, -0.86), r: 0.4, lid: 0.3, tilt: -0.3, M });
  for (const [side, sx] of [['L', -1], ['R', 1]]) {
    gun(root, side, V(sx * 0.36, -0.42, -0.66), M, { r: 0.09, len: 0.5 });
    engine(root, side, V(sx * 0.32, 0, 0.82), M, 0.18);
  }

  // the trio, on a frame that turns around the hub
  const orbit = new THREE.Group();
  orbit.name = 'Orbit';
  root.add(orbit);
  const arms = [];
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI * 5) / 6 + (i * Math.PI * 2) / 3;      // the front starts clear
    const out = V(Math.cos(a), 0, -Math.sin(a));
    arms.push(rod(out.clone().multiplyScalar(0.7), out.clone().multiplyScalar(ORBIT_R - BALL_R + 0.1), 0.12, 0.09));
    const mini = new THREE.Group();
    mini.name = `Mini_${i}`;
    mini.position.copy(out).multiplyScalar(ORBIT_R);
    orbit.add(mini);
    mesh(`Ball_${i}`, new THREE.SphereGeometry(BALL_R, 28, 20), M.shell, mini);
    // short spikes all round, clear of the eye (which looks outward) and the arm
    const stalks = [], tips = [], d = V(0, 0, 0);
    for (let k = 0; k < 16; k++) {
      const y = 1 - (2 * (k + 0.5)) / 16, rr = Math.sqrt(1 - y * y), b = k * Math.PI * (3 - Math.sqrt(5));
      d.set(Math.cos(b) * rr, y, Math.sin(b) * rr);
      if (d.dot(out) > 0.55 || d.dot(out) < -0.75) continue;
      stalks.push(rod(d.clone().multiplyScalar(BALL_R - 0.05), d.clone().multiplyScalar(BALL_R + 0.4), 0.1, 0.05, 6));
      tips.push(new THREE.SphereGeometry(0.14, 10, 8).translate(d.x * (BALL_R + 0.48), d.y * (BALL_R + 0.48), d.z * (BALL_R + 0.48)));
    }
    mesh(`Spikes_${i}`, mergeGeometries(stalks), M.plate, mini);
    mesh(`SpikeTips_${i}`, mergeGeometries(tips), M.glow, mini);
    const look = new THREE.Group();
    look.quaternion.setFromUnitVectors(V(0, 0, -1), out);
    mini.add(look);
    eye(look, { at: V(0, 0.05, -(BALL_R - 0.02)), r: 0.34, lid: 0.25, tilt: i % 2 ? 0.3 : -0.3, M, name: `MiniEye_${i}` });
  }
  mesh('Arms', mergeGeometries(arms), M.plate, orbit);
  return root;
}

// the trio circles the hub and each one bobs on its own
export function swarmRig(model) {
  const orbit = model.getObjectByName('Orbit');
  const minis = [0, 1, 2].map((i) => model.getObjectByName(`Mini_${i}`));
  return (dt, t, r) => {
    orbit.rotation.y += dt * 1.3 * Math.sign(r.spin || 1);
    minis.forEach((m, i) => { m.position.y = 0.22 * Math.sin(t * 3.2 + i * 2.1 + r.seed); });
  };
}
