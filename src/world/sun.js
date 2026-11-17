import * as THREE from 'three';
import { damp } from '../core/math.js';

function glowTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _ndc = new THREE.Vector3();
const _toSun = new THREE.Vector3();
const _fwd = new THREE.Vector3();

// Key light (with soft shadows that follow the ship), coloured fill, the visible sun
// disc + corona, and the screen-space data the lens pass uses for flares.
export function createSun(scene, sunDir) {
  const light = new THREE.DirectionalLight(0xfff0dc, 3.6);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const sc = light.shadow.camera;
  sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 400;
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.035;
  light.shadow.radius = 3;
  scene.add(light, light.target);

  // cool nebula bounce from "above", warm magenta from below
  scene.add(new THREE.HemisphereLight(0x8c9cc8, 0x3a2430, 0.6));

  const coreTex = glowTexture([[0, '#ffffff'], [0.12, '#fff6e8'], [0.25, 'rgba(255,214,160,0.55)'], [0.5, 'rgba(255,140,60,0.12)'], [1, 'rgba(255,90,30,0)']]);
  const haloTex = glowTexture([[0, 'rgba(255,190,120,0.55)'], [0.3, 'rgba(255,120,60,0.14)'], [1, 'rgba(120,60,140,0)']]);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, color: new THREE.Color(14, 11, 8), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color(1.6, 1.2, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const DIST = 20000;
  core.scale.setScalar(2400);
  halo.scale.setScalar(16000);
  core.renderOrder = halo.renderOrder = -5;
  scene.add(core, halo);

  const state = { screen: new THREE.Vector2(0.5, 0.5), visibility: 0 };

  return {
    light,
    state,
    update(dt, camera, shipPos, occluders) {
      core.position.copy(camera.position).addScaledVector(sunDir, DIST);
      halo.position.copy(core.position);
      light.position.copy(shipPos).addScaledVector(sunDir, 150);
      light.target.position.copy(shipPos);

      // lens-flare visibility: on screen, facing, and not blocked by planet/asteroids
      camera.getWorldDirection(_fwd);
      _ndc.copy(core.position).project(camera);
      let vis = _fwd.dot(sunDir) > 0 && Math.abs(_ndc.x) < 1.15 && Math.abs(_ndc.y) < 1.15 ? 1 : 0;
      if (vis) {
        _toSun.copy(sunDir);
        if (occluders?.some((o) => o.blocksRay(camera.position, _toSun))) vis = 0;
        const edge = Math.max(Math.abs(_ndc.x), Math.abs(_ndc.y));
        vis *= 1 - THREE.MathUtils.smoothstep(edge, 0.8, 1.15);
      }
      state.visibility = damp(state.visibility, vis, 10, dt);
      state.screen.set(_ndc.x * 0.5 + 0.5, _ndc.y * 0.5 + 0.5);
    },
  };
}
