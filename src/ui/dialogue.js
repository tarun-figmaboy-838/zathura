import { ENEMY_FACE, ENEMY_KINDS, WARDEN_ART } from '../enemies/look.js';

const $ = (id) => document.getElementById(id);

// Game-style comms dialogue: a speaker badge (enemy or crew), a name and a line that types out.
// Lines play one after another; a tap finishes the line being typed, or skips to the next.
//
// line: { who: 'enemy' | 'crew', name, text, hold (seconds after typing),
//         face: 'drone' | 'phage' | 'swarm' | 'raider' | 'warden' | 'crew' (the portrait), mood: 'taunt' | 'laugh' | 'panic' | 'cheer' }
// voice(who): called every few letters while typing (the comic "blah-blah" talk blips)
export class Dialogue {
  constructor() {
    this.root = $('dialog');
    this.nameEl = this.root.querySelector('.name');
    this.textEl = this.root.querySelector('.line');
    // typed part + invisible rest: the box is sized for the whole line from the first letter
    this.typedEl = document.createElement('span');
    this.restEl = document.createElement('span');
    this.restEl.className = 'rest';
    this.textEl.replaceChildren(this.typedEl, this.restEl);
    this.faceEl = this.root.querySelector('.portrait img');
    // portraits made with Figma AI; preloaded so a new speaker never pops in blank
    this.faces = Object.fromEntries([...ENEMY_KINDS, 'warden', 'crew'].map((f) => {
      const img = new Image();
      img.src = `assets/ui/face-${f === 'warden' ? WARDEN_ART : f}.webp`;
      return [f, img.src];
    }));
    this.queue = [];
    this.line = null;
    this.onDone = null;
    this.voice = null;
    this.onLine = null;      // (line | null): a line starts, or the talking stops (voice-over)
    this.busy = null;        // () => true while the line's voice is still speaking
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
      this.onLine?.(null);
      this.root.classList.remove('show');
      document.body.classList.remove('talking');
      const done = this.onDone;
      this.onDone = null;
      done?.();
      return;
    }
    this.chars = 0;
    this.hold = 0;
    const face = this.line.face || (this.line.who === 'crew' ? 'crew' : ENEMY_FACE);
    this.root.dataset.face = face;
    this.root.dataset.mood = this.line.mood || '';
    if (this.faceEl.src !== this.faces[face]) this.faceEl.src = this.faces[face];
    this.root.classList.add('typing');
    this.root.classList.remove('done');
    this.nameEl.textContent = this.line.name;
    this.typedEl.textContent = '';
    this.restEl.textContent = this.line.text;
    this.root.classList.remove('show');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    document.body.classList.add('talking');
    this.onLine?.(this.line);
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
    this.onLine?.(null);
    this.root.classList.remove('show', 'typing', 'done');
    document.body.classList.remove('talking');
  }

  update(dt) {
    const l = this.line;
    if (!l) return;
    if (this.chars < l.text.length) {
      const before = Math.floor(this.chars / 3);
      this.chars = Math.min(l.text.length, this.chars + dt * 30);   // readable typing speed
      if (Math.floor(this.chars / 3) > before && l.text[Math.floor(this.chars) - 1] !== ' ') this.voice?.(l.who);
      const n = Math.floor(this.chars);
      this.typedEl.textContent = l.text.slice(0, n);
      this.restEl.textContent = l.text.slice(n);
      return;
    }
    if (this.restEl.textContent) { this.typedEl.textContent = l.text; this.restEl.textContent = ''; }
    if (this.root.classList.contains('typing')) { this.root.classList.remove('typing'); this.root.classList.add('done'); }
    this.hold += dt;
    if (this.hold >= Math.max(2, l.hold ?? 2.2) && !this.busy?.()) this.next();   // at least 2 s to read it, and the voice done
  }
}
