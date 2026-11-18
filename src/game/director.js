import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

// Introduces things the first time they appear: one short line in the narration box at a time,
// optionally with a drone camera shot (the rig blends into it and back out again: zoom in,
// zoom out) and a glowing highlight on the UI being explained. Tap the box to skip ahead.
//
// step: { text, time, cam?(shot), focus?: [css selectors], onStart?() }
//   cam fills shot.pos / shot.target / shot.up / shot.fov every frame
export class Director {
  constructor(rig) {
    this.rig = rig;
    this.box = $('narrate');
    this.textEl = this.box.querySelector('.text');
    this.queue = [];
    this.step = null;
    this.t = 0;
    this.shot = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50 };
    this.fresh = true;
    this.box.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.next(); });
  }

  get active() { return !!this.step; }
  get camera() { return this.step && this.step.cam ? this.step.cam : null; }

  play(steps) {
    this.queue.push(...steps);
    if (!this.step) this.next();
  }

  next() {
    document.querySelectorAll('.spot').forEach((el) => el.classList.remove('spot'));
    this.step = this.queue.shift() || null;
    this.t = 0;
    this.fresh = true;
    const s = this.step;
    document.body.classList.toggle('narrating', !!(s && s.text));
    this.onText?.(s && s.text ? s : null);       // voice-over for the line (or silence)
    if (!s) { this.box.classList.remove('show'); return; }
    if (s.text) {
      this.textEl.textContent = s.text;
      this.box.classList.remove('show');
      void this.box.offsetWidth;
      this.box.classList.add('show');
    } else this.box.classList.remove('show');
    for (const sel of s.focus || []) document.querySelectorAll(sel).forEach((el) => el.classList.add('spot'));
    s.onStart?.();
  }

  clear() {
    this.queue.length = 0;
    if (this.step) { this.step = null; this.next(); }
  }

  update(dt) {
    const s = this.step;
    if (!s) return;
    this.t += dt;
    if (s.cam) {
      // the shot follows moving subjects smoothly; the rig handles blending in and out of it
      const r = this.rig;
      s.cam(this.shot);
      const k = this.fresh ? 1 : 1 - Math.exp(-6 * dt);
      r.dronePos.lerp(this.shot.pos, k);
      r.droneTarget.lerp(this.shot.target, k);
      r.droneUp.copy(this.shot.up);
      r.droneFov += (this.shot.fov - r.droneFov) * k;
      this.fresh = false;
    }
    if (this.t >= s.time) this.next();
  }
}
