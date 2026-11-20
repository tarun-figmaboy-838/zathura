// Which enemies fly in the battles. Change this one word to switch.
//   'drone'  virus drones and the Warden as a giant virus drone: robots, so the student never
//            destroys anything alive (in use)
//   'ship'   DRAFT, saved for later: the raider ships with alien pilots and the Warden's carrier.
//            Everything they need is kept: assets/models/raider.glb and boss.glb (blender/),
//            assets/ui/face-raider.webp and face-warden.webp, the raiders' lines (SHIP_LINES in
//            src/game/banter.js) and voices (assets/vo).
export const ENEMY_LOOK = 'drone';

// portraits, assets/ui/face-<art>.webp (the Warden keeps the face key 'warden' for its colours)
export const ENEMY_FACE = ENEMY_LOOK === 'ship' ? 'raider' : 'drone';
export const WARDEN_ART = ENEMY_LOOK === 'ship' ? 'warden' : 'warden-drone';
