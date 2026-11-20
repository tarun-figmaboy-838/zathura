// Which enemies fly in the battles. Change this one word to switch.
//   'drone'  virus drones: robots, so the student never destroys anything alive (in use)
//   'ship'   DRAFT, saved for later: the raider ships with alien pilots. Everything they need is
//            kept: assets/models/raider.glb (blender/build_raider.py), assets/ui/face-raider.webp,
//            their lines (SHIP_LINES in src/game/banter.js) and voices (assets/vo).
export const ENEMY_LOOK = 'drone';

export const ENEMY_FACE = ENEMY_LOOK === 'ship' ? 'raider' : 'drone';   // assets/ui/face-*.webp
