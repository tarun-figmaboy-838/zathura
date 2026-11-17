// On-screen, game-style controls while cruising: left/right steering on the left and action
// buttons on the right (FIRE with a heat ring, LOCK-ON and SHIELD with cooldown sweeps). Works
// with mouse and multi-touch; keys light them up too.
export class Controls {
  constructor(input) {
    this.input = input;
    this.root = document.getElementById('controls');
    this.btn = {};
    this.root.querySelectorAll('[data-hold]').forEach((el) => {
      const act = el.dataset.hold;
      this.btn[act] = el;
      const set = (v) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.virtual[act] = v;
        if (v) el.setPointerCapture?.(e.pointerId);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('lostpointercapture', () => { input.virtual[act] = false; });
    });
    this.root.querySelectorAll('[data-tap]').forEach((el) => {
      const act = el.dataset.tap;
      this.btn[act] = el;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.tap(act);
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 140);
      });
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  // make a button pulse to suggest using it right now
  urge(name, seconds) {
    const el = this.btn[name];
    el.classList.add('urge');
    clearTimeout(el._urge);
    el._urge = setTimeout(() => el.classList.remove('urge'), seconds * 1000);
  }

  // 'chase': steer left/right, fire, lock, shield. 'top' (angle battles): hidden, the answer
  // options take over (see game/quiz.js)
  setMode(mode) {
    if (this.root.dataset.mode === mode) return;
    this.root.dataset.mode = mode;
  }

  update({ heat, overheated, lock, shield }) {
    const i = this.input;
    const held = { left: i.dirX < 0, right: i.dirX > 0, up: i.dirY > 0, down: i.dirY < 0, fire: i.fire };
    for (const [k, v] of Object.entries(held)) this.btn[k]?.classList.toggle('pressed', v);
    const f = this.btn.fire;
    f.style.setProperty('--heat', heat.toFixed(3));
    f.classList.toggle('overheat', overheated);
    for (const [k, s] of [['lock', lock], ['shield', shield]]) {
      const el = this.btn[k];
      el.style.setProperty('--cd', s.cooldown.toFixed(3));
      el.classList.toggle('ready', s.ready);
      el.classList.toggle('active', s.active);
    }
  }
}
