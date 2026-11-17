import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();

// Camera-facing ribbon trails, all in one draw call. Each trail keeps a short history of
// positions; the newest sample tracks the emitter every frame and older samples are laid
// down at a fixed interval, fading and tapering with age.
export class Trails {
  constructor(scene, { maxTrails = 24, samples = 30, interval = 0.022 } = {}) {
    this.samples = samples;
    this.interval = interval;
    const verts = maxTrails * samples * 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    const index = [];
    for (let t = 0; t < maxTrails; t++) {
      const base = t * samples * 2;
      for (let i = 0; i < samples - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(index);
    this.geo = geo;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    scene.add(mesh);

    this.trails = Array.from({ length: maxTrails }, () => ({
      used: false,
      color: new THREE.Color(),
      width: 0.5,
      maxAge: 0.6,
      intensity: 1,
      pts: Array.from({ length: samples }, () => ({ p: new THREE.Vector3(), t: -1e9 })),
    }));
  }

  alloc(color, width = 0.5, maxAge = 0.6) {
    const tr = this.trails.find((t) => !t.used);
    if (!tr) return null;
    tr.used = true;
    tr.color.copy(color);
    tr.width = width;
    tr.maxAge = maxAge;
    this.reset(tr);
    return tr;
  }

  reset(tr) {
    for (const s of tr.pts) s.t = -1e9;
  }

  push(tr, pos, time) {
    const pts = tr.pts;
    if (time - pts[1].t >= this.interval || pts[0].t < -1e8) {
      const last = pts.pop();
      last.p.copy(pos);
      last.t = time;
      pts.unshift(last);
    } else {
      pts[0].p.copy(pos);
      pts[0].t = time;
    }
  }

  update(camPos, time) {
    const S = this.samples;
    this.trails.forEach((tr, ti) => {
      const pts = tr.pts;
      for (let i = 0; i < S; i++) {
        const v = (ti * S + i) * 2;
        const s = pts[i];
        const age = time - s.t;
        const a = Math.max(0, 1 - age / tr.maxAge) * tr.intensity;
        if (a <= 0) {
          this.col.fill(0, v * 3, v * 3 + 6);
          this.pos.set([s.p.x, s.p.y, s.p.z, s.p.x, s.p.y, s.p.z], v * 3);
          continue;
        }
        const n = pts[Math.min(i + 1, S - 1)];
        const pv = i > 0 ? pts[i - 1] : s;
        _dir.subVectors(i < S - 1 ? s.p : pv.p, i < S - 1 ? n.p : s.p);
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
        _toCam.subVectors(camPos, s.p);
        _side.crossVectors(_dir, _toCam).normalize().multiplyScalar(tr.width * (0.25 + 0.75 * Math.sqrt(a)));
        this.pos[v * 3] = s.p.x + _side.x; this.pos[v * 3 + 1] = s.p.y + _side.y; this.pos[v * 3 + 2] = s.p.z + _side.z;
        this.pos[v * 3 + 3] = s.p.x - _side.x; this.pos[v * 3 + 4] = s.p.y - _side.y; this.pos[v * 3 + 5] = s.p.z - _side.z;
        const k = a * a;
        for (let j = 0; j < 2; j++) {
          this.col[v * 3 + j * 3] = tr.color.r * k;
          this.col[v * 3 + j * 3 + 1] = tr.color.g * k;
          this.col[v * 3 + j * 3 + 2] = tr.color.b * k;
        }
      }
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
