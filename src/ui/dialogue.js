const $ = (id) => document.getElementById(id);

// Game-style comms dialogue: a speaker badge (enemy or crew), a name and a line that types out.
// Lines play one after another; a tap finishes the line being typed, or skips to the next.
//
// line: { who: 'enemy' | 'crew', name, text, hold (seconds after typing) }
// voice(who): called every few letters while typing (the comic "blah-blah" talk blips)
export class Dialogue {
  constructor() {
    this.root = $('dialog');
    this.nameEl = this.root.querySelector('.name');
    this.textEl = this.root.querySelector('.line');
    this.queue = [];
    this.line = null;
    this.onDone = null;
    this.voice = null;
    this.root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.skip(); });
  }

  get active() { return !!this.line; }

  play(lines, onDone) {
    this.queue = [...lines];
    this.onDone = onDone;
    this.next();
  }

  // one quick line (battle banter): replaces whatever is being said
  say(line) { this.play([line]); }

  next() {
    this.line = this.queue.shift() || null;
    if (!this.line) {
      this.root.classList.remove('show');
      document.body.classList.remove('talking');
      const done = this.onDone;
      this.onDone = null;
      done?.();
      return;
    }
    this.chars = 0;
    this.hold = 0;
    this.root.dataset.who = this.line.who;
    this.nameEl.textContent = this.line.name;
    this.textEl.textContent = '';
    this.root.classList.remove('show');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    document.body.classList.add('talking');
  }

  skip() {
    if (!this.line) return;
    if (this.chars < this.line.text.length) this.chars = this.line.text.length;
    else this.next();
  }

  clear() {
    this.queue.length = 0;
    this.line = null;
    this.onDone = null;
    this.root.classList.remove('show');
    document.body.classList.remove('talking');
  }

  update(dt) {
    const l = this.line;
    if (!l) return;
    if (this.chars < l.text.length) {
      const before = Math.floor(this.chars / 3);
      this.chars = Math.min(l.text.length, this.chars + dt * 42);
      if (Math.floor(this.chars / 3) > before && l.text[Math.floor(this.chars) - 1] !== ' ') this.voice?.(l.who);
      this.textEl.textContent = l.text.slice(0, Math.floor(this.chars));
      return;
    }
    this.textEl.textContent = l.text;
    this.hold += dt;
    if (this.hold >= (l.hold ?? 1.6)) this.next();
  }
}
