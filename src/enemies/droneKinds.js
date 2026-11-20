import { makeVirusDrone, virusRig } from './virusDrone.js';
import { makePhageDrone, phageRig } from './phageDrone.js';
import { makeSwarmDrone, swarmRig } from './swarmDrone.js';

// The kinds of virus drone, one per sector (src/enemies/look.js picks them by level): the model,
// how it moves (rig), its trail colour and how many can fly at once. The key also names its
// portrait (assets/ui/face-<key>.webp), its lines and its voice (src/game/banter.js).
export const DRONE_KINDS = [
  { key: 'drone', make: makeVirusDrone, rig: virusRig, trail: [1.15, 0.38, 0.16], count: 8 },   // levels 1-4
  { key: 'phage', make: makePhageDrone, rig: phageRig, trail: [0.45, 1.1, 0.3], count: 4 },     // levels 5-8
  { key: 'swarm', make: makeSwarmDrone, rig: swarmRig, trail: [1.1, 0.3, 0.9], count: 4 },      // mastery 1-4
];
