import * as THREE from 'three';

const _p = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const POOL = 10;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Deliberately minimal: level + objective + two health bars (top-left), the journey bar
// toward the black hole (top-centre), score + pause (top-right), a crosshair at the aim
// point, small health bars over enemies, edge arrows for off-screen ones, and banners.
export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      levelNum: $('level-num'), levelName: $('level-name'), objective: $('objective'),
      shield: $('shield-bar'), hull: $('hull-bar'), score: $('score'),
      fill: $('route-fill'), routeShip: $('route-ship'),
      banner: $('banner'), alert: $('alert'), crosshair: $('crosshair'), hit: $('hitmarker'), marker: $('turret-marker'),
    };
    const markers = $('markers');
    const make = (cls, html = '') => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      d.style.display = 'none';
      markers.appendChild(d);
      return d;
    };
    this.bars = Array.from({ length: POOL }, () => {
      const el = make('enemy-hp', '<em></em>');
      return { el, fill: el.firstChild };
    });
    this.arrows = Array.from({ length: POOL }, () => make('offscreen'));
    this.weak = Array.from({ length: 5 }, () => {
      const el = make('enemy-hp weak', '<em></em>');
      return { el, fill: el.firstChild };
    });
    this.boss = { root: $('bossbar'), fill: $('boss-fill'), state: $('boss-state') };
    this.popups = Array.from({ length: 8 }, () => ({ el: make('popup'), pos: new THREE.Vector3(), t: 0 }));
    this.popCursor = 0;
    this.hitT = 0;
    this.bannerT = 0;
    this.alertT = 0;
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  banner(title, sub = '', dur = 2.6) {
    this.el.banner.querySelector('.title').textContent = title;
    this.el.banner.querySelector('.sub').textContent = sub;
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

  // ctx: { camera, campaign, vitals, score, crosshair (px), markerPoint, turret, raiders, locked }
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

    this.el.levelNum.textContent = `LEVEL ${campaign.level + 1}/${campaign.count}`;
    this.el.levelName.textContent = campaign.L.name;
    this.el.objective.textContent = campaign.objective(ctx.boss);

    // boss: integrity bar + small bars over each live weak point
    const b = ctx.boss;
    const showBoss = !!(b && b.active);
    this.boss.root.classList.toggle('hidden', !showBoss);
    let wi = 0;
    if (showBoss) {
      this.boss.fill.style.width = `${b.integrity * 100}%`;
      const exposed = b.phase === 'core';
      this.boss.state.textContent = b.dying ? 'Breaking up' : exposed ? 'Core exposed' : `Shielded · ${b.turretsLeft} turrets`;
      this.boss.state.classList.toggle('exposed', exposed);
      for (const w of b.weakPoints()) {
        if (wi >= this.weak.length || !toScreen(w.pos, s)) continue;
        const bar = this.weak[wi++];
        bar.el.style.display = 'block';
        bar.el.style.transform = `translate(${s.x}px, ${s.y - 26}px)`;
        bar.fill.style.width = `${(w.obj.kind === 'core' ? b.coreHp / ctx.coreHp : b.turrets[w.obj.index].hp / ctx.turretHp) * 100}%`;
      }
    }
    for (; wi < this.weak.length; wi++) this.weak[wi].el.style.display = 'none';
    this.el.shield.style.width = `${vitals.shieldFrac * 100}%`;
    this.el.hull.style.width = `${vitals.hullFrac * 100}%`;
    this.el.hull.classList.toggle('low', vitals.hullFrac < 0.3);
    this.el.score.textContent = fmt(ctx.score);
    const prog = campaign.progress * 100;
    this.el.fill.style.width = `${prog}%`;
    this.el.routeShip.style.left = `${prog}%`;

    this.el.crosshair.style.transform = `translate(${ctx.crosshair.x}px, ${ctx.crosshair.y}px)`;
    this.el.crosshair.classList.toggle('locked', !!ctx.locked);
    const mv = toScreen(ctx.markerPoint, s);
    this.el.marker.style.display = mv ? 'block' : 'none';
    if (mv) this.el.marker.style.transform = `translate(${s.x}px, ${s.y}px) rotate(45deg)`;
    this.el.marker.classList.toggle('on', ctx.turret.onTarget);

    // enemy health bars and off-screen arrows
    const camInv = _inv.copy(camera.quaternion).invert();
    const R = Math.min(W, H) * 0.4;
    let i = 0;
    for (const r of ctx.raiders.list) {
      if (!r.alive || i >= POOL) continue;
      const bar = this.bars[i], arrow = this.arrows[i];
      i++;
      _rel.copy(r.position);
      _rel.y += 6;
      if (toScreen(_rel, s)) {
        bar.el.style.display = 'block';
        bar.el.style.transform = `translate(${s.x}px, ${s.y - 14}px)`;
        bar.fill.style.width = `${(r.hp / r.maxHp) * 100}%`;
        arrow.style.display = 'none';
      } else {
        bar.el.style.display = 'none';
        _rel.copy(r.position).sub(camera.position).applyQuaternion(camInv);
        const ang = Math.atan2(_rel.x, _rel.y);
        arrow.style.display = 'block';
        arrow.style.transform = `translate(${W / 2 + Math.sin(ang) * R}px, ${H / 2 - Math.cos(ang) * R}px) rotate(${(ang * 180) / Math.PI}deg)`;
      }
    }
    for (; i < POOL; i++) { this.bars[i].el.style.display = 'none'; this.arrows[i].style.display = 'none'; }

    this.hitT = Math.max(0, this.hitT - dt);
    this.el.hit.style.opacity = Math.min(1, this.hitT * 6);
    this.el.hit.style.transform = `scale(${1 + this.hitT})`;
    for (const p of this.popups) {
      if (p.t <= 0) { p.el.style.display = 'none'; continue; }
      p.t -= dt;
      if (!toScreen(p.pos, s)) { p.el.style.display = 'none'; continue; }
      p.el.style.display = 'block';
      p.el.style.opacity = Math.min(1, p.t * 2);
      p.el.style.transform = `translate(${s.x}px, ${s.y - (1.1 - p.t) * 44}px)`;
    }
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.alertT > 0 && (this.alertT -= dt) <= 0) this.el.alert.classList.remove('show');
  }
}
