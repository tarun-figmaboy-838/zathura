export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Frame-rate independent exponential smoothing toward a target.
export const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));

export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

export const rand = (a, b) => a + Math.random() * (b - a);

// Seeded PRNG (mulberry32) for reproducible layouts.
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Lead targeting. A projectile fired at `speed` that inherits `shooterVel` meets a target
// moving at `targetVel` after t seconds. Writes the point to aim the barrel at into `out`
// and returns t.
export function intercept(shooterPos, shooterVel, targetPos, targetVel, speed, out) {
  const dx = targetPos.x - shooterPos.x, dy = targetPos.y - shooterPos.y, dz = targetPos.z - shooterPos.z;
  const vx = targetVel.x - shooterVel.x, vy = targetVel.y - shooterVel.y, vz = targetVel.z - shooterVel.z;
  const a = vx * vx + vy * vy + vz * vz - speed * speed;
  const b = 2 * (dx * vx + dy * vy + dz * vz);
  const c = dx * dx + dy * dy + dz * dz;
  let t = -1;
  if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  if (!(t > 0)) t = Math.sqrt(c) / speed;
  out.set(targetPos.x + vx * t, targetPos.y + vy * t, targetPos.z + vz * t);
  return t;
}

// Squared distance between segment a→b and point c (no allocations; t lands in segOut.t).
export const segOut = { t: 0 };
export function segmentPointDistSq(a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  let t = len > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  segOut.t = t;
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz;
}
