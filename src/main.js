import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, createComposer } from './core/renderer.js';
import { Input } from './core/input.js';
import { CameraRig } from './core/cameraRig.js';
import { clamp, damp, intercept, rand, segmentPointDistSq, segOut, wrapAngle } from './core/math.js';
import { createSky } from './world/sky.js';
import { createStars } from './world/stars.js';
import { createSun } from './world/sun.js';
import { createPlanet } from './world/planet.js';
import { createBlackHole } from './world/blackhole.js';
import { AsteroidField } from './world/asteroids.js';
import { createDust } from './world/dust.js';
import { SectorGate, TargetRings } from './world/holo.js';
import { AngleOverlay } from './world/angleOverlay.js';
import { AngleQuiz } from './game/quiz.js';
import { makeQuestion, typeForSector } from './game/angles.js';
import { Ship, addPanelDetail } from './ship/ship.js';
import { Turret } from './ship/turret.js';
import { EngineFX } from './ship/engineFx.js';
import { Vitals } from './ship/vitals.js';
import { ShieldFX } from './ship/shield.js';
import { Radar } from './ship/radar.js';
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
const SHIP_RADIUS = 6;
const BATTLE_SCALE = 1.45;   // the ship is drawn bigger in top-view battles so it reads at a glance
const GATE_AHEAD = 690;
const QUIZ_DIST = 27;        // how far from the cannon a raider hovers while it is the question      // the sector gate is placed so the ship reaches it near the end of the cruise
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
// the black hole looms beyond the launch pad (the intro dives into it); the worlds below are
// on its far side, along the five-sector route
// its disk is tilted so it cuts a diagonal streak of light behind the ship on the title screen
const blackhole = createBlackHole(sky.cube, { position: V(0, 420, -6000), radius: 300, normal: V(-0.55, 1, 0.3) });
const planets = [
  createPlanet(SUN_DIR, sky.cube, { position: V(2400, -300, -4200), radius: 1100, preset: 'gas' }),
  createPlanet(SUN_DIR, sky.cube, { position: V(-2600, 700, -8800), radius: 750, preset: 'ice', tilt: [0.5, 0.2, 0.6] }),
  createPlanet(SUN_DIR, sky.cube, { position: V(2200, 400, -13200), radius: 700, preset: 'desert', tilt: [0.1, 0.8, 0.2] }),
  createPlanet(SUN_DIR, sky.cube, { position: V(-1900, -500, -17000), radius: 950, preset: 'ocean', tilt: [0.3, 1.2, -0.2] }),
];
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
const FLOOD = 220;
const floods = ['Floodlight_L', 'Floodlight_R'].map((name) => {
  const spot = new THREE.SpotLight(0xfff0dc, FLOOD, 60, 0.42, 0.6, 2);
  station.getObjectByName(name).getWorldPosition(spot.position);
  spot.target.position.set(0, -0.5, 0);
  scene.add(spot, spot.target);
  return spot;
});

const ship = new Ship(shipGltf);
scene.add(ship.root);
const turret = new Turret(ship);
turret.minPitchFore = -12 * Math.PI / 180;
const engines = new EngineFX(ship, scene);
const shield = new ShieldFX(ship);
const radar = new Radar(ship);
const vitals = new Vitals();
const field = new AsteroidField(scene, rockGltf, { managed: true, capacity: 64 });
const trails = new Trails(scene);
const raiders = new Raiders(scene, raiderGltf, trails, 10);
const boss = new Boss(scene, bossGltf);
const gate = new SectorGate(scene);
const rings = new TargetRings(scene);
const angleOverlay = new AngleOverlay(scene, $('markers'));
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
const intro = new Intro(station, ship, fx, audio, rig, blackhole);
const campaign = new Campaign();
const quiz = new AngleQuiz(angleOverlay, {
  audio,
  fire: (correct) => quizFire(correct),
  punish: (target) => quizPunish(target),
  solved: (target, firstTry) => quizSolved(target, firstTry),
});
fx.onSecondary = (pos, scale) => audio.explosion(pos, scale);

// ------------------------------------------------------------------ state
const BEST_KEY = 'driftbound.best';
const loadBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const state = {
  mode: 'title', modeT: 0, time: 0, score: 0, levelStartScore: 0, best: loadBest(),
  damage: 0, smokeT: 0, warnedHull: false, shieldHintT: 0, cannonFlash: 0, manualT: 0, manualYaw: 0, locked: null,
  finaleSpeed: 0, shipScale: 1, aiming: false, jumped: false, crossT: 0,
  volley: null, timeScale: 1, bossHoldT: 0, bossSolved: 0,
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
const blips = [];
const quizCenter = new THREE.Vector3();
const battlePhase = () => campaign.phase === 'battle' || campaign.phase === 'boss' || campaign.phase === 'contact';
const whiteout = $('whiteout');
function setMode(m) {
  state.mode = m;
  state.modeT = 0;
  $('title').classList.toggle('hidden', m !== 'title');
  $('pause').classList.toggle('hidden', m !== 'paused');
  $('gameover').classList.toggle('hidden', m !== 'gameover');
  $('victory').classList.toggle('hidden', m !== 'victory');
  $('skip').classList.toggle('hidden', m !== 'launch');
  hud.show(m === 'play' || m === 'dying');
  controls.show(m === 'play');
  input.active = m === 'play';
}

// full-screen fade layer: white for the black-hole crossing, black for the ending
function setWhiteout(color, opacity, seconds = 0) {
  whiteout.classList.toggle('black', color === 'black');
  whiteout.style.transition = seconds ? `opacity ${seconds}s ease` : 'none';
  whiteout.style.opacity = opacity;
}

// a few rocks drifting around the pad on the title screen, clear of the launch line
const TITLE_ROCKS = [
  [-17, 9, -22, 2.6], [15, 13, -34, 3.6], [-30, -5, -48, 5.5], [27, 3, -62, 4.2], [-48, 16, -96, 7],
  [44, 22, -118, 8], [11, -13, -44, 2.4], [-22, 26, -70, 3.4], [36, -9, -30, 2.2],
];
function dockScene() {
  setWorld('intro');
  intro.dock();
  field.clearAll();
  for (const [x, y, z, s] of TITLE_ROCKS) field.spawn(V(x, y, z), s, V(rand(-0.4, 0.4), rand(-0.3, 0.3), rand(-0.4, 0.2)));
}

// 'intro': the station and the black hole; 'route': the far side, with its planets
function setWorld(which) {
  const intro = which === 'intro';
  station.visible = intro;
  for (const f of floods) f.intensity = intro ? FLOOD : 0;
  blackhole.object.visible = intro;
  for (const p of planets) p.enabled = !intro;
}

function launch() {
  if (state.mode !== 'title' && state.mode !== 'gameover' && state.mode !== 'victory') return;
  audio.start();
  audio.uiConfirm();
  setWhiteout('white', 0);
  intro.start();
  setMode('launch');
}

// the ship comes out of the black hole on the far side and the first sector begins
function emerge() {
  lens.uniforms.uAberration.value = 0.006;
  setWorld('route');
  field.clearAll();
  ship.reset();
  ship.docked = false;
  ship.root.position.set(LANE.x, LANE.y, 0);
  ship.root.quaternion.identity();
  ship.velocity.set(0, 0, -115);
  shield.mesh.visible = true;
  for (const w of wingTrails) trails.reset(w);
  rig.mode = 'chase';
  rig.t = 1;
  state.score = 0;
  startCampaign();
  setWhiteout('white', 1);
  void whiteout.offsetWidth;
  setWhiteout('white', 0, 1.1);
  lens.uniforms.uFlash.value = 0.4;
  audio.warp(ship.position);
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
  gate.hide();
  quiz.stop();
  state.volley = null;
  state.bossSolved = 0;
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
  state.shipScale = 1;
  ship.root.scale.setScalar(1);
  campaign.phase = 'idle';
  campaign.level = 0;
  dockScene();
  rig.mode = 'chase';
  rig.t = 1;
  setWhiteout('white', 0);
  launch();
}

function pause() { if (state.mode === 'play') setMode('paused'); }
function resume() { if (state.mode === 'paused') setMode('play'); }

function die() {
  quiz.stop();
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
  return newBest;
}

function gameOver() {
  saveBest();
  $('go-score').textContent = state.score.toLocaleString('en-US');
  $('go-level').textContent = campaign.level + 1;
  setMode('gameover');
}

// Ending: a drone parks behind the ship and keeps zooming in as it burns away, so the ship stays
// the same size on screen while space rushes past it, then it jumps home in a flash.
function startFinale() {
  setMode('finale');
  state.finaleSpeed = Math.max(130, -ship.velocity.z);
  state.jumped = false;
  state.crossT = 0;
  rig.plungePos.copy(ship.position).add(tmp.set(10, 5, 24));
  rig.focus.copy(ship.position);
  rig.holdFov = 50;
  rig.setMode('hold', 1.2);
  audio.ignite();
}

function finaleUpdate(dt) {
  const T = state.modeT;
  if (!state.jumped) {
    state.finaleSpeed = Math.min(3600, state.finaleSpeed + dt * (40 + T * 300));
    ship.thrust = 1.6;
    ship.boost = Math.min(1, ship.boost + dt * 1.5);
    ship.velocity.set(0, 0, -state.finaleSpeed);
    ship.position.addScaledVector(ship.velocity, dt);
    rig.focus.lerp(ship.position, 1 - Math.exp(-10 * dt));
    const d = ship.position.distanceTo(rig.plungePos);
    rig.holdFov = clamp((2 * Math.atan(26 / d) * 180) / Math.PI, 12, 52);
    rig.plungePos.y += dt * 1.5;
    rig.addShake(dt * 0.4);
    if (d > 520 || T > 4.5) {
      state.jumped = true;
      state.crossT = T;
      ship.model.visible = false;
      shield.mesh.visible = false;
      fx.warp(ship.position, tmp.set(0, 0, -1));
      fx.ring(ship.position, 120, 0.6);
      lens.uniforms.uFlash.value = 0.75;
      audio.warp(camera.position);
    }
  } else {
    ship.velocity.set(0, 0, 0);
    const f = clamp((T - state.crossT - 0.7) / 1.3, 0, 1);
    setWhiteout('black', f);
    if (f >= 1) victory();
  }
}

function victory() {
  const newBest = saveBest();
  $('v-score').textContent = state.score.toLocaleString('en-US');
  $('v-best').textContent = state.best.toLocaleString('en-US');
  $('v-newbest').classList.toggle('hidden', !newBest);
  setMode('victory');
  setWhiteout('black', 1);
  void whiteout.offsetWidth;
  setWhiteout('black', 0.45, 2.2);
}

$('start').addEventListener('click', launch);
$('resume').addEventListener('click', resume);
$('retry').addEventListener('click', retryLevel);
$('restart').addEventListener('click', restartFromStation);
$('again').addEventListener('click', restartFromStation);
$('pause-btn').addEventListener('click', () => input.tap('pause'));
canvas.addEventListener('pointerdown', () => { if (state.mode === 'launch') intro.skip(); });
$('skip').addEventListener('pointerdown', () => intro.skip());
addEventListener('keydown', (e) => {
  if (state.mode === 'launch' && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) intro.skip();
  else if (state.mode === 'title' && e.code === 'Enter' && !$('start').disabled) launch();
  else if (state.mode === 'play' && /^(Digit|Numpad)[1-4]$/.test(e.code)) quiz.choose(Number(e.code.slice(-1)) - 1);
});

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

function onBossHit(part, point, amount = 1) {
  if (quiz.active && quiz.target && part !== quiz.target.part) { fx.impact(point, tmp.copy(point).sub(boss.position).normalize()); return; }
  const res = boss.damage(part, amount);
  const n = tmp.copy(point).sub(boss.position).normalize();
  fx.impact(point, n);
  if (res === 'hull') return;
  if (res === 'shield') {
    audio.shieldHit();
    if (state.time > state.shieldHintT) { state.shieldHintT = state.time + 3; hud.alert('Hit the turrets', 'warn', 1.4); }
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
    hud.banner('CORE EXPOSED', '', 2.2);
    audio.shieldDown();
  }
  if (res === 'defeated') {
    addScore(5000, boss.corePos);
    hud.banner('WARDEN DOWN', '+5,000', 2.4);
  }
}

function onPlayerBolt(target, point, bolt) {
  if (target.isBossPart) { onBossHit(target, point, bolt.damage); return; }
  if (target.isRaider) {
    fx.impact(point, tmp.copy(point).sub(target.position).normalize());
    const killed = raiders.damage(target, bolt.damage);
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
  const R = SHIELD_RADIUS * state.shipScale;
  if (state.mode === 'play' && segmentPointDistSq(a, b, ship.position) < R * R) {
    out.copy(a).lerp(b, segOut.t).sub(ship.position).normalize().multiplyScalar(R - 0.5).add(ship.position);
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
  if (state.mode !== 'play' || a.cool > 0 || battlePhase()) return;
  a.t = a.dur;
  a.cool = a.cd;
  if (name === 'lock') { hud.alert('Lock-on', 'warn', 1.2); audio.hit(true); }
  else { hud.alert('Shield', 'info', 1.2); audio.shieldUp(); shield.pulse(); }
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
    hud.alert('Barrage · Shield!', 'danger', 1.8);
    controls.urge('shield', 2.2);
    audio.alarm();
  },
  onDefeated() { campaign.destroyed++; },
  shake(a) { rig.addShake(a); },
  flash(a) { lens.uniforms.uFlash.value = Math.max(lens.uniforms.uFlash.value, a); },
};
const campaignCtx = {
  ship, raiders, field, boss,
  sector(level) {
    gate.show(tmp.set(LANE.x, LANE.y, ship.position.z - GATE_AHEAD), level + 1, campaign.count, campaign.L.name);
    audio.waveHorn();
  },
  spawnBoss() {
    boss.spawn(ship, state.time, Math.PI + (Math.random() < 0.5 ? -1 : 1) * (camera.aspect < 1 ? rand(0.4, 0.55) : rand(0.8, 1.05)));
    boss.quiz = true;
    boss.holdAngle = boss.angle;
    state.bossHoldT = 0;
    state.bossSolved = 0;
    audio.alarm();
  },
  announce(title, sub) { hud.banner(title, sub, 2.2); audio.waveHorn(); },
  spawnRaider(skill) {
    // anywhere around the ship except straight up (question bar) or straight down (answers)
    const yaw = (Math.random() < 0.5 ? 1 : -1) * rand(0.5, Math.PI - 0.5);
    const off = V(-Math.sin(yaw) * QUIZ_DIST, 0, -Math.cos(yaw) * QUIZ_DIST);
    const pos = off.clone().add(ship.position);
    const r = raiders.spawn(pos, ship.position, skill, state.time, true);
    if (!r) return;
    r.hold = off;
    fx.warp(pos, tmp.copy(ship.position).sub(pos).normalize());
    audio.warp(pos);
  },
  spawnMeteor(p, size, v) { field.spawn(V(p.x, p.y, p.z), size, V(v.x, v.y, v.z)); },
  levelComplete(level) {
    const bonus = 500 * (level + 1) + Math.round(vitals.hull) * 5;
    state.score += bonus;
    state.levelStartScore = state.score;
    hud.banner(`SECTOR ${level + 1} COMPLETE`, `+${bonus.toLocaleString('en-US')}`, 2.6);
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

// bearing from the turret, in the turret's yaw convention (0 = nose, + = left)
const bearing = (pos) => Math.atan2(-(pos.x - turretPos.x), -(pos.z - turretPos.z));

// the target closest to a chosen cannon direction, within maxAng radians of it
function sectorTarget(yaw, maxAng) {
  let best = null;
  let bestScore = Infinity;
  const test = (obj, pos, vel) => {
    const d = Math.abs(wrapAngle(bearing(pos) - yaw));
    if (d > maxAng) return;
    const score = d + pos.distanceTo(turretPos) * 0.002;
    if (score < bestScore) { bestScore = score; best = { obj, pos, vel }; }
  };
  for (const r of raiders.list) if (r.alive) test(r, r.position, r.vel);
  for (const w of boss.weakPoints()) test(w.obj, w.pos, w.vel);
  return best;
}

function toScreen(v, out) {
  tmp.copy(v).project(camera);
  out.x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
  return tmp.z < 1;
}

// where the cannon should point this frame
function computeAim() {
  ship.nodes.TurretPitch.getWorldPosition(turretPos);
  state.locked = null;
  state.aiming = false;
  const top = rig.mode === 'top';
  if (top && battlePhase()) {
    // angle battle: the cannon rests on the reference line and turns by the picked angle
    const yaw = quiz.active ? quiz.aimYaw : 0;
    const d = quiz.active ? Math.max(20, quiz.target.pos.distanceTo(quizCenter)) : 60;
    aim.set(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(d).add(quizCenter);
    aim.y = quiz.active ? quiz.target.pos.y : ship.position.y;
    return 'quiz';
  }
  if (abilities.lock.t > 0) {
    const tgt = nearestTarget();
    if (tgt) {
      intercept(turretPos, ship.velocity, tgt.pos, tgt.vel, BOLT_SPEED, aim);
      state.locked = tgt.obj;
      return 'lock';
    }
  }
  // top view: the four arrows (and their diagonals) point the cannon in a fixed screen
  // direction: up = ahead, right = right... It keeps tracking whatever is in that sector.
  if (top && (input.dirX !== 0 || input.dirY !== 0)) {
    state.manualYaw = Math.atan2(-input.dirX, input.dirY);
    state.manualT = performance.now();
    state.aiming = true;
  }
  if (top && state.manualT > input.pointerT) {
    const tgt = sectorTarget(state.manualYaw, 0.6);
    if (tgt) {
      intercept(turretPos, ship.velocity, tgt.pos, tgt.vel, BOLT_SPEED, aim);
      state.locked = tgt.obj;
    } else {
      aim.set(-Math.sin(state.manualYaw), 0, -Math.cos(state.manualYaw)).multiplyScalar(80).add(turretPos);
    }
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

// ------------------------------------------------------------------ angle battles
// the next thing to ask about: the hovering raider, or (boss) a turret, then the core
function nextQuizTarget(dt) {
  if (campaign.phase === 'battle') {
    for (const r of raiders.list) {
      if (r.alive && r.hold && r.holdT > 0.7) return { kind: 'raider', obj: r, pos: r.position, index: campaign.spawned, total: campaign.L.raiders };
    }
    return null;
  }
  if (campaign.phase !== 'boss' || !boss.active || boss.dying || boss.entry > 0.02) return null;
  state.bossHoldT += dt;
  if (Math.abs(wrapAngle(boss.holdAngle - boss.angle)) > 0.01 || state.bossHoldT < 1.0) return null;
  const total = 7;   // four turrets, then three hits on the core
  const index = Math.min(total, state.bossSolved + 1);
  const tr = boss.turrets.find((x) => x.alive);
  if (tr) return { kind: 'turret', obj: tr, part: tr.part, pos: tr.pos, index, total };
  return { kind: 'core', obj: boss, part: boss.parts.core, pos: boss.corePos, index, total };
}

function updateQuiz(dt, t) {
  ship.nodes.TurretMount.getWorldPosition(quizCenter);
  quizCenter.y = ship.position.y;
  if (!battlePhase()) {
    if (quiz.active) quiz.stop();
  } else if (!quiz.active) {
    const tgt = nextQuizTarget(dt);
    if (tgt) {
      const dx = tgt.pos.x - quizCenter.x, dz = tgt.pos.z - quizCenter.z;
      const dist = Math.hypot(dx, dz);
      const q = makeQuestion(Math.atan2(-dx, -dz), typeForSector(campaign.level));
      quiz.ask(tgt, q, tgt.index, tgt.total, { len: dist + 4.8, tLen: dist, arcR: 12 * rig.topZoom });
    }
  }
  quiz.update(dt, turret.yaw);
  angleOverlay.update(dt, t, quizCenter, camera);
}

function quizFire(correct) {
  const kind = quiz.target.kind;
  state.volley = { n: 5, next: state.time, damage: kind === 'raider' ? 3 : 4 };
  if (!correct) rig.addShake(0.1);
}

function quizPunish(target) {
  if (target.kind === 'raider') raiders.punish(target.obj, state.time);
  else boss.punish(state.time, bossCtx);
  audio.alarm();
}

function quizSolved(target, firstTry) {
  state.timeScale = 0.35;   // a beat of slow motion on the hit
  rig.addShake(0.35);
  if (target.kind === 'raider') {
    const r = target.obj;
    if (r.alive) { raiders.kill(r); raiderDestroyed(r, true); }
  } else {
    if (target.kind === 'turret' && target.obj.alive) onBossHit(target.part, target.pos.clone(), 99);
    state.bossSolved++;
    boss.holdAngle = Math.PI + (Math.random() < 0.5 ? -1 : 1) * (camera.aspect < 1 ? rand(0.4, 0.55) : rand(0.8, 1.05));
    state.bossHoldT = 0;
  }
  if (firstTry) addScore(50, tmp.copy(target.pos).add(V(0, 0, -9)));
}

// in-world enemy markers: radar blips around the cannon and health rings under each enemy
function updateHolo(t, show) {
  blips.length = 0;
  rings.begin(t);
  if (show) {
    for (const r of raiders.list) {
      if (!r.alive) continue;
      blips.push({ angle: bearing(r.position), strength: 1, kind: 0 });
      const charge = quiz.active && quiz.target && quiz.target.obj === r ? quiz.chargeLeft : r.hp / r.maxHp;
      rings.add(tmp.copy(r.position).setY(r.position.y - 1.2), r.hold ? 4.8 : 7.5, charge, 0);
    }
    for (const w of boss.weakPoints()) {
      const core = w.obj.kind === 'core';
      blips.push({ angle: bearing(w.pos), strength: 1, kind: 1 });
      rings.add(w.pos, core ? 7.5 : 6.4, core ? boss.coreHp / CORE_HP : boss.turrets[w.obj.index].hp / TURRET_HP, core ? 2 : 1);
    }
  }
  rings.end();
  radar.setBlips(blips);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let forcedDt = null;
function frame() {
  const raw = forcedDt ?? clock.getDelta();
  const realDt = state.mode === 'paused' ? 0 : Math.min(raw, 1 / 30);
  const dt = realDt * state.timeScale;
  state.timeScale = Math.min(1, state.timeScale + realDt * 1.4);
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

  if (intro.active && (mode === 'title' || mode === 'launch')) {
    const ev = intro.update(dt, t);
    // crossing the horizon goes black; emerge() then bursts out into white light
    if (mode === 'launch') setWhiteout('black', intro.fade);
    lens.uniforms.uAberration.value = 0.006 + 0.012 * intro.distort * intro.distort;
    if (ev === 'emerge') emerge();
  }

  // ---- ship motion (bigger in top-view battles)
  const battleView = (play || mode === 'dying') && campaign.cfg.view === 'top';
  state.shipScale = damp(state.shipScale, battleView ? BATTLE_SCALE : 1, 2.5, dt);
  ship.root.scale.setScalar(state.shipScale);
  ship.radius = SHIP_RADIUS * state.shipScale;
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
  if (intro.active) intro.applyCamera(camera, t);
  controls.setMode(rig.mode === 'top' ? 'top' : 'chase');
  if (mode === 'dying' && state.modeT > 2.6) gameOver();

  // ---- campaign + aiming + firing
  if (play) {
    campaign.update(dt, campaignCtx);
    if (campaign.phase === 'finale') startFinale();
  }
  if (play) {
    computeAim();
  } else if (mode === 'title' || mode === 'launch') {
    ship.nodes.TurretPitch.getWorldPosition(turretPos);
    aim.set(Math.sin(t * 0.35) * 110, 75, -90).add(ship.position);
  }
  turret.update(dt, aim);
  let fired = false;
  if (state.volley && state.volley.n > 0 && t >= state.volley.next) {
    turret.nextShot = 0;
    turret.overheated = false;
    if (turret.tryFire(t, shot)) {
      fired = true;
      playerBolts.spawn(shot.position, shot.direction, ship.velocity, BOLT_SPEED, state.volley.damage);
      fx.muzzle(shot.position, shot.direction, ship.velocity);
      audio.cannon();
      rig.addShake(0.12);
      state.cannonFlash = 1;
    }
    state.volley.n--;
    state.volley.next = t + 0.07;
    if (state.volley.n <= 0) state.volley = null;
  }
  if (play && input.fire && !battlePhase()) {
    const wasHot = turret.overheated;
    if (turret.tryFire(t, shot)) {
      fired = true;
      playerBolts.spawn(shot.position, shot.direction, ship.velocity, BOLT_SPEED);
      fx.muzzle(shot.position, shot.direction, ship.velocity);
      audio.cannon();
      rig.addShake(0.08);
      state.cannonFlash = 1;
    }
    if (turret.overheated && !wasHot) { hud.alert('Overheated', 'warn'); audio.overheat(); }
  }
  state.cannonFlash = Math.max(0, state.cannonFlash - dt * 8);
  ship.setCannonGlow(turret.heat, state.cannonFlash);
  radar.update(dt, {
    yaw: turret.yaw, want: turret.desiredYaw, firing: play && input.fire && !turret.overheated, shot: fired,
    aiming: state.aiming, top: rig.mode === 'top', heat: turret.heat, locked: !!state.locked, show: play && !battlePhase(), time: t,
  });

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
  updateHolo(t, play || mode === 'dying');
  if (play) updateQuiz(dt, t);
  else angleOverlay.update(dt, t, quizCenter, camera);
  gate.update(dt, t, ship.position);

  if (vitals.update(dt) && play) { shield.pulse(); audio.shieldUp(); }
  if (abilities.shield.t > 0) shield.pulse();
  if (mode === 'launch') shield.mesh.visible = ship.redshift < 0.02;
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
    const fade = Math.max(0, 1 - ship.redshift * 5);   // no contrails while falling into the black hole
    wingTrails[i].intensity = flying ? (THREE.MathUtils.smoothstep(speed, 60, 160) * 0.5 + ship.boost * 0.8) * fade : 0;
    trails.push(wingTrails[i], ship.nodes[n].getWorldPosition(tmp), t);
  });
  trails.update(camera.position, t);
  dust.update(camera, ship.velocity);
  stars.update(camera, t);
  for (const p of planets) p.update(camera, t);
  blackhole.update(t);
  // up close the disk fills the view: dim it and the bloom so the shadow stays truly black
  const near = blackhole.object.visible
    ? THREE.MathUtils.clamp((camera.position.distanceTo(blackhole.position) / blackhole.uniforms.uR.value - 1.2) / 7, 0, 1)
    : 1;
  blackhole.uniforms.uIntensity.value = 0.32 + 0.68 * near;
  blackhole.uniforms.uDisk.value = 0.7;
  bloom.strength = BLOOM_STRENGTH * (blackhole.object.visible ? 0.3 + 0.45 * near : 1);
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
  if (play || mode === 'dying') {
    turret.aimPoint(markerPoint, Math.max(20, Math.min(turretPos.distanceTo(aim), 600)));
    if (input.pointerSeen && !state.locked && state.manualT <= input.pointerT) {
      crosshair.x = (input.pointer.x * 0.5 + 0.5) * window.innerWidth;
      crosshair.y = (-input.pointer.y * 0.5 + 0.5) * window.innerHeight;
    } else toScreen(aim, crosshair);
    hud.update(dt, {
      camera, campaign, vitals, score: state.score, crosshair, markerPoint, showMarker: rig.mode !== 'top', hideAim: battlePhase(),
      turret, raiders, locked: state.locked, boss,
    });
    const ab = (a) => ({ cooldown: a.cool / a.cd, ready: a.cool <= 0, active: a.t > 0 });
    controls.update({ heat: turret.heat, overheated: turret.overheated, lock: ab(abilities.lock), shield: ab(abilities.shield) });
  }

  if (mode !== 'paused') composer.render();
}

// ------------------------------------------------------------------ boot
dockScene();
fx.explosion(new THREE.Vector3(0, -5000, 0), 1, null, { scrap: true });
gate.group.visible = true;   // compile the hologram shaders up front
try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
gate.group.visible = false;
renderer.setAnimationLoop(frame);
$('start').disabled = false;
$('start').classList.remove('failed');
$('load-msg').textContent = '';
if (document.fonts?.load) document.fonts.load('64px "Lilita One"').catch(() => {});

// handy for tuning from the devtools console
window.game = {
  THREE, scene, camera, renderer, ship, turret, rig, field, fx, raiders, boss, vitals, intro, campaign, state, input, audio, hud, abilities,
  radar, gate, rings, blackhole, planets, quiz, angleOverlay, launch, setMode,
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
