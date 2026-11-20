// Which enemies fly in the battles. Change this one word to switch.
//   'drone'  virus drones (a new kind each sector, src/enemies/droneKinds.js) and the Warden as a
//            giant virus drone: robots, so the student never destroys anything alive (in use)
//   'ship'   DRAFT, saved for later: the raider ships with alien pilots and the Warden's carrier.
//            Everything they need is kept: assets/models/raider.glb and boss.glb (blender/),
//            assets/ui/face-raider.webp and face-warden.webp, the raiders' lines (SHIP_LINES in
//            src/game/banter.js) and voices (assets/vo).
export const ENEMY_LOOK = 'drone';

// the enemy kinds, in the order the sectors bring them (each is also its portrait,
// assets/ui/face-<kind>.webp), and the kind a level of a sector (group 0, 1, 2) sends
export const ENEMY_KINDS = ENEMY_LOOK === 'ship' ? ['raider'] : ['drone', 'phage', 'swarm'];
export const kindFor = (group) => ENEMY_KINDS[Math.min(group, ENEMY_KINDS.length - 1)];
export const ENEMY_FACE = ENEMY_KINDS[0];
// the Warden keeps the face key 'warden' (its colours) and swaps the art
export const WARDEN_ART = ENEMY_LOOK === 'ship' ? 'warden' : 'warden-drone';
