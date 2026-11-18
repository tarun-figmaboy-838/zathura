import * as THREE from 'three';
import { damp } from '../core/math.js';

// The sector portal at the end of every journey: a heavy metal ring with glowing clamps and an
// energy vortex spinning inside it. The ship flies through its centre; crossing the plane
// returns true from update() so the game can flash and start the sector.
export class Portal {
  constructor(scene, { radius = 24 } = {}) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // frame: dark steel ring, an inner light strip and eight clamps with amber lamps
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 1.5, 24, 160), steel);
    this.group.add(ring);
    this.stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3.2), toneMapped: false });
    const strip = new THREE.Mesh(new THREE.TorusGeometry(radius - 1.25, 0.32, 10, 160), this.stripMat);
    this.group.add(strip);
    const clampGeo = new THREE.BoxGeometry(3.2, 5.2, 4.2);
    const lampGeo = new THREE.SphereGeometry(0.42, 12, 8);
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.4), toneMapped: false });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const c = new THREE.Mesh(clampGeo, steel);
      c.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      c.rotation.z = a;
      this.group.add(c);
      const lamp = new THREE.Mesh(lampGeo, this.lampMat);
      lamp.position.set(Math.cos(a) * (radius + 2.6), Math.sin(a) * (radius + 2.6), 1.6);
      this.group.add(lamp);
    }

    // vortex: spiral arms around a bright tunnel mouth, receding into the distance
    this.uniforms = { uTime: { value: 0 }, uAlpha: { value: 0 }, uSpin: { value: 1 }, uFlash: { value: 0 } };
    const vortexMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha, uSpin, uFlash;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x);
          // log-spiral arms that wind inward and spin; depth: tighter and faster toward the centre
          float swirl = a * 3.0 + log(r + 0.02) * 6.0 - uTime * 2.4 * uSpin;
          float arms = 0.5 + 0.5 * sin(swirl);
          arms = arms * arms;
          float fine = 0.5 + 0.5 * sin(a * 11.0 + log(r + 0.02) * 17.0 - uTime * 4.0 * uSpin);
          float rim = smoothstep(0.7, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
          float mouth = exp(-r * r * 9.0);                       // the bright far end of the tunnel
          vec3 deep = vec3(0.12, 0.05, 0.4), mid = vec3(0.2, 0.55, 1.0), hot = vec3(0.85, 0.95, 1.0);
          vec3 col = mix(deep, mid, arms * smoothstep(0.05, 0.8, r)) * (0.35 + 0.65 * fine);
          col += hot * mouth * 2.2 + mid * rim * 1.4;
          float a2 = (0.35 + 0.65 * arms) * smoothstep(1.0, 0.85, r) + mouth;
          gl_FragColor = vec4(col * a2 * uAlpha * (1.0 + uFlash * 2.0), 1.0);
        }`,
    });
    this.vortex = new THREE.Mesh(new THREE.CircleGeometry(radius - 1.0, 96), vortexMat);
    this.vortex.renderOrder = 2;
    this.group.add(this.vortex);

    // soft halo behind the ring
    const haloTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
      grd.addColorStop(0, 'rgba(120,200,255,0)');
      grd.addColorStop(0.55, 'rgba(120,200,255,0.55)');
      grd.addColorStop(1, 'rgba(90,60,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3.4, radius * 3.4), this.haloMat);
    halo.position.z = -0.6;
    this.group.add(halo);

    // sector name on a small glass panel above the ring
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.labelMat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const w = radius * 2.1;
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), this.labelMat);
    this.label.position.set(0, radius + 9, 0);
    this.group.add(this.label);

    this.state = 'off';
    this.alpha = 0;
    this.t = 0;
  }

  draw(top, name) {
    const g = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 26);
    g.fillStyle = 'rgba(6, 14, 30, 0.6)';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(120, 225, 255, 0.6)';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(111, 227, 255, 0.9)';
    g.shadowBlur = 16;
    g.fillStyle = '#9ff0ff';
    g.font = '400 46px "Lilita One", sans-serif';
    g.fillText(top, W / 2, 80);
    g.fillStyle = '#ffffff';
    g.font = '400 92px "Lilita One", sans-serif';
    g.fillText(name.toUpperCase(), W / 2, 168, W - 80);
    this.texture.needsUpdate = true;
  }

  show(pos, top, name) {
    this.draw(top, name);
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

  // returns true on the frame the ship flies through
  update(dt, time, shipPos) {
    if (this.state === 'off') return false;
    this.t += dt;
    const u = this.uniforms;
    u.uTime.value = time;
    const dz = this.group.position.z - shipPos.z;          // negative while the portal is ahead
    let crossed = false;
    if (this.state === 'in' && dz > -1) {
      this.state = 'out';
      u.uFlash.value = 1;
      crossed = true;
    }
    this.alpha = this.state === 'in' ? Math.min(1, this.t / 0.8) : damp(this.alpha, 0, 3, dt);
    // the vortex spins up as the ship closes in
    u.uSpin.value = 1 + 2.5 * Math.max(0, 1 - Math.abs(dz) / 400);
    u.uAlpha.value = this.alpha;
    u.uFlash.value = Math.max(0, u.uFlash.value - dt * 2);
    this.haloMat.opacity = this.alpha * 0.55;
    this.labelMat.opacity = this.alpha * Math.min(1, Math.max(0, (-dz - 40) / 140));
    this.stripMat.color.setRGB(0.6, 2.4, 3.2).multiplyScalar(0.6 + 0.4 * Math.sin(time * 3) ** 2 + u.uFlash.value * 2);
    if (this.state === 'out' && this.alpha < 0.01) this.hide();
    return crossed;
  }
}
