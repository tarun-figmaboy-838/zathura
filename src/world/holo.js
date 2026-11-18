import * as THREE from 'three';
import { damp } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// ------------------------------------------------------------------ sector gate
// A holographic ring the ship flies through at the start of every sector, with the sector
// number and name on a glass panel above it. It replaces the old full-screen level banner.
export class SectorGate {
  constructor(scene, { radius = 24 } = {}) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.uniforms = { uR: { value: radius }, uTime: { value: 0 }, uAlpha: { value: 0 }, uFlash: { value: 0 } };
    const ringMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uR, uTime, uAlpha, uFlash;
        varying vec2 vP;
        const float TAU = 6.2831853;
        void main() {
          float r = length(vP);
          float a = atan(vP.y, vP.x);
          // twelve heavy arc segments
          float s = fract(a / TAU * 12.0 + 0.25);
          float seg = smoothstep(0.03, 0.06, s) * (1.0 - smoothstep(0.94, 0.97, s));
          float outer = exp(-pow((r - uR) * 1.5, 2.0)) * seg;
          float rim = exp(-pow((r - uR - 1.6) * 5.0, 2.0)) * 0.45;
          // rotating dashed inner ring
          float d = fract((a + uTime * 0.5) / TAU * 60.0);
          float dash = step(0.45, d) * exp(-pow((r - uR * 0.84) * 5.0, 2.0)) * 0.55;
          // four amber chevrons pointing into the gate
          float q = fract(a / TAU * 4.0 + 0.125) - 0.5;
          float chev = (1.0 - smoothstep(0.012, 0.03, abs(abs(q) * 3.0 - (uR + 3.2 - r) * 0.06)))
                     * step(uR + 1.4, r) * (1.0 - step(uR + 4.6, r));
          // faint scan ripple across the opening
          float fill = (1.0 - smoothstep(uR * 0.3, uR, r)) * 0.05 * (0.5 + 0.5 * sin(r * 1.4 - uTime * 7.0));
          vec3 col = vec3(0.32, 0.84, 1.0) * (outer * 1.5 + rim + dash + fill) + vec3(1.0, 0.62, 0.22) * chev * 1.4;
          col *= 1.0 + uFlash * 2.5;
          gl_FragColor = vec4(col * uAlpha, 1.0);
        }`,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry((radius + 6) * 2, (radius + 6) * 2), ringMat);
    ring.frustumCulled = false;
    ring.renderOrder = 3;
    this.group.add(ring);

    // glass label panel
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 288;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.labelMat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, color: new THREE.Color(1.15, 1.15, 1.15),
    });
    const w = radius * 2.7;
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (288 / 1024)), this.labelMat);
    this.label.position.set(0, radius + 13, 0);
    this.label.renderOrder = 4;
    this.group.add(this.label);

    this.t = 0;
    this.state = 'off';
    this.alpha = 0;
  }

  draw(index, total, name) {
    const g = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    // glass panel with a bright frame and corner brackets
    const pad = 10, r = 28;
    g.beginPath();
    g.roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
    g.fillStyle = 'rgba(6, 16, 34, 0.62)';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(120, 225, 255, 0.55)';
    g.stroke();
    g.strokeStyle = '#8ff0ff';
    g.lineWidth = 7;
    for (const [x, y, dx, dy] of [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]) {
      g.beginPath();
      g.moveTo(x + dx * 70, y);
      g.lineTo(x + dx * r * 0.3, y);
      g.quadraticCurveTo(x, y, x, y + dy * r * 0.3);
      g.lineTo(x, y + dy * 70);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(111, 227, 255, 0.9)';
    g.shadowBlur = 18;
    g.fillStyle = '#9ff0ff';
    g.font = '400 50px "Lilita One", sans-serif';
    g.fillText(`SECTOR ${index} / ${total}`, W / 2, 92);
    g.fillStyle = '#ffffff';
    g.font = '400 104px "Lilita One", sans-serif';
    g.fillText(name.toUpperCase(), W / 2, 188, W - 90);
    this.texture.needsUpdate = true;
  }

  // place the gate at `pos` (on the route ahead of the ship) and fade it in
  show(pos, index, total, name) {
    this.draw(index, total, name);
    this.group.position.copy(pos);
    this.group.visible = true;
    this.state = 'in';
    this.t = 0;
    this.uniforms.uFlash.value = 0;
  }

  hide() {
    this.state = 'off';
    this.alpha = 0;
    this.group.visible = false;
  }

  update(dt, time, shipPos) {
    if (this.state === 'off') return;
    this.t += dt;
    this.uniforms.uTime.value = time;
    if (this.state === 'in' && shipPos.z < this.group.position.z - 2) {
      this.state = 'out';
      this.uniforms.uFlash.value = 1;
    }
    const target = this.state === 'in' ? Math.min(1, this.t / 0.6) : 0;
    this.alpha = this.state === 'in' ? target : damp(this.alpha, 0, 5, dt);
    this.uniforms.uFlash.value = Math.max(0, this.uniforms.uFlash.value - dt * 3);
    this.uniforms.uAlpha.value = this.alpha;
    // the panel fades as the ship gets close so it never fills the screen
    const dz = this.group.position.z - shipPos.z;
    this.labelMat.opacity = this.alpha * Math.min(1, Math.max(0, (-dz - 30) / 120));
    if (this.state === 'out' && this.alpha < 0.01) this.hide();
  }
}

// ------------------------------------------------------------------ target rings
// Flat holographic rings drawn under enemies in the top-view battles, with an arc showing the
// remaining health. They replace the floating health bars.
export class TargetRings {
  constructor(scene, capacity = 16) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.hp = new Float32Array(capacity);
    this.kind = new Float32Array(capacity);
    geo.setAttribute('aHp', new THREE.InstancedBufferAttribute(this.hp, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aHp; attribute float aKind;
        varying vec2 vP; varying float vHp; varying float vKind;
        void main() {
          vP = position.xz; vHp = aHp; vKind = aKind;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vP; varying float vHp; varying float vKind;
        const float TAU = 6.2831853;
        // lock-on bracket: four corner marks that slowly turn and breathe
        void main() {
          float pulse = 0.92 + 0.08 * sin(uTime * 4.0);
          float c = cos(uTime * 0.6), s = sin(uTime * 0.6);
          vec2 p = vec2(c * vP.x - s * vP.y, s * vP.x + c * vP.y) / pulse;
          vec2 q = abs(p);
          float edge = 1.0 - smoothstep(0.035, 0.075, abs(max(q.x, q.y) - 0.82));   // the square's outline
          float arms = edge * smoothstep(0.46, 0.5, min(q.x, q.y));                   // keep only the corners
          vec3 col = vKind > 1.5 ? vec3(1.0, 0.85, 0.3) : vKind > 0.5 ? vec3(1.0, 0.72, 0.2) : vec3(1.0, 0.3, 0.18);
          gl_FragColor = vec4(col * arms * 1.6, 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
  }

  begin(time) { this.n = 0; this.uniforms.uTime.value = time; }

  add(pos, radius, hp, kind = 0) {
    if (this.n >= this.capacity) return;
    _m.compose(_p.copy(pos), _q.identity(), _s.set(radius, 1, radius));
    this.mesh.setMatrixAt(this.n, _m);
    this.hp[this.n] = Math.max(0, Math.min(1, hp));
    this.kind[this.n] = kind;
    this.n++;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.aHp.needsUpdate = true;
    this.mesh.geometry.attributes.aKind.needsUpdate = true;
  }
}
