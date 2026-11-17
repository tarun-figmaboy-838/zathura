import * as THREE from 'three';

const _p = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const POOL = 10;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Deliberately minimal: sector + objective + two health bars (top-left), the journey bar
// (top-centre), score + pause (top-right), a crosshair, edge arrows for off-screen raiders and
// short banners. Enemy health lives in the world as holographic rings (see world/holo.js).
export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      levelNum: $('level-num'), levelName: $('level-name'), objective: $('objective'),
      shield: $('shield-bar'), hull: $('hull-bar'), score: $('score'),
      banner: $('banner'), alert: $('alert'), crosshair: $('crosshair'), hit: $('hitmarker'), marker: $('turret-marker'),
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
    this.boss = { root: $('bossbar'), fill: $('boss-fill'), state: $('boss-state') };
    this.popups = Array.from({ length: 8 }, () => ({ el: make('popup'), pos: new THREE.Vector3(), t: 0 }));
    this.popCursor = 0;
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

  hitMarker(kill) {
    this.hitT = kill ? 0.45 : 0.16;
    this.el.hit.classList.toggle('kill', !!kill);
  }

  popup(pos, text) {
    const p = this.popups[this.popCursor];
    this.popCursor = (this.popCursor + 1) % this.popups.length;
    p.pos.copy(pos);
    p.t = 1.1;
    p.el.textContent = text;
  }

  // only touch the DOM when a text value actually changes
  text(key, el, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  // ctx: { camera, campaign, vitals, score, crosshair (px), markerPoint, showMarker, turret, raiders, locked, boss }
  update(dt, ctx) {
    const { camera, campaign, vitals } = ctx;
    const W = window.innerWidth, H = window.innerHeight;
    const toScreen = (v, out) => {
      _p.copy(v).project(camera);
      out.x = (_p.x * 0.5 + 0.5) * W;
      out.y = (-_p.y * 0.5 + 0.5) * H;
      return Math.abs(_p.x) < 1 && Math.abs(_p.y) < 1 && _p.z < 1;
    };
    const s = {};

    this.text('num', this.el.levelNum, `SECTOR ${campaign.level + 1}/${campaign.count}`);
    this.text('name', this.el.levelName, campaign.L.name);
    const obj = campaign.objective(ctx.boss);
    this.text('obj', this.el.objective, obj);
    this.el.objective.style.display = obj ? '' : 'none';

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
    this.el.shield.style.width = `${vitals.shieldFrac * 100}%`;
    this.el.hull.style.width = `${vitals.hullFrac * 100}%`;
    this.el.hull.classList.toggle('low', vitals.hullFrac < 0.3);
    this.text('score', this.el.score, fmt(ctx.score));

    this.el.crosshair.style.display = ctx.hideAim ? 'none' : '';
    this.el.crosshair.style.transform = `translate(${ctx.crosshair.x}px, ${ctx.crosshair.y}px)`;
    this.el.crosshair.classList.toggle('locked', !!ctx.locked);
    const mv = ctx.showMarker && toScreen(ctx.markerPoint, s);
    this.el.marker.style.display = mv ? 'block' : 'none';
    if (mv) this.el.marker.style.transform = `translate(${s.x}px, ${s.y}px) rotate(45deg)`;
    this.el.marker.classList.toggle('on', ctx.turret.onTarget);

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
    for (const p of this.popups) {
      if (p.t <= 0) { p.el.style.display = 'none'; continue; }
      p.t -= dt;
      if (!toScreen(p.pos, s)) { p.el.style.display = 'none'; continue; }
      p.el.style.display = 'block';
      p.el.style.opacity = Math.min(1, p.t * 2);
      // start above the hit point so the number never sits on the explosion or a result badge
      p.el.style.transform = `translate(${s.x}px, ${s.y - 48 - (1.1 - p.t) * 40}px)`;
    }
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.alertT > 0 && (this.alertT -= dt) <= 0) this.el.alert.classList.remove('show');
  }
}
