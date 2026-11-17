import * as THREE from 'three';

const _rel = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const rand = (a, b) => a + Math.random() * (b - a);

// Fully synthesized Web Audio: every sound is built from oscillators, filtered noise and
// envelopes, so there are no audio files. One-shots are panned and attenuated relative
// to the camera; engine, turret servo and ambience are continuous layers.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.camPos = new THREE.Vector3();
    this.last = {};
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.buildLoops();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // ------------------------------------------------------------------ helpers
  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  out(gain, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    return g;
  }

  env(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  osc(type, f0, f1, dur, peak, dest, t, attack = 0.003) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this.env(g.gain, t, peak, attack, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  burst(filterType, freq, q, dur, peak, dest, t, freqEnd = null, attack = 0.002) {
    const n = this.noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g.gain, t, peak, attack, dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 1.5);
    n.stop(t + attack + dur + 0.05);
    return n;
  }

  spatial(pos) {
    _rel.copy(pos).sub(this.camPos);
    const d = _rel.length();
    _rel.applyQuaternion(_inv);
    const pan = Math.max(-1, Math.min(1, _rel.x / Math.max(d, 1))) * 0.85;
    const gain = 1 / (1 + Math.pow(d / 110, 1.4));
    return { pan, gain, d };
  }

  limit(key, ms) {
    const now = performance.now();
    if (this.last[key] && now - this.last[key] < ms) return false;
    this.last[key] = now;
    return true;
  }

  ready() { return !!this.ctx && this.ctx.state === 'running'; }

  // ------------------------------------------------------------------ one-shots
  cannon() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.85, rand(-0.06, 0.06));
    this.osc('sine', 170, 42, 0.16, 0.75, o, t);
    const zf = this.ctx.createBiquadFilter();
    zf.type = 'lowpass';
    zf.frequency.setValueAtTime(4200, t);
    zf.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    zf.connect(o);
    this.osc('sawtooth', 1250 * rand(0.94, 1.06), 130, 0.11, 0.16, zf, t);
    const last = this.burst('highpass', 1800, 0.7, 0.05, 0.3, o, t);
    last.onended = () => o.disconnect();
  }

  enemyShot(pos) {
    if (!this.ready() || !this.limit('eshot', 40)) return;
    const s = this.spatial(pos);
    if (s.gain < 0.03) return;
    const t = this.ctx.currentTime;
    const o = this.out(s.gain * 0.5, s.pan);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1300;
    f.Q.value = 1.6;
    f.connect(o);
    const src = this.osc('square', 950 * rand(0.95, 1.05), 260, 0.13, 0.35, f, t);
    src.onended = () => o.disconnect();
  }

  explosion(pos, size = 1) {
    if (!this.ready()) return;
    const s = this.spatial(pos);
    if (s.gain < 0.02) return;
    const t = this.ctx.currentTime;
    const o = this.out(Math.min(1.3, s.gain * (0.55 + size * 0.3)), s.pan);
    const dur = 0.9 + size * 0.4;
    const dull = Math.max(0.25, 1 - s.d / 900);
    this.burst('lowpass', 2600 * dull, 0.7, dur, 1.0, o, t, 110, 0.006);
    this.burst('bandpass', 3200, 0.9, 0.16, 0.5 * dull, o, t);
    const sub = this.osc('sine', 80, 26, dur * 0.85, 0.9, o, t, 0.008);
    sub.onended = () => o.disconnect();
  }

  hit(kill = false) {
    if (!this.ready() || !this.limit('hit', 30)) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.22);
    if (kill) {
      this.osc('sine', 1300, 1300, 0.06, 0.5, o, t);
      this.osc('sine', 2000, 2000, 0.1, 0.5, o, t + 0.06);
    } else {
      this.osc('sine', 1900, 1500, 0.035, 0.45, o, t);
    }
  }

  shieldHit() {
    if (!this.ready() || !this.limit('shield', 50)) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.55, rand(-0.3, 0.3));
    this.burst('bandpass', 1300, 4, 0.28, 0.9, o, t, 500);
    this.osc('sine', 260, 120, 0.25, 0.4, o, t);
  }

  shieldDown() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(o);
    this.osc('sawtooth', 900, 70, 0.7, 0.35, f, t);
    this.burst('lowpass', 1500, 0.8, 0.6, 0.5, o, t, 120);
  }

  shieldUp() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.25);
    this.osc('sine', 300, 900, 0.35, 0.4, o, t, 0.05);
    this.osc('sine', 450, 1350, 0.35, 0.2, o, t, 0.05);
  }

  hullHit() {
    if (!this.ready() || !this.limit('hull', 60)) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.7, rand(-0.25, 0.25));
    for (const [f, d, g] of [[310, 0.5, 0.35], [527, 0.35, 0.25], [883, 0.25, 0.18]]) this.osc('sine', f * rand(0.95, 1.05), f * 0.97, d, g, o, t);
    this.burst('lowpass', 900, 0.8, 0.14, 0.8, o, t);
  }

  alarm() {
    if (!this.ready() || !this.limit('alarm', 1200)) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.connect(o);
    this.osc('square', 760, 760, 0.1, 0.5, f, t);
    this.osc('square', 760, 760, 0.1, 0.5, f, t + 0.18);
  }

  overheat() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.3);
    this.osc('square', 220, 160, 0.35, 0.25, o, t);
    this.burst('highpass', 3000, 0.7, 0.5, 0.25, o, t, 1200);
  }

  flyby(pos) {
    if (!this.ready() || !this.limit('flyby', 250)) return;
    const s = this.spatial(pos);
    const t = this.ctx.currentTime;
    const o = this.out(Math.min(0.8, s.gain * 1.2), s.pan);
    this.burst('bandpass', 400, 1.5, 0.7, 0.9, o, t, 2200, 0.25);
  }

  warp(pos) {
    if (!this.ready() || !this.limit('warp', 120)) return;
    const s = this.spatial(pos);
    const t = this.ctx.currentTime;
    const o = this.out(Math.max(0.12, s.gain) * 0.8, s.pan);
    this.osc('sine', 1600, 140, 0.45, 0.35, o, t);
    this.burst('lowpass', 3000, 0.7, 0.5, 0.45, o, t, 200);
  }

  waveHorn() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.linearRampToValueAtTime(1400, t + 0.5);
    f.frequency.linearRampToValueAtTime(300, t + 1.6);
    f.connect(o);
    this.osc('sawtooth', 98, 98, 1.5, 0.35, f, t, 0.2);
    this.osc('sawtooth', 147, 147, 1.5, 0.25, f, t, 0.2);
  }

  klaxon() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    f.connect(o);
    for (let i = 0; i < 3; i++) {
      this.osc('sawtooth', 520, 520, 0.32, 0.4, f, t + i * 0.7, 0.03);
      this.osc('sawtooth', 390, 390, 0.32, 0.4, f, t + i * 0.7 + 0.35, 0.03);
    }
  }

  hiss() {
    if (!this.ready()) return;
    this.burst('highpass', 2500, 0.6, 0.9, 0.35, this.out(0.7), this.ctx.currentTime, 6000, 0.02);
  }

  clunk() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.9);
    this.osc('sine', 120, 50, 0.3, 0.9, o, t);
    this.burst('bandpass', 700, 3, 0.18, 0.6, o, t);
    this.osc('sine', 410, 400, 0.4, 0.15, o, t);
  }

  rcsBurst() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.5);
    for (let i = 0; i < 9; i++) this.burst('bandpass', 1800, 1.2, 0.12, 0.45, o, t + i * 0.2 + rand(0, 0.05));
  }

  ignite() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(1.0);
    this.burst('lowpass', 200, 0.7, 1.6, 1.0, o, t, 2400, 0.25);
    this.osc('sine', 40, 70, 1.4, 0.8, o, t, 0.2);
    this.burst('bandpass', 1200, 2, 0.08, 0.5, o, t);
  }

  // crossing the event horizon: a deep falling boom under a rising rush of noise
  horizon() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(1.0);
    this.osc('sine', 130, 24, 2.2, 0.9, o, t, 0.02);
    this.osc('sawtooth', 65, 30, 1.6, 0.18, o, t, 0.05);
    this.burst('lowpass', 300, 0.7, 1.8, 0.8, o, t, 4200, 0.4);
  }

  // right answer: bright rising chord
  correct() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.3);
    [660, 830, 990, 1320].forEach((f, i) => this.osc('triangle', f, f, 0.22, 0.45, o, t + i * 0.06));
  }

  // wrong answer: short low double buzz
  wrong() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.28);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    f.connect(o);
    this.osc('square', 180, 150, 0.14, 0.5, f, t);
    this.osc('square', 150, 120, 0.2, 0.5, f, t + 0.16);
  }

  uiConfirm() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.out(0.28);
    this.osc('sine', 520, 520, 0.09, 0.5, o, t);
    this.osc('sine', 780, 780, 0.12, 0.45, o, t + 0.07);
    this.osc('sine', 1170, 1170, 0.2, 0.35, o, t + 0.14);
  }

  boostWhoosh() {
    if (!this.ready() || !this.limit('boost', 500)) return;
    const t = this.ctx.currentTime;
    this.burst('bandpass', 300, 1.2, 0.9, 0.6, this.out(0.7), t, 1600, 0.15);
  }

  // ------------------------------------------------------------------ continuous layers
  buildLoops() {
    const ctx = this.ctx;
    // engine: two detuned saws + sub through a throttle-driven low-pass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 200;
    this.engFilter.connect(this.engGain).connect(this.master);
    for (const [type, f] of [['sawtooth', 46], ['sawtooth', 46.7], ['sine', 23]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(this.engFilter);
      o.start();
    }
    this.rumble = ctx.createGain();
    this.rumble.gain.value = 0;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 180;
    rf.Q.value = 0.8;
    const rn = this.noiseSrc();
    rn.connect(rf).connect(this.rumble).connect(this.master);
    rn.start();

    // turret servo whine
    this.servoGain = ctx.createGain();
    this.servoGain.gain.value = 0;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 700;
    sf.Q.value = 3;
    sf.connect(this.servoGain).connect(this.master);
    this.servo = ctx.createOscillator();
    this.servo.type = 'triangle';
    this.servo.frequency.value = 180;
    this.servo.connect(sf);
    this.servo.start();

    // ambience: low drone with a slow swell + soft filtered "room tone"
    const amb = ctx.createGain();
    amb.gain.value = 0.05;
    amb.connect(this.master);
    for (const f of [55, 82.4, 110.2]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 100 ? 0.25 : 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(amb);
      o.start();
      lfo.start();
    }
    const air = this.noiseSrc();
    const af = ctx.createBiquadFilter();
    af.type = 'lowpass';
    af.frequency.value = 320;
    const ag = ctx.createGain();
    ag.gain.value = 0.35;
    air.connect(af).connect(ag).connect(amb);
    air.start();
  }

  update(camera, ship, turret, alive) {
    this.camPos.copy(camera.position);
    _inv.copy(camera.quaternion).invert();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const thr = alive ? ship.thrust : 0;
    const boost = alive ? ship.boost : 0;
    this.engFilter.frequency.setTargetAtTime(160 + thr * 520 + boost * 900, t, 0.08);
    this.engGain.gain.setTargetAtTime(alive ? 0.05 + thr * 0.06 + boost * 0.05 : 0, t, 0.1);
    this.rumble.gain.setTargetAtTime(boost * 0.22, t, 0.1);
    const slew = Math.min(turret.slew, 4);
    this.servoGain.gain.setTargetAtTime(alive ? Math.min(0.06, slew * 0.02) : 0, t, 0.05);
    this.servo.frequency.setTargetAtTime(150 + slew * 70, t, 0.05);
  }
}
