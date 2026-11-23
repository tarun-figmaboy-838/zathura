import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

// Introduces things the first time they appear: one short line in the narration box at a time,
// optionally with a drone camera shot (the rig blends into it and back out again: zoom in,
// zoom out) and a glowing highlight on the UI being explained. Tap the box to skip ahead.
//
// step: { text, time, cam?(shot), focus?: [css selectors], world?: [() => ({ pos, radius })], onStart?() }
//   cam fills shot.pos / shot.target / shot.up / shot.fov every frame
//   A step that points at something (focus or world) and has no camera shot is a tutorial spotlight
//   (this.coach, see ui/coach.js): the game freezes, everything else dims, and a tap goes on.
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
    this.coach = null;
    this.ready = null;         // (step) => true once a spotlight's targets are in view (the camera settled)
    this.box.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.next(); });
  }

  get active() { return !!this.step; }
  get spotlight() { return !!this.coach?.active; }
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
    const spot = !!(s && s.text && (s.focus || s.world) && !s.cam && this.coach);
    document.body.classList.toggle('narrating', !!(s && s.text));
    if (!spot) this.onText?.(s && s.text ? s : null);   // voice-over for the line (or silence); a spotlight speaks when it shows
    if (!s) { this.box.classList.remove('show'); return; }
    if (spot) {
      // a spotlight: it waits (the game still running) until what it is about is in view and the
      // camera has settled, then the game freezes and the line waits for a tap (see update)
      this.box.classList.remove('show');
      s.pending = true;
      return;
    }
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
    if (this.coach?.active) this.coach.hide();
    if (this.step) { this.step = null; this.next(); }
  }

  update(dt) {
    const s = this.step;
    if (!s || this.spotlight) return;                // a spotlight waits for its tap
    this.t += dt;
    if (s.pending) {
      if (this.t < 2.5 && this.ready && !this.ready(s)) return;
      s.pending = false;
      for (const sel of s.focus || []) document.querySelectorAll(sel).forEach((el) => el.classList.add('spot'));
      s.onStart?.();
      s.time = 0;
      this.onText?.(s);                              // the co-pilot reads it (sets s.time to the voice's length)
      this.coach.show(s, () => this.next(), Math.max(2.8, (s.time || 0) + 0.8));
      return;
    }
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
