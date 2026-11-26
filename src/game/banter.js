// Comic battle banter, like the comms chatter in an arcade shooter: cheeky virus drones (robots)
// who talk big and glitch when hit, a pompous robot Warden, and a co-pilot on your side. Lines are
// short enough to read at a glance. They never carry the maths: that stays in the question card and
// the narration.

import { ENEMY_LOOK, ENEMY_FACE } from '../enemies/look.js';

const recent = new Map();
// a random line from a pool, never the same one twice in a row
function pick(key, list) {
  let i;
  do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === recent.get(key));
  recent.set(key, i);
  return list[i];
}

// the enemy's callsign on the nameplate, its lines, and its portrait (src/enemies/look.js picks)
const DRONE_NAMES = ['GLITCH', 'BUG-404', 'ZAP-9', 'BYTE', 'SPIKE', 'BLIP', 'VIRO', 'ERR-7'];
const DRONE_LINES = {
  raiderArrive: [
    'Beep boop! Tiny ship detected!',
    'Virus drone online! Nobody gets past ME!',
    'Uploading virus... to YOUR ship!',
    "Beep! Bet you can't find x!",
    'Spikes polished. Lasers charged!',
    'Angles? Does not compute!',
    'Surrender now! Or after my update.',
    'Scanning... is that a flying toaster?',
  ],
  raiderMock: [
    'Beep boop! Missed me by a mile!',
    'Is that your best angle? Ha!',
    'Wrong way! Recalculate, space cadet!',
    'So close! ...Not really.',
    'Even old software aims better!',
    'Error 404: hit not found!',
    'Were you aiming at a star?',
    "Nyah nyah! Can't hit this drone!",
  ],
  raiderHit: [
    'ERROR! ERROR! System crash!',
    'Nooo! Not my shiny spikes!',
    'No fair! That was MATHS!',
    'Rebooting... in tiny pieces!',
    'Shutting... down...',
    'Okay! You know your angles!',
    'Virus deleted?! Nooo!',
  ],
  raiderWinTime: [
    'Too slow, pilot! Need a reboot?',
    "Beep beep! Time's up!",
    'Zzz... sleep mode... oh, too late!',
  ],
  raiderWin: [
    'Beep! Your ship is a space pancake now!',
    'Virus wins! Better luck next time, pilot!',
    "Who's the tiny ship now? Still you!",
  ],
};

// each new kind of drone has its own name, arrival, mocking and crash lines (the rest are shared)
const PHAGE_NAMES = ['HOPPER', 'STILTS', 'T4-BOT', 'CLAMP', 'SIX-LEGS', 'PROBE'];
const PHAGE_LINES = {
  raiderArrive: [
    'Phage drone landing! Six legs, zero worries!',
    'Click clack! Here come my legs!',
    'Legs locked. Lasers loaded!',
    'I hop! I zap! I win!',
  ],
  raiderMock: [
    'Ha! I just stepped aside!',
    'Missed! Too many legs to hit!',
  ],
  raiderHit: [
    'My legs! All six of them!',
    'Landing gear... failing!',
    'Wobble... wobble... CRASH!',
  ],
};
const SWARM_NAMES = ['TRIO', 'X3', 'TRIPLEX', 'HIVE-3', 'TRIBYTE', 'CLUSTER'];
const SWARM_LINES = {
  raiderArrive: [
    'We are three! You are one!',
    'Three drones, one brain!',
    'We copy! We paste! We attack!',
    'Swarm online. Beep beep beep!',
  ],
  raiderMock: [
    'Missed all three of us!',
    'Wrong angle! We all saw it!',
  ],
  raiderHit: [
    'Swarm scattered! Regroup! REGROUP!',
    'Error! Error! Error!',
    'We split up... into tiny pieces!',
  ],
};

// DRAFT, saved for later (ENEMY_LOOK 'ship'): goofy alien raider pilots
const SHIP_NAMES = ['GRUNK', 'ZIZZ', 'BLORP', 'SKRAG', 'VEXX', 'MUNCH', 'KRONK', 'GLIB'];
const SHIP_LINES = {
  raiderArrive: [
    'Ha! A tiny ship! This will be easy.',
    'Nobody gets past ME! ...Probably.',
    'Prepare to become space dust!',
    "Bet you can't even find x!",
    'I polished my lasers just for you!',
    'Angles? Pfft. Who needs angles?',
    'Surrender now! Or later. Later works too.',
    'Is that a ship or a flying toaster?',
  ],
  raiderMock: [
    'Ha! Missed me by a mile!',
    'Is that your best angle?',
    'Wrong way, space cadet!',
    'Ooh, so close! ...Not really.',
    'My grandma aims better than that!',
    'Swing and a miss!',
    'Were you aiming at a comet?',
    "Nyah nyah, can't hit me!",
  ],
  raiderHit: [
    'Nooo! Not my shiny paint job!',
    "I'm telling my mom!",
    'No fair! You used MATHS!',
    "I'll be back! ...In tiny pieces.",
    'Eject! EJECT! Where is the eject button?!',
    'Okay, okay, you know your angles!',
    'My ship! I only just washed it!',
  ],
  raiderWinTime: [
    'Too slow, pilot! Taking a nap?',
    "Tick tock! Time's up, slowpoke!",
    'Zzz... oh, are you done? Too late!',
  ],
  raiderWin: [
    'Ha! Your ship is a space pancake now!',
    'Boom! Better luck next time, pilot!',
    "Who's the tiny ship now? Oh wait. Still you.",
  ],
};

// per kind (see src/enemies/droneKinds.js): callsigns, its own lines, and the co-pilot's first look
const KINDS = {
  drone: { names: DRONE_NAMES, lines: {}, intro: 'Virus drone incoming! It shoots at your ship.' },
  phage: { names: PHAGE_NAMES, lines: PHAGE_LINES, intro: 'New drone: the Phage! It walks on six legs.' },
  swarm: { names: SWARM_NAMES, lines: SWARM_LINES, intro: 'New drone: the Swarm! Three drones in one.' },
  raider: { names: SHIP_NAMES, lines: {}, intro: 'Raider incoming! It shoots at your ship.' },
};
const kindOf = (kind) => KINDS[kind] || KINDS[ENEMY_FACE];
export const raiderName = (kind = ENEMY_FACE) => pick(`name:${kind}`, kindOf(kind).names);
export const enemyIntro = (kind = ENEMY_FACE) => kindOf(kind).intro;
export const ENEMY_CALLSIGN = ENEMY_LOOK === 'ship' ? 'RAIDER' : 'DRONE';   // when a callsign is missing
export const WARDEN = 'THE WARDEN';

const POOLS = {
  ...(ENEMY_LOOK === 'ship' ? SHIP_LINES : DRONE_LINES),
  wardenArrive: [
    'Who dares fly into MY sector?!',
    'Answer my angles... if you can! Mwahaha!',
  ],
  wardenMock: [
    'Wrong! The Warden is never wrong.',
    'Pathetic! Try harder, little pilot.',
    'Mwahaha! My turrets are laughing at you!',
    'Is that the best your school can teach?',
  ],
  wardenTurret: [
    'My turret! I just had it polished!',
    'That was my favourite turret!',
    'Stop that! Those cost a fortune!',
    'Lucky shot! ...Very, very lucky.',
  ],
  wardenCore: [
    'Ow! Not the core! Anything but the core!',
    "Ouch! That's my good side!",
    'Grr! Stop doing maths at me!',
  ],
  wardenDown: ['Impossible! Beaten by... geometry?!'],
  wardenWinTime: ["Time's up! The Warden always wins!", 'Too slow! My sector, my rules!'],
  wardenWin: ['Bow before the Warden! ...Or what is left of you.', 'Your ship is scrap! Mwahaha!'],
};

// src: where the speaker is (a Vector3, live or a snapshot) so landscape screens can put the speech
// bubble beside it
// a little acting for each kind of line (see .dialog[data-mood] in style.css)
const MOOD = {
  raiderArrive: 'taunt', wardenArrive: 'taunt',
  raiderMock: 'laugh', wardenMock: 'laugh', raiderWin: 'laugh', raiderWinTime: 'laugh', wardenWin: 'laugh', wardenWinTime: 'laugh',
  raiderHit: 'panic', wardenTurret: 'panic', wardenCore: 'panic', wardenDown: 'panic',
};
const faceOf = (who, name, kind) => (who === 'crew' ? 'crew' : name === WARDEN ? 'warden' : kind || ENEMY_FACE);
// kind: the drone kind speaking; its own lines come first, the shared pool otherwise
const line = (who, name, key, hold = 1.5, src = null, kind = null) => {
  const own = kind && kindOf(kind).lines[key];
  return {
    who, name, text: (own ? pick(`${kind}:${key}`, own) : pick(key, POOLS[key])).replace('{name}', name), hold, src,
    face: faceOf(who, name, kind), mood: MOOD[key] || '',
  };
};
export const enemyLine = (name, key, hold, src, kind) => line('enemy', name, key, hold, src, kind);
export const wardenIntro = () => POOLS.wardenArrive.map((text) => ({ who: 'enemy', name: WARDEN, text, hold: 1.3, face: 'warden', mood: 'taunt' }));
