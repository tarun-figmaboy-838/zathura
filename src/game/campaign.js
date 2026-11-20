import { rand } from '../core/math.js';

// The levels come from Angle Hunt (angle-game.vercel.app): eight hand-made levels, then four
// "mastery" levels built the same way. Every level is one target: a known angle, a rule and four
// answers (the right one plus Angle Hunt's traps: the known angle itself, 180°, 360° − answer,
// ±20°, double the known angle). Every wrong answer is at least MISS° from the right one: the raider
// is about 8–10° wide as seen from the cannon, so a wrong shot always visibly misses it.
//   linear    a linear pair: the two angles on a straight line add up to 180°   (? = 180 − known)
//   opposite  vertically opposite angles are equal                             (? = known)
const HUNT = [
  { known: 76, rule: 'linear', options: [76, 104, 124, 80] },
  { known: 68, rule: 'opposite', options: [68, 112, 136, 180] },
  { known: 118, rule: 'linear', options: [62, 118, 180, 242] },
  { known: 43, rule: 'linear', options: [43, 137, 180, 223] },
  { known: 113, rule: 'opposite', options: [67, 113, 180, 226] },
  { known: 152, rule: 'linear', options: [28, 152, 180, 332] },
  { known: 47, rule: 'opposite', options: [47, 94, 133, 180] },
  { known: 101, rule: 'linear', options: [79, 101, 180, 281] },
];
export const RULE_NAMES = { linear: 'Linear pair', opposite: 'Opposite angles' };
const MISS = 16;   // degrees: the smallest gap between a wrong answer and the right one

function shuffle(list, r) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Angle Hunt's mastery generator: a random rule, a known angle of 25–155° (never right at 90°)
// and the same kinds of trap answers
export function masteryLevel(r = Math.random) {
  const rule = r() < 0.5 ? 'linear' : 'opposite';
  let known = 25 + Math.floor(r() * 131);
  if (Math.abs(known - 90) < 3) known += 7;
  const ans = rule === 'linear' ? 180 - known : known;
  const traps = [known, 180 - known, 180, 360 - ans, ans + 20, ans - 20, known * 2]
    .filter((p) => p > 0 && p < 360 && Math.abs(p - ans) >= MISS);
  const set = [ans];
  for (const p of shuffle(traps, r)) {
    if (set.length >= 4) break;
    if (set.every((f) => Math.abs(f - p) >= 4)) set.push(p);
  }
  for (let h = ans + 20; set.length < 4; h += 17) if (h < 360 && set.every((p) => Math.abs(p - h) >= 4) && Math.abs(h - ans) >= MISS) set.push(h);
  return { known, rule, options: shuffle(set, r) };
}

// the answer of a level: the angle the cannon must turn from its line onto the target
export const answerOf = (lv) => (lv.rule === 'linear' ? 180 - lv.known : lv.known);

// The run: 12 levels in three sectors of four, then the Warden. A short journey through the
// asteroid belt and a portal comes before every level; each sector ends with a meteor field and
// a short look at the stars earned.
function buildLevels() {
  const levels = [];
  const add = (q, i, group) => levels.push({
    ...q,
    label: group < 2 ? `L${i + 1}` : `M${i - 7}`,
    title: group < 2 ? `LEVEL ${i + 1}` : `MASTERY ${i - 7}`,
    name: RULE_NAMES[q.rule],
    group,
    groupEnd: i % 4 === 3,
    skill: group,
    meteors: [8, 10, 12][group],
    journey: i === 0 ? 15 : 12,
  });
  HUNT.forEach((q, i) => add(q, i, Math.floor(i / 4)));
  for (let i = 8; i < 12; i++) add(masteryLevel(), i, 2);
  levels.push({ label: 'BOSS', title: 'FINAL', name: 'The Warden', boss: true, group: 3, groupEnd: true, skill: 4, meteors: 0, journey: 10 });
  return levels;
}

// Phase timings / speeds
const PHASES = {
  journey: { view: 'chase', speed: 125, steer: true },    // fly it: steer, shoot rocks and junk, reach the portal
  contact: { view: 'top', speed: 16, steer: false },
  battle: { view: 'top', speed: 16, steer: false },
  won: { view: 'top', speed: 16, steer: false },          // a beat after the hit, then the next journey
  boss: { view: 'top', speed: 12, steer: false },
  cleared: { view: 'chase', speed: 80, steer: true },
  meteors: { view: 'chase', speed: 85, steer: true },
  complete: { view: 'chase', speed: 130, steer: true },
  finale: { view: 'finale', speed: 0, steer: false },
  idle: { view: 'chase', speed: 0, steer: false },
};

export class Campaign {
  constructor() {
    this.level = 0;
    this.phase = 'idle';
    this.t = 0;
    this.newRun();
  }

  // fresh mastery levels for every run
  newRun() { this.levels = buildLevels(); }

  get L() { return this.levels[this.level]; }
  get cfg() { return PHASES[this.phase]; }
  get count() { return 4; }                               // sectors: L1–L4, L5–L8, M1–M4, the Warden
  get total() { return this.levels.length - 1; }          // angle levels (12)
  get journeyTime() { return this.L.journey ?? 7; }
  get firstOfGroup() { return this.level === 0 || this.levels[this.level - 1].group !== this.L.group; }

  start(level) {
    this.level = level;
    this.enter('journey');
  }

  enter(phase) {
    this.phase = phase;
    this.t = 0;
    this.spawned = 0;
    this.spawnT = 0.8;
    this.destroyed = 0;
    this.missed = 0;
    this.announced = false;
  }

  // ctx: { raiders, field, ship, boss, sector(level), announce(title, sub), spawnBoss(),
  //        spawnRaider(skill), spawnMeteor(pos, size, vel), levelComplete(group), portalPassed(), reportOpen() }
  update(dt, ctx) {
    this.t += dt;
    const L = this.L;
    const ship = ctx.ship.position;
    switch (this.phase) {
      case 'journey':
        if (!this.announced) { this.announced = true; ctx.sector(this.level); }
        // the level starts once the ship has flown through the portal
        if ((ctx.portalPassed && ctx.portalPassed()) || this.t > this.journeyTime + 3) this.enter('contact');
        break;
      case 'contact':
        if (this.t > 1.4) {
          if (L.boss) { this.enter('boss'); ctx.spawnBoss(); } else this.enter('battle');
        }
        break;
      case 'boss':
        if (ctx.boss.defeated && ctx.raiders.count === 0 && this.t > 1) {
          this.enter('cleared');
          ctx.announce('WARDEN DOWN', '');
        }
        break;
      case 'battle':
        // one target per level: it is the question
        if (ctx.raiders.count > 0) break;
        if (this.spawned < 1) {
          this.spawnT -= dt;
          if (this.spawnT <= 0) { ctx.spawnRaider(L.skill); this.spawned++; }
        } else this.enter('won');
        break;
      case 'won':
        // a beat to read the worked answer, then the next journey (or the sector's meteor field)
        if (this.t > 3.1) {
          if (L.groupEnd) {
            this.enter('cleared');
            ctx.announce('CLEAR', '');
          } else this.start(this.level + 1);
        }
        break;
      case 'cleared':
        if (this.t > 2.4) {
          if (L.meteors) {
            this.enter('meteors');
            ctx.announce('METEOR FIELD', '');
          } else {
            this.enter('complete');
            ctx.levelComplete(L.group);
          }
        }
        break;
      case 'meteors':
        this.spawnT -= dt;
        if (this.spawned < L.meteors && this.spawnT <= 0) {
          const size = rand(3.2, 6.5 + L.skill * 0.6);
          ctx.spawnMeteor({ x: rand(-26, 26), y: rand(2, 15), z: ship.z - rand(560, 700) }, size,
            { x: rand(-3, 3), y: rand(-1.5, 1.5), z: rand(8, 22) });
          this.spawned++;
          this.spawnT = rand(0.65, 1.15) - L.skill * 0.06;
        }
        if (this.spawned >= L.meteors && ctx.field.liveCount === 0 && this.t > 2) {
          this.enter('complete');
          ctx.levelComplete(L.group);
        }
        break;
      case 'complete':
        // wait for the stars moment to finish (it closes by itself)
        if (this.t > 1.2 && !(ctx.reportOpen && ctx.reportOpen())) {
          if (this.level < this.levels.length - 1) this.start(this.level + 1);
          else this.enter('finale');
        }
        break;
      default:
        break;
    }
  }

}
