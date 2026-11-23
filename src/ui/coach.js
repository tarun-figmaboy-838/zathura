import * as THREE from 'three';

// The tutorial spotlight: while it shows, the game is frozen (see frame() in main.js), everything
// is dimmed except one or two holes around what is being explained (on-screen controls, or a thing
// in the 3D world such as a rock or a gate), so only that stays bright (no outline drawn round it;
// the control itself pulses gently, see .spot), and a short line sits beside it. It goes on by
// itself once the line has been read; a tap, Space or Enter skips ahead.
//
// show(step, onDone, seconds): step = { text, focus: [css selectors], world: [() => ({ pos, radius })] }

const PAD = 10;          // space between a control and its hole, px
const MIN_TIME = 600;    // ms before a tap counts (so a tap still in progress can't skip the line)
const _p = new THREE.Vector3();
const SVG = 'http://www.w3.org/2000/svg';

export class Coach {
  constructor() {
    const root = document.createElement('div');
    root.id = 'coach';
    root.className = 'coach';
    root.innerHTML = `
      <svg class="dim" aria-hidden="true"><defs><mask id="coach-mask" maskUnits="userSpaceOnUse">
        <rect class="full" fill="white" /><g class="holes"></g></mask></defs>
        <rect class="full shade" mask="url(#coach-mask)" /></svg>
      <div class="coach-card" role="status" aria-live="polite"><p class="text"></p></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.svg = root.querySelector('svg');
    this.holes = root.querySelector('.holes');
    this.card = root.querySelector('.coach-card');
    this.textEl = root.querySelector('.text');
    this.step = null;
    this.onDone = null;
    this.shownAt = 0;
    root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.advance(); });
    addEventListener('keydown', (e) => {
      if (this.step && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); this.advance(); }
    });
  }

  get active() { return !!this.step; }

  show(step, onDone, seconds = 3) {
    this.step = step;
    this.onDone = onDone;
    this.shownAt = performance.now();
    this.duration = seconds * 1000;
    this.textEl.textContent = step.text;
    const n = (step.focus || []).length + (step.world || []).length;
    this.holes.replaceChildren(...Array.from({ length: n }, () => document.createElementNS(SVG, 'rect')));
    this.root.classList.remove('show');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    document.body.classList.add('coaching');
  }

  advance() {
    if (!this.step || performance.now() - this.shownAt < MIN_TIME) return;
    const done = this.onDone;
    this.hide();
    done?.();
  }

  hide() {
    this.step = null;
    this.onDone = null;
    this.root.classList.remove('show');
    document.body.classList.remove('coaching');
  }

  // where the holes go this frame (controls can move with the layout; world things are projected)
  update(camera) {
    const s = this.step;
    if (!s) return;
    if (performance.now() - this.shownAt >= this.duration) { this.advance(); return; }   // read: go on
    const W = innerWidth, H = innerHeight;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.querySelectorAll('.full').forEach((r) => { r.setAttribute('width', W); r.setAttribute('height', H); });
    const boxes = [];
    for (const sel of s.focus || []) {
      const el = document.querySelector(sel);
      const r = el?.getBoundingClientRect();
      if (!r || !r.width) { boxes.push(null); continue; }
      const round = r.width / r.height > 0.7 && r.width / r.height < 1.4;     // round controls get a circle
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (round) { const rad = Math.max(r.width, r.height) / 2 + PAD; boxes.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2, round }); }
      else boxes.push({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2, round });
    }
    const focal = H / 2 / Math.tan((camera.fov * Math.PI) / 360);
    for (const f of s.world || []) {
      const o = f();
      _p.copy(o.pos).project(camera);
      if (_p.z > 1) { boxes.push(null); continue; }
      const cx = (_p.x * 0.5 + 0.5) * W, cy = (-_p.y * 0.5 + 0.5) * H;
      const rad = Math.max(34, (o.radius / Math.max(1, o.pos.distanceTo(camera.position))) * focal * 1.3) + PAD;
      boxes.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2, round: true });
    }
    const rects = this.holes.children;
    let u = null;
    boxes.forEach((b, i) => {
      const r = rects[i];
      if (!b) { r.setAttribute('width', 0); return; }
      const rr = b.round ? b.w / 2 : 18;
      Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h, rx: rr, ry: rr, fill: 'black' }).forEach(([k, v]) => r.setAttribute(k, v));
      u = u ? { x0: Math.min(u.x0, b.x), y0: Math.min(u.y0, b.y), x1: Math.max(u.x1, b.x + b.w), y1: Math.max(u.y1, b.y + b.h) }
        : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
    });
    // the line sits beside the holes: above them if they are low on the screen, else below
    const cw = this.card.offsetWidth, ch = this.card.offsetHeight, m = 14;
    let x = W / 2 - cw / 2, y = H * 0.3;
    if (u) {
      const below = (u.y0 + u.y1) / 2 < H * 0.5;
      x = (u.x0 + u.x1) / 2 - cw / 2;
      y = below ? u.y1 + 20 : u.y0 - 20 - ch;
      if (y < m || y + ch > H - m) y = Math.min(H - m - ch, Math.max(m, H * 0.3));
    }
    x = Math.min(W - m - cw, Math.max(m, x));
    this.card.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
