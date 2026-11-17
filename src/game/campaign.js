import { rand } from '../core/math.js';

export const LEVELS = [
  { name: 'Drift Lanes', raiders: 3, maxAlive: 2, skill: 0, meteors: 6 },
  { name: 'Ion Reach', raiders: 4, maxAlive: 3, skill: 1, meteors: 8 },
  { name: 'Nebula Gate', raiders: 5, maxAlive: 3, skill: 2, meteors: 10 },
  { name: 'Shattered Belt', raiders: 6, maxAlive: 4, skill: 3, meteors: 12 },
  { name: 'Event Horizon', raiders: 0, maxAlive: 0, skill: 4, meteors: 14, boss: true },
];

// Phase timings / speeds. Each level: a short journey → raiders appear (top view) →
// targets cleared → meteor field (chase view) → level complete. After the last level: finale.
const PHASES = {
  journey: { view: 'chase', speed: 125, steer: true },
  contact: { view: 'top', speed: 16, steer: false },
  battle: { view: 'top', speed: 16, steer: false },
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
  }

  get L() { return LEVELS[this.level]; }
  get cfg() { return PHASES[this.phase]; }
  get count() { return LEVELS.length; }

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

  // ctx: { raiders, field, ship, announce(title, sub), spawnRaider(pos, lookAt, skill),
  //        spawnMeteor(pos, size, vel), levelComplete(level) }
  update(dt, ctx) {
    this.t += dt;
    const L = this.L;
    const ship = ctx.ship.position;
    switch (this.phase) {
      case 'journey':
        if (!this.announced) { this.announced = true; ctx.announce(`LEVEL ${this.level + 1}`, L.name); }
        if (this.t > 6.5) {
          this.enter('contact');
          if (L.boss) ctx.announce('WARNING', 'Warden carrier · destroy its 4 turrets');
          else ctx.announce('HOSTILES INBOUND', 'Aim the cannon at them and fire');
        }
        break;
      case 'contact':
        if (this.t > 1.4) {
          if (L.boss) { this.enter('boss'); ctx.spawnBoss(); } else this.enter('battle');
        }
        break;
      case 'boss':
        if (ctx.boss.defeated && ctx.raiders.count === 0 && this.t > 1) {
          this.enter('cleared');
          ctx.announce('WARDEN DESTROYED', 'The way to the black hole is open');
        }
        break;
      case 'battle': {
        this.spawnT -= dt;
        if (this.spawned < L.raiders && this.spawnT <= 0 && ctx.raiders.count < L.maxAlive) {
          const a = rand(0, Math.PI * 2);
          ctx.spawnRaider({ x: ship.x + Math.sin(a) * 95, y: ship.y, z: ship.z + Math.cos(a) * 70 }, ship, L.skill);
          this.spawned++;
          this.spawnT = rand(0.5, 1.1);
        }
        if (this.spawned >= L.raiders && ctx.raiders.count === 0) {
          this.enter('cleared');
          ctx.announce('TARGETS DESTROYED', 'Meteor field ahead');
        }
        break;
      }
      case 'cleared':
        if (this.t > 2.4) {
          this.enter('meteors');
          ctx.announce('METEOR FIELD', 'Shoot the meteoroids · steer to dodge');
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
          ctx.levelComplete(this.level);
        }
        break;
      case 'complete':
        if (this.t > 3.2) {
          if (this.level < LEVELS.length - 1) this.start(this.level + 1);
          else this.enter('finale');
        }
        break;
      default:
        break;
    }
  }

  objective(boss) {
    const L = this.L;
    switch (this.phase) {
      case 'journey': return 'Cruising toward the black hole';
      case 'contact':
      case 'battle': return `Raiders destroyed ${this.destroyed}/${L.raiders}`;
      case 'boss':
        if (!boss || boss.phase === 'turrets') return `Destroy the turrets ${4 - (boss ? boss.turretsLeft : 4)}/4`;
        return 'Shields down · destroy the core!';
      case 'cleared': return 'Targets destroyed';
      case 'meteors': return `Meteoroids ${this.destroyed}/${L.meteors}`;
      case 'complete': return 'Level complete';
      case 'finale': return 'Entering the event horizon';
      default: return '';
    }
  }

  // 0..1 along the whole 5-level route (for the journey bar)
  get progress() {
    const L = this.L;
    const p = {
      journey: Math.min(1, this.t / 6.5) * 0.25,
      contact: 0.25,
      battle: 0.25 + 0.35 * (this.destroyed / Math.max(1, L.raiders)),
      boss: 0.25 + 0.35 * (1 - (this.bossIntegrity ?? 1)),
      cleared: 0.6,
      meteors: 0.6 + 0.35 * Math.min(1, (this.destroyed + this.missed) / L.meteors),
      complete: 1,
      finale: 1,
      idle: 0,
    }[this.phase];
    return Math.min(1, (this.level + p) / LEVELS.length);
  }
}
