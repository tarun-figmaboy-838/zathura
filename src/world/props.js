import * as THREE from 'three';

// A little life along the route, kept sparse and off the flight lane so it never gets messy:
//   satellites:  small craft with gold foil, solar panels, a dish and a blinking light, drifting
//                and turning slowly beside the lane
//   outposts:    small space stations further out (a module, a ring, panels, lit windows)
//   UFO:         now and then a friendly saucer flies alongside for a few seconds; the little
//                alien in its glass dome waves and says hello, then it zips off with a goodbye
// None of them can be shot or locked onto (they are not in any hit test).

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4, ...extra });
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

const HELLO = ['Hey!', 'Hi, pilot!', 'Hello there!', 'Nice ship!', 'Good luck!', 'Hey, buddy!'];
const BYE = ['Bye!', 'See you!', 'Bye-bye!', 'Fly safe!'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function makeSatellite(M) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 3), M.foil));
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6).rotateZ(Math.PI / 2), M.metal);
    arm.position.x = sx * 2.3;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 2.4), M.panel);
    panel.position.x = sx * 5.9;
    g.add(arm, panel);
  }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, 0.9).rotateX(-Math.PI / 2), M.white);
  dish.position.z = -2.1;
  dish.material.side = THREE.DoubleSide;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), M.red);
  lamp.position.set(0, 1.4, 1.2);
  g.add(dish, lamp);
  g.userData.lamp = lamp;
  return g;
}

function makeOutpost(M) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 22, 20).rotateX(Math.PI / 2), M.white));
  for (const z of [-11, 11]) g.add(new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 10).translate(0, 0, z), M.white));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 1.4, 10, 48), M.metal);
  g.add(ring);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6.5, 6), M.metal);
    s.position.set(Math.cos(a) * 6.6, Math.sin(a) * 6.6, 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 6), M.panel);
    p.position.set(sx * 19, 0, 6);
    g.add(p);
  }
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.7, 0.2), M.window, 24);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    m4.compose(V(Math.cos(a) * 10, Math.sin(a) * 10, 1.45), q, V(1, 1, 1));
    win.setMatrixAt(i, m4);
  }
  g.add(win);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), M.red);
  lamp.position.set(0, 4.2, -11);
  g.add(lamp);
  g.userData.lamp = lamp;
  g.userData.ring = ring;
  return g;
}

// a classic silver saucer with a ring of coloured lights and a glass dome; inside, a little green
// alien with big eyes, its arm on a pivot so it can wave
function makeUfo(M) {
  const g = new THREE.Group();
  const pts = [V(0, -0.9, 0), V(2.2, -0.75, 0), V(4.6, -0.2, 0), V(5, 0, 0), V(4.6, 0.25, 0), V(2.4, 0.8, 0), V(0, 0.95, 0)].map((p) => new THREE.Vector2(p.x, p.y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), M.silver));
  const lights = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }));
    l.position.set(Math.cos(a) * 4.75, 0.02, Math.sin(a) * 4.75);
    g.add(l);
    lights.push(l);
  }
  // the alien (seen through the dome)
  const alien = new THREE.Group();
  alien.position.y = 0.9;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12).scale(1, 1.1, 0.9), M.alien);
  body.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 14).scale(1.15, 1, 1), M.alien);
  head.position.y = 1.75;
  alien.add(body, head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10).scale(1, 1.25, 0.6), M.eye);
    eye.position.set(sx * 0.42, 1.85, 0.8);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.shine);
    shine.position.set(sx * 0.42 + 0.1, 1.98, 0.98);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), M.alien);
    stalk.position.set(sx * 0.45, 2.85, 0);
    stalk.rotation.z = -sx * 0.35;
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.bob);
    bob.position.set(sx * 0.6, 3.2, 0);
    alien.add(eye, shine, stalk, bob);
  }
  const arm = new THREE.Group();
  arm.position.set(0.7, 0.85, 0);
  const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 6).translate(0, 0.55, 0), M.alien);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 1.15, 0), M.alien);
  arm.add(limb, hand);
  arm.rotation.z = -0.6;
  alien.add(arm);
  g.add(alien);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  dome.position.y = 0.85;
  g.add(dome);
  g.userData = { lights, arm, alien };
  return g;
}

export class Props {
  // root: the DOM layer for the alien's speech bubble
  constructor(scene, root) {
    this.scene = scene;
    const M = {
      foil: std(0xd6a646, { metalness: 0.9, roughness: 0.3 }),
      metal: std(0x9aa1ab),
      white: std(0xd9dde3, { metalness: 0.3, roughness: 0.5 }),
      panel: std(0x1d3270, { metalness: 0.5, roughness: 0.3, emissive: 0x081436, emissiveIntensity: 0.6 }),
      silver: std(0xc8ced8, { metalness: 0.85, roughness: 0.25, envMapIntensity: 1.4 }),
      alien: std(0x6fdc4a, { metalness: 0, roughness: 0.55, emissive: 0x16380c, emissiveIntensity: 0.6 }),
      eye: std(0x0c0c14, { metalness: 0.2, roughness: 0.2 }),
      shine: glow(2, 2, 2),
      bob: glow(1.6, 0.5, 2.2),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
      red: glow(3, 0.25, 0.2),
      window: glow(2.2, 1.7, 0.9),
    };
    this.items = [];
    for (let i = 0; i < 3; i++) this.items.push({ kind: 'sat', obj: makeSatellite(M), alive: false });
    for (let i = 0; i < 2; i++) this.items.push({ kind: 'outpost', obj: makeOutpost(M), alive: false });
    for (const it of this.items) { it.obj.visible = false; it.spin = V(0, 0, 0); scene.add(it.obj); }
    this.ufo = { obj: makeUfo(M), alive: false, t: 0 };
    this.ufo.obj.visible = false;
    scene.add(this.ufo.obj);

    this.bubble = document.createElement('div');
    this.bubble.className = 'alien-say';
    root.appendChild(this.bubble);
    this.onSay = null;           // (text) a chirp when the alien talks
  }

  // a satellite or an outpost ahead, beside the lane (x: distance from the lane's centre line)
  spawn(kind, pos) {
    const it = this.items.find((x) => !x.alive && x.kind === kind);
    if (!it) return false;
    it.alive = true;
    it.obj.visible = true;
    it.obj.position.copy(pos);
    it.obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.obj.scale.setScalar(kind === 'sat' ? 1.6 + Math.random() * 0.8 : 1.4 + Math.random() * 0.6);
    it.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(kind === 'sat' ? 0.5 : 0.12);
    return true;
  }

  // the friendly UFO: it flies up from behind on one side, keeps pace for a few seconds while the
  // alien waves and says hello, then speeds off ahead with a goodbye
  visit(ship, side) {
    const u = this.ufo;
    if (u.alive) return;
    u.alive = true;
    u.t = 0;
    u.side = side;
    u.hello = pick(HELLO);
    u.bye = pick(BYE);
    u.said = 0;
    u.obj.visible = true;
    u.obj.scale.setScalar(1.6);
    u.obj.position.set(ship.position.x + side * 34, ship.position.y + 9, ship.position.z + 40);
  }

  get busy() { return this.ufo.alive; }

  // the gate is close: say goodbye and zip off now
  hurry() { const u = this.ufo; if (u.alive && u.t < 4.1) u.t = 4.1; }

  clear() {
    for (const it of this.items) { it.alive = false; it.obj.visible = false; }
    this.ufo.alive = false;
    this.ufo.obj.visible = false;
    this.bubble.classList.remove('show');
  }

  update(dt, time, ship, camera) {
    for (const it of this.items) {
      if (!it.alive) continue;
      const o = it.obj;
      o.rotation.x += it.spin.x * dt;
      o.rotation.y += it.spin.y * dt;
      o.rotation.z += it.spin.z * dt;
      if (o.userData.ring) o.userData.ring.rotation.z += dt * 0.6;
      o.userData.lamp.visible = Math.sin(time * 4 + o.id) > 0.3;
      if (o.position.z > ship.position.z + 80) { it.alive = false; o.visible = false; }
    }

    const u = this.ufo;
    if (!u.alive) return;
    u.t += dt;
    const o = u.obj, d = u.obj.userData, p = ship.position;
    // follow beside the ship: catch up (0-1.2 s), keep pace (to 4.6 s), then zip away ahead
    const lead = u.t < 1.2 ? 40 - 75 * (u.t / 1.2) ** 0.7 : u.t < 4.6 ? -35 : -35 - 260 * (u.t - 4.6) ** 2;
    const tx = p.x + u.side * 34, ty = p.y + 9 + Math.sin(u.t * 2.2) * 1.2;
    o.position.x += (tx - o.position.x) * Math.min(1, dt * 3);
    o.position.y += (ty - o.position.y) * Math.min(1, dt * 3);
    o.position.z = p.z + lead;
    o.rotation.y = time * 1.5;                                   // the saucer turns...
    d.alien.rotation.y = -o.rotation.y + Math.atan2(-u.side * 0.6, 1);   // ...the alien keeps facing the ship
    o.rotation.z = -u.side * 0.18;
    d.arm.rotation.z = u.t > 1.0 && u.t < 5.4 ? -0.55 + 0.5 * Math.sin(u.t * 9) : -0.6;     // waving
    d.lights.forEach((l, i) => l.material.color.setHSL(((i / 10) + time * 0.5) % 1, 1, 0.6).multiplyScalar(2.2));

    // the speech bubble over the saucer
    const text = u.t > 1.3 && u.t < 3.8 ? u.hello : u.t > 4.1 && u.t < 5.6 ? u.bye : '';
    if (text && u.said !== text) { u.said = text; this.onSay?.(text); }
    const s = o.position.clone().add(V(0, 7, 0)).project(camera);
    const on = text && s.z < 1 && Math.abs(s.x) < 0.95 && Math.abs(s.y) < 0.95;
    this.bubble.classList.toggle('show', !!on);
    if (on) {
      if (this.bubble.textContent !== text) this.bubble.textContent = text;
      this.bubble.style.transform = `translate(${((s.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-s.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (u.t > 6.2) { u.alive = false; o.visible = false; this.bubble.classList.remove('show'); }
  }
}
