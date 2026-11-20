import { wrapAngle } from '../core/math.js';

const DEG = Math.PI / 180;
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const $ = (id) => document.getElementById(id);

// One angle question per target. The cannon rests on the reference line; the player turns it
// with the joystick, and the angle x it has turned is drawn and counted live on the radar. FIRE
// shoots: when x is the answer (within TOLERANCE) the beam is on the target and it explodes.
// Otherwise the shot goes wide, the target fires back and the question box shows the rule (then
// the working, after a second miss); turn again and fire again.
//
// ctx: { audio, fire(correct), punish(target), solved(target), timeout(target) }
// text with the angles in orange and x in italic serif, built from DOM nodes
function rich(text) {
  const frag = document.createDocumentFragment();
  for (const part of text.split(/(\d+°|\bx\b)/)) {
    if (!part) continue;
    if (/^\d+°$/.test(part)) { const s = document.createElement('span'); s.className = 'deg'; s.textContent = part; frag.append(s); }
    else if (part === 'x') { const s = document.createElement('i'); s.className = 'xv'; s.textContent = 'x'; frag.append(s); }
    else frag.append(part);
  }
  return frag;
}

// after a miss the clock has at least this many seconds left, so the hint can be used
const MISS_TIME = 10;
// how far off x may be and still count (degrees); the target is 8-10 degrees wide on the radar,
// so a counted shot is always visibly on it
const TOLERANCE = 2;

export class AngleQuiz {
  constructor(overlay, ctx) {
    this.overlay = overlay;
    this.ctx = ctx;
    this.root = $('quiz');
    this.box = $('quiz-prompt');
    this.textEl = $('quiz-text');
    this.limit = 0;
    this.timeLeft = 0;
    this.state = 'off';
    this.aimYaw = 0;
    this.turn = 0;            // how far the cannon has turned from its line (radians, + = counter-clockwise)
  }

  get active() { return this.state !== 'off'; }
  get busy() { return this.state === 'aim' || this.state === 'fire'; }
  get canSteer() { return this.state === 'ask' && this.t >= 0.5; }

  // x: the angle the cannon has turned from its line, measured towards the question's side, in
  // whole degrees (0-359): turning the other way counts the long way round
  get x() {
    const a = ((this.q.s * this.turn) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(a / DEG) % 360;
  }

  // target: { kind, obj, part, pos (live Vector3), radius }
  // limit: seconds to answer (0 = no limit); when it runs out the target attacks and it restarts
  ask(target, q, index, total, geom, limit = 0) {
    this.limit = limit;
    this.timeLeft = limit;
    this.target = target;
    this.q = q;
    this.state = 'ask';
    this.t = 0;
    this.tries = 0;
    this.turn = 0;
    this.aimYaw = q.rYaw;
    this.say(q.prompt, '');
    this.root.classList.remove('hidden');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    document.body.classList.add('quiz-on');
    this.overlay.show(q, geom);
    this.overlay.live(0, 0);
  }

  // the joystick turns the cannon (radians this frame, + = counter-clockwise)
  steer(delta) {
    if (!this.canSteer || !delta) return;
    const before = this.x;
    this.turn += delta;
    if (this.x !== before && this.x % 5 === 0) this.ctx.audio.dial();
  }

  // FIRE: the cannon shoots where it points; it counts when x is the answer
  shoot() {
    if (!this.canSteer) return;
    const off = Math.abs(((this.x - this.q.answer) % 360 + 540) % 360 - 180);
    this.correct = off <= TOLERANCE;
    if (this.correct) this.turn = this.q.s * this.q.answer * DEG;      // right on the target
    this.value = this.correct ? this.q.answer : this.x;
    this.state = 'aim';
    this.t = 0;
    this.ctx.audio.hit(false);
  }

  // hold: freeze the clock (while the game is explaining something)
  update(dt, turretYaw, hold = false) {
    if (this.state === 'off') return;
    this.t += dt;
    const q = this.q;
    this.aimYaw = q.rYaw + this.turn;
    if (this.state !== 'result' || !this.correct) this.overlay.live(this.q.s * this.x * DEG, this.x);
    switch (this.state) {
      case 'ask':
        if (this.limit && !hold) {
          const before = Math.ceil(this.timeLeft);
          this.timeLeft -= dt;
          const now = Math.ceil(this.timeLeft);
          if (now < before && now <= 3 && now > 0) this.ctx.audio.tick();
          if (this.timeLeft <= 0) {
            this.timeLeft = this.limit;
            this.flash('bad');
            this.ctx.timeout(this.target);
          }
        }
        break;
      case 'aim':
        // the cannon catches up with the beam, then fires
        if (Math.abs(wrapAngle(turretYaw - this.aimYaw)) < 0.035 || this.t > 1.2) {
          this.state = 'fire';
          this.t = 0;
          this.ctx.fire(this.correct);
        }
        break;
      case 'fire':
        if (this.t < 0.4) break;
        this.state = 'result';
        this.t = 0;
        if (this.correct) {
          this.overlay.result(true);
          // confirm in the narration box: "? = 55°" takes the place of "Find ?"
          this.say(q.explain ? `Correct!  ${q.explain}` : `x = ${q.answer}°`, 'ok');
          this.ctx.audio.correct();
          this.ctx.solved(this.target, this.tries === 0);
        } else {
          this.tries++;
          this.overlay.result(false);
          this.say(this.tries >= 2 && q.hint2 ? q.hint2 : q.hint, 'bad');
          if (this.limit) this.timeLeft = Math.max(this.timeLeft, MISS_TIME);   // time to read the hint and try again
          this.ctx.audio.wrong();
          this.ctx.punish(this.target);
        }
        break;
      case 'result':
        if (this.correct) {
          if (this.t > 2.9) this.stop();     // time to read the working (grade 7 pacing)
        } else if (this.t > 1.2) {
          this.overlay.clearResult();        // the cannon stays where it was: adjust and fire again
          this.state = 'ask';
          this.t = 0.5;
        }
        break;
      default:
        break;
    }
  }

  // the question box: "Find x" in the game font, then the rest; angles in orange (like their arcs
  // on the radar) and x in the radar's italic serif. mood: '' | 'ok' | 'bad'
  say(text, mood) {
    const [head, ...rest] = text.split('  ');
    if (rest.length) {
      const find = document.createElement('b');
      find.className = 'find';
      find.append(rich(head));
      this.textEl.replaceChildren(find, rich(rest.join(' ')));
    } else this.textEl.replaceChildren(rich(text));
    this.flash(mood);
  }

  flash(mood) {
    this.box.classList.remove('ok', 'bad');
    if (!mood) return;
    void this.box.offsetWidth;
    this.box.classList.add(mood);
  }

  stop() {
    this.state = 'off';
    this.target = null;
    this.root.classList.remove('show');
    this.root.classList.add('hidden');
    document.body.classList.remove('quiz-on');
    this.overlay.hide();
  }
}
