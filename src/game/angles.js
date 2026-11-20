// Angle questions for the cannon battles.
//
// All angles are yaws in the top view: 0 = straight up the screen (the ship's nose),
// positive = anticlockwise. Every question is built around the real direction to the target
// (tYaw): the cannon rests on a reference ray R, and the unknown angle "x" is the turn from R to
// the target. Picking the right value turns the cannon exactly onto the target.
//
//  opposite   two lines cross at the ship; the angle opposite "x" is given   (x = given)
//  linear     R and its extension form a straight line; the angle next to "x" is given   (x = 180 - given)
//  complement R and a perpendicular P form a right angle; the other part is given   (x = 90 - given)
//  point      R, T and a third ray X go all the way round; the other two angles are given (x = 360 - b - c)
//  triangle   the ship, a point on R and a point on T make a triangle; its other two angles are
//             given (x = 180 - b - c)

const DEG = Math.PI / 180;
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export const HINTS = {
  opposite: 'Opposite angles are equal',
  linear: 'Angles on a straight line add up to 180°',
  complement: 'The two parts add up to 90°',
  point: 'Angles around a point add up to 360°',
  triangle: 'Angles in a triangle add up to 180°',
};

const range5 = (lo, hi) => { const out = []; for (let v = lo; v <= hi; v += 5) out.push(v); return out; };

// level: optional { answer, options } to use instead of random ones (Angle Hunt's levels)
// Fisher-Yates, so the right answer isn't always on the same button
function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function makeQuestion(tYaw, type, r = Math.random, level = null) {
  const s = r() < 0.5 ? 1 : -1;   // turn direction from R to the target
  const answer = level ? level.answer : type === 'complement' ? pick([20, 25, 30, 35, 40, 50, 55, 60, 65, 70], r)
    : type === 'triangle' ? pick(range5(40, 110), r)
    : type === 'point' ? pick([...range5(40, 70), ...range5(110, 150)], r)
    : pick([25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155], r);
  const A = answer * DEG;
  const rYaw = tYaw - s * A;
  const q = { type, s, answer, tYaw, rYaw, unknown: { from: rYaw, sweep: s * A }, hint: HINTS[type] };
  if (type === 'opposite') {
    q.given = answer;
    q.known = { from: rYaw + Math.PI, sweep: s * A };
    q.prompt = `Find x  It is opposite the ${q.given}° angle`;
    q.hint2 = `x is opposite the ${q.given}° angle, and opposite angles are equal`;
    q.explain = `Opposite angles are equal: ${answer}°`;
  } else if (type === 'linear') {
    q.given = 180 - answer;
    q.known = { from: tYaw, sweep: s * (Math.PI - A) };
    q.prompt = `Find x  x and ${q.given}° make a straight line`;
    q.hint2 = `x = 180° − ${q.given}°`;
    q.explain = `${q.given}° + ${answer}° = 180°`;
  } else if (type === 'complement') {
    q.given = 90 - answer;
    q.pYaw = rYaw + s * Math.PI / 2;
    q.known = { from: tYaw, sweep: s * (Math.PI / 2 - A) };
    q.prompt = `Find x  With ${q.given}° it makes 90°`;
    q.hint2 = `x = 90° − ${q.given}°`;
    q.explain = `${q.given}° + ${answer}° = 90°`;
  } else if (type === 'point') {
    // going on round from T: angle b to a third ray X, then angle c back to R
    const rest = 360 - answer;
    const b = pick(range5(Math.max(60, rest - 175), Math.min(175, rest - 60)), r);
    const c = rest - b;
    q.given = b;
    q.given2 = c;
    q.pYaw = tYaw + s * b * DEG;                                   // the third ray, dotted
    q.known = { from: tYaw, sweep: s * b * DEG };
    q.known2 = { from: q.pYaw, sweep: s * c * DEG };
    q.prompt = `Find x  ${b}°, ${c}° and x go all the way round`;
    q.hint2 = `x = 360° − ${b}° − ${c}°`;
    q.explain = `${b}° + ${c}° + ${answer}° = 360°`;
  } else {
    // triangle: corners at the ship (angle x), P on the cannon line (b), Q on the enemy line (c);
    // keep it close to isosceles so it always reads clearly
    const rest = 180 - answer;
    let b, c, tries = 0;
    do {
      b = pick(range5(30, rest - 30), r);
      c = rest - b;
    } while (tries++ < 20 && (Math.sin(c * DEG) / Math.sin(b * DEG) > 1.35 || Math.sin(c * DEG) / Math.sin(b * DEG) < 0.74));
    q.given = b;
    q.given2 = c;
    q.tri = { b, c };
    q.known = { from: 0, sweep: 0 };                               // drawn at the other corners
    q.prompt = `Find x  The triangle's angles make 180°`;
    q.hint2 = `x = 180° − ${b}° − ${c}°`;
    q.explain = `${b}° + ${c}° + ${answer}° = 180°`;
  }
  q.options = level ? shuffle([...level.options], r) : makeOptions(answer, q.given, type, r, q.given2);
  return q;
}

// three wrong answers: the usual mistakes first, then near misses. Every wrong value is at
// least 20 degrees from the answer, so a wrong shot always visibly misses the target.
function makeOptions(answer, given, type, r, given2 = 0) {
  const wrong = [];
  const ok = (v) => v >= 5 && v <= 175 && Math.abs(v - answer) >= 20 && wrong.every((w) => Math.abs(w - v) >= 10);
  // every option is a multiple of 5, like the real answer, so no option gives itself away
  const add = (v) => { v = Math.round(v / 5) * 5; if (wrong.length < 3 && ok(v)) wrong.push(v); };
  const mistakes = type === 'opposite' ? [180 - answer, 90 - answer]
    : type === 'linear' ? [given, Math.abs(90 - given), 90 - answer]
    : type === 'complement' ? [given, 180 - answer, 90 + answer]
    : type === 'point' ? [Math.abs(180 - given - given2), 360 - given - given2 - 90, given]   // forgot it is 360, not 180
    : [given + given2, 180 - given, 180 - given2];                                         // triangle
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

