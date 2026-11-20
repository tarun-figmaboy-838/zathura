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
import { WormholeTube } from './world/wormhole.js';
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
import { Projectiles } from './combat/projectiles.js';
import { Effects, SHIP_CORE } from './combat/fx.js';
import { Trails } from './combat/trails.js';
import { Raiders } from './enemies/raiders.js';
import { ENEMY_LOOK, kindFor } from './enemies/look.js';
import { DRONE_KINDS } from './enemies/droneKinds.js';
import { makeWardenDrone } from './enemies/wardenDrone.js';
import { Boss, TURRET_HP, CORE_HP } from './enemies/boss.js';
import { Intro } from './game/intro.js';
import { Campaign, masteryLevel, answerOf } from './game/campaign.js';
import { AudioEngine } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Controls } from './ui/controls.js';
import { Dialogue } from './ui/dialogue.js';
import { Voice } from './audio/vo.js';
import { raiderName, enemyLine, crewLine, wardenIntro, WARDEN, ENEMY_CALLSIGN, enemyIntro } from './game/banter.js';

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

// Everything the UI shows is ready before Play can be tapped: every image the page and the
// stylesheet use (buttons, answer capsules, portraits, icons, cockpit and title art) is downloaded
// and decoded, and every font face is loaded. Started right away, awaited before Play is enabled;
// capped at 8 s so a flaky network can never lock the player out.
const UI_FONTS = ['400 64px "Lilita One"', '600 20px "Fredoka"', '700 30px "Fredoka"', '400 16px "Inter"', '600 16px "Inter"',
  '700 20px "Inter"', '800 12px "Inter"', '700 20px "Orbitron"', '900 20px "Orbitron"'];
function uiImageUrls() {
  const urls = new Set([...document.querySelectorAll('img[src]')].map((i) => i.src));
  for (const f of ['raider', 'warden', 'crew']) urls.add(new URL(`assets/ui/face-${f}.webp`, document.baseURI).href);
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }        // cross-origin (Google Fonts): skip
    const base = sheet.href || document.baseURI;
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules) walk(r.cssRules);
        for (const m of (r.cssText || '').matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          if (!m[1].startsWith('data:')) urls.add(new URL(m[1], base).href);
        }
      }
    };
    walk(rules);
  }
  return [...urls];
}
const uiReady = (() => {
  const images = uiImageUrls().map((src) => {
    const img = new Image();
    img.src = src;
    return (img.decode ? img.decode() : new Promise((ok) => { img.onload = ok; })).catch(() => {});
  });
  const fonts = document.fonts?.load ? UI_FONTS.map((f) => document.fonts.load(f).catch(() => {})) : [];
  const all = Promise.all([...images, ...fonts]).then(() => document.fonts?.ready);
  return Promise.race([all, new Promise((ok) => setTimeout(ok, 8000))]);
})();

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
const _dustVel = new THREE.Vector3();
scene.add(stars.object, dust.object, blackhole.object, ...planets.map((p) => p.object));

let shipGltf, rockGltf, raiderGltf, stationGltf, bossGltf;
try {
  const loader = new GLTFLoader();
  // the raider ship and carrier models are only needed for the saved ship draft (src/enemies/look.js)
  [shipGltf, rockGltf, stationGltf, raiderGltf, bossGltf] = await Promise.all(
    ['ship', 'asteroids', 'station', ...(ENEMY_LOOK === 'ship' ? ['raider', 'boss'] : [])]
      .map((n) => loader.loadAsync(`assets/models/${n}.glb`)),
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
// the enemies: three kinds of virus drone and the Warden drone (built in code), or the saved ship draft
const raiders = new Raiders(scene, raiderGltf
  ? [{ key: 'raider', model: raiderGltf.scene, trail: [1.15, 0.38, 0.16], count: 10 }]
  : DRONE_KINDS.map((k) => ({ ...k, model: k.make() })), trails);
const boss = new Boss(scene, bossGltf ? bossGltf.scene : makeWardenDrone());
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
// the rides: 3D funnels anchored where they open (inside the black hole; behind each portal's ring)
const wormTube = new WormholeTube(scene, blackhole.uniforms.uR.value);
intro.tube = wormTube;
const portalTube = new WormholeTube(scene, 22.5, { length: 560, segments: 140, radial: 72, throat: 0.84, warm: 0.35 });
const riding = () => (state.mode === 'launch' && intro.stage === 'tunnel') || state.tunnel > 0;
const vo = new Voice(audio);
// a voiced line speaks (the talk blips only fill in for lines without a voice); the line waits for it
dialogue.voice = (who) => { if (!vo.speaking) audio.chatter(who); };
dialogue.onLine = (line) => { if (line) vo.play(line.text); else vo.stop(); };
dialogue.busy = () => vo.speaking;
const campaign = new Campaign();
const director = new Director(rig);
// the co-pilot reads the introductions; a step lasts at least as long as its voice
director.onText = (step) => {
  if (!step) { if (!dialogue.active) vo.stop(); return; }
  const d = vo.play(step.text);
  if (d) step.time = Math.max(step.time || 0, d + 0.6);
};
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
  volley: null, timeScale: 1, bossHoldT: 0, bossSolved: 0, turnHold: 0, fireHeld: false,
  sector: { asked: 0, first: 0 }, stars: [], reportOpen: false, reportT: 0,
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

// title screen: the logo always ends above the black hole (where the hole shows depends on the
// window's shape); its width is capped so its bottom stays clear of the hole's glow
const titleEl = document.querySelector('.title-logo');
const TITLE_ASPECT = 917 / 340;   // the title image's width / height
const _camUp = new THREE.Vector3();
let titleFit = 0;
function fitTitle() {
  const top = titleEl.getBoundingClientRect().top;
  _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  tmp.copy(blackhole.position).addScaledVector(_camUp, blackhole.uniforms.uR.value * 2.0).project(camera);
  const holeTop = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
  const fit = Math.max(160, (holeTop - top - 14) * TITLE_ASPECT);
  if (Math.abs(fit - titleFit) > 2) { titleFit = fit; titleEl.style.setProperty('--fit', `${fit.toFixed(0)}px`); }
}

// full-screen fade layer: white for the black-hole crossing, black for the ending
function setWhiteout(color, opacity, seconds = 0, easing = 'ease') {
  whiteout.classList.toggle('black', color === 'black');
  whiteout.style.transition = seconds ? `opacity ${seconds}s ${easing}` : 'none';
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
  vo.preload();                    // decode the voices now that audio can play
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
  setWhiteout('white', 0, 0.7, 'cubic-bezier(0.15, 0.75, 0.3, 1)');
  lens.uniforms.uFlash.value = 0.4;
  state.warp = 1.3;
  wormTube.alpha = 0;
  wormTube.exit = 0;
  audio.warp(ship.position);
  document.body.classList.add('warping');            // controls fade in once the flash has cleared
  setTimeout(() => document.body.classList.remove('warping'), 650);
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
  state.tunnel = 0;
  portalTube.alpha = 0;
  for (const a of Object.values(abilities)) { a.t = 0; a.cool = 0; }
}

function retryLevel() {
  clearCombat();
  setWhiteout('white', 0);
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
  victoryTimers.forEach(clearTimeout);
  victoryTimers.length = 0;
  clearCombat();
  state.stars = [];
  closeReport();
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
  state.lastQ = quiz.active ? quiz.q : state.timedOutQ || null;   // a time-out stops the quiz first
  state.timedOutQ = null;
  state.killer = t ? (t.kind === 'raider' ? { kind: 'raider', obj: t.obj } : { kind: 'boss' })
    : boss.active && !boss.dying ? { kind: 'boss' }
    : (() => { const r = raiders.list.find((x) => x.alive); return r ? { kind: 'raider', obj: r } : null; })();
  quiz.stop();
  director.clear();
  dialogue.clear();
  state.volley = null;          // the wreck doesn't keep firing
  state.tunnel = 0;             // and any portal ride ends
  portalTube.alpha = 0;
  portalTube.exit = 0;
  state.rideHidShield = false;
  setWhiteout('white', 0);
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
  state.tunnel = 0;
  portalTube.alpha = 0;
  $('go-score').textContent = state.score.toLocaleString('en-US');
  $('go-level').textContent = campaign.L.label;
  setMode('gameover');
}

// Ending: a drone parks behind the ship and keeps zooming in as it burns away, so the ship stays
// the same size on screen while space rushes past it, then it jumps home in a flash.
// ------------------------------------------------------------------ the ending
// The way home: a giant portal opens far ahead. The ship lights its engines and races at it; the
// camera rides along, then lets it go (a long-lens shot of it rushing in). In the last moments it
// stretches into a streak of light, like a time jump, and plunges in: gone. The portal flares,
// implodes behind it with a shockwave, the stars settle, and the journey ends.
const FIN = { ENTER: 3.4, DIST: 760, SCALE: 2.6, LET_GO: 300 };   // LET_GO: the camera stops this far from the portal
const finale = { z0: 0, entered: false, enterT: 0, collapsed: false, pos: new THREE.Vector3() };
function startFinale() {
  setMode('finale');
  director.clear();
  dialogue.clear();
  shield.mesh.visible = false;          // no shield bubble in the way of the camera
  const f = finale;
  f.letGo = false;
  f.z0 = ship.position.z;
  f.entered = false;
  f.collapsed = false;
  f.pos.set(ship.position.x, ship.position.y + 2, f.z0 - FIN.DIST);
  field.clearAll();
  trash.clearAll();
  portal.show(f.pos, '', '');
  portal.group.scale.setScalar(FIN.SCALE);
  portalTube.place(f.pos, V(0, 0, -1));
  portalTube.mesh.scale.setScalar(FIN.SCALE);
  portalTube.alpha = 0;
  portalTube.exit = 0;
  rig.plungePos.copy(camera.position);
  rig.focus.copy(ship.position).add(tmp.set(0, 0.5, -80));
  rig.holdFov = camera.fov;
  rig.setMode('hold', 0.6);
  audio.warp(f.pos);
  audio.ignite();
}

function finaleUpdate(dt) {
  const T = state.modeT, f = finale;
  const k = clamp(T / FIN.ENTER, 0, 1);
  if (!f.entered) {
    // the run at the portal: gentle at first, then flat out
    const prevZ = ship.position.z;
    ship.position.z = f.z0 - FIN.DIST * Math.pow(k, 2.6);
    ship.position.x += (f.pos.x - ship.position.x) * (1 - Math.exp(-3 * dt));
    ship.position.y += (f.pos.y - ship.position.y) * (1 - Math.exp(-3 * dt));
    ship.velocity.set(0, 0, (ship.position.z - prevZ) / Math.max(dt, 1e-4));
    ship.thrust = 1.0;
    ship.boost = Math.min(0.35, ship.boost + dt * 1.5);   // enough to roar, not so much the glare hides the ship
    // the time jump: it stretches into a streak of light and the view warps
    const st = clamp((k - 0.8) / 0.2, 0, 1);
    ship.visual.scale.set(1 - 0.55 * st, 1 - 0.55 * st, 1 + 8 * st * st);
    state.warp = Math.max(state.warp || 0, st * 1.3);
    portalTube.alpha = 0.9 * clamp((k - 0.15) / 0.5, 0, 1);
    rig.addShake(dt * (0.3 + 1.2 * st));
    if (k >= 1) {
      f.entered = true;
      f.enterT = T;
      ship.model.visible = false;
      shield.mesh.visible = false;
      ship.velocity.set(0, 0, 0);
      fx.warp(f.pos, tmp.set(0, 0, -1));
      lens.uniforms.uFlash.value = 0.45;
      audio.boostWhoosh();
    }
  } else {
    // gone: the vortex spins up and brightens around where it vanished, then the portal implodes
    // to a point and bursts
    const e = T - f.enterT;
    portalTube.exit = 0.3 * clamp(e / 0.35, 0, 1);
    const shrink = clamp((e - 0.35) / 0.6, 0, 1);
    const sc = FIN.SCALE * (1 - shrink * shrink * shrink);
    if (!f.collapsed) {
      portal.group.scale.setScalar(Math.max(0.001, sc));
      portalTube.mesh.scale.setScalar(Math.max(0.001, sc));
      portal.uniforms.uFlash.value = Math.max(portal.uniforms.uFlash.value, 0.6 * (1 - shrink));
      portal.spinBoost = 10 * clamp(e / 0.9, 0, 1);
    }
    if (!f.collapsed && shrink >= 1) {
      f.collapsed = true;
      portal.hide();
      portalTube.alpha = 0;
      portalTube.exit = 0;
      fx.ring(f.pos, 340, 1.0, [0.8, 1.4, 2.0]);       // blue-white shockwaves: a time jump, not a blast
      fx.ring(f.pos, 160, 0.55, [1.6, 1.7, 2.0]);
      lens.uniforms.uFlash.value = 0.6;
      rig.addShake(0.7);
      audio.horizon();
    }
    const fade = clamp((e - 2.6) / 1.0, 0, 1);
    setWhiteout('black', fade);
    if (fade >= 1) victory();
  }
  // the camera rides close behind the ship as the portal grows ahead; when the portal fills the
  // view it stops and lets the ship streak the last stretch into the middle of it
  if (!f.letGo && ship.position.z - f.pos.z > FIN.LET_GO && !f.entered) {
    // locked to the ship (an eased follow lags further and further behind as it speeds up); the
    // switch into this shot is smoothed by the rig's blend
    rig.plungePos.copy(ship.position).add(tmp2.set(4, 5, 18));
    rig.focus.copy(ship.position).lerp(f.pos, 0.35).add(tmp2.set(0, 1.5, 0));
    rig.holdFov += (58 - rig.holdFov) * (1 - Math.exp(-4 * dt));
  } else {
    f.letGo = true;
    rig.focus.lerp(f.pos, 1 - Math.exp(-3 * dt));
    rig.holdFov += (50 - rig.holdFov) * (1 - Math.exp(-2 * dt));
  }
}

const victoryTimers = [];
function victory() {
  victoryTimers.forEach(clearTimeout);
  victoryTimers.length = 0;
  const newBest = saveBest();
  $('v-score').textContent = state.score.toLocaleString('en-US');
  const best = $('v-best');
  best.textContent = newBest ? 'New best' : `Best ${state.best.toLocaleString('en-US')}`;
  best.classList.toggle('new-best', newBest);
  // one rating for the whole run: the average of the stars earned every 4 levels
  const groups = campaign.count;
  const total = state.stars.reduce((a, b) => a + (b || 0), 0);
  const rating = Math.max(1, Math.round(total / groups));
  $('v-stars').querySelectorAll('i').forEach((el, i) => {
    el.className = '';
    if (i < rating) victoryTimers.push(setTimeout(() => { el.className = 'on'; audio.star(i); }, 700 + i * 320));
  });
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
    dialogue.say(focus(at(enemyLine(WARDEN, 'wardenDown', 2.2), boss.model, boss.corePos.clone()), 'boss'));   // the climax gets a close-up
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
  lens.uniforms.uFlash.value = 0.12;
  state.warp = 0.6;
  field.clearAll();
  trash.clearAll();
  // straight on into the funnel behind the ring; the level starts when the ride ends (endPortalRide)
  state.tunnel = PORTAL_RIDE;
  portalTube.alpha = 1;
  rig.addShake(0.5);
  fx.ring(ship.position, 60, 0.7);
  audio.warp(ship.position);
  audio.boostWhoosh();
}

const PORTAL_RIDE = 1.5;
function endPortalRide() {
  // out of the white the ride ended in, into the level
  portalTube.alpha = 0;
  portalTube.exit = 0;
  setWhiteout('white', 1);
  void whiteout.offsetWidth;
  setWhiteout('white', 0, 0.5, 'cubic-bezier(0.1, 0.7, 0.3, 1)');
  state.warp = 1;
  rig.addShake(0.3);
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
    portal.group.scale.setScalar(1);
    portalTube.place(portal.group.position, V(0, 0, -1));
    portalTube.mesh.scale.setScalar(1);
    portalTube.alpha = 0;
    portalTube.exit = 0;
    state.portalPassed = false;
    for (let i = 0; i < 46; i++) spawnScenery(rand(90, 900));
    audio.waveHorn();
    introduce('portal', [
      { time: 1.5 },
      { text: 'Steer with ◀ ▲ ▼ ▶ and shoot the rocks and space junk!', focus: ['#controls .pad', '#controls .act.fire'], time: 4.5 },
      { text: 'Then fly through the portal to start Level 1.', time: 3.6 },
    ]);
    if (campaign.firstOfGroup) state.sector = { asked: 0, first: 0 };
    vitals.reset();                                        // repaired between levels: earlier hits never end a later one
    state.warnedHull = false;
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
      { text: 'The Warden is here!', cam: camBoss, time: 3.2 },
      { text: 'Break its 4 turrets, then hit its core.', cam: camBoss, time: 4 },
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
    const kind = kindFor(campaign.L.group);                 // a new kind of drone each sector
    const r = raiders.spawn(pos, ship.position, skill, state.time, true, kind);
    if (!r) return;
    r.hold = off;
    r.callsign = raiderName(kind);
    r.taunted = false;
    fx.warp(pos, tmp.copy(ship.position).sub(pos).normalize());
    audio.warp(pos);
    introduce(`enemy:${kind}`, [{ text: enemyIntro(kind), cam: camRaider(r), time: 3.4 }]);
  },
  spawnMeteor(p, size, v) { field.spawn(V(p.x, p.y, p.z), size, V(v.x, v.y, v.z)); },
  levelComplete(level) {
    const bonus = 500 * (level + 1) + Math.round(vitals.hull) * 5;
    state.score += bonus;
    state.levelStartScore = state.score;
    openReport(level);
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
  const name = boss_ ? WARDEN : (k && k.obj && k.obj.callsign) || ENEMY_CALLSIGN;
  const key = (boss_ ? 'warden' : 'raider') + (state.deathCause === 'time' ? 'WinTime' : 'Win');
  const q = state.lastQ;
  const tip = q ? `Remember: ${RULE_REMINDERS[q.type] || q.hint} Try again!` : 'Hull breached! Dodge the rocks or shoot them first.';
  const lines = [];
  if (k) lines.push(boss_ ? at(enemyLine(name, key, 1.6), boss.model, boss.corePos) : at(enemyLine(name, key, 1.6, null, k.obj.kind), k.obj.model, k.obj.position));
  lines.push({ who: 'crew', name: 'CO-PILOT', text: tip, hold: 2.0, face: 'crew', mood: 'cheer' });
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

// ------------------------------------------------------------------ stars
// stars: every target hit on the first try = 3, at least 60% = 2, otherwise 1
function starsFor(s) {
  if (!s.asked || s.first >= s.asked) return 3;
  return s.first / s.asked >= 0.6 ? 2 : 1;
}

// every 4 levels: the stars earned pop in over the action (no card, numbers or buttons), then the
// game flies on by itself; the victory screen gives the run its overall rating
const REPORT_TIME = 2.6;
function openReport(level) {
  const stars = starsFor(state.sector);
  state.stars[level] = Math.max(state.stars[level] || 0, stars);
  state.reportStars = stars;
  $('r-stars').querySelectorAll('i').forEach((el) => { el.className = ''; });
  $('report').classList.add('show');
  state.reportOpen = true;
  state.reportT = 0;
}

function closeReport() {
  if (!state.reportOpen) return;
  $('report').classList.remove('show');
  state.reportOpen = false;
}

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
  const markSeen = (key) => () => { seen.add(key); saveSeen(); };
  if (first) {
    steps.push({ text: 'This bright line is your cannon.', cam: camCannon, time: 3.6, onStart: markSeen('battle') });
    steps.push({ text: 'Turn it by the angle x to hit the target.', focus: ['.ang-label.unknown'], time: 4 });
  }
  if (!seen.has(q.type)) steps.push({ text: RULES[q.type], cam: camDiagram, time: 5, onStart: markSeen(q.type) });
  if (first) steps.push({ text: 'Turn with the joystick, then press FIRE!', focus: ['#stick', '#controls .act.fire'], time: 3.6 });
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
// your ship, for the co-pilot: from behind and to the side, looking past it toward the enemy
function camShip(o) {
  const r = raiders.list.find((x) => x.alive && x.hold);
  const foe = r ? r.position : boss.active ? boss.position : null;
  if (foe) _cA.copy(foe).sub(ship.position).setY(0).normalize(); else _cA.set(0, 0, -1);   // ship -> enemy
  _cB.set(_cA.z, 0, -_cA.x);
  const k = dronePull() * state.shipScale;
  o.pos.copy(ship.position).addScaledVector(_cA, -11 * k).addScaledVector(_cB, 8 * k).add(tmp.set(0, 6 * k, 0));
  o.target.copy(ship.position).addScaledVector(_cA, 3);
  o.up.set(0, 1, 0);
  o.fov = 42 / Math.sqrt(Math.min(1, camera.aspect));
}

// Focus shots, kept for the moments that matter (most lines play in the battle view): the Warden
// going down gets a close-up like the defeat shot, then the camera returns. Introductions and the
// defeat have their own shots.
const _focus = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50 };
const focusing = () => {
  const l = dialogue.line;
  if (!l || !l.focus || state.mode !== 'play' || director.camera || !battlePhase()) return null;
  if (l.focus === 'ship' || l.focus === 'boss') return l.focus === 'boss' && !boss.active ? null : l.focus;
  return l.focus.alive ? l.focus : null;
};
function focusShot(dt) {
  const f = focusing();
  if (!f) return false;
  if (f === 'ship') camShip(_focus); else if (f === 'boss') camBoss(_focus); else camRaider(f, true)(_focus);
  if (rig.mode !== 'drone') {
    rig.dronePos.copy(_focus.pos); rig.droneTarget.copy(_focus.target); rig.droneFov = _focus.fov;
    rig.setMode('drone', 0.7);
  }
  const s = 1 - Math.exp(-5 * dt);                // from one speaker to the next: a smooth swing
  rig.dronePos.lerp(_focus.pos, s);
  rig.droneTarget.lerp(_focus.target, s);
  rig.droneUp.copy(_focus.up);
  rig.droneFov += (_focus.fov - rig.droneFov) * s;
  return true;
}
// a line that gets a focus shot (and a moment longer to enjoy it)
const focus = (line, on) => Object.assign(line, { focus: on, hold: Math.max(line.hold || 0, 1.5) });

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
      // the question comes after the raider's opening taunt (see updateBanter)
      if (r.alive && r.hold && raiders.arrived(r) && r.taunted) return { kind: 'raider', obj: r, pos: r.position, index: campaign.level + 1, total: campaign.total };
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
  } else if (!quiz.active && !director.camera && state.mode === 'play' && !(state.doom > 0) && !(dialogue.active && (dialogue.line.intro || dialogue.line.focus))) {
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
  steerQuiz(dt);
  if (director.active && quiz.busy) director.clear();      // answering ends the walkthrough
  quiz.update(dt, turret.yaw, director.active || dialogue.active);   // reading time: the clock waits
  angleOverlay.update(dt, t, quizCenter, camera);
}

// the joystick (or ◀ ▶) turns the cannon and x counts as it turns: a gentle push turns it slowly
// for the last few degrees, a full push fast; held keys start slow and speed up. FIRE shoots.
const TURN_DEG = Math.PI / 180;
function steerQuiz(dt) {
  const fire = input.fireButton;
  const pressed = fire && !state.fireHeld;              // one shot per press
  state.fireHeld = fire;
  if (!quiz.canSteer || state.doom > 0) { state.turnHold = 0; return; }
  let speed = 0;                                         // degrees per second
  if (input.keyX) {
    state.turnHold += dt;
    speed = 14 + 76 * Math.min(1, state.turnHold / 1.2);
  } else {
    state.turnHold = 0;
    const a = Math.abs(input.stick.x);
    speed = a < 0.12 ? 0 : 10 + 110 * ((a - 0.12) / 0.88) ** 2;
  }
  // right turns the cannon clockwise on the screen (the top view looks down)
  quiz.steer(-Math.sign(input.dirX) * speed * TURN_DEG * dt);
  if (pressed) quiz.shoot();
}

function quizFire(correct) {
  const kind = quiz.target.kind;
  state.volley = { n: 5, next: state.time, damage: kind === 'raider' ? 3 : 4, ghost: !correct };
  if (!correct) rig.addShake(0.1);
}

function quizPunish(target) {
  buzz([70, 50, 70]);
  dialogue.say(target.kind === 'raider' ? at(enemyLine(target.obj.callsign, 'raiderMock', 1.5, null, target.obj.kind), target.obj.model, target.obj.position)
    : at(enemyLine(WARDEN, 'wardenMock', 1.5), boss.model, boss.corePos));
  if (target.kind === 'raider') raiders.punish(target.obj, state.time);
  else boss.punish(state.time, bossCtx);
  audio.alarm();
}

// time ran out: the target makes a heavy attack (Angle Hunt: the meteor reaches the core)
// Time ran out: instant fail. The enemy fires its finishing burst, the ship is destroyed, and
// Retry restarts this level.
function quizTimeout(target) {
  if (state.mode !== 'play' || state.doom > 0) return;
  state.timedOutQ = quiz.q;                                // the defeat screen reminds the student of its rule
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
// grade 7 pacing: 25 s on L1 easing to 15 s; 18 s for each of the Warden's targets
const timeLimit = () => (campaign.L.boss ? 18 : Math.max(15, 25 - 1.2 * Math.min(campaign.level, 9)));

function quizSolved(target, firstTry) {
  state.timeScale = 0.35;   // a beat of slow motion on the hit
  rig.addShake(0.35);
  if (target.kind === 'raider') {
    const r = target.obj;
    if (r.alive) { raiders.kill(r); raiderDestroyed(r, true); }
    dialogue.say(at(enemyLine(r.callsign || ENEMY_CALLSIGN, 'raiderHit', 0.9, null, r.kind), r.model, r.position.clone()));
  } else {
    if (target.kind === 'turret' && target.obj.alive) onBossHit(target.part, target.pos.clone(), 99);
    if (target.kind === 'turret') dialogue.say(at(enemyLine(WARDEN, 'wardenTurret', 1.3), boss.model, boss.corePos));
    // the core always takes exactly three right answers, however many of the volley's shots land
    if (target.kind === 'core' && !boss.dying) {
      const hitsLeft = Math.max(0, 3 - (state.bossSolved - 4) - 1);
      const want = Math.ceil((CORE_HP * hitsLeft) / 3);
      if (boss.coreHp > want) onBossHit(target.part, target.pos.clone(), boss.coreHp - want);
      if (!boss.dying) dialogue.say(at(enemyLine(WARDEN, 'wardenCore', 1.3), boss.model, boss.corePos));
    }
    state.bossSolved++;
    boss.holdAngle = Math.PI + (Math.random() < 0.5 ? -1 : 1) * (camera.aspect < 1 ? rand(0.4, 0.55) : rand(0.8, 1.05));
    state.bossHoldT = 0;
  }
  if (firstTry) { addScore(50, tmp.copy(target.pos).add(V(0, 0, -9))); state.sector.first++; }
  buzz(20);
}

// Comms are a speech bubble on the craft that is talking, with its tail pointing at it: the raider
// or the Warden for enemy lines, your own ship for the co-pilot. Each line picks the spot around the
// speaker (above or below, slid along) that covers the least of the question, the answers, the
// HUD, the radar ring and the craft itself, and then follows the craft as it moves. Lines with no
// speaker on screen (the co-pilot's tip after a defeat) use the docked box from the CSS.
const dlgEl = $('dialog');
const _box = new THREE.Box3(), _sph = new THREE.Sphere();
const KEEP_OUT = ['quiz-prompt', 'top-right', 'bossbar', 'banner'];
const comms = { line: null, pick: null, t: 0, out: [] };
const at = (line, obj, src = obj.position) => Object.assign(line, { obj, src });

function overlap(x, y, w, h, out, circles) {
  let s = 0;
  for (const o of out) s += Math.max(0, Math.min(x + w, o.r) - Math.max(x, o.l)) * Math.max(0, Math.min(y + h, o.b) - Math.max(y, o.t));
  for (const c of circles) {                           // sample the box against each circle
    let n = 0;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      const px = x + ((i + 0.5) / 8) * w, py = y + ((j + 0.5) / 4) * h;
      if ((px - c.x) ** 2 + (py - c.y) ** 2 < c.r * c.r) n++;
    }
    s += (n / 32) * w * h * c.w;
  }
  return s;
}

const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const _corner = new THREE.Vector3();
// the speaker's outline on screen: its model's box projected (a little inset: box corners overshoot
// the silhouette), or a small mark at its position when the craft is gone (blown up)
function speakerRect(l, W, H) {
  if (l.obj && shown(l.obj) && !_box.setFromObject(l.obj).isEmpty()) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).project(camera);
      const x = (_corner.x * 0.5 + 0.5) * W, y = (-_corner.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const ix = (x1 - x0) * 0.14, iy = (y1 - y0) * 0.14;
    return { x0: x0 + ix, y0: y0 + iy, x1: x1 - ix, y1: y1 - iy };
  }
  tmp.copy(l.src).project(camera);
  const cx = (tmp.x * 0.5 + 0.5) * W, cy = (-tmp.y * 0.5 + 0.5) * H;
  return { x0: cx - 22, y0: cy - 22, x1: cx + 22, y1: cy + 22 };
}

function placeComms(dt) {
  const l = dialogue.line;
  const on = l && l.src && (document.body.classList.contains('battle') || state.mode === 'dying');
  if (!on) {
    // keep the bubble where it is while it fades out (dropping it at once moved it to the docked spot,
    // right over the answers); a docked line (no speaker) takes over straight away
    if (dlgEl.classList.contains('bubble')) {
      comms.idle = (comms.idle || 0) + dt;
      if ((l && !l.src) || comms.idle > 0.35) { dlgEl.classList.remove('bubble', 'compact'); dlgEl.style.cssText = ''; }
    }
    comms.line = null;
    return;
  }
  comms.idle = 0;
  const W = window.innerWidth, H = window.innerHeight;
  if (!dlgEl.classList.contains('bubble')) dlgEl.classList.add('bubble');
  if (l !== comms.line) {
    comms.line = l;
    comms.pick = null;
    const narrow = W < 600;                          // phones: a compact bubble, it has less room
    dlgEl.classList.toggle('compact', narrow);
    dlgEl.style.maxWidth = `${narrow ? Math.min(250, W - 24) : 300}px`;
    // its size can't change within a line (the untyped rest is laid out from the start)
    comms.bw = dlgEl.offsetWidth;
    comms.bh = dlgEl.offsetHeight;
    comms.drawn = '';
  }
  const sr = speakerRect(l, W, H);
  const cx = (sr.x0 + sr.x1) / 2;
  // the speaker off-screen or behind the camera: the bubble goes, rather than sliding into a corner
  tmp.copy(l.src).project(camera);
  if (tmp.z > 1 || sr.x1 < 0 || sr.x0 > W || sr.y1 < 0 || sr.y0 > H) { dialogue.clear(); return; }
  const bw = comms.bw, bh = comms.bh;
  const TAIL = 22;
  const spot = (above, f) => {
    const x = clamp(cx - bw * f, 10, W - 10 - bw);
    const y = clamp(above ? sr.y0 - TAIL - bh : sr.y1 + TAIL, 8, H - 8 - bh);
    return { x, y, above, f };
  };
  const cost = (p) => {
    const craft = { l: sr.x0, t: sr.y0, r: sr.x1, b: sr.y1 };
    const circles = [];
    if (angleOverlay.on) {
      tmp.copy(quizCenter).project(camera);
      circles.push({ x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, r: angleOverlay.ringPx || 0, w: 1.2 });
    }
    // the question, the answers and the HUD are never covered; the craft hardly; the radar if it must
    return 8 * overlap(p.x, p.y, bw, bh, comms.out, []) + overlap(p.x, p.y, bw, bh, [], circles) + 3 * overlap(p.x, p.y, bw, bh, [craft], [])
      + (p.above ? 0 : 40) + Math.abs(p.f - 0.5) * 60;
  };
  // choose a spot when the line starts, and look again now and then (switching only for a clearly
  // better one, so it doesn't jump about)
  comms.t -= dt;
  if (!comms.pick || comms.t <= 0) {
    comms.t = 0.5;
    comms.out = [];
    for (const id of KEEP_OUT) {
      const el = $(id);
      const r = el && el.getBoundingClientRect();
      if (r && r.width && getComputedStyle(el).opacity > 0.05) comms.out.push({ l: r.left - 8, t: r.top - 8, r: r.right + 8, b: r.bottom + 8 });
    }
    if (quiz.active) {
      // the joystick and FIRE stay clear too
      for (const el of [$('stick'), document.querySelector('#controls .act.fire')]) {
        const r = el.getBoundingClientRect();
        if (r.width) comms.out.push({ l: r.left - 8, t: r.top - 8, r: r.right + 8, b: r.bottom + 8 });
      }
    }
    let best = null, bestCost = Infinity;
    for (const above of [true, false]) for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const p = spot(above, f), c = cost(p);
      if (c < bestCost) { bestCost = c; best = p; }
    }
    const now = comms.pick ? cost(spot(comms.pick.above, comms.pick.f)) : Infinity;
    if (!comms.pick || bestCost < now * 0.7) comms.pick = best;
  }
  const p = spot(comms.pick.above, comms.pick.f);
  const x = p.x.toFixed(0), y = p.y.toFixed(0), tx = clamp(cx - p.x, 24, bw - 24).toFixed(0), tail = p.above ? 'down' : 'up';
  const key = `${x},${y},${tx},${tail}`;
  if (key === comms.drawn) return;
  comms.drawn = key;
  dlgEl.dataset.tail = tail;
  dlgEl.style.left = `${x}px`;
  dlgEl.style.top = `${y}px`;
  dlgEl.style.setProperty('--tail-x', `${tx}px`);
}

// enemy banter: a raider taunts once it has flown in, the Warden boasts after its introduction
function updateBanter() {
  // wait until the camera is back on the battle (not mid-way back from a close-up), so the craft
  // that talks is in view and its bubble sits on it
  if (director.active || director.camera || state.doom > 0) return;
  if (rig.mode !== campaign.cfg.view || rig.t < 1) return;
  for (const r of raiders.list) {
    if (!r.alive || !r.hold || r.taunted || !raiders.arrived(r)) continue;
    r.taunted = true;
    const lines = [at(enemyLine(r.callsign, 'raiderArrive', 1.3, null, r.kind), r.model, r.position)];
    if (Math.random() < 0.35) lines.push(at(crewLine('crewReply', 1.2), ship.model, ship.position));   // the co-pilot answers from your ship
    for (const l of lines) l.intro = true;     // the question waits for the opening banter
    dialogue.play(lines);
  }
  if (boss.active && !boss.dying && state.wardenTalk === false) {
    state.wardenTalk = true;
    dialogue.play(wardenIntro().map((l) => ({ ...at(l, boss.model, boss.corePos), intro: true })));
  }
}

// in-world enemy markers: health rings under each enemy
function updateHolo(t, show) {
  rings.begin(t);
  if (show) {
    for (const r of raiders.list) {
      if (!r.alive) continue;
      rings.add(tmp.copy(r.position).setY(r.position.y - 1.2), r.hold ? 5.2 : 7.5, r.hp / r.maxHp, 0);
    }
    for (const w of boss.weakPoints()) {
      const core = w.obj.kind === 'core';
      rings.add(w.pos, core ? 7.5 : 6.4, core ? boss.coreHp / CORE_HP : boss.turrets[w.obj.index].hp / TURRET_HP, core ? 2 : 1);
    }
  }
  rings.end();
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
    if (mode === 'launch') { if (intro.white > 0.001) setWhiteout('white', intro.white); else setWhiteout('black', intro.fade); }
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
    const auto = (campaign.phase === 'journey' && portal.state === 'in' && ship.position.z - portal.group.position.z < 300) || state.tunnel > 0;
    const sx = auto ? clamp((LANE.x - ship.position.x) / 10, -1, 1) : cfg.steer ? input.dirX : 0;
    const sy = auto ? clamp((LANE.y - ship.position.y) / 6, -1, 1) : cfg.steer ? input.dirY : 0;
    ship.rail(dt, state.tunnel > 0 ? 320 : cfg.speed, sx, sy, LANE, BOUNDS);   // the portal's tunnel rushes
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
    else if (focusShot(dt)) { /* a craft is talking: close on it */ }
    else rig.setMode(campaign.cfg.view, 1.15);            // ...and back out
  }
  rig.update(dt, ship, t);
  if (intro.active) intro.applyCamera(camera, t);
  if (mode === 'title') fitTitle();
  wormTube.update(t);
  portalTube.update(t);
  // no hex shield bubble during a ride; put it back afterwards only if the ride hid it
  if (riding() && shield.mesh.visible) { shield.mesh.visible = false; state.rideHidShield = true; }
  else if (!riding() && state.rideHidShield) { state.rideHidShield = false; if (state.mode !== 'dying') shield.mesh.visible = true; }
  controls.setMode((play ? campaign.cfg.view === 'top' : rig.mode === 'top') ? 'top' : 'chase');
  // defeat: after the blast, a drone shot pushes in on the enemy while the comms play
  if (mode === 'dying') {
    if (!state.deathTalk && state.modeT > 1.0) { state.deathTalk = true; dialogue.play(defeatLines(), () => { if (state.mode === 'dying') gameOver(); }); }
    if (!state.killer && !dialogue.active && state.deathTalk && state.modeT > 2.6) gameOver();
  }
  if (play) updateBanter();
  if (mode !== 'paused') dialogue.update(dt);
  // a line spoken by a craft in a battle ends with the battle: once the next journey starts its
  // craft is gone, and the bubble must not drift over the controls with the wrong face on it
  if (dialogue.line && dialogue.line.src && mode === 'play' && !battlePhase()) dialogue.clear();
  if (play && state.reportOpen) {
    const before = state.reportT;
    state.reportT += dt;
    $('r-stars').querySelectorAll('i').forEach((el, i) => {
      const at = 0.35 + i * 0.32;
      if (i < state.reportStars && before < at && state.reportT >= at) { el.className = 'on'; audio.star(i); }
    });
    if (state.reportT > REPORT_TIME) closeReport();
  }
  placeComms(dt);
  // comms sit in the battle layout (console column / top strip) during battles; a line that is
  // still playing keeps its place until it ends
  const battleUI = play && battlePhase();
  if (battleUI || !dialogue.active) document.body.classList.toggle('battle', battleUI);
  if (play && state.doom > 0 && (state.doom -= dt) <= 0) { state.doom = 0; die(); }

  // ---- campaign + aiming + firing
  if (play) {
    if (state.tunnel > 0) {
      // the light at the end of the portal's tunnel swells to white, then the level begins
      const e = clamp((PORTAL_RIDE - state.tunnel - (PORTAL_RIDE - 0.55)) / 0.55, 0, 1);
      portalTube.exit = e;
      setWhiteout('white', e * e * e);
      if ((state.tunnel -= dt) <= 0) { state.tunnel = 0; endPortalRide(); }
    }
    else campaign.update(dt, campaignCtx);
    if (campaign.phase === 'cleared' && !seen.has('meteors')) {
      introduce('meteors', [
        { text: 'Meteor field! LOCK aims for you. SHIELD blocks hits.', focus: ['#controls .act.lock', '#controls .act.shield'], time: 4.5 },
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

  // ---- simulation
  const holdFire = director.active || dialogue.active || quiz.busy;   // talk and answering: the clock waits, so do they
  raiderCtx.shipAlive = play && !holdFire;
  raiderCtx.arena = campaign.phase === 'battle' || campaign.phase === 'contact' || campaign.phase === 'boss';
  if (play || mode === 'dying') raiders.update(dt, t, raiderCtx);
  bossCtx.shipAlive = play && !holdFire;
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
  rings.mesh.visible = !director.camera && !focusing();   // lock-on brackets would float oddly in a low close-up
  // a focus shot is about the craft: the radar and the question fade out until the battle view is back
  const focusNow = !!focusing();
  angleOverlay.muted = focusNow;
  document.body.classList.toggle('focusing', focusNow);
  if (play) updateQuiz(dt, t);
  else angleOverlay.update(dt, t, quizCenter, camera);
  if (portal.state === 'in' && mode === 'play') portalTube.alpha = 0.85 * clamp(1 - (ship.position.z - portal.group.position.z - 30) / 240, 0, 1);
  if (portal.update(dt, t, ship.position) && state.mode === 'play') crossPortal();   // live mode: it may have died this frame

  if (vitals.update(dt) && play) { shield.pulse(); audio.shieldUp(); }
  if (abilities.shield.t > 0) shield.pulse();
  if (mode === 'launch' && !riding()) shield.mesh.visible = ship.redshift < 0.02;
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
  // the streaks read as rain in the overhead view, and must not draw over the black hole's shadow
  dust.object.visible = rig.mode !== 'top' && !(play && battlePhase()) && !(mode === 'launch' && (intro.stage === 'plunge' || intro.stage === 'follow' || intro.stage === 'tunnel')) && !riding();
  dust.update(camera, _dustVel.copy(ship.velocity).clampLength(0, 650));   // capped: at warp speed they became screen-wide lines
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
  bloom.strength = BLOOM_STRENGTH * (blackhole.object.visible ? 0.3 + 0.45 * near : 1) * (1 - 0.6 * (state.battleDim || 0)) * (titleView ? 0.75 : 1) * (riding() ? 0.4 : 1);   // keep the tunnel's colours crisp
  field.material.color.setScalar(titleView || mode === 'launch' ? 0.55 : 1);   // rocks by the station sit in shadow
  sun.update(dt, camera, ship.position, SUN_OCCLUDERS);

  state.damage = damp(state.damage, 0, 2.5, dt);
  const lowHull = play && vitals.hullFrac < 0.3 ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
  const hurry = play && quiz.state === 'ask' && quiz.limit && quiz.timeLeft < 3 && !director.active
    ? (0.3 + 0.25 * Math.sin(t * 10)) * (1 - quiz.timeLeft / 3) : 0;
  // after a portal or the black hole: a lens warp (colour split) that settles in a moment
  state.warp = Math.max(0, (state.warp || 0) - dt * 2.2);
  if (mode !== 'title' && mode !== 'launch') lens.uniforms.uAberration.value = 0.0018 + 0.02 * state.warp * state.warp;
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
portal.group.visible = true;   // compile the portal and wormhole shaders up front
portalTube.mesh.visible = wormTube.mesh.visible = true;
try { await renderer.compileAsync(scene, camera); } catch { /* optional */ }
portal.group.visible = false;
portalTube.mesh.visible = wormTube.mesh.visible = false;
renderer.setAnimationLoop(frame);
await uiReady;                        // every image and font the UI uses is in (see uiReady)
$('start').disabled = false;
$('start').classList.remove('failed');
$('load-msg').textContent = '';

// handy for tuning from the devtools console
window.game = {
  THREE, scene, camera, renderer, ship, turret, rig, field, fx, raiders, boss, vitals, intro, campaign, state, input, audio, hud, abilities,
  portal, rings, director, blackhole, planets, quiz, angleOverlay, launch, setMode,
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
