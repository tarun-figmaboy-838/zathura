import * as THREE from 'three';

// What every journey gate shares (see brokenPlanet.js, stationGate.js, caveGate.js, ringGate.js,
// wreckGate.js): a group placed on the lane at the end of the journey, shown and hidden, and an
// update that returns true on the frame the ship passes the gate's middle. radius: how far the gate
// reaches along the route either side of its middle (the game keeps rocks and scenery out of it).
// Subclasses build into this.group and may define setLook(sector) and animate(dt, time, near).
export class GateBase {
  constructor(scene, radius) {
    this.radius = radius;
    this.keepOut = radius;                  // how far toward the ship scenery must stay away (a gate may reach further)
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.state = 'off';
    this.t = 0;
    this.flash = 0;
  }

  show(pos, look = 0) {
    this.setLook?.(Math.min(look, 3));
    this.group.position.copy(pos);
    this.group.visible = true;
    this.state = 'in';
    this.t = 0;
    this.flash = 0;
  }

  hide() {
    this.state = 'off';
    this.group.visible = false;
  }

  update(dt, time, shipPos) {
    if (this.state === 'off') return false;
    this.t += dt;
    const dz = this.group.position.z - shipPos.z;          // negative while the gate is ahead
    let crossed = false;
    if (this.state === 'in' && dz > -1) {
      this.state = 'out';
      this.flash = 1;
      crossed = true;
    }
    this.flash = Math.max(0, this.flash - dt * 1.2);
    const near = Math.min(1, Math.max(0, 1 - (-dz - this.radius) / 700));   // 0 far .. 1 arriving
    this.animate?.(dt, time, near);
    if (this.state === 'out' && dz > this.radius + 400) this.hide();
    return crossed;
  }
}

// a small seeded random source, so a gate looks the same every time
export const seeded = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// Fade a gate in (k 0..1) instead of letting it pop into view: its materials become see-through for
// the fade and go back to solid at 1. Shader materials take k through a uFade uniform.
export function setFade(group, k) {
  const solid = k >= 0.999;
  group.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      m.userData.fade ??= { transparent: m.transparent, opacity: m.opacity };
      const base = m.userData.fade;
      if (m.uniforms?.uFade) m.uniforms.uFade.value = k;
      else m.opacity = base.opacity * k;
      m.transparent = solid ? base.transparent : true;
    }
  });
}
