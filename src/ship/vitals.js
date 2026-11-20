// Hull + regenerating shield. Damage drains the shield first; when it breaks, half of the
// overflow bleeds into the hull. The shield starts recharging after a few quiet seconds.
export class Vitals {
  constructor({ hull = 100, shield = 100, regenDelay = 3.5, regenRate = 22 } = {}) {
    this.maxHull = hull;
    this.maxShield = shield;
    this.regenDelay = regenDelay;
    this.regenRate = regenRate;
    this.reset();
  }

  reset() {
    this.hull = this.maxHull;
    this.shield = this.maxShield;
    this.sinceHit = 99;
    this.dead = false;
  }

  get shieldFrac() { return this.shield / this.maxShield; }
  get hullFrac() { return this.hull / this.maxHull; }

  // returns 'shield' | 'break' | 'hull' | 'dead' | 'none'
  // floor: the hull never drops below this (crashes into rocks bruise the ship but never end the game)
  damage(amount, floor = 0) {
    if (this.dead) return 'none';
    this.sinceHit = 0;
    if (this.shield > 0) {
      this.shield -= amount;
      if (this.shield > 0) return 'shield';
      const spill = -this.shield;
      this.shield = 0;
      this.hull = Math.max(Math.min(this.hull, floor), this.hull - spill * 0.5);
      if (this.hull <= 0) { this.dead = true; return 'dead'; }
      return 'break';
    }
    this.hull = Math.max(Math.min(this.hull, floor), this.hull - amount);
    if (this.hull > 0) return 'hull';
    this.hull = 0;
    this.dead = true;
    return 'dead';
  }

  // returns true on the frame the shield finishes recharging
  update(dt) {
    this.sinceHit += dt;
    if (this.dead || this.sinceHit < this.regenDelay || this.shield >= this.maxShield) return false;
    this.shield = Math.min(this.maxShield, this.shield + this.regenRate * dt);
    return this.shield >= this.maxShield;
  }
}
