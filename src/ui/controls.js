// On-screen, game-style controls for the journeys: a joystick on the left flies the ship and FIRE
// (with a heat ring) on the right shoots at the target X. Nothing else. In the angle battles they
// hide and the answer options take over. Works with mouse and multi-touch; keys move the knob and
// light FIRE too.
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
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    // the joystick: drag the knob anywhere in its ring; it springs back when let go
    this.stick = document.getElementById('stick');
    this.knob = this.stick.querySelector('.stick-knob');
    this.stickId = null;
    const move = (e) => {
      const r = this.stick.getBoundingClientRect();
      const reach = r.width * 0.36;                          // knob travel, px
      let x = (e.clientX - (r.left + r.width / 2)) / reach;
      let y = -(e.clientY - (r.top + r.height / 2)) / reach;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      input.stick.set(x, y);
    };
    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.stickId = e.pointerId;
      this.stick.setPointerCapture?.(e.pointerId);
      this.stick.classList.add('held');
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    const release = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      input.stick.set(0, 0);
      this.stick.classList.remove('held');
    };
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);
    this.stick.addEventListener('lostpointercapture', release);
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  // 'chase': the joystick and FIRE. 'top' (angle battles): hidden, the answer options take over
  // (see game/quiz.js)
  setMode(mode) {
    if (this.root.dataset.mode === mode) return;
    this.root.dataset.mode = mode;
  }

  update({ heat, overheated }) {
    const i = this.input;
    this.btn.fire.classList.toggle('pressed', i.fire);
    // the knob shows the arrow keys too
    const x = i.dirX, y = i.dirY, l = Math.max(1, Math.hypot(x, y));
    const reach = this.stick.clientWidth * 0.36;               // same travel as a drag
    this.knob.style.translate = `${((x / l) * reach).toFixed(1)}px ${((-y / l) * reach).toFixed(1)}px`;
    this.stick.classList.toggle('on', x !== 0 || y !== 0);
    const f = this.btn.fire;
    f.style.setProperty('--heat', heat.toFixed(3));
    f.classList.toggle('overheat', overheated);
  }
}
