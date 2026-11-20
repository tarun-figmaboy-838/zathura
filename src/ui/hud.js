import * as THREE from 'three';

const _p = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const POOL = 10;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Deliberately minimal: score + pause (top-right), the boss bar, a crosshair, edge arrows for
// off-screen raiders and short banners. The sector name is on the gate the ship flies through,
// the ship's condition shows on the ship itself (shield flashes, smoke, red screen edges), and
// enemy health lives in the world as holographic rings (see world/holo.js).
export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      score: $('score'),
      banner: $('banner'), alert: $('alert'), crosshair: $('crosshair'), hit: $('hitmarker'), marker: $('turret-marker'),
      lockbox: $('lockbox'), lockburst: $('lockburst'),
    };
    const markers = $('markers');
    const make = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      d.style.display = 'none';
      markers.appendChild(d);
      return d;
    };
    this.arrows = Array.from({ length: POOL }, () => make('offscreen'));
    this.hazards = Array.from({ length: 6 }, () => make('hazard'));
    this.boss = { root: $('bossbar'), fill: $('boss-fill'), state: $('boss-state') };
    this.hitT = 0;
    this.bannerT = 0;
    this.alertT = 0;
    this.last = {};
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  banner(title, sub = '', dur = 2.2) {
    this.el.banner.querySelector('.title').textContent = title;
    const s = this.el.banner.querySelector('.sub');
    s.textContent = sub;
    s.style.display = sub ? '' : 'none';
    this.el.banner.classList.add('show');
    this.bannerT = dur;
  }

  alert(text, kind = 'danger', dur = 1.6) {
    this.el.alert.textContent = text;
    this.el.alert.className = `show ${kind}`;
    this.alertT = dur;
  }

  // the locked target was hit (the brackets flash) or broken (they fly apart)
  lockHit(obj) { if (obj === this.lockObj) this.lockHitT = 0.1; }
  lockKill(obj) {
    const b = this.el.lockburst, l = this.el.lockbox;
    if (obj !== this.lockObj || l.style.display !== 'block') return;
    b.style.width = l.style.width;
    b.style.height = l.style.height;
    b.style.transform = l.style.transform;
    b.style.setProperty('--c', getComputedStyle(l).getPropertyValue('--c'));
    b.classList.remove('go');
    void b.offsetWidth;
    b.classList.add('go');
    clearTimeout(this.burstT);
    this.burstT = setTimeout(() => b.classList.remove('go'), 450);
    l.style.display = 'none';
    this.lockObj = null;
  }

  hitMarker(kill) {
    this.hitT = kill ? 0.45 : 0.16;
    this.el.hit.classList.toggle('kill', !!kill);
  }

  // only touch the DOM when a text value actually changes
  text(key, el, value) {
    if (this.last[key] === value) return;
    const grew = key === 'score' && this.last[key] !== undefined && value !== '0';
    this.last[key] = value;
    el.textContent = value;
    if (grew) {                                 // points in: the coin pops
      const chip = el.parentElement;
      chip.classList.remove('pop');
      void chip.offsetWidth;
      chip.classList.add('pop');
    }
  }

  // ctx: { camera, score, crosshair (px), markerPoint, showMarker, hideAim, turret, raiders, locked, boss }
  update(dt, ctx) {
    const { camera } = ctx;
    const W = window.innerWidth, H = window.innerHeight;
    const toScreen = (v, out) => {
      _p.copy(v).project(camera);
      out.x = (_p.x * 0.5 + 0.5) * W;
      out.y = (-_p.y * 0.5 + 0.5) * H;
      return Math.abs(_p.x) < 1 && Math.abs(_p.y) < 1 && _p.z < 1;
    };
    const s = {};


    // boss integrity bar
    const b = ctx.boss;
    const showBoss = !!(b && b.active);
    this.boss.root.classList.toggle('hidden', !showBoss);
    if (showBoss) {
      this.boss.fill.style.width = `${b.integrity * 100}%`;
      const exposed = b.phase === 'core';
      this.text('bstate', this.boss.state, b.dying ? 'Breaking up' : exposed ? 'Core exposed' : `${b.turretsLeft} turrets`);
      this.boss.state.classList.toggle('exposed', exposed);
    }
    this.text('score', this.el.score, fmt(ctx.score));

    this.el.crosshair.style.display = ctx.hideAim ? 'none' : '';
    this.el.crosshair.style.transform = `translate(${ctx.crosshair.x}px, ${ctx.crosshair.y}px)`;
    this.el.crosshair.classList.toggle('locked', !!ctx.locked);
    const mv = ctx.showMarker && toScreen(ctx.markerPoint, s);
    this.el.marker.style.display = mv ? 'block' : 'none';
    if (mv) this.el.marker.style.transform = `translate(${s.x}px, ${s.y}px) rotate(45deg)`;
    this.el.marker.classList.toggle('on', ctx.turret.onTarget);

    // the lock brackets snap around whatever the target has set itself on (sized to it)
    const focal = H / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const lb = ctx.lockBox, lock = this.el.lockbox;
    const hazards = ctx.hazards || [];
    const danger = !!ctx.locked && hazards.includes(ctx.locked);
    this.el.crosshair.classList.toggle('danger', danger);
    if (lb && lb.pos && !ctx.hideAim && toScreen(lb.pos, s)) {
      // never smaller than the sight, so the brackets always frame it
      const px = Math.max(36, (lb.radius / Math.max(1, lb.pos.distanceTo(camera.position))) * focal * 1.25);
      if (this.lockObj !== ctx.locked) {             // a new target: replay the snap-in
        this.lockObj = ctx.locked;
        this.lockHp = '';
        lock.style.display = 'none';
        void lock.offsetWidth;
      }
      lock.style.display = 'block';
      lock.style.width = lock.style.height = `${Math.round(px * 2)}px`;
      lock.style.transform = `translate(${(s.x - px).toFixed(1)}px, ${(s.y - px).toFixed(1)}px)`;
      lock.classList.toggle('danger', danger);
      // tough targets show how many hits are left
      const o = ctx.locked, max = o && o.maxHp > 1 ? Math.min(8, o.maxHp) : 0;
      const hp = max ? `${Math.max(0, Math.min(max, Math.ceil((o.hp / o.maxHp) * max)))}/${max}` : '';
      if (hp !== this.lockHp) {
        this.lockHp = hp;
        const [n] = hp.split('/').map(Number);
        lock.querySelector('.hp').innerHTML = max ? Array.from({ length: max }, (_, i) => `<u${i < n ? '' : ' class="gone"'}></u>`).join('') : '';
      }
    } else {
      lock.style.display = 'none';
      this.lockObj = null;
    }
    this.lockHitT = Math.max(0, (this.lockHitT || 0) - dt);
    lock.classList.toggle('hit', this.lockHitT > 0);

    // red warning rings on the other rocks about to hit the ship, sized to the rock
    let k = 0;
    for (const r of hazards) {
      if (k >= this.hazards.length) break;
      if (r === ctx.locked || !toScreen(r.pos, s)) continue;
      const px = Math.max(18, (r.radius / Math.max(1, r.pos.distanceTo(camera.position))) * focal * 1.3);
      const el = this.hazards[k++];
      el.style.display = 'block';
      el.style.width = el.style.height = `${Math.round(px * 2)}px`;
      el.style.transform = `translate(${(s.x - px).toFixed(1)}px, ${(s.y - px).toFixed(1)}px)`;
    }
    for (; k < this.hazards.length; k++) this.hazards[k].style.display = 'none';

    // edge arrows for raiders that are off screen
    const camInv = _inv.copy(camera.quaternion).invert();
    const R = Math.min(W, H) * 0.42;
    let i = 0;
    for (const r of ctx.raiders.list) {
      if (!r.alive || i >= POOL) continue;
      if (toScreen(r.position, s)) continue;
      const arrow = this.arrows[i++];
      _rel.copy(r.position).sub(camera.position).applyQuaternion(camInv);
      const ang = Math.atan2(_rel.x, _rel.y);
      arrow.style.display = 'block';
      arrow.style.transform = `translate(${W / 2 + Math.sin(ang) * R}px, ${H / 2 - Math.cos(ang) * R}px) rotate(${(ang * 180) / Math.PI}deg)`;
    }
    for (; i < POOL; i++) this.arrows[i].style.display = 'none';

    this.hitT = Math.max(0, this.hitT - dt);
    this.el.hit.style.opacity = Math.min(1, this.hitT * 6);
    this.el.hit.style.transform = `scale(${1 + this.hitT})`;
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.alertT > 0 && (this.alertT -= dt) <= 0) this.el.alert.classList.remove('show');
  }
}
