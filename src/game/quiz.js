import { wrapAngle } from '../core/math.js';

const DEG = Math.PI / 180;
const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const $ = (id) => document.getElementById(id);

// One angle question per target. The cannon rests on the reference line; the player taps the
// angle that turns it onto the target. Right: the ghost beam lands on the target, the cannon
// fires and it explodes. Wrong: the shot goes wide, the target fires back, the button turns red
// and the narration box shows the rule (then the working, after a second miss); try again.
//
// ctx: { audio, fire(correct), punish(target), solved(target) }
export class AngleQuiz {
  constructor(overlay, ctx) {
    this.overlay = overlay;
    this.ctx = ctx;
    this.root = $('quiz');
    this.box = $('quiz-prompt');
    this.textEl = $('quiz-text');
    this.buttons = [...this.root.querySelectorAll('.opt')];
    this.buttons.forEach((b, i) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.choose(i); });
      b.addEventListener('click', (e) => e.preventDefault());
    });
    this.state = 'off';
    this.aimYaw = 0;
  }

  get active() { return this.state !== 'off'; }
  get busy() { return this.state === 'aim' || this.state === 'fire'; }

  // target: { kind, obj, part, pos (live Vector3), radius }
  ask(target, q, index, total, geom) {
    this.target = target;
    this.q = q;
    this.state = 'ask';
    this.t = 0;
    this.tries = 0;
    this.aimYaw = q.rYaw;
    this.say(q.prompt, '');
    this.buttons.forEach((b, i) => {
      b.querySelector('span').textContent = `${q.options[i]}°`;
      b.disabled = false;
      b.className = 'opt';
      b.querySelector('img').src = 'assets/ui/opt.png';
      b.style.animationDelay = `${0.25 + i * 0.06}s`;
    });
    this.root.classList.remove('hidden');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    document.body.classList.add('quiz-on');
    this.overlay.show(q, geom);
  }

  choose(i) {
    if (this.state !== 'ask' || this.t < 0.5) return;
    const b = this.buttons[i];
    if (!b || b.disabled) return;
    this.choice = i;
    this.value = this.q.options[i];
    this.correct = this.value === this.q.answer;
    this.state = 'aim';
    this.t = 0;
    b.classList.add('picked');
    this.overlay.aim(this.q.rYaw, this.q.s * this.value * DEG);
    this.ctx.audio.hit(false);
  }

  update(dt, turretYaw) {
    if (this.state === 'off') return;
    this.t += dt;
    const q = this.q;
    const b = this.buttons[this.choice];
    switch (this.state) {
      case 'ask':
        this.aimYaw = q.rYaw;
        break;
      case 'aim': {
        const k = Math.min(1, this.t / 0.75);
        this.overlay.aimProgress(ease(k));
        this.aimYaw = q.rYaw + q.s * this.value * DEG * ease(k);
        if (k >= 1 && (Math.abs(wrapAngle(turretYaw - this.aimYaw)) < 0.035 || this.t > 1.5)) {
          this.state = 'fire';
          this.t = 0;
          this.ctx.fire(this.correct);
        }
        break;
      }
      case 'fire':
        if (this.t < 0.4) break;
        this.state = 'result';
        this.t = 0;
        if (this.correct) {
          this.overlay.result(true);
          b.classList.add('correct');
          b.querySelector('img').src = 'assets/ui/opt-ok.png';
          // confirm in the narration box: "? = 55°" takes the place of "Find ?"
          this.say(`? = ${q.answer}°  ${q.prompt.split('  ').slice(1).join(' ')}`, 'ok');
          this.ctx.audio.correct();
          this.ctx.solved(this.target, this.tries === 0);
        } else {
          this.tries++;
          this.overlay.result(false);
          b.classList.add('wrong');
          b.disabled = true;
          b.querySelector('img').src = 'assets/ui/opt-bad.png';
          this.say(this.tries >= 2 && q.hint2 ? q.hint2 : q.hint, 'bad');
          this.ctx.audio.wrong();
          this.ctx.punish(this.target);
        }
        break;
      case 'result':
        if (this.correct) {
          if (this.t > 1.25) this.stop();
        } else if (this.t > 1.2) {
          this.overlay.clearAim();
          this.state = 'ask';
          this.t = 0.5;
        }
        break;
      default:
        break;
    }
  }

  // narration box: "Find ?" in the game font, then the rest; mood: '' | 'bad'
  say(text, mood) {
    const [head, ...rest] = text.split('  ');
    if (rest.length) {
      const find = document.createElement('b');
      find.className = 'find';
      find.textContent = head;
      this.textEl.replaceChildren(find, document.createTextNode(rest.join(' ')));
    } else this.textEl.textContent = text;
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
