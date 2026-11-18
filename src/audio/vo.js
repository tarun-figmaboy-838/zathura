// Voice-over: every line the game shows (comms, introductions, tips) can have a recorded voice in
// assets/vo/, named by a hash of the line's exact text (tools/vo/make_vo.py makes them with Kokoro).
// A line without a file simply stays silent (the talk blips play instead). The music dips while
// someone speaks.
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
};

export const voKey = hash;   // (for tests)

export class Voice {
  constructor(audio) {
    this.audio = audio;
    this.keys = new Set();
    this.loading = new Map();
    this.ready = new Map();
    this.src = null;
    this.endAt = 0;
    this.want = null;
    fetch('assets/vo/manifest.json').then((r) => (r.ok ? r.json() : { files: [] }))
      .then((m) => { this.keys = new Set(m.files || []); this.preload(); }).catch(() => {});
  }

  has(text) { return !!text && this.keys.has(hash(text)); }

  // decode every voice once the audio has started (the files are small)
  preload() {
    if (!this.audio.ctx) return;
    for (const k of this.keys) this.load(k);
  }

  load(k) {
    if (!this.loading.has(k)) {
      this.loading.set(k, fetch(`assets/vo/${k}.m4a`).then((r) => r.arrayBuffer())
        .then((b) => this.audio.ctx.decodeAudioData(b))
        .then((buf) => { this.ready.set(k, buf); if (this.want === k) this.start(k); return buf; })
        .catch(() => null));
    }
    return this.loading.get(k);
  }

  get speaking() { return !!this.audio.ctx && this.audio.ctx.currentTime < this.endAt; }

  // say a line (stops the one before); returns its length in seconds, 0 if it has no voice
  play(text) {
    this.stop();
    const a = this.audio;
    if (!a.ctx || !this.has(text)) return 0;
    const k = hash(text);
    this.want = k;
    if (this.ready.has(k)) return this.start(k);
    this.load(k);                                 // starts as soon as it is decoded
    return 0;
  }

  start(k) {
    const a = this.audio, ctx = a.ctx, buf = this.ready.get(k);
    if (!buf) return 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(a.voiceBus());
    src.start();
    this.src = src;
    this.endAt = ctx.currentTime + buf.duration;
    a.duckMusic(true, buf.duration);
    return buf.duration;
  }

  stop() {
    this.want = null;
    if (this.src) { try { this.src.stop(); } catch { /* already ended */ } this.src = null; }
    if (this.audio.ctx && this.speaking) this.audio.duckMusic(false);
    this.endAt = 0;
  }
}
