// Comic battle banter, like the comms chatter in an arcade shooter: goofy raiders who talk big and
// panic when hit, a pompous Warden, and a co-pilot on your side. Lines are short enough to read at
// a glance. They never carry the maths: that stays in the question card and the narration.

const recent = new Map();
// a random line from a pool, never the same one twice in a row
function pick(key, list) {
  let i;
  do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === recent.get(key));
  recent.set(key, i);
  return list[i];
}

const NAMES = ['GRUNK', 'ZIZZ', 'BLORP', 'SKRAG', 'VEXX', 'MUNCH', 'KRONK', 'GLIB'];
export const raiderName = () => pick('name', NAMES);
export const WARDEN = 'THE WARDEN';
const CREW = 'CO-PILOT';

const POOLS = {
  raiderArrive: [
    'Ha! A tiny ship! This will be easy.',
    "Nobody gets past {name}! ...That's me.",
    'Prepare to become space dust!',
    "Bet you can't even find x!",
    'I polished my lasers just for you!',
    'Angles? Pfft. Who needs angles?',
    'Surrender now! Or later. Later works too.',
    'Is that a ship or a flying toaster?',
  ],
  crewReply: [
    'Ignore him, pilot. Find x and fire!',
    "Rude! Let's show him some maths.",
    "Don't listen to him. You've got this!",
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
  raiderArrive: 'taunt', wardenArrive: 'taunt', crewReply: 'cheer',
  raiderMock: 'laugh', wardenMock: 'laugh', raiderWin: 'laugh', raiderWinTime: 'laugh', wardenWin: 'laugh', wardenWinTime: 'laugh',
  raiderHit: 'panic', wardenTurret: 'panic', wardenCore: 'panic', wardenDown: 'panic',
};
const faceOf = (who, name) => (who === 'crew' ? 'crew' : name === WARDEN ? 'warden' : 'raider');
const line = (who, name, key, hold = 1.5, src = null) => ({
  who, name, text: pick(key, POOLS[key]).replace('{name}', name), hold, src, face: faceOf(who, name), mood: MOOD[key] || '',
});
export const enemyLine = (name, key, hold, src) => line('enemy', name, key, hold, src);
export const crewLine = (key, hold) => line('crew', CREW, key, hold);
export const wardenIntro = () => POOLS.wardenArrive.map((text) => ({ who: 'enemy', name: WARDEN, text, hold: 1.3, face: 'warden', mood: 'taunt' }));
