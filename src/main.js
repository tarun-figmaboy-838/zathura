import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, createComposer } from './core/renderer.js';
import { Input } from './core/input.js';
import { CameraRig } from './core/cameraRig.js';
import { damp, intercept, rand, segmentPointDistSq, segOut } from './core/math.js';
import { createSky } from './world/sky.js';
import { createStars } from './world/stars.js';
import { createSun } from './world/sun.js';
import { createPlanet } from './world/planet.js';
import { createBlackHole } from './world/blackhole.js';
import { AsteroidField } from './world/asteroids.js';
import { createDust } from './world/dust.js';
import { Ship, addPanelDetail } from './ship/ship.js';
import { Turret } from './ship/turret.js';
import { EngineFX } from './ship/engineFx.js';
import { Vitals } from './ship/vitals.js';
import { ShieldFX } from './ship/shield.js';
import { Projectiles } from './combat/projectiles.js';
import { Effects, SHIP_CORE } from './combat/fx.js';
import { Trails } from './combat/trails.js';
import { Raiders } from './enemies/raiders.js';
import { Boss, TURRET_HP, CORE_HP } from './enemies/boss.js';
import { Intro } from './game/intro.js';
import { Campaign } from './game/campaign.js';
import { AudioEngine } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Controls } from './ui/controls.js';

const SUN_DIR = new THREE.Vector3(-0.72, 0.4, -0.56).normalize();
const BOLT_SPEED = 560;
const SHIELD_RADIUS = 7;
const LANE = new THREE.Vector3(0, 6.5, 0);
const BOUNDS = { x: 30, y: 11 };
const PLAYER = { isPlayer: true };
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ world
const canvas = $('game');
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 60000);
const { composer, lens, bloom } = createComposer(renderer, scene, camera);
const BLOOM_STRENGTH = bloom.strength;

const sky = createSky(renderer, scene, SUN_DIR);
const stars = createStars();
const sun = createSun(scene, SUN_DIR);
const dust = createDust();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// a handful of vivid worlds along the route, and the black hole at the end of it
const planets = [
  createPlanet(SUN_DIR, sky.cube, { position: V(2400, -300, -4200), radius: 1100, preset: 'gas' }),
  createPlanet(SUN_DIR, sky.cube, { position: V(-2600, 700, -8800), radius: 750, preset: 'ice', tilt: [0.5, 0.2, 0.6] }),
  createPlanet(SUN_DIR, sky.cube, { position: V(2200, 400, -13200), radius: 700, preset: 'desert', tilt: [0.1, 0.8, 0.2] }),
  createPlanet(SUN_DIR, sky.cube, { position: V(-1900, -500, -17000), radius: 950, preset: 'ocean', tilt: [0.3, 1.2, -0.2] }),
];
const blackhole = createBlackHole(sky.cube, { position: V(0, 520, -20000), radius: 460 });
scene.add(stars.object, dust.object, blackhole.object, ...planets.map((p) => p.object));

let shipGltf, rockGltf, raiderGltf, stationGltf, bossGltf;
try {
  const loader = new GLTFLoader();
  [shipGltf, rockGltf, raiderGltf, stationGltf, bossGltf] = await Promise.all(
    ['ship', 'asteroids', 'raider', 'station', 'boss'].map((n) => loader.loadAsync(`assets/models/${n}.glb`)),
  );
} catch (err) {
  $('load-msg').textContent = `Could not load models (${err.message}). Serve this folder over http.`;
  throw err;
}

// station + round landing pad
const station = stationGltf.scene;
scene.add(station);
const tuned = new Set();
station.traverse((o) => {
  if (!o.isMesh) return;
  o.receiveShadow = o.castShadow = true;
  const m = o.material;
  if (tuned.has(m)) return;
  tuned.add(m);
  if (m.name === 'PadDeck') { m.color.multiplyScalar(0.7); addPanelDetail(m, { scale: 0.7, seam: 0.5, grime: 0.4, chips: 0.1, soot: [0, 0, 0] }); }
  if (m.name === 'StationHull') { m.color.multiplyScalar(0.75); addPanelDetail(m, { scale: 0.35, seam: 0.4, grime: 0.3, chips: 0.1, soot: [0, 0, 0] }); }
  if (m.name === 'Window') m.emissiveIntensity *= 0.5;
});
station.updateMatrixWorld(true);
for (const name of ['Floodlight_L', 'Floodlight_R']) {
  const spot = new THREE.SpotLight(0xfff0dc, 220, 60, 0.42, 0.6, 2);
  station.getObjectByName(name).getWorldPosition(spot.position);
  spot.target.position.set(0, -0.5, 0);
  scene.add(spot, spot.target);
}

const ship = new Ship(shipGltf);
scene.add(ship.root);
const turret = new Turret(ship);
turret.minPitchFore = -12 * Math.PI / 180;
const engines = new EngineFX(ship, scene);
const shield = new ShieldFX(ship);
const vitals = new Vitals();
const field = new AsteroidField(scene, rockGltf, { managed: true, capacity: 64 });
const trails = new Trails(scene);
const raiders = new Raiders(scene, raiderGltf, trails, 10);
const boss = new Boss(scene, bossGltf);
const fx = new Effects(scene, field.pools[2].low.geometry, field.material);
const playerBolts = new Projectiles(scene, { headSize: 3, minPx: 9 });
const enemyBolts = new Projectiles(scene, {
  capacity: 120, core: new THREE.Color(1.2, 5, 1.4), sheath: new THREE.Color(0.25, 1.1, 0.3),
  head: new THREE.Vector3(1.3, 4, 1.3), coreRadius: 0.2, sheathRadius: 0.6, maxLen: 6, life: 3.5, headSize: 3.2, minPx: 10,
});
const bossBolts = new Projectiles(scene, {
  capacity: 220, core: new THREE.Color(5, 1.5, 0.5), sheath: new THREE.Color(1.5, 0.3, 0.08),
  head: new THREE.Vector3(5, 1.3, 0.4), coreRadius: 0.24, sheathRadius: 0.75, maxLen: 4, life: 5, headSize: 3.8, minPx: 11,
});
const wingTrails = [0, 1].map(() => trails.alloc(new THREE.Color(0.55, 0.8, 1.0), 0.12, 0.45));
const input = new Input(canvas);
const controls = new Controls(input);
const rig = new CameraRig(camera);
const hud = new Hud();
const audio = new AudioEngine();
const intro = new Intro(station, ship, fx, audio, rig);
const campaign = new Campaign();
fx.onSecondary = (pos, scale) => audio.explosion(pos, scale);

// ------------------------------------------------------------------ state
const BEST_KEY = 'driftbound.best';
const loadBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const state = {
  mode: 'title', modeT: 0, time: 0, score: 0, levelStartScore: 0, best: loadBest(),
  damage: 0, smokeT: 0, warnedHull: false, shieldHintT: 0, cannonFlash: 0, manualT: 0, manualYaw: 0, locked: null, finaleSpeed: 0,
};
const abilities = {
  lock: { dur: 5, cd: 12, t: 0, cool: 0 },
  shield: { dur: 4, cd: 16, t: 0, cool: 0 },
};
const aim = new THREE.Vector3();
const shot = { position: new THREE.Vector3(), direction: new THREE.Vector3() };
const markerPoint = new THREE.Vector3();
const turretPos = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const pip = new THREE.Vector3();
const hA = new THREE.Vector3();
const hB = new THREE.Vector3();
const hC = new THREE.Vector3();
const crosshair = { x: 0, y: 0 };
const bufferSize = new THREE.Vector2();
const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
$('title-best').textContent = state.best.toLocaleString('en-US');

function setMode(m) {
  state.mode = m;
  state.modeT = 0;
  $('title').classList.toggle('hidden', m !== 'title');
  $('pause').classList.toggle('hidden', m !== 'paused');
  $('gameover').classList.toggle('hidden', m !== 'gameover');
  $('victory').classList.toggle('hidden', m !== 'victory');
  $('skip').classList.toggle('hidden', m !== 'launch');
  hud.show(m === 'play' || m === 'dying' || m === 'finale');
  controls.show(m === 'play');
  input.active = m === 'play';
}

function launch() {
  audio.start();
  intro.start();
  setMode('launch');
}

function startCampaign() {
  ship.kinematic = true;
  state.levelStartScore = state.score;
  campaign.start(0);
  setMode('play');
}

function clearCombat() {
  raiders.clear();
  playerBolts.clear();
  enemyBolts.clear();
  bossBolts.clear();
  boss.despawn();
  field.clearAll();
  for (const a of Object.values(abilities)) { a.t = 0; a.cool = 0; }
}

function retryLevel() {
  clearCombat();
  vitals.reset();
  turret.reset();
  ship.model.visible = true;
  shield.mesh.visible = true;
  ship.position.set(LANE.x, LANE.y, ship.position.z);
  ship.velocity.set(0, 0, -60);
  state.score = state.levelStartScore;
  state.warnedHull = false;
  campaign.start(campaign.level);
  rig.setMode('chase', 0.8);
  setMode('play');
}

function restartFromStation() {
  clearCombat();
  vitals.reset();
  turret.reset();
  shield.mesh.visible = true;
  state.score = 0;
  state.warnedHull = false;
  campaign.phase = 'idle';
  campaign.level = 0;
  intro.dock();
  rig.mode = 'chase';
  rig.t = 1;
  $('whiteout').classList.remove('fade', 'black');
  $('whiteout').style.opacity = 0;
  launch();
}

function pause() { if (state.mode === 'play') setMode('paused'); }
function resume() { if (state.mode === 'paused') setMode('play'); }

function die() {
  setMode('dying');
  ship.model.visible = false;
  shield.mesh.visible = false;
  fx.explosion(ship.position, 4.5, ship.velocity, { scrap: true, core: SHIP_CORE, chain: 4 });
  audio.explosion(ship.position, 3);
  rig.addShake(1.2);
  lens.uniforms.uFlash.value = 0.6;
}

function saveBest() {
  const newBest = state.score > state.best;
  if (newBest) {
    state.best = state.score;
    try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* storage unavailable */ }
  }
  $('title-best').textContent = state.best.toLocaleString('en-US');
  return newBest;
}

function gameOver() {
  saveBest();
  $('go-score').textContent = state.score.toLocaleString('en-US');
  $('go-level').textContent = campaign.level + 1;
  setMode('gameover');
}

function startFinale() {
  setMode('finale');
  rig.focus.copy(blackhole.position);
  rig.setMode('finale', 2.2);
  state.finaleSpeed = 140;
  state.plunge = false;
  state.crossT = 0;
  hud.banner('THE EVENT HORIZON', 'Hold on…', 4);
  audio.ignite();
}

function victory() {
  const newBest = saveBest();
  $('v-score').textContent = state.score.toLocaleString('en-US');
  $('v-best').textContent = state.best.toLocaleString('en-US');
  $('v-newbest').classList.toggle('hidden', !newBest);
  setMode('victory');
  const w = $('whiteout');
  w.classList.add('black');
  w.style.opacity = 1;
  requestAnimationFrame(() => { w.classList.add('fade'); w.style.opacity = 0.45; });
}

$('start').addEventListener('click', launch);
$('resume').addEventListener('click', resume);
$('retry').addEventListener('click', retryLevel);
$('restart').addEventListener('click', restartFromStation);
$('again').addEventListener('click', restartFromStation);
$('pause-btn').addEventListener('click', () => input.tap('pause'));
canvas.addEventListener('pointerdown', () => { if (state.mode === 'launch') intro.skip(); });
addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'Escape') && state.mode === 'launch') intro.skip(); });

// ------------------------------------------------------------------ combat resolution
function addScore(points, pos) {
  state.score += points;
  hud.popup(pos, `+${points}`);
}

function raiderDestroyed(r, byPlayer) {
  const pos = r.position.clone();
  fx.explosion(pos, 2.4, r.vel, { scrap: true, core: SHIP_CORE, chain: 2 });
  audio.explosion(pos, 1.6);
  rig.addShake(Math.min(0.7, 50 / Math.max(pos.distanceTo(camera.position), 20)));
  campaign.destroyed++;
  if (byPlayer) addScore(100 + 25 * campaign.level, pos);
}

function playerHitTest(a, b, out) {
  let best = null;
  let bestD = Infinity;
  const r = raiders.segmentHit(a, b, hA);
  if (r) { best = r; bestD = a.distanceToSquared(hA); out.copy(hA); }
  const rock = field.segmentHit(a, b, hB);
  if (rock && a.distanceToSquared(hB) < bestD) { best = rock; bestD = a.distanceToSquared(hB); out.copy(hB); }
  const part = boss.segmentHit(a, b, hC);
  if (part && a.distanceToSquared(hC) < bestD) { best = part; out.copy(hC); }
  return best;
}

function onBossHit(part, point) {
  const res = boss.damage(part, 1);
  const n = tmp.copy(point).sub(boss.position).normalize();
  fx.impact(point, n);
  if (res === 'hull') return;
  if (res === 'shield') {
    audio.shieldHit();
    if (state.time > state.shieldHintT) { state.shieldHintT = state.time + 3; hud.alert('Core shielded · hit the turrets', 'warn', 1.6); }
    return;
  }
  const down = res === 'turretDown' || res === 'coreExposed';
  hud.hitMarker(down || res === 'defeated');
  audio.hit(down);
  if (down) {
    const tr = boss.turrets[part.index];
    fx.explosion(tr.pos, 2.4, boss.vel, { scrap: true, core: SHIP_CORE });
    audio.explosion(tr.pos, 1.8);
    rig.addShake(0.4);
    addScore(400, tr.pos);
  }
  if (res === 'coreExposed') {
    hud.banner('CORE EXPOSED', 'Shields down · hit the reactor!', 2.8);
    audio.shieldDown();
  }
  if (res === 'defeated') {
    addScore(5000, boss.corePos);
    hud.banner('WARDEN BREAKING UP', '+5,000', 2.6);
  }
}

function onPlayerBolt(target, point) {
  if (target.isBossPart) { onBossHit(target, point); return; }
  if (target.isRaider) {
    fx.impact(point, tmp.copy(point).sub(target.position).normalize());
    const killed = raiders.damage(target, 1);
    hud.hitMarker(killed);
    audio.hit(killed);
    if (killed) raiderDestroyed(target, true);
    return;
  }
  const rock = target;
  fx.impact(point, tmp.copy(point).sub(rock.pos).normalize());
  hud.hitMarker(false);
  if (!field.damage(rock, 1)) return;
  const scale = THREE.MathUtils.clamp(rock.size / 4, 0.8, 3);
  fx.explosion(rock.pos, scale, rock.vel);
  audio.explosion(rock.pos, scale * 0.6);
  hud.hitMarker(true);
  rig.addShake(Math.min(0.5, (scale * 30) / Math.max(rock.pos.distanceTo(camera.position), 20)));
  if (!rock.fragment) {
    campaign.destroyed++;
    addScore(30 + 10 * campaign.level, rock.pos);
  } else addScore(10, rock.pos);
}

function enemyHitTest(a, b, out) {
  let best = null;
  let bestD = Infinity;
  if (state.mode === 'play' && segmentPointDistSq(a, b, ship.position) < SHIELD_RADIUS * SHIELD_RADIUS) {
    out.copy(a).lerp(b, segOut.t).sub(ship.position).normalize().multiplyScalar(SHIELD_RADIUS - 0.5).add(ship.position);
    best = PLAYER;
    bestD = a.distanceToSquared(out);
  }
  const rock = field.segmentHit(a, b, hB);
  if (rock && a.distanceToSquared(hB) < bestD) { out.copy(hB); best = rock; }
  return best;
}

function onEnemyBolt(target, point, bolt) {
  if (target === PLAYER) playerDamage(bolt.damage, point);
  else fx.impact(point, tmp.copy(point).sub(target.pos).normalize());
}

function playerDamage(amount, point) {
  if (state.mode !== 'play') return;
  if (abilities.shield.t > 0) { shield.hit(point); audio.shieldHit(); return; }
  const res = vitals.damage(amount);
  if (res === 'shield' || res === 'break') {
    shield.hit(point);
    audio.shieldHit();
    state.damage = Math.min(1, state.damage + 0.18);
    rig.addShake(0.15);
    if (res === 'break') { audio.shieldDown(); hud.alert('Shields down', 'danger'); }
  } else if (res === 'hull') {
    fx.hullHit(point, tmp.copy(point).sub(ship.position).normalize());
    audio.hullHit();
    state.damage = Math.min(1, state.damage + 0.55);
    rig.addShake(0.35);
    if (vitals.hullFrac < 0.3 && !state.warnedHull) { state.warnedHull = true; hud.alert('Hull critical', 'danger', 2.5); audio.alarm(); }
  } else if (res === 'dead') {
    die();
  }
}

// meteoroids that reach the ship explode against it
function collideShip() {
  const rock = field.overlap(ship.position, ship.radius * 0.8);
  if (!rock) return;
  const p = tmp2.copy(rock.pos);
  field.destroy(rock);
  fx.explosion(p, THREE.MathUtils.clamp(rock.size / 4, 0.8, 3), ship.velocity);
  audio.explosion(p, 1);
  if (!rock.fragment) campaign.missed++;
  playerDamage(10 + rock.size * 2.5, p);
}
field.onPassed = () => { campaign.missed++; };

function activate(name) {
  const a = abilities[name];
  if (state.mode !== 'play' || a.cool > 0) return;
  a.t = a.dur;
  a.cool = a.cd;
  if (name === 'lock') { hud.alert('Lock-on engaged', 'warn', 1.2); audio.hit(true); }
  else { hud.alert('Shield boost', 'info', 1.2); audio.shieldUp(); shield.pulse(); }
}

const raiderCtx = {
  ship, field, fx, audio, bolts: enemyBolts, shipAlive: false, arena: false,
  onCrash(r) { raiders.kill(r); raiderDestroyed(r, false); },
  onRam(r) { raiders.kill(r); raiderDestroyed(r, true); playerDamage(25, r.position); },
};
const bossCtx = {
  ship, raiders, fx, audio, bolts: bossBolts, shipAlive: false,
  launchRaider(pos, dir) {
    const r = raiders.spawn(pos, tmp2.copy(pos).addScaledVector(dir, 40), 2, state.time, true);
    if (!r) return;
    r.vel.copy(dir).multiplyScalar(r.speed);
    fx.warp(pos, dir);
    audio.boostWhoosh();
  },
  onBarrageWarning() {
    hud.alert('Barrage incoming · use SHIELD', 'danger', 1.8);
    controls.urge('shield', 2.2);
    audio.alarm();
  },
  onDefeated() { campaign.destroyed++; },
  shake(a) { rig.addShake(a); },
  flash(a) { lens.uniforms.uFlash.value = Math.max(lens.uniforms.uFlash.value, a); },
};
const campaignCtx = {
  ship, raiders, field, boss,
  spawnBoss() {
    boss.spawn(ship, state.time);
    audio.alarm();
    hud.alert('Warden carrier inbound', 'danger', 2.2);
  },
  announce(title, sub) { hud.banner(title, sub, 2.8); audio.waveHorn(); },
  spawnRaider(p, lookAt, skill) {
    const pos = V(p.x, p.y, p.z);
    if (!raiders.spawn(pos, lookAt, skill, state.time, true)) return;
    fx.warp(pos, tmp.copy(lookAt).sub(pos).normalize());
    audio.warp(pos);
  },
  spawnMeteor(p, size, v) { field.spawn(V(p.x, p.y, p.z), size, V(v.x, v.y, v.z)); },
  levelComplete(level) {
    const bonus = 500 * (level + 1) + Math.round(vitals.hull) * 5;
    state.score += bonus;
    state.levelStartScore = state.score;
    hud.banner(`LEVEL ${level + 1} COMPLETE`, `+${bonus.toLocaleString('en-US')} bonus`, 3);
    audio.shieldUp();
  },
};

// nearest live target for lock-on: raiders in battle, meteoroids ahead otherwise
function nearestTarget() {
  let best = null;
  let bestD = Infinity;
  for (const r of raiders.list) {
    if (!r.alive) continue;
    const d = r.position.distanceToSquared(ship.position);
    if (d < bestD) { bestD = d; best = { obj: r, pos: r.position, vel: r.vel }; }
  }
  for (const w of boss.weakPoints()) {
    const d = w.pos.distanceToSquared(ship.position) * 0.3; // prefer the boss's weak points
    if (d < bestD) { bestD = d; best = w; }
  }
  if (best) return best;
  for (const r of field.rocks) {
    if (!r.alive || r.pos.z > ship.position.z - 10) continue;
    const d = r.pos.distanceToSquared(ship.position);
    if (d < bestD && d < 700 * 700) { bestD = d; best = { obj: r, pos: r.pos, vel: r.vel }; }
  }
  return best;
}

function toScreen(v, out) {
  tmp.copy(v).project(camera);
  out.x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
  return tmp.z < 1;
}

// where the cannon should point this frame
function computeAim(dt) {
  ship.nodes.TurretPitch.getWorldPosition(turretPos);
  state.locked = null;
  const top = rig.mode === 'top';
  if (abilities.lock.t > 0) {
    const tgt = nearestTarget();
    if (tgt) {
      intercept(turretPos, ship.velocity, tgt.pos, tgt.vel, BOLT_SPEED, aim);
      state.locked = tgt.obj;
      return 'lock';
    }
  }
  if (top && input.dirX !== 0) {
    if (state.manualT < input.pointerT) state.manualYaw = turret.yaw;
    state.manualT = performance.now();
    state.manualYaw -= input.dirX * 2.6 * dt;
  }
  const manual = top && state.manualT > input.pointerT;
  if (manual) {
    aim.set(-Math.sin(state.manualYaw), 0, -Math.cos(state.manualYaw)).multiplyScalar(80).add(turretPos);
    return 'manual';
  }
  if (!input.pointerSeen) {
    if (top) aim.set(-Math.sin(turret.yaw), 0, -Math.cos(turret.yaw)).multiplyScalar(80).add(turretPos);
    else aim.copy(turretPos).add(tmp.set(0, -1, -300));
    return 'default';
  }
  const ray = rig.ray(input.pointer);
  if (top) {
    const t = (turretPos.y - ray.origin.y) / Math.min(-1e-3, ray.direction.y);
    ray.at(t, aim);
  } else {
    const d = Math.min(field.raycast(ray.origin, ray.direction, 25), raiders.raycast(ray.origin, ray.direction, 25), 380);
    ray.at(d, aim);
  }
  // aim assist: snap to the lead point of a target close to the pointer
  const px = { x: (input.pointer.x * 0.5 + 0.5) * window.innerWidth, y: (-input.pointer.y * 0.5 + 0.5) * window.innerHeight };
  let bestPx = 70;
  const s = {};
  const consider = (obj, pos, vel) => {
    intercept(turretPos, ship.velocity, pos, vel, BOLT_SPEED, pip);
    if (!toScreen(pip, s)) return;
    const d = Math.hypot(s.x - px.x, s.y - px.y);
    const d2 = toScreen(pos, s) ? Math.hypot(s.x - px.x, s.y - px.y) : Infinity;
    const best = Math.min(d, d2);
    if (best < bestPx) { bestPx = best; aim.copy(pip); state.locked = obj; }
  };
  for (const r of raiders.list) if (r.alive) consider(r, r.position, r.vel);
  for (const w of boss.weakPoints()) consider(w.obj, w.pos, w.vel);
  if (!top) for (const r of field.rocks) if (r.alive && r.pos.z < ship.position.z) consider(r, r.pos, r.vel);
  return 'pointer';
}

// Finale: race at the black hole, then a calm "plunge": the camera holds back while the ship
// slows (time dilation), stretches toward the centre, slips over the horizon, and the view
// drifts into the darkness and fades to black.
function finaleUpdate(dt) {
  const R = blackhole.uniforms.uR.value;
  const toBH = tmp.copy(blackhole.position).sub(ship.position);
  const dist = toBH.length();
  toBH.divideScalar(dist);
  if (!state.plunge) {
    state.finaleSpeed = Math.min(3000, state.finaleSpeed + dt * (260 + state.modeT * 520));
    ship.thrust = 1.6;
    ship.boost = Math.min(1, ship.boost + dt);
    rig.addShake(dt * 1.2 * Math.min(1, state.modeT / 4));
    if (dist < R * 4.2) {
      state.plunge = true;
      state.plungeT = 0;
      state.finaleSpeed = Math.min(state.finaleSpeed, 1100);
      rig.plungePos.copy(camera.position);
      rig.setMode('plunge', 0.6);
      hud.show(false);
    }
  } else {
    state.plungeT += dt;
    if (ship.model.visible) {
      const k = THREE.MathUtils.clamp(1 - (dist - R) / (3.2 * R), 0, 1);
      state.finaleSpeed = 110 + 990 * Math.pow(1 - k, 1.6);
      ship.visual.scale.set(1 - 0.6 * k, 1 - 0.6 * k, 1 + 3.5 * k);
      ship.thrust = 0.55 + 0.6 * (1 - k);
      ship.boost = 0;
      if (dist < R * 1.02) {
        ship.model.visible = false;
        shield.mesh.visible = false;
        state.crossT = state.plungeT;
        lens.uniforms.uFlash.value = 0.25;
        audio.shieldDown();
      }
    }
    // trail the falling ship closely, but stop just outside the horizon and let it slip away
    if (ship.model.visible) tmp2.copy(ship.position).addScaledVector(toBH, -42).add(camera.up.clone().multiplyScalar(6));
    else tmp2.copy(rig.plungePos).addScaledVector(toBH, 380 * dt);
    if (tmp2.distanceTo(blackhole.position) > R * 1.25) rig.plungePos.lerp(tmp2, 1 - Math.exp(-3 * dt));
    if (!ship.model.visible) {
      const f = THREE.MathUtils.clamp((state.plungeT - state.crossT - 0.5) / 1.6, 0, 1);
      const w = $('whiteout');
      w.classList.add('black');
      w.style.opacity = f;
      if (f >= 1) victory();
    }
  }
  if (ship.model.visible) {
    ship.velocity.copy(toBH).multiplyScalar(state.finaleSpeed);
    ship.position.addScaledVector(ship.velocity, dt);
    m4.lookAt(ship.position, tmp2.copy(ship.position).add(toBH), THREE.Object3D.DEFAULT_UP);
    ship.root.quaternion.slerp(q4.setFromRotationMatrix(m4), 1 - Math.exp(-2.5 * dt));
  } else {
    ship.velocity.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let forcedDt = null;
function frame() {
  const raw = forcedDt ?? clock.getDelta();
  const dt = state.mode === 'paused' ? 0 : Math.min(raw, 1 / 30);
  state.time += dt;
  state.modeT += dt;
  const t = state.time;
  const mode = state.mode;
  const play = mode === 'play';

  if (input.consume('pause')) { if (play) pause(); else if (mode === 'paused') resume(); }
  if (input.consume('mute')) hud.alert(audio.toggleMute() ? 'Sound off' : 'Sound on', 'info', 1.2);
  if (input.consume('lock')) activate('lock');
  if (input.consume('shield')) activate('shield');
  for (const a of Object.values(abilities)) { a.t = Math.max(0, a.t - dt); a.cool = Math.max(0, a.cool - dt); }

  if (intro.active && (mode === 'title' || mode === 'launch' || mode === 'play')) {
    if (intro.update(dt, t) === 'handover') startCampaign();
  }

  // ---- ship motion
  if (play && ship.kinematic) {
    const cfg = campaign.cfg;
    ship.rail(dt, cfg.speed, cfg.steer ? input.dirX : 0, cfg.steer ? input.dirY : 0, LANE, BOUNDS);
  } else if (mode === 'finale') {
    finaleUpdate(dt);
  } else if (mode === 'dying') {
    ship.position.addScaledVector(ship.velocity, dt);
  }
  ship.update(dt, input, t, false);

  // ---- camera
  if (play) rig.setMode(campaign.cfg.view);
  rig.update(dt, ship, t);
  if (intro.active) intro.applyCamera(camera);
  controls.setMode(rig.mode === 'top' ? 'top' : 'chase');
  if (mode === 'dying' && state.modeT > 2.6) gameOver();

  // ---- campaign + aiming + firing
  if (play) {
    campaign.update(dt, campaignCtx);
    if (campaign.phase === 'finale') startFinale();
  }
  if (play) {
    computeAim(dt);
  } else if (mode === 'title' || mode === 'launch') {
    ship.nodes.TurretPitch.getWorldPosition(turretPos);
    aim.set(Math.sin(t * 0.35) * 110, 75, -90).add(ship.position);
  }
  turret.update(dt, aim);
  if (play && input.fire) {
    const wasHot = turret.overheated;
    if (turret.tryFire(t, shot)) {
      playerBolts.spawn(shot.position, shot.direction, ship.velocity, BOLT_SPEED);
      fx.muzzle(shot.position, shot.direction, ship.velocity);
      audio.cannon();
      rig.addShake(0.08);
      state.cannonFlash = 1;
    }
    if (turret.overheated && !wasHot) { hud.alert('Cannon overheated', 'warn'); audio.overheat(); }
  }
  state.cannonFlash = Math.max(0, state.cannonFlash - dt * 8);
  ship.setCannonGlow(turret.heat, state.cannonFlash);

  // ---- simulation
  raiderCtx.shipAlive = play;
  raiderCtx.arena = campaign.phase === 'battle' || campaign.phase === 'contact' || campaign.phase === 'boss';
  if (play || mode === 'dying') raiders.update(dt, t, raiderCtx);
  bossCtx.shipAlive = play;
  if (play || mode === 'dying') boss.update(dt, t, bossCtx);
  campaign.bossIntegrity = boss.active ? boss.integrity : 0;
  rig.topZoom = campaign.phase === 'boss' ? 1.65 : 1;
  bossBolts.update(dt, enemyHitTest, onEnemyBolt);
  playerBolts.update(dt, playerHitTest, onPlayerBolt);
  enemyBolts.update(dt, enemyHitTest, onEnemyBolt);
  field.update(dt, t, ship.position, camera.position);
  if (play && dt > 0) collideShip();

  if (vitals.update(dt) && play) { shield.pulse(); audio.shieldUp(); }
  if (abilities.shield.t > 0) shield.pulse();
  shield.update(dt, vitals.shieldFrac);
  if (play && vitals.hullFrac < 0.45 && (state.smokeT -= dt) <= 0) {
    state.smokeT = 0.05;
    fx.damageSmoke(tmp.set(rand(-1.5, 1.5), rand(0, 1), rand(-2, 5)).applyMatrix4(ship.root.matrixWorld), ship.velocity, 1 - vitals.hullFrac / 0.45);
  }

  // ---- effects + environment
  fx.update(dt);
  engines.update(dt, t);
  const speed = ship.velocity.length();
  const flying = mode !== 'dying' && mode !== 'gameover' && ship.model.visible;
  ['NavLight_L', 'NavLight_R'].forEach((n, i) => {
    wingTrails[i].intensity = flying ? THREE.MathUtils.smoothstep(speed, 60, 160) * 0.5 + ship.boost * 0.8 : 0;
    trails.push(wingTrails[i], ship.nodes[n].getWorldPosition(tmp), t);
  });
  trails.update(camera.position, t);
  dust.update(camera, ship.velocity);
  stars.update(camera, t);
  for (const p of planets) p.update(camera, t);
  blackhole.update(t);
  // up close the disk fills the view: dim it and the bloom so the shadow stays truly black
  const bhDist = camera.position.distanceTo(blackhole.position) / blackhole.uniforms.uR.value;
  const near = THREE.MathUtils.clamp((bhDist - 1.2) / 7, 0, 1);
  blackhole.uniforms.uIntensity.value = 0.32 + 0.68 * near;
  bloom.strength = BLOOM_STRENGTH * (0.35 + 0.65 * near);
  sun.update(dt, camera, ship.position, [...planets, blackhole]);

  state.damage = damp(state.damage, 0, 2.5, dt);
  const lowHull = play && vitals.hullFrac < 0.3 ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
  lens.uniforms.uTime.value = t;
  lens.uniforms.uSun.value.copy(sun.state.screen);
  lens.uniforms.uSunVis.value = sun.state.visibility;
  lens.uniforms.uFlash.value = damp(lens.uniforms.uFlash.value, 0, 7, dt);
  lens.uniforms.uDamage.value = Math.max(state.damage, lowHull);
  const pxScale = fx.setViewport(renderer.getDrawingBufferSize(bufferSize).y, camera.fov);
  playerBolts.setViewport(pxScale);
  enemyBolts.setViewport(pxScale);
  bossBolts.setViewport(pxScale);

  audio.update(camera, ship, turret, flying);
  if (play || mode === 'dying' || mode === 'finale') {
    turret.aimPoint(markerPoint, Math.max(20, Math.min(turretPos.distanceTo(aim), 600)));
    if (input.pointerSeen && !state.locked) {
      crosshair.x = (input.pointer.x * 0.5 + 0.5) * window.innerWidth;
      crosshair.y = (-input.pointer.y * 0.5 + 0.5) * window.innerHeight;
    } else toScreen(aim, crosshair);
    hud.update(dt, { camera, campaign, vitals, score: state.score, crosshair, markerPoint, turret, raiders, locked: state.locked, boss, turretHp: TURRET_HP, coreHp: CORE_HP });
    const ab = (a) => ({ cooldown: a.cool / a.cd, ready: a.cool <= 0, active: a.t > 0 });
    controls.update({ heat: turret.heat, overheated: turret.overheated, lock: ab(abilities.lock), shield: ab(abilities.shield) });
  }

  if (mode !== 'paused') composer.render();
}

// ------------------------------------------------------------------ boot
intro.dock();
fx.explosion(new THREE.Vector3(0, -5000, 0), 1, null, { scrap: true });
try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
renderer.setAnimationLoop(frame);
const startBtn = $('start');
startBtn.disabled = false;
startBtn.querySelector('.text').textContent = 'Launch';

// handy for tuning from the devtools console
window.game = {
  THREE, scene, camera, renderer, ship, turret, rig, field, fx, raiders, boss, vitals, intro, campaign, state, input, audio, hud, abilities,
  launch, setMode,
  debug: {
    fire(on) { input.virtual.fire = on; },
    key(code, on) { if (on) input.keys.add(code); else input.keys.delete(code); },
    advance(seconds, step = 1 / 60) {
      forcedDt = step;
      for (let s = 0; s < seconds; s += step) frame();
      forcedDt = null;
      clock.getDelta();
    },
    level(n) { clearCombat(); campaign.start(n); },
  },
};
