import * as THREE from 'three';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const FIRE = ['Space', 'KeyJ'];
const TAPS = { Escape: 'pause', KeyP: 'pause', KeyM: 'mute' };

// One input state fed by the keyboard, the on-screen joystick and the FIRE button (a tap on the
// scene does nothing: the ship's target X aims for you). Directions and fire are held states;
// pause and mute are one-shot taps. Directions are -1..1: the keys give full steps, the joystick
// anything in between.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.virtual = { left: false, right: false, up: false, down: false, fire: false };
    this.stick = new THREE.Vector2();            // the on-screen joystick, x right / y up, length <= 1
    this.taps = new Set();
    this.active = false;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code) && TAPS[e.code]) this.taps.add(TAPS[e.code]);
      this.keys.add(e.code);
      if (this.active && [...LEFT, ...RIGHT, ...UP, ...DOWN, 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.stick.set(0, 0); Object.keys(this.virtual).forEach((k) => { this.virtual[k] = false; }); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  any(codes) { return codes.some((c) => this.keys.has(c)); }
  get keyX() { return (this.virtual.right || this.any(RIGHT) ? 1 : 0) - (this.virtual.left || this.any(LEFT) ? 1 : 0); }
  get keyY() { return (this.virtual.up || this.any(UP) ? 1 : 0) - (this.virtual.down || this.any(DOWN) ? 1 : 0); }
  get dirX() { return this.keyX || this.stick.x; }
  get dirY() { return this.keyY || this.stick.y; }
  get fire() { return this.active && (this.virtual.fire || this.any(FIRE)); }
  tap(name) { this.taps.add(name); }
  consume(name) { const had = this.taps.has(name); this.taps.delete(name); return had; }
}
