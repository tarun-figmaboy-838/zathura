import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer, createComposer } from './core/renderer.js';
import { Input } from './core/input.js';
import { CameraRig, topHeight, wideLayout, battleFrame, bossZoom } from './core/cameraRig.js';
import { clamp, damp, intercept, rand, segmentPointDistSq, segOut, wrapAngle } from './core/math.js';
import { createSky } from './world/sky.js';
import { createStars } from './world/stars.js';
import { createSun } from './world/sun.js';
import { createPlanet } from './world/planet.js';
import { createBlackHole } from './world/blackhole.js';
import { AsteroidField } from './world/asteroids.js';
import { createDust } from './world/dust.js';
import { TargetRings } from './world/holo.js';
import { Portal } from './world/portal.js';
import { SpaceTrash } from './world/trash.js';
import { AngleOverlay } from './world/angleOverlay.js';
import { AngleQuiz } from './game/quiz.js';
import { Director } from './game/director.js';
import { makeQuestion } from './game/angles.js';
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
import { Campaign, masteryLevel, answerOf } from './game/campaign.js';
import { AudioEngine } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Controls } from './ui/controls.js';
import { Dialogue } from './ui/dialogue.js';
import { raiderName, enemyLine, crewLine, wardenIntro, WARDEN } from './game/banter.js';

const SUN_DIR = new THREE.Vector3(-0.72, 0.4, -0.56).normalize();
const BOLT_SPEED = 560;
const SHIELD_RADIUS = 7;
const SHIP_RADIUS = 6;
const BATTLE_SCALE = 1.45;   // the ship is drawn bigger in top-view battles so it reads at a glance
// how far from the cannon a raider hovers (just outside the radar ring); wide screens give it the
// whole left side of the screen, so it can wait further out
const TAN_HALF_FOV = Math.tan((52 * Math.PI) / 360);
// how far out the raider holds: on wide screens it is framed left of the console column
// (portrait: as far out as still fits the screen on the diagonal, so the radar fills the width)
const quizDist = () => (wideLayout(camera.aspect) ? battleFrame(camera.aspect).dist * topHeight(camera.aspect) * TAN_HALF_FOV
  : camera.aspect < 1 ? 33.5 : 32);
let MOUNT_SCALE = 1.35;      // the turret's own scale from the model (read at load)
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
const SUN_OCCLUDERS = [...planets, blackhole];
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
// battles: a soft overhead key light and a cyan glow under the player's ship, so it stands out
const battleLight = new THREE.DirectionalLight(0xe6f6ff, 0);
scene.add(battleLight, battleLight.target);
const shipGlow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(120, 220, 255, 0.55)');
  grd.addColorStop(0.45, 'rgba(70, 160, 255, 0.18)');
  grd.addColorStop(1, 'rgba(40, 90, 255, 0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -2;
  m.visible = false;
  scene.add(m);
  return m;
})();
scene.add(ship.root);
const turret = new Turret(ship);
MOUNT_SCALE = ship.nodes.TurretMount.scale.x;
turret.minPitchFore = -12 * Math.PI / 180;
const engines = new EngineFX(ship, scene);
const shield = new ShieldFX(ship);
const radar = new Radar(ship);
const vitals = new Vitals();
const field = new AsteroidField(scene, rockGltf, { managed: true, capacity: 64 });
const trash = new SpaceTrash(scene);
// decorative asteroid belt along the route: never collides, never counts as a meteor
const C3 = (r, g, b) => new THREE.Color(r, g, b);
const scenery = new AsteroidField(scene, rockGltf, {
  managed: true, capacity: 90, seed: 7,
  // bright grey stone, icy blue and rusty red, so the belt reads against the dark nebula
  tints: [C3(1.75, 1.65, 1.55), C3(1.75, 1.65, 1.55), C3(1.3, 1.6, 2.1), C3(2.0, 1.3, 0.95)],
});
scenery.material.envMapIntensity = 1.5;
const trails = new Trails(scene);
const raiders = new Raiders(scene, raiderGltf, trails, 10);
const boss = new Boss(scene, bossGltf);
const portal = new Portal(scene);
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
const dialogue = new Dialogue();
const audio = new AudioEngine();
const intro = new Intro(station, ship, fx, audio, rig, blackhole);
dialogue.voice = (who) => audio.chatter(who);
const campaign = new Campaign();
const director = new Director(rig);
// what has been introduced already in this visit (every fresh visit introduces everything again)
const seen = new Set();
const saveSeen = () => {};
try { localStorage.removeItem('driftbound.seen'); } catch { /* storage unavailable */ }
const quiz = new AngleQuiz(angleOverlay, {
  audio,
  fire: (correct) => quizFire(correct),
  punish: (target) => quizPunish(target),
  timeout: (target) => quizTimeout(target),
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
  sector: { asked: 0, first: 0 }, stars: [], reportOpen: false, upgrades: [],
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
// 'won' is the beat after a hit: the answer's explanation stays up until it ends
const battlePhase = () => ['battle', 'boss', 'contact', 'won'].includes(campaign.phase);
const whiteout = $('whiteout');
function setMode(m) {
  state.mode = m;
  state.modeT = 0;
  $('title').classList.toggle('hidden', m !== 'title');
  $('cockpit').classList.toggle('gone', m !== 'title');   // fades out as the camera leaves the bridge
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
// a few rocks for depth, low at the edges of the windshield: clear of the title and the black hole
const TITLE_ROCKS = [[-30, -6, -46, 3.4], [34, -4, -60, 3.0], [-58, 4, -120, 5.5]];
function dockScene() {
  setWorld('intro');
  intro.dock();
  field.clearAll();
  for (const [x, y, z, s] of TITLE_ROCKS) field.spawn(V(x, y, z), s, V(rand(-0.15, 0.15), rand(-0.1, 0.1), rand(-0.1, 0.05)));
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
  lens.uniforms.uAberration.value = 0.0018;
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
  scenery.clearAll();
  trash.clearAll();
  portal.hide();
  quiz.stop();
  director.clear();
  dialogue.clear();
  state.doom = 0;
  state.volley = null;
  state.bossSolved = 0;
  state.deathCause = null;
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
  if (state.sectorAtLevel) state.sector = { ...state.sectorAtLevel };
  state.warnedHull = false;
  campaign.start(campaign.level);
  rig.setMode('chase', 0.8);
  setMode('play');
}

function restartFromStation(launchNow = true) {
  clearCombat();
  resetUpgrades();
  state.stars = [];
  closeReport(true);
  vitals.reset();
  turret.reset();
  shield.mesh.visible = true;
  state.score = 0;
  state.warnedHull = false;
  state.shipScale = 1;
  ship.root.scale.setScalar(1);
  campaign.phase = 'idle';
  campaign.newRun();
  campaign.level = 0;
  dockScene();
  rig.mode = 'chase';
  rig.t = 1;
  setWhiteout('white', 0);
  if (launchNow) launch();
}

function pause() { if (state.mode === 'play') setMode('paused'); }
function resume() { if (state.mode === 'paused') setMode('play'); }

function die() {
  // who beat us: the question's target, else the boss or any raider still flying
  const t = quiz.target;
  state.lastQ = quiz.active ? quiz.q : null;
  state.killer = t ? (t.kind === 'raider' ? { kind: 'raider', obj: t.obj } : { kind: 'boss' })
    : boss.active && !boss.dying ? { kind: 'boss' }
    : (() => { const r = raiders.list.find((x) => x.alive); return r ? { kind: 'raider', obj: r } : null; })();
  quiz.stop();
  director.clear();
  dialogue.clear();
  state.volley = null;          // the wreck doesn't keep firing
  buzz([120, 60, 200]);
  setMode('dying');
  state.deathTalk = false;
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
  $('go-title').textContent = state.deathCause === 'time' ? "Time's up!" : 'Destroyed';
  state.deathCause = null;
  $('go-score').textContent = state.score.toLocaleString('en-US');
  $('go-level').textContent = campaign.L.label;
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
  const total = state.stars.reduce((a, b) => a + (b || 0), 0);
  $('v-total').textContent = `${total}/${campaign.count * 3}`;
  $('v-stars').innerHTML = Array.from({ length: campaign.count }, (_, i) =>
    `<div><span>${i + 1}</span><em class="stars mini">${[0, 1, 2].map((k) => `<i class="${k < (state.stars[i] || 0) ? 'on' : ''}"></i>`).join('')}</em></div>`).join('');
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
canvas.addEventListener('pointerdown', () => { if (state.mode === 'launch') intro.skip(); else if (state.mode === 'dying') dialogue.skip(); });
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
  if (byPlayer) addScore(100 + 25 * campaign.L.group, pos);
}

// bolt.ghost: a wrong answer's shot, which flies past ships (it can still break rocks)
function playerHitTest(a, b, out, bolt) {
  const ghost = bolt && bolt.ghost;
  let best = null;
  let bestD = Infinity;
  const r = ghost ? null : raiders.segmentHit(a, b, hA);
  if (r) { best = r; bestD = a.distanceToSquared(hA); out.copy(hA); }
  const rock = field.segmentHit(a, b, hB);
  if (rock && a.distanceToSquared(hB) < bestD) { best = rock; bestD = a.distanceToSquared(hB); out.copy(hB); }
  const junk = trash.segmentHit(a, b, hB);
  if (junk && a.distanceToSquared(hB) < bestD) { best = junk; bestD = a.distanceToSquared(hB); out.copy(hB); }
  const deco = scenery.segmentHit(a, b, hB);
  if (deco && a.distanceToSquared(hB) < bestD) { best = deco; bestD = a.distanceToSquared(hB); out.copy(hB); }
  const part = ghost ? null : boss.segmentHit(a, b, hC);
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
    dialogue.say(enemyLine(WARDEN, 'wardenDown', 1.8, boss.corePos.clone()));
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
  if (target.isTrash) {
    fx.impact(point, tmp.copy(point).sub(target.pos).normalize());
    hud.hitMarker(false);
    if (--target.hp > 0) return;
    trash.kill(target);
    fx.explosion(target.pos, 0.9, target.vel, { scrap: true });
    audio.explosion(target.pos, 0.7);
    hud.hitMarker(true);
    addScore(25, target.pos);
    return;
  }
  const rock = target;
  fx.impact(point, tmp.copy(point).sub(rock.pos).normalize());
  hud.hitMarker(false);
  if (!rock.owner.damage(rock, 1)) return;
  const scale = THREE.MathUtils.clamp(rock.size / 4, 0.8, 3);
  fx.explosion(rock.pos, scale, rock.vel);
  audio.explosion(rock.pos, scale * 0.6);
  hud.hitMarker(true);
  rig.addShake(Math.min(0.5, (scale * 30) / Math.max(rock.pos.distanceTo(camera.position), 20)));
  if (rock.owner === scenery) addScore(10, rock.pos);
  else if (!rock.fragment) {
    campaign.destroyed++;
    addScore(30 + 10 * campaign.L.group, rock.pos);
  } else addScore(10, rock.pos);
}

// flying through a sector portal: a flash of light, and the sector begins
function crossPortal() {
  state.portalPassed = true;
  setWhiteout('white', 0.85);
  void whiteout.offsetWidth;
  setWhiteout('white', 0, 0.8);
  lens.uniforms.uFlash.value = 0.5;
  rig.addShake(0.5);
  fx.ring(ship.position, 60, 0.7);
  audio.warp(ship.position);
  audio.boostWhoosh();
  hud.banner(campaign.L.boss ? 'THE WARDEN' : campaign.L.title, '', 2.2);
}

// ------------------------------------------------------------------ scenery belt
// big slow rocks far out, medium ones nearer, small fast debris just outside the lane
const SCENERY = [
  { p: 0.22, size: [16, 42], x: [95, 230], y: [-70, 90] },
  { p: 0.4, size: [6, 14], x: [50, 100], y: [-32, 46] },
  { p: 0.38, size: [1.6, 3.6], x: [41, 58], y: [-14, 26] },
];
function spawnScenery(zAhead, bigOnly = false) {
  let roll = bigOnly ? 0 : Math.random();
  const k = SCENERY.find((s) => (roll -= s.p) < 0) || SCENERY[2];
  const side = Math.random() < 0.5 ? -1 : 1;
  scenery.spawn(V(side * rand(...k.x), LANE.y + rand(...k.y), ship.position.z - zAhead), rand(...k.size),
    V(rand(-1.5, 1.5), rand(-0.8, 0.8), rand(-1, 1)));
}

// keep the belt streaming past while cruising; clear it once the battle camera is overhead
function updateScenery(dt) {
  const ph = campaign.phase;
  if (battlePhase()) {
    if (rig.mode === 'top' && rig.t > 0.55 && scenery.liveCount) scenery.clearAll();
    return;
  }
  // the journey: rocks and space junk drift into the lane to shoot or dodge, more on later levels
  // (none in the last stretch before the portal)
  if (ph === 'journey' && portal.state === 'in' && ship.position.z - portal.group.position.z > 420) {
    state.hazardT = (state.hazardT ?? 1.2) - dt;
    if (state.hazardT <= 0) {
      state.hazardT = Math.max(0.55, rand(1.0, 1.6) - campaign.level * 0.06);
      const at = V(rand(-26, 26), LANE.y + rand(-9, 10), ship.position.z - rand(430, 560));
      if (Math.random() < 0.55) field.spawn(at, rand(2.4, 4.6), V(rand(-2, 2), rand(-1, 1), rand(12, 26)));
      else trash.spawn(at, rand(1.2, 2.2), V(rand(-3, 3), rand(-1.5, 1.5), rand(14, 28)));
    }
  }
  if (ph === 'contact' && (field.liveCount || trash.liveCount)) { field.clearAll(); trash.clearAll(); }
  const rate = ph === 'journey' ? (campaign.level === 0 ? 7 : 4) : ph === 'meteors' ? 0.8 : ph === 'idle' ? 0 : 3;
  state.sceneryT = (state.sceneryT ?? 0) + dt * rate;
  while (state.sceneryT >= 1) {
    state.sceneryT -= 1;
    spawnScenery(rand(650, 950), ph === 'meteors');   // only distant giants during meteor fields
  }
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
    buzz(40);
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
  const junk = trash.overlap(ship.position, ship.radius * 0.7);
  if (junk) {
    trash.kill(junk);
    fx.explosion(junk.pos, 0.9, ship.velocity, { scrap: true });
    audio.explosion(junk.pos, 0.8);
    playerDamage(8, tmp2.copy(junk.pos));
  }
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
  portalPassed: () => state.portalPassed,
  sector(level) {
    const L = campaign.L;
    portal.show(tmp.set(LANE.x, LANE.y, ship.position.z - (campaign.journeyTime - 0.4) * 123), L.boss ? 'FINAL' : L.title, L.name);
    state.portalPassed = false;
    for (let i = 0; i < 46; i++) spawnScenery(rand(90, 900));
    audio.waveHorn();
    introduce('portal', [
      { time: 1.5 },
      { text: 'Steer with ◀ ▲ ▼ ▶ and shoot the rocks and space junk!', focus: ['#controls .pad', '#controls .act.fire'], time: 3.6 },
      { text: 'Then fly through the portal to start Level 1.', time: 3 },
    ]);
    if (campaign.firstOfGroup) state.sector = { asked: 0, first: 0 };
    state.levelStartScore = state.score;                   // Retry restarts this level with these points
    state.sectorAtLevel = { ...state.sector };             // ...and these star stats
  },
  spawnBoss() {
    boss.spawn(ship, state.time, Math.PI + (Math.random() < 0.5 ? -1 : 1) * (camera.aspect < 1 ? rand(0.4, 0.55) : rand(0.8, 1.05)));
    boss.quiz = true;
    boss.holdAngle = boss.angle;
    state.bossHoldT = 0;
    state.bossSolved = 0;
    state.wardenTalk = false;
    audio.alarm();
    introduce('boss', [
      { text: 'The Warden is here!', cam: camBoss, time: 2.6 },
      { text: 'Break its 4 turrets, then hit its core.', cam: camBoss, time: 2.8 },
    ]);
  },
  announce(title, sub) { hud.banner(title, sub, 2.2); audio.waveHorn(); },
  spawnRaider(skill) {
    // anywhere around the ship except straight up (question bar) or straight down (answers)
    const side = Math.random() < 0.5 ? 1 : -1;
    const tilt = rand(0.4, 0.68);   // portrait: up or down along the long side, clear of the question and answers
    const yaw = side * (camera.aspect >= 1 ? rand(1.05, Math.PI - 1.05) : Math.random() < 0.5 ? tilt : Math.PI - tilt);
    const D = quizDist();
    const off = V(-Math.sin(yaw) * D, 0, -Math.cos(yaw) * D);
    // it warps in far out along its bearing and flies in to its spot (see Raiders.holdUpdate)
    const pos = off.clone().multiplyScalar(2.9).add(ship.position);
    const r = raiders.spawn(pos, ship.position, skill, state.time, true);
    if (!r) return;
    r.hold = off;
    r.callsign = raiderName();
    r.taunted = false;
    fx.warp(pos, tmp.copy(ship.position).sub(pos).normalize());
    audio.warp(pos);
    introduce('raider', [{ text: 'Raider incoming! It shoots at your ship.', cam: camRaider(r), time: 2.6 }]);
  },
  spawnMeteor(p, size, v) { field.spawn(V(p.x, p.y, p.z), size, V(v.x, v.y, v.z)); },
  levelComplete(level) {
    const bonus = 500 * (level + 1) + Math.round(vitals.hull) * 5;
    state.score += bonus;
    state.levelStartScore = state.score;
    openReport(level, bonus);
  },
  reportOpen: () => state.reportOpen,
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
  if (!top) for (const j of trash.list) if (j.alive && j.pos.z < ship.position.z) consider(j, j.pos, j.vel);
  for (const w of boss.weakPoints()) consider(w.obj, w.pos, w.vel);
  if (!top) for (const r of field.rocks) if (r.alive && r.pos.z < ship.position.z) consider(r, r.pos, r.vel);
  return 'pointer';
}

// ------------------------------------------------------------------ defeat
const RULE_REMINDERS = {
  linear: 'Angles on a straight line add up to 180°.',
  opposite: 'Vertically opposite angles are equal.',
  complement: 'The two parts of a right angle add up to 90°.',
  point: 'Angles around a point add up to 360°.',
  triangle: 'The angles in a triangle add up to 180°.',
};
function defeatLines() {
  const k = state.killer;
  const boss_ = k && k.kind === 'boss';
  const name = boss_ ? WARDEN : (k && k.obj && k.obj.callsign) || 'RAIDER';
  const key = (boss_ ? 'warden' : 'raider') + (state.deathCause === 'time' ? 'WinTime' : 'Win');
  const q = state.lastQ;
  const tip = q ? `Remember: ${RULE_REMINDERS[q.type] || q.hint} Try again!` : 'Hull breached! Dodge the rocks or shoot them first.';
  const lines = [];
  if (k) lines.push(enemyLine(name, key, 1.6));
  lines.push({ who: 'crew', name: 'CO-PILOT', text: tip, hold: 2.0 });
  return lines;
}

// a slow push-in on the enemy that won
const _death = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50 };
function deathShot(dt) {
  const k = state.killer;
  if (k.kind === 'raider' && !k.obj.alive) { state.killer = null; return; }
  if (k.kind === 'raider') camRaider(k.obj, true)(_death); else camBoss(_death);
  const push = Math.min(1, (state.modeT - 0.9) / 5);          // creep a little closer while it talks
  _death.pos.lerp(_death.target, 0.1 * push);
  if (rig.mode !== 'drone') {
    rig.dronePos.copy(_death.pos); rig.droneTarget.copy(_death.target); rig.droneFov = _death.fov;
    rig.setMode('drone', 1.3);
  }
  const s = 1 - Math.exp(-5 * dt);
  rig.dronePos.lerp(_death.pos, s);
  rig.droneTarget.lerp(_death.target, s);
  rig.droneUp.copy(_death.up);
  rig.droneFov += (_death.fov - rig.droneFov) * s;
}

// ------------------------------------------------------------------ feel
// a short vibration on phones that support it (hits, wrong answers)
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ------------------------------------------------------------------ sector report + upgrades
const BASE = {
  fire: turret.fireInterval, hull: vitals.maxHull, shield: vitals.maxShield,
  regen: vitals.regenRate, delay: vitals.regenDelay, lockDur: abilities.lock.dur, lockCd: abilities.lock.cd,
};
const HULL_ICON = '<svg viewBox="0 0 24 24"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" /></svg>';
const UPGRADES = [
  { id: 'cannon', name: 'Rapid cannon', img: 'btn-fire.png', apply() { turret.fireInterval *= 0.8; } },
  { id: 'shield', name: 'Shield +30', img: 'btn-shield.png', apply() { vitals.maxShield += 30; vitals.shield = vitals.maxShield; } },
  { id: 'hull', name: 'Hull +30', icon: HULL_ICON, apply() { vitals.maxHull += 30; vitals.hull = vitals.maxHull; } },
  { id: 'lock', name: 'Lock-on +2s', img: 'btn-lock.png', apply() { abilities.lock.dur += 2; abilities.lock.cd = Math.max(6, abilities.lock.cd - 2); } },
  { id: 'recharge', name: 'Fast recharge', img: 'btn-retry.png', apply() { vitals.regenRate *= 1.4; vitals.regenDelay *= 0.75; } },
];

function resetUpgrades() {
  turret.fireInterval = BASE.fire;
  vitals.maxHull = BASE.hull;
  vitals.maxShield = BASE.shield;
  vitals.regenRate = BASE.regen;
  vitals.regenDelay = BASE.delay;
  abilities.lock.dur = BASE.lockDur;
  abilities.lock.cd = BASE.lockCd;
  state.upgrades = [];
}

// stars: every target hit on the first try = 3, at least 60% = 2, otherwise 1
function starsFor(s) {
  if (!s.asked || s.first >= s.asked) return 3;
  return s.first / s.asked >= 0.6 ? 2 : 1;
}

function openReport(level, bonus) {
  const s = state.sector;
  const stars = starsFor(s);
  state.stars[level] = Math.max(state.stars[level] || 0, stars);
  $('r-title').textContent = `Sector ${level + 1}`;
  $('r-first').textContent = `${s.first}/${s.asked}`;
  $('r-bonus').textContent = `+${bonus.toLocaleString('en-US')}`;
  $('r-stars').querySelectorAll('i').forEach((el, i) => {
    el.className = '';
    if (i < stars) setTimeout(() => { el.className = 'on'; audio.star(i); }, 450 + i * 320);
  });
  // one upgrade per sector (none after the last one)
  const box = $('r-upgrades');
  const next = $('r-next');
  box.innerHTML = '';
  const last = level >= campaign.count - 1;
  box.classList.toggle('hidden', last);
  next.disabled = !last;
  if (!last) {
    const offer = UPGRADES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    for (const up of offer) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'upg';
      b.innerHTML = `<span class="ico">${up.img ? `<img src="assets/ui/${up.img}" alt="" draggable="false" />` : up.icon}</span><b>${up.name}</b>`;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        up.apply();
        state.upgrades.push(up.id);
        box.querySelectorAll('.upg').forEach((o) => { o.disabled = true; o.classList.toggle('chosen', o === b); });
        next.disabled = false;
        audio.uiConfirm();
        next.focus();
      });
      box.appendChild(b);
    }
  }
  $('report').classList.remove('hidden');
  state.reportOpen = true;
  audio.shieldUp();
}

function closeReport(silent = false) {
  if (!state.reportOpen) return;
  $('report').classList.add('hidden');
  state.reportOpen = false;
  if (!silent) audio.uiConfirm();
}
$('r-next').addEventListener('click', () => closeReport());

// pause menu: sound on/off and back to the station
function updateSoundButton() { $('p-sound').classList.toggle('off', audio.muted); }
$('p-sound').addEventListener('click', () => { audio.toggleMute(); updateSoundButton(); });
$('p-home').addEventListener('click', () => { restartFromStation(false); setMode('title'); });   // back to the bridge

// ------------------------------------------------------------------ introductions
// Each new thing is explained once, the first time it appears (see game/director.js).
function introduce(key, steps) {
  if (seen.has(key)) return;
  seen.add(key);
  saveSeen();
  director.play(steps);
}

const RULES = {
  opposite: 'New rule: vertically opposite angles are equal.',
  linear: 'Rule: angles on a straight line add up to 180°.',
  complement: 'New rule: a right angle makes 90°.',
  point: 'New rule: angles around a point make 360°.',
  triangle: "New rule: a triangle's angles make 180°.",
};
function introduceQuestion(q) {
  const steps = [];
  const first = !seen.has('battle');
  if (first) {
    seen.add('battle');
    saveSeen();
    steps.push({ text: 'This bright line is your cannon.', cam: camCannon, time: 2.6 });
    steps.push({ text: 'Turn it by the angle x to hit the target.', focus: ['.ang-label.unknown'], time: 2.8 });
  }
  if (!seen.has(q.type)) {
    seen.add(q.type);
    saveSeen();
    steps.push({ text: RULES[q.type], cam: camDiagram, time: 2.8 });
  }
  if (first) steps.push({ text: 'Tap the right angle!', focus: ['.quiz-options'], time: 2.4 });
  if (steps.length) director.play(steps);
}

// drone shots (pos / target / up / fov filled every frame; the rig blends in and out)
const _cA = new THREE.Vector3();
const _cB = new THREE.Vector3();
// low and close, beside the raider's nose, as it flies in and brakes
// narrow (portrait) screens: the drone backs off so the whole subject stays in frame
const dronePull = () => Math.pow(Math.max(1, 1.1 / camera.aspect), 0.65);
// exact: aim dead-centre on the raider (the defeat shot); otherwise lead a little toward the ship
const camRaider = (r, exact = false) => (o) => {
  const k = dronePull() * (r.root.scale.x / 1.35) * (exact ? 1.35 : 1);   // pull back as the raider grows
  _cA.copy(ship.position).sub(r.position).setY(0).normalize();          // raider -> ship
  _cB.set(_cA.z, 0, -_cA.x);                                            // its side
  o.pos.copy(r.position).addScaledVector(_cA, 7 * k).addScaledVector(_cB, 12 * k).add(tmp.set(0, 6 * k, 0));
  o.target.copy(r.position).lerp(ship.position, exact || camera.aspect < 1 ? 0 : 0.12);
  o.up.set(0, 1, 0);
  o.fov = 42 / Math.sqrt(Math.min(1, camera.aspect));   // wider lens on portrait screens
};
// the boss: a wide close-up from in front of it, the player's ship small beyond
function camBoss(o) {
  _cA.copy(ship.position).sub(boss.position).setY(0).normalize();
  _cB.set(_cA.z, 0, -_cA.x);
  const k = dronePull();
  o.pos.copy(boss.position).addScaledVector(_cA, 30 * k).addScaledVector(_cB, 16 * k).add(tmp.set(0, 20 * k, 0));
  o.target.copy(boss.position).lerp(ship.position, camera.aspect < 1 ? 0 : 0.15);
  o.up.set(0, 1, 0);
  o.fov = 50;
}
// straight down onto the ship's cannon, close
function camCannon(o) {
  o.pos.copy(quizCenter).add(tmp.set(0, 36 * rig.topZoom, 8 * rig.topZoom));
  o.target.copy(quizCenter);
  o.up.set(0, 1, 0);
  o.fov = 52;
}
// a closer look at the angle diagram
function camDiagram(o) {
  o.pos.copy(quizCenter).add(tmp.set(0, 72 * rig.topZoom, 12 * rig.topZoom));
  o.target.copy(quizCenter);
  o.up.set(0, 1, 0);
  o.fov = 52;
}

// ------------------------------------------------------------------ angle battles
// the next thing to ask about: the hovering raider, or (boss) a turret, then the core
function nextQuizTarget(dt) {
  if (campaign.phase === 'battle') {
    for (const r of raiders.list) {
      if (r.alive && r.hold && raiders.arrived(r)) return { kind: 'raider', obj: r, pos: r.position, index: campaign.level + 1, total: campaign.total };
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
  } else if (!quiz.active && !director.camera && state.mode === 'play' && !(state.doom > 0) && !(dialogue.active && dialogue.line.intro)) {
    const tgt = nextQuizTarget(dt);
    if (tgt) {
      const dx = tgt.pos.x - quizCenter.x, dz = tgt.pos.z - quizCenter.z;
      const dist = Math.hypot(dx, dz);
      const lv = campaign.L.boss ? masteryLevel() : campaign.L;
      const q = makeQuestion(Math.atan2(-dx, -dz), lv.rule, Math.random, { answer: answerOf(lv), options: lv.options });
      state.sector.asked++;
      // the radar ring must fit between the question box and the answer buttons on any screen
      const camH = topHeight(camera.aspect) * rig.topZoom;
      const halfH = camH * TAN_HALF_FOV;
      const wide = wideLayout(camera.aspect);
      const ringMax = wide ? halfH * battleFrame(camera.aspect).ring : Math.min(halfH * 0.66, halfH * camera.aspect * 0.9);
      // the ring stays clear of the raider: the enemy line runs on past it to the target
      const gap = wide && tgt.kind === 'raider' ? Math.max(8.5, 0.25 * halfH) : 8.5;
      quiz.ask(tgt, q, tgt.index, tgt.total, { len: Math.min(dist - gap, ringMax), tLen: dist, arcR: 13 * Math.min(rig.topZoom, 1.65) }, timeLimit());
      introduceQuestion(q);
    }
  }
  if (director.active && quiz.busy) director.clear();      // answering ends the walkthrough
  quiz.update(dt, turret.yaw, director.active || dialogue.active);   // reading time: the clock waits
  angleOverlay.update(dt, t, quizCenter, camera);
}

function quizFire(correct) {
  const kind = quiz.target.kind;
  state.volley = { n: 5, next: state.time, damage: kind === 'raider' ? 3 : 4, ghost: !correct };
  if (!correct) rig.addShake(0.1);
}

function quizPunish(target) {
  buzz([70, 50, 70]);
  dialogue.say(target.kind === 'raider' ? enemyLine(target.obj.callsign, 'raiderMock', 1.5, target.obj.position) : enemyLine(WARDEN, 'wardenMock', 1.5, boss.corePos));
  if (target.kind === 'raider') raiders.punish(target.obj, state.time);
  else boss.punish(state.time, bossCtx);
  audio.alarm();
}

// time ran out: the target makes a heavy attack (Angle Hunt: the meteor reaches the core)
// Time ran out: instant fail. The enemy fires its finishing burst, the ship is destroyed, and
// Retry restarts this level.
function quizTimeout(target) {
  if (state.mode !== 'play' || state.doom > 0) return;
  quiz.stop();
  director.clear();
  buzz([90, 50, 90, 50, 200]);
  audio.alarm();
  hud.alert("Time's up!", 'danger', 2);
  if (target.kind === 'raider') raiders.punish(target.obj, state.time, true);
  else { boss.punish(state.time, bossCtx); boss.punish(state.time + 0.2, bossCtx); }
  state.doom = 0.55;
  state.deathCause = 'time';
}

// seconds to answer: Angle Hunt's curve, 14 s on the first level down to 9 s; 9 s for the Warden
const timeLimit = () => (campaign.L.boss ? 9 : Math.max(9, 14 - 0.55 * Math.min(campaign.level, 9)));

function quizSolved(target, firstTry) {
  state.timeScale = 0.35;   // a beat of slow motion on the hit
  rig.addShake(0.35);
  if (target.kind === 'raider') {
    const r = target.obj;
    if (r.alive) { raiders.kill(r); raiderDestroyed(r, true); }
    dialogue.say(enemyLine(r.callsign || 'RAIDER', 'raiderHit', 1.3, r.position.clone()));
  } else {
    if (target.kind === 'turret' && target.obj.alive) onBossHit(target.part, target.pos.clone(), 99);
    if (target.kind === 'turret') dialogue.say(enemyLine(WARDEN, 'wardenTurret', 1.3, boss.corePos));
    // the core always takes exactly three right answers, however many of the volley's shots land
    if (target.kind === 'core' && !boss.dying) {
      const hitsLeft = Math.max(0, 3 - (state.bossSolved - 4) - 1);
      const want = Math.ceil((CORE_HP * hitsLeft) / 3);
      if (boss.coreHp > want) onBossHit(target.part, target.pos.clone(), boss.coreHp - want);
      if (!boss.dying) dialogue.say(enemyLine(WARDEN, 'wardenCore', 1.3, boss.corePos));
    }
    state.bossSolved++;
    boss.holdAngle = Math.PI + (Math.random() < 0.5 ? -1 : 1) * (camera.aspect < 1 ? rand(0.4, 0.55) : rand(0.8, 1.05));
    state.bossHoldT = 0;
  }
  if (firstTry) { addScore(50, tmp.copy(target.pos).add(V(0, 0, -9))); state.sector.first++; }
  buzz(20);
}

// Landscape battles: comms are a speech bubble beside whoever is talking, in the open side space
// next to the radar (never over the radar, the question bar or the answers). The co-pilot talks
// from the other side. Phones and defeat close-ups keep the docked box from the CSS.
const dlgEl = $('dialog');
let lastSpeaker = null;
function placeComms() {
  const l = dialogue.line;
  const on = l && camera.aspect >= 1 && document.body.classList.contains('battle');
  if (!on) {
    if (dlgEl.classList.contains('bubble')) { dlgEl.classList.remove('bubble'); dlgEl.style.cssText = ''; }
    return;
  }
  const W = window.innerWidth, H = window.innerHeight;
  const ringPx = angleOverlay.ringPx || 0.6 * H / 2;
  const bands = [[16, W / 2 - ringPx - 16], [W / 2 + ringPx + 16, W - 16]];
  const bh = dlgEl.offsetHeight;                 // read before writing: one layout pass per frame
  let x, y, tail = '', tailX = 0, bw;
  if (l.src) {
    tmp.copy(l.src).project(camera);
    const ex = (tmp.x * 0.5 + 0.5) * W, ey = (-tmp.y * 0.5 + 0.5) * H;
    lastSpeaker = ex < W / 2 ? 0 : 1;
    const [b0, b1] = bands[lastSpeaker];
    bw = Math.max(190, Math.min(300, b1 - b0));
    x = clamp(ex - bw / 2, Math.max(12, b0), Math.min(W - 12, b1) - bw);   // stays in the side space
    const off = 0.2 * H;                          // clear of the craft itself
    const above = ey > H / 2;
    y = above ? ey - off - bh : ey + off;
    tail = above ? 'down' : 'up';
    tailX = clamp(ex - x, 22, bw - 22);
  } else {
    const [b0, b1] = bands[lastSpeaker === 0 ? 1 : 0];   // the crew: the side without the enemy
    bw = Math.max(190, Math.min(300, b1 - b0));
    x = clamp((b0 + b1) / 2 - bw / 2, Math.max(12, b0), Math.min(W - 12, b1) - bw);
    y = H / 2 - bh / 2;
  }
  y = clamp(y, 112, H - 118 - bh);              // between the question bar and the answers
  if (!dlgEl.classList.contains('bubble')) dlgEl.classList.add('bubble');
  dlgEl.dataset.tail = tail;
  dlgEl.style.cssText = `left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;width:${bw.toFixed(0)}px;--tail-x:${tailX.toFixed(0)}px`;
}

// enemy banter: a raider taunts once it has flown in, the Warden boasts after its introduction
function updateBanter() {
  if (director.active || state.doom > 0) return;
  for (const r of raiders.list) {
    if (!r.alive || !r.hold || r.taunted || !raiders.arrived(r)) continue;
    r.taunted = true;
    const lines = [enemyLine(r.callsign, 'raiderArrive', 1.3, r.position)];
    if (Math.random() < 0.35) lines.push(crewLine('crewReply', 1.2));
    for (const l of lines) l.intro = true;     // the question waits for the opening banter
    dialogue.play(lines);
  }
  if (boss.active && !boss.dying && state.wardenTalk === false) {
    state.wardenTalk = true;
    dialogue.play(wardenIntro(boss.corePos).map((l) => ({ ...l, intro: true })));
  }
}

// in-world enemy markers: radar blips around the cannon and health rings under each enemy
function updateHolo(t, show) {
  blips.length = 0;
  rings.begin(t);
  if (show) {
    for (const r of raiders.list) {
      if (!r.alive) continue;
      blips.push({ angle: bearing(r.position), strength: 1, kind: 0 });
      rings.add(tmp.copy(r.position).setY(r.position.y - 1.2), r.hold ? 5.2 : 7.5, r.hp / r.maxHp, 0);
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
  if (input.consume('mute')) { hud.alert(audio.toggleMute() ? 'Sound off' : 'Sound on', 'info', 1.2); updateSoundButton(); }
  if (input.consume('lock')) activate('lock');
  if (input.consume('shield')) activate('shield');
  for (const a of Object.values(abilities)) { a.t = Math.max(0, a.t - dt); a.cool = Math.max(0, a.cool - dt); }

  if (intro.active && (mode === 'title' || mode === 'launch')) {
    const ev = intro.update(dt, t);
    // crossing the horizon goes black; emerge() then bursts out into white light
    if (mode === 'launch') setWhiteout('black', intro.fade);
    lens.uniforms.uAberration.value = 0.0018 + 0.012 * intro.distort * intro.distort;
    if (ev === 'emerge') emerge();
  }

  // ---- ship motion (bigger in top-view battles)
  const battleView = (play || mode === 'dying') && campaign.cfg.view === 'top';
  state.shipScale = damp(state.shipScale, battleView ? BATTLE_SCALE : 1, 2.5, dt);
  ship.root.scale.setScalar(state.shipScale);
  const gunBoost = (state.shipScale - 1) / (BATTLE_SCALE - 1);          // 0 cruising .. 1 in battle
  ship.nodes.TurretMount.scale.setScalar(MOUNT_SCALE * (1 + 0.7 * gunBoost));
  battleLight.intensity = 1.2 * gunBoost;                // soft overhead light so both crafts read clearly
  battleLight.position.copy(ship.position).add(tmp.set(0, 60, 18));
  battleLight.target.position.copy(ship.position);
  shipGlow.position.set(ship.position.x, ship.position.y - 1.5, ship.position.z + 1);
  shipGlow.material.opacity = 0.2 * gunBoost;
  // battles: dim the sky and the stars so the radar lines and both crafts are the brightest things
  scene.backgroundIntensity = 1 - 0.6 * gunBoost;
  stars.brightness = 1 - 0.6 * gunBoost;
  state.battleDim = gunBoost;
  shipGlow.visible = gunBoost > 0.01;
  ship.radius = SHIP_RADIUS * state.shipScale;
  if (play && ship.kinematic) {
    const cfg = campaign.cfg;
    const auto = campaign.phase === 'journey' && portal.state === 'in' && ship.position.z - portal.group.position.z < 300;
    const sx = auto ? clamp((LANE.x - ship.position.x) / 10, -1, 1) : cfg.steer ? input.dirX : 0;
    const sy = auto ? clamp((LANE.y - ship.position.y) / 6, -1, 1) : cfg.steer ? input.dirY : 0;
    ship.rail(dt, cfg.speed, sx, sy, LANE, BOUNDS);
  } else if (mode === 'finale') {
    finaleUpdate(dt);
  } else if (mode === 'dying') {
    ship.position.addScaledVector(ship.velocity, dt);
  }
  ship.update(dt, input, t, false);

  // ---- camera
  director.update(dt);
  if (mode === 'dying' && state.killer && state.modeT > 0.9) deathShot(dt);
  if (play) {
    if (director.camera) rig.setMode('drone', 0.95);      // drone shot: zoom in on what is introduced
    else rig.setMode(campaign.cfg.view, 1.15);            // ...and back out
  }
  rig.update(dt, ship, t);
  if (intro.active) intro.applyCamera(camera, t);
  controls.setMode((play ? campaign.cfg.view === 'top' : rig.mode === 'top') ? 'top' : 'chase');
  // defeat: after the blast, a drone shot pushes in on the enemy while the comms play
  if (mode === 'dying') {
    if (!state.deathTalk && state.modeT > 1.0) { state.deathTalk = true; dialogue.play(defeatLines(), () => { if (state.mode === 'dying') gameOver(); }); }
    if (!state.killer && !dialogue.active && state.deathTalk && state.modeT > 2.6) gameOver();
  }
  if (play) updateBanter();
  if (mode !== 'paused') dialogue.update(dt);
  placeComms();
  // comms sit in the battle layout (console column / top strip) during battles; a line that is
  // still playing keeps its place until it ends
  const battleUI = play && battlePhase();
  if (battleUI || !dialogue.active) document.body.classList.toggle('battle', battleUI);
  if (play && state.doom > 0 && (state.doom -= dt) <= 0) { state.doom = 0; die(); }

  // ---- campaign + aiming + firing
  if (play) {
    campaign.update(dt, campaignCtx);
    if (campaign.phase === 'cleared' && !seen.has('meteors')) {
      introduce('meteors', [
        { text: 'Meteor field! LOCK aims for you. SHIELD blocks hits.', focus: ['#controls .act.lock', '#controls .act.shield'], time: 3.2 },
      ]);
    }
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
      playerBolts.spawn(shot.position, shot.direction, ship.velocity, BOLT_SPEED, state.volley.damage, state.volley.ghost);
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
  ship.setCannonGlow(Math.max(turret.heat, battlePhase() ? 0.55 : 0), state.cannonFlash);
  radar.update(dt, {
    yaw: turret.yaw, want: turret.desiredYaw, firing: play && input.fire && !turret.overheated, shot: fired,
    aiming: state.aiming, top: rig.mode === 'top', heat: turret.heat, locked: !!state.locked, show: play && !battlePhase(), time: t,
  });

  // ---- simulation
  raiderCtx.shipAlive = play && !director.active;
  raiderCtx.arena = campaign.phase === 'battle' || campaign.phase === 'contact' || campaign.phase === 'boss';
  if (play || mode === 'dying') raiders.update(dt, t, raiderCtx);
  bossCtx.shipAlive = play && !director.active;
  if (play || mode === 'dying') boss.update(dt, t, bossCtx);
  campaign.bossIntegrity = boss.active ? boss.integrity : 0;
  rig.topZoom = campaign.phase === 'boss' ? bossZoom(camera.aspect) : 1;
  bossBolts.update(dt, enemyHitTest, onEnemyBolt);
  playerBolts.update(dt, playerHitTest, onPlayerBolt);
  enemyBolts.update(dt, enemyHitTest, onEnemyBolt);
  field.update(dt, t, ship.position, camera.position);
  trash.update(dt, ship.position);
  if (play) updateScenery(dt);
  scenery.update(dt, t, ship.position, camera.position);
  if (play && dt > 0) collideShip();
  updateHolo(t, play);
  rings.mesh.visible = !director.camera;   // lock-on brackets would float oddly in a low close-up
  if (play) updateQuiz(dt, t);
  else angleOverlay.update(dt, t, quizCenter, camera);
  if (portal.update(dt, t, ship.position) && mode === 'play') crossPortal();

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
  dust.object.visible = rig.mode !== 'top' && !(play && battlePhase());   // the streaks read as rain in the overhead view
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
  const titleView = mode === 'title';
  bloom.strength = BLOOM_STRENGTH * (blackhole.object.visible ? 0.3 + 0.45 * near : 1) * (1 - 0.6 * (state.battleDim || 0)) * (titleView ? 0.75 : 1);
  field.material.color.setScalar(titleView || mode === 'launch' ? 0.55 : 1);   // rocks by the station sit in shadow
  sun.update(dt, camera, ship.position, SUN_OCCLUDERS);

  state.damage = damp(state.damage, 0, 2.5, dt);
  const lowHull = play && vitals.hullFrac < 0.3 ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
  const hurry = play && quiz.state === 'ask' && quiz.limit && quiz.timeLeft < 3 && !director.active
    ? (0.3 + 0.25 * Math.sin(t * 10)) * (1 - quiz.timeLeft / 3) : 0;
  lens.uniforms.uTime.value = t;
  lens.uniforms.uSun.value.copy(sun.state.screen);
  lens.uniforms.uSunVis.value = sun.state.visibility;
  lens.uniforms.uFlash.value = damp(lens.uniforms.uFlash.value, 0, 7, dt);
  lens.uniforms.uDamage.value = Math.max(state.damage, lowHull, hurry);
  const pxScale = fx.setViewport(renderer.getDrawingBufferSize(bufferSize).y, camera.fov);
  playerBolts.setViewport(pxScale);
  enemyBolts.setViewport(pxScale);
  bossBolts.setViewport(pxScale);

  audio.setMood(mode === 'paused' ? 'paused' : mode === 'gameover' || mode === 'dying' ? 'off'
    : mode !== 'play' ? 'calm' : campaign.phase === 'boss' ? 'boss' : battlePhase() ? 'battle'
    : campaign.phase === 'journey' ? 'calm' : 'cruise');
  audio.update(camera, ship, turret, flying);
  // the system cursor is hidden only while the aiming crosshair replaces it (cruise and meteor
  // fields); everywhere else (title, intro, angle battles, menus) the normal pointer shows
  const wantCursor = play && !battlePhase() ? 'none' : 'default';
  if (canvas.style.cursor !== wantCursor) canvas.style.cursor = wantCursor;
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
portal.group.visible = true;   // compile the portal shaders up front
try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
portal.group.visible = false;
renderer.setAnimationLoop(frame);
$('start').disabled = false;
$('start').classList.remove('failed');
$('load-msg').textContent = '';
if (document.fonts?.load) document.fonts.load('64px "Lilita One"').catch(() => {});

// handy for tuning from the devtools console
window.game = {
  THREE, scene, camera, renderer, ship, turret, rig, field, fx, raiders, boss, vitals, intro, campaign, state, input, audio, hud, abilities,
  radar, portal, rings, director, blackhole, planets, quiz, angleOverlay, launch, setMode,
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
