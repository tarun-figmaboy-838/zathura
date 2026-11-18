import * as THREE from 'three';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];
const FIRE = ['Space', 'KeyJ'];
const TAPS = { KeyE: 'lock', KeyK: 'lock', KeyQ: 'shield', KeyL: 'shield', Escape: 'pause', KeyP: 'pause', KeyM: 'mute' };

// One input state fed by keyboard, mouse/touch on the scene (aim + fire), and the on-screen
// buttons. Directions and fire are held states; abilities and pause are one-shot taps.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.virtual = { left: false, right: false, up: false, down: false, fire: false };
    this.pointer = new THREE.Vector2(0, 0.1);   // aim position in NDC
    this.pointerSeen = false;
    this.pointerT = 0;                           // last time the pointer moved (ms)
    this.pointerFire = false;
    this.taps = new Set();
    this.active = false;
    this.activePointer = null;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code) && TAPS[e.code]) this.taps.add(TAPS[e.code]);
      this.keys.add(e.code);
      if (this.active && [...LEFT, ...RIGHT, ...UP, ...DOWN, 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.pointerFire = false; Object.keys(this.virtual).forEach((k) => { this.virtual[k] = false; }); });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.setPointer(e);
      this.activePointer = e.pointerId;
      this.pointerFire = true;
      canvas.setPointerCapture?.(e.pointerId);
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.pointerId === this.activePointer) this.setPointer(e);
    });
    const release = (e) => {
      if (e.pointerId === this.activePointer || e.pointerType === 'mouse') { this.pointerFire = false; this.activePointer = null; }
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    this.pointerSeen = true;
    this.pointerT = performance.now();
  }

  any(codes) { return codes.some((c) => this.keys.has(c)); }
  get dirX() { return (this.virtual.right || this.any(RIGHT) ? 1 : 0) - (this.virtual.left || this.any(LEFT) ? 1 : 0); }
  get dirY() { return (this.virtual.up || this.any(UP) ? 1 : 0) - (this.virtual.down || this.any(DOWN) ? 1 : 0); }
  get fire() { return this.active && (this.pointerFire || this.virtual.fire || this.any(FIRE)); }
  tap(name) { this.taps.add(name); }
  consume(name) { const had = this.taps.has(name); this.taps.delete(name); return had; }
}
