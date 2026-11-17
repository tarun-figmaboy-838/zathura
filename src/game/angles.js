// Angle questions for the cannon battles.
//
// All angles are yaws in the top view: 0 = straight up the screen (the ship's nose),
// positive = anticlockwise. Every question is built around the real direction to the target
// (tYaw): the cannon rests on a reference ray R, and the unknown angle "?" is the turn from R to
// the target. Picking the right value turns the cannon exactly onto the target.
//
//  opposite   two lines cross at the ship; the angle opposite "?" is given   (? = given)
//  linear     R and its extension form a straight line; the angle next to "?" is given   (? = 180 - given)
//  complement R and a perpendicular P form a right angle; the other part is given   (? = 90 - given)

const DEG = Math.PI / 180;
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export const QUESTION_TYPES = ['opposite', 'linear', 'complement'];

export const HINTS = {
  opposite: 'Opposite angles are equal',
  linear: 'Angles on a straight line add up to 180°',
  complement: 'The two parts add up to 90°',
};

export function makeQuestion(tYaw, type, r = Math.random) {
  const s = r() < 0.5 ? 1 : -1;   // turn direction from R to the target
  const answer = type === 'complement'
    ? pick([20, 25, 30, 35, 40, 50, 55, 60, 65, 70], r)
    : pick([25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155], r);
  const A = answer * DEG;
  const rYaw = tYaw - s * A;
  const q = { type, s, answer, tYaw, rYaw, unknown: { from: rYaw, sweep: s * A }, hint: HINTS[type] };
  // q.whole: the full angle the two parts make (180° straight line, 90° right angle), drawn as
  // a thin outer arc so the rule is visible in the picture
  if (type === 'opposite') {
    q.given = answer;
    q.known = { from: rYaw + Math.PI, sweep: s * A };
    q.prompt = `Find ?  It is opposite the ${q.given}° angle`;
    q.hint2 = `So ? = ${q.given}°`;
  } else if (type === 'linear') {
    q.given = 180 - answer;
    q.known = { from: tYaw, sweep: s * (Math.PI - A) };
    q.whole = { from: rYaw, sweep: s * Math.PI, label: '180°' };
    q.prompt = `Find ?  It makes a straight line with ${q.given}°`;
    q.hint2 = `? = 180° − ${q.given}°`;
  } else {
    q.given = 90 - answer;
    q.pYaw = rYaw + s * Math.PI / 2;
    q.known = { from: tYaw, sweep: s * (Math.PI / 2 - A) };
    q.whole = { from: rYaw, sweep: s * Math.PI / 2, label: '90°' };
    q.prompt = `Find ?  With ${q.given}° it makes 90°`;
    q.hint2 = `? = 90° − ${q.given}°`;
  }
  q.options = makeOptions(answer, q.given, type, r);
  return q;
}

// three wrong answers: the usual mistakes first, then near misses. Every wrong value is at
// least 20 degrees from the answer, so a wrong shot always visibly misses the target.
function makeOptions(answer, given, type, r) {
  const wrong = [];
  const ok = (v) => v >= 5 && v <= 175 && Math.abs(v - answer) >= 20 && wrong.every((w) => Math.abs(w - v) >= 10);
  const add = (v) => { v = Math.round(v); if (wrong.length < 3 && ok(v)) wrong.push(v); };
  const mistakes = type === 'opposite' ? [180 - answer, 90 - answer]
    : type === 'linear' ? [given, 90 - answer, answer + given / 2]
    : [given, 180 - answer, 90 + answer];
  for (const v of mistakes) add(v);
  const near = [20, -20, 30, -30, 45, -45, 60, -60].sort(() => r() - 0.5);
  for (const d of near) add(answer + d);
  const all = [answer, ...wrong];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

// question type for a sector (0-based); later sectors mix all three
export function typeForSector(level, r = Math.random) {
  if (level < QUESTION_TYPES.length) return QUESTION_TYPES[level];
  return pick(QUESTION_TYPES, r);
}
