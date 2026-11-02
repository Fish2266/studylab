/* mascot.js — Flurry, the study snowman.
 *
 * Flurry reacts to how a study session is going. Right answers refreeze him
 * and put a grin (then sunglasses, then a party hat) on his face; wrong ones
 * melt him a little more each time, until — after enough misses in a row — he
 * is a puddle with a hat floating in it, holding a tiny "help" sign.
 *
 * Design rules, so he stays charming rather than annoying:
 *   - He only shows up where something just happened (a verdict, a round or
 *     test summary, an end screen, an empty state). Never a popup, never a
 *     blocker, never on top of the question.
 *   - Small (about the height of two lines of text) and always beside the
 *     real feedback, never instead of it.
 *   - Decorative: aria-hidden, so screen readers hear the verdict, not jokes.
 *   - One switch in Settings turns him off; reduced motion stills him.
 *
 * Everything is drawn in SVG from numbers, so the melt is continuous rather
 * than a handful of stickers. No user text ever goes into the markup.
 */
import { el, append } from './utils.js';
import * as data from './data.js';

export const NAME = 'Flurry';
export const MAX_MELT = 9;

export const isEnabled = () => data.getSettings().mascot !== false;

/* ---------------- quips ---------------- */

const WRONG = [
  /* 1 */ ['Oops! Shake it off.', 'Not quite — but now you’ve seen it.', 'A miss is just a rep in disguise.', 'Close-ish. Next one!'],
  /* 2 */ ['Is it getting warm in here?', 'I’m fine. Totally fine. *drip*', 'Two misses. I felt that one in my buttons.', 'Hm. Slightly damp, but still believing in you.'],
  /* 3 */ ['I’m starting to drip.', 'My carrot is wilting.', 'Say the answer out loud once — it sticks better. Also I’m melting.', 'Someone open a window. A cold one.'],
  /* 4 */ ['I can’t feel my buttons.', 'This is the part of the movie where it rains.', 'Could somebody turn down the sun?', 'I just want you to know I’m being very brave.'],
  /* 5 */ ['Tell my snowballs I loved them.', 'I’m writing my will. The carrot goes to the rabbit.', 'I now have a small personal rain cloud.', 'Not to be dramatic, but this is the worst day of my life.'],
  /* 6 */ ['I’m 40% puddle.', 'My hat is the only part of me with dignity left.', 'Please. I’ve a family. Of snowflakes.', 'I’ve started melting in places I didn’t know I had.'],
  /* 7 */ ['I’ve become soup.', '*sad gurgling puddle noises*', 'I’m one with the floor now.', 'Don’t step in me. I’m grieving.'],
  /* 8+ */ ['{n} in a row. I’ve started a support group.', 'Even my hat is crying.', 'I’ve seen things. Warm things.', 'This puddle has feelings and they are all bad.',
    'My ancestors were glaciers. GLACIERS.', 'I’m not crying, you’re crying. (I’m crying.)', 'Please get one right. Do it for the puddle.',
    'I was a snowman once. Young. Round. Full of hope.', 'A small fish has moved into me.', 'Miss #{n}. The puddle remains.'],
];
// Every few misses on a bad run, something actually useful slips in.
const TIPS = [
  'Real talk: flip through these in Flashcards first, then come back.',
  'Tip from a melting friend: read the answer, cover it, say it back.',
  'Starring the tricky ones lets you study just those later.',
  'Short rounds beat long ones. Take a breather if you need it.',
];
const RIGHT = [
  /* 1 */ ['Nice!', 'Yes! That’s the one.', 'Brrrilliant.', 'Snow problem.', 'Correct-a-mundo.'],
  /* 2 */ ['Two in a row!', 'Ice work!', 'You’re on a roll. A snowball roll.', 'Chill. Very chill.'],
  /* 3-4 */ ['Three in a row — I’m chilling.', 'Look at you go!', 'I’d high-five you but: twigs.', 'My carrot is pointing UP.'],
  /* 5-7 */ ['Too cool. Literally.', 'Sunglasses on. You earned them.', 'Is it me or are you a genius?', 'This is my favourite study session ever.'],
  /* 8+ */ ['{n} in a row! I’m frozen solid with pride.', 'Are you a blizzard? Because you’re on a roll.', 'Teach me your ways.',
    'Somebody stop them. Actually, don’t.', '{n}! I’m throwing myself a party.'],
];
const RECOVER = ['Refreezing! Keep going!', 'Ahh — a cold front of knowledge.', 'I can feel my buttons again!', 'Oh thank goodness. More of that please.', 'I’m un-melting! Is that a word? It’s now.'];
const SKIP = ['Honest answer! That’s how learning starts.', 'Have a good look — it will come back around.', 'No shame. Even snowmen forget things.'];
const OVERRIDE = ['Oh phew. Refreezing.', 'Your words, your rules.', 'I KNEW you knew it.'];
const POKE = ['Hi!', 'That tickles.', 'Don’t touch the carrot.', 'Yes? I’m studying too, you know.', 'Boop.'];
const POKE_LOTS = ['Okay, now you’re procrastinating.', 'The questions are over there. ➡', 'I’m going to lie down now.'];

/** Pick from a list without repeating the last pick from that list. */
const lastPick = new Map();
function pick(list, n = 0) {
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && lastPick.get(list) === i) i = (i + 1) % list.length;
  lastPick.set(list, i);
  return list[i].replace('{n}', String(n));
}

/* ---------------- mood: one per study session ---------------- */

/**
 * A study session's Flurry. `react()` takes 'right' | 'wrong' | 'skip' |
 * 'override' and returns { face, melt, quip } to draw.
 */
export function createMood() {
  const s = { melt: 0, wrongRun: 0, rightRun: 0, wrongs: 0 };
  return {
    get state() { return { ...s }; },
    react(kind) {
      let face, quip;
      if (kind === 'right' || kind === 'override') {
        const wasMelted = s.melt >= 3;
        s.rightRun++; s.wrongRun = 0;
        s.melt = Math.max(0, s.melt - (s.rightRun >= 3 ? 2 : 1));
        face = s.rightRun >= 8 ? 'party' : s.rightRun >= 5 ? 'cool' : s.rightRun >= 3 ? 'grin' : 'happy';
        if (kind === 'override') quip = pick(OVERRIDE);
        else if (wasMelted && s.rightRun === 1) quip = pick(RECOVER);
        else quip = pick(RIGHT[s.rightRun >= 8 ? 4 : s.rightRun >= 5 ? 3 : s.rightRun >= 3 ? 2 : s.rightRun - 1], s.rightRun);
      } else if (kind === 'skip') {
        s.rightRun = 0;
        face = s.melt >= 3 ? 'worried' : 'think';
        quip = pick(SKIP);
      } else {
        s.wrongRun++; s.rightRun = 0; s.wrongs++;
        s.melt = Math.min(MAX_MELT, s.melt + 1);
        const r = s.wrongRun;
        face = r >= 7 ? 'puddle' : r >= 5 ? 'sob' : r >= 3 ? 'cry' : r === 2 ? 'sad' : 'worried';
        quip = (r === 4 || (r >= 9 && r % 5 === 4)) ? pick(TIPS) : pick(WRONG[Math.min(r, 8) - 1], r);
      }
      return { face, melt: s.melt, quip };
    },
  };
}

/** Mood for a finished round or test, from its score. */
export function moodForScore(pct) {
  if (pct >= 95) return { face: 'party', melt: 0, quip: pick(['Flawless! I’m making snow angels.', 'Perfect! I may never melt again.', 'Snow way. That was perfect!']) };
  if (pct >= 80) return { face: 'grin', melt: 0, quip: pick(['Brrrilliant round!', 'That was ice cold. In a good way.', 'Look at that score! My buttons are bursting.']) };
  if (pct >= 60) return { face: 'happy', melt: 1, quip: pick(['Solid! A few to tidy up.', 'Good stuff. A couple more reps and you have it.', 'Nice work — the misses are where the learning is.']) };
  if (pct >= 40) return { face: 'worried', melt: 3, quip: pick(['Getting there. I’m only a little damp.', 'Halfway! Let’s go again while it’s fresh.', 'Not bad, not great. A light drizzle.']) };
  if (pct >= 20) return { face: 'cry', melt: 5, quip: pick(['I’m going to need a minute. And a freezer.', 'Rough one. Try Flashcards, then come back for revenge.', 'My carrot has seen better days.']) };
  return { face: 'puddle', melt: 8, quip: pick(['I’m a puddle. But a supportive puddle. Go again?', 'I’ve melted completely. Worth it if you try again.', 'Everything hurts. Study the misses and save me.']) };
}

/* ---------------- drawing ---------------- */

const HAPPY = new Set(['happy', 'grin', 'cool', 'party', 'wave', 'proud']);
const SAD = new Set(['worried', 'sad', 'cry', 'sob', 'puddle']);
const INK = '#26232f';
const CARROT = '#f2862e';
const WATER = 'var(--snow-water)';

/** Is this state drawn as a puddle? */
const isPuddle = (face, m) => face === 'puddle' || m >= 7;

/**
 * The visible area for a state, cropped to what is actually drawn, so a plain
 * snowman is not shrunk to make room for a rain cloud he does not have, and a
 * puddle is not a thin strip at the bottom of a tall empty box.
 */
export function frame(face, m) {
  const bottom = isPuddle(face, m) ? 127 : 132;
  let top;
  if (isPuddle(face, m)) {
    const happy = HAPPY.has(face);
    top = m >= 8 && !happy ? 48 : 76;                          // room for the cloud (and the help sign under it)
  } else if (face === 'party') {
    top = -16;
  } else if (face === 'sob' || (SAD.has(face) && m >= 5)) {
    const sy = 1 - m * 0.065;
    top = Math.min(-8, Math.round(124 * (1 - sy)) - 31);       // the cloud sinks with him
  } else {
    top = -8;
  }
  return { top, height: bottom - top, width: 120 };
}

/**
 * The snowman element.
 * `size` is his HEIGHT in px — so a melted Flurry spreads sideways into a
 * proper puddle instead of shrinking — capped so he is never wider than
 * `maxWidth`.
 * @param {{face?:string, melt?:number, size?:number, maxWidth?:number, title?:string, wave?:boolean}} o
 */
export function snowman({ face = 'happy', melt = 0, size = 72, maxWidth = Infinity, title = '', wave = false } = {}) {
  const m = Math.max(0, Math.min(MAX_MELT, Math.round(melt)));
  const f = frame(face, m);
  let h = size, w = size * f.width / f.height;
  if (w > maxWidth) { w = maxWidth; h = w * f.height / f.width; }
  const node = el('span', {
    class: `snowman snowman--${face}${wave ? ' is-waving' : ''}${isPuddle(face, m) ? ' is-puddle' : ''}`, 'aria-hidden': 'true',
    style: { width: Math.round(w) + 'px', height: Math.round(h) + 'px' }, title: title || null,
  });
  node.innerHTML = svg(face, m, f);        // static markup built from numbers only
  return node;
}

function svg(face, m, f) {
  const body = isPuddle(face, m) ? puddle(face, m) : standing(face, m);
  return `<svg viewBox="0 ${f.top} ${f.width} ${f.height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Sizes per place, by height. Phones get a little less. */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
export const SIZES = {
  verdict: () => ({ size: narrow() ? 74 : 86, maxWidth: narrow() ? 120 : 150 }),
  summary: () => ({ size: narrow() ? 92 : 104, maxWidth: 170 }),
  hero: (big = false) => ({ size: big ? (narrow() ? 124 : 140) : (narrow() ? 100 : 112), maxWidth: 200 }),
  mini: () => ({ size: 36, maxWidth: 64 }),
  badge: () => ({ size: narrow() ? 54 : 60, maxWidth: 96 }),
};

function standing(face, m) {
  const happy = HAPPY.has(face), sad = SAD.has(face);
  const sx = 1 + m * 0.045, sy = 1 - m * 0.065;
  const armY = happy ? 42 : sad ? 86 : 68;
  const tilt = sad ? -(5 + m * 2.5) : happy ? 5 : 0;
  const droop = m * 1.3 + (sad ? 3 : 0);
  const puddleRx = 16 + m * 6;

  const parts = [];
  parts.push(`<ellipse cx="60" cy="122" rx="${puddleRx}" ry="${3 + m * 0.7}" fill="${WATER}"/>`);
  if (m >= 2) parts.push(`<circle class="sm-drop" cx="${36 + m}" cy="118" r="1.6" fill="${WATER}"/><circle class="sm-drop sm-drop--2" cx="${84 - m}" cy="119" r="1.3" fill="${WATER}"/>`);

  // cloud for the truly dramatic
  if (face === 'sob' || (sad && m >= 5)) {
    const drop = ((122 + 2) * (1 - sy)).toFixed(1);            // the hat sinks as he melts; so does his cloud
    parts.push(`<g transform="translate(0 ${drop})"><g class="sm-cloud"><g fill="var(--snow-cloud)"><ellipse cx="60" cy="-12" rx="22" ry="7"/><circle cx="49" cy="-15" r="7"/><circle cx="62" cy="-19" r="9"/><circle cx="72" cy="-14" r="6"/></g>` +
      `<g stroke="${WATER}" stroke-width="1.6" stroke-linecap="round"><path class="sm-rain" d="M48 -3v5"/><path class="sm-rain sm-rain--2" d="M57 -2v5"/><path class="sm-rain" d="M66 -3v5"/><path class="sm-rain sm-rain--2" d="M74 -2v5"/></g></g></g>`);
  }
  // sparkles for the very pleased
  if (face === 'party' || face === 'cool') {
    parts.push(`<g fill="#ffd34d">${star(16, 22, 5)}${star(104, 34, 4)}${star(98, 6, 3.4)}${face === 'party' ? star(22, 70, 3.4) + star(100, 78, 4) : ''}</g>`);
  }
  if (face === 'party') {
    parts.push(`<g class="sm-confetti"><rect x="10" y="44" width="3" height="5" fill="#ff6b8b" transform="rotate(20 11 46)"/><rect x="104" y="56" width="3" height="5" fill="#3fd6a0" transform="rotate(-25 105 58)"/><rect x="30" y="-6" width="3" height="5" fill="#56b8ff" transform="rotate(40 31 -4)"/><rect x="90" y="-10" width="3" height="5" fill="#ff6b8b"/></g>`);
  }

  // everything that melts
  parts.push(`<g transform="translate(60 122) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-60 -122)">`);
  // arms (behind the body)
  parts.push(`<g stroke="#7a5638" stroke-width="2.6" stroke-linecap="round" fill="none">` +
    `<path d="M45 64 L20 ${armY} M26 ${armY + (armY < 64 ? 3 : -3)} l-5 ${armY < 64 ? -4 : 4}"/>` +
    `<g class="sm-arm-r"><path d="M75 64 L100 ${armY} M94 ${armY + (armY < 64 ? 3 : -3)} l5 ${armY < 64 ? -4 : 4}"/></g></g>`);
  // snow
  parts.push(`<g fill="var(--snow-fill)" stroke="var(--snow-line)" stroke-width="1.6">` +
    `<circle cx="60" cy="98" r="24"/><circle cx="60" cy="64" r="18"/><circle cx="60" cy="33" r="17"/></g>`);
  // a little shading so he reads on white
  parts.push(`<g fill="var(--snow-shade)"><path d="M43 106 a24 24 0 0 0 34 8 a26 26 0 0 1 -34 -8z"/><path d="M47 72 a18 18 0 0 0 26 4 a20 20 0 0 1 -26 -4z"/></g>`);
  // buttons
  parts.push(`<g fill="${INK}"><circle cx="60" cy="58" r="1.9"/><circle cx="60" cy="66" r="1.9"/><circle cx="60" cy="74" r="1.9"/><circle cx="60" cy="92" r="2.1"/><circle cx="60" cy="102" r="2.1"/></g>`);
  // scarf
  parts.push(`<g fill="var(--snow-scarf)"><path d="M44.5 47.5 q15.5 6 31 0 l0.5 5 q-16 6.5 -32 0z"/><path d="M66 52 l4.5 15 l-6 1.4 l-3.4 -15z"/></g>`);
  // face, drawn at 1.3× so it still reads when Flurry is 50px tall
  parts.push(`<g transform="translate(60 33) scale(1.3) translate(-60 -33)">${face_(face, m, droop)}</g>`);
  // hat
  if (face === 'party') {
    parts.push(`<g transform="translate(0 -3) rotate(8 60 20)"><path d="M48 21 L61 -6 L72 21 z" fill="var(--snow-scarf)"/><path d="M52 13 l15 0 M55 6 l9 0" stroke="#fff" stroke-width="2" opacity=".7"/><circle cx="61" cy="-6" r="3.4" fill="#ffd34d"/></g>`);
  } else {
    parts.push(`<g transform="translate(0 -4) rotate(${tilt} 60 20)"><rect x="44" y="18" width="32" height="3.6" rx="1.6" fill="${INK}"/><rect x="48.5" y="1" width="23" height="18" rx="2" fill="${INK}"/><rect x="48.5" y="12.5" width="23" height="3.6" fill="var(--snow-scarf)"/></g>`);
  }
  parts.push(`</g>`);
  return parts.join('');
}

function face_(face, m, droop) {
  const out = [];
  const stroke = `stroke="${INK}" stroke-width="1.7" stroke-linecap="round" fill="none"`;
  // eyes
  if (face === 'cool') {
    out.push(`<g fill="${INK}"><rect x="49.5" y="27" width="9.5" height="6.5" rx="2.4"/><rect x="61" y="27" width="9.5" height="6.5" rx="2.4"/></g><path d="M59 29.5 h2" ${stroke}/><path d="M51.5 28.6 l2.6 0" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".8"/>`);
  } else if (face === 'grin' || face === 'party') {
    out.push(`<path d="M52.5 32 q2.5 -3.4 5 0 M62.5 32 q2.5 -3.4 5 0" ${stroke}/>`);
  } else if (face === 'think') {
    out.push(`<g fill="${INK}"><circle cx="56" cy="29.5" r="1.9"/><circle cx="66" cy="29.5" r="1.9"/></g><path d="M62.5 25.5 l6 -1" ${stroke}/>`);
  } else {
    out.push(`<g fill="${INK}"><circle cx="55" cy="31" r="2"/><circle cx="65" cy="31" r="2"/></g>`);
  }
  // brows
  if (SAD.has(face)) out.push(`<path d="M51 27.4 L57 25.4 M63 25.4 L69 27.4" ${stroke}/>`);
  if (face === 'nervous') out.push(`<path d="M51 26.5 L57 26 M63 25 L69 26.8" ${stroke}/>`);
  // nose
  out.push(`<path d="M60 35 L${(74 - m * 0.6).toFixed(1)} ${(37 + droop).toFixed(1)} L60 38.6 z" fill="${CARROT}"/>`);
  // mouth
  const mouth = {
    happy: `<path d="M54 40.5 q6 5 12 0" ${stroke}/>`,
    wave: `<path d="M54 40.5 q6 5 12 0" ${stroke}/>`,
    proud: `<path d="M54 40.5 q6 5 12 0" ${stroke}/>`,
    grin: `<path d="M53.5 39.6 q6.5 8 13 0 z" fill="#3a2230"/>`,
    party: `<path d="M53.5 39.6 q6.5 8 13 0 z" fill="#3a2230"/>`,
    cool: `<path d="M54 40.5 q6 4.6 12 -0.5" ${stroke}/>`,
    think: `<path d="M56 42 h7" ${stroke}/>`,
    worried: `<path d="M55 43 q5 -2.6 10 0" ${stroke}/>`,
    sad: `<path d="M54 44 q6 -5.4 12 0" ${stroke}/>`,
    cry: `<path d="M54 44.5 q2 -3 4 0 q2 -3 4 0 q2 -3 4 0" ${stroke}/>`,
    sob: `<path d="M54.5 41 q5.5 -5 11 0 q-5.5 4.6 -11 0z" fill="#3a2230"/>`,
    nervous: `<path d="M54 42 l2 -1.6 l2 1.6 l2 -1.6 l2 1.6 l2 -1.6 l2 1.6" ${stroke}/>`,
  }[face] || `<path d="M55 41.5 h10" ${stroke}/>`;
  out.push(mouth);
  // cheeks
  if (HAPPY.has(face)) out.push(`<g fill="#ff8fa3" opacity=".45"><circle cx="50.5" cy="37" r="2.6"/><circle cx="69.5" cy="37" r="2.6"/></g>`);
  // water works
  if (face === 'worried' || face === 'nervous') out.push(`<path class="sm-sweat" d="M76 21 q-2.6 4.4 0 6 q2.6 -1.6 0 -6z" fill="${WATER}"/>`);
  if (face === 'cry') out.push(`<g fill="${WATER}"><path class="sm-tear" d="M54 34 q-1.8 3.4 0 4.6 q1.8 -1.2 0 -4.6z"/><path class="sm-tear sm-tear--2" d="M66 34 q-1.8 3.4 0 4.6 q1.8 -1.2 0 -4.6z"/></g>`);
  if (face === 'sob') {
    // tears that arc out like garden sprinklers. Dignity: gone.
    out.push(`<g stroke="${WATER}" stroke-width="2.2" stroke-linecap="round" fill="none"><path class="sm-fountain" d="M54 33 q-16 -8 -26 16"/><path class="sm-fountain sm-fountain--2" d="M66 33 q16 -8 26 16"/></g>`);
  }
  return out.join('');
}

function puddle(face, m) {
  const happy = HAPPY.has(face);
  const stroke = `stroke="${INK}" stroke-width="1.6" stroke-linecap="round" fill="none"`;
  const p = [];
  if (m >= 8 && !happy) {
    p.push(`<g transform="translate(0 12)"><g class="sm-cloud"><g fill="var(--snow-cloud)"><ellipse cx="60" cy="58" rx="22" ry="7"/><circle cx="49" cy="55" r="7"/><circle cx="62" cy="51" r="9"/><circle cx="72" cy="56" r="6"/></g>` +
      `<g stroke="${WATER}" stroke-width="1.6" stroke-linecap="round"><path class="sm-rain" d="M48 67v6"/><path class="sm-rain sm-rain--2" d="M58 68v6"/><path class="sm-rain" d="M68 67v6"/></g></g></g>`);
  }
  p.push(`<ellipse cx="60" cy="112" rx="54" ry="12" fill="${WATER}"/>`);
  p.push(`<path d="M24 110 q8 -9 18 -6 q8 -7 18 -3 q10 -6 18 1 q10 -2 14 7 q-36 9 -68 1z" fill="var(--snow-fill)" stroke="var(--snow-line)" stroke-width="1.4"/>`);
  // floating debris: buttons, carrot, twigs
  p.push(`<g fill="${INK}"><circle cx="34" cy="115" r="1.7"/><circle cx="84" cy="117" r="1.7"/><circle cx="44" cy="119" r="1.5"/></g>`);
  p.push(`<path d="M76 113 l13 -3 l-12 5z" fill="${CARROT}"/>`);
  p.push(`<path d="M8 113 l14 2 M14 113 l-3 -3 M98 115 l14 -2 M106 114 l3 -3" stroke="#7a5638" stroke-width="2.2" stroke-linecap="round"/>`);
  // the face, now horizontal
  p.push(`<g fill="${INK}"><circle cx="52.5" cy="105.5" r="2.4"/><circle cx="64.5" cy="105.5" r="2.4"/></g>`);
  if (happy) p.push(`<path d="M55 109.5 q3.5 3 7 0" ${stroke}/>`);
  else p.push(`<path d="M50 102.5 l5 -1.4 M62 101.1 l5 1.4" ${stroke}/><path d="M55 111 q1.7 -2 3.4 0 q1.7 -2 3.4 0" ${stroke}/>`);
  // the hat, floating with what remains of its pride
  p.push(`<g transform="rotate(-14 30 100)"><rect x="16" y="99" width="26" height="3" rx="1.4" fill="${INK}"/><rect x="20" y="85" width="18" height="15" rx="2" fill="${INK}"/><rect x="20" y="94" width="18" height="3" fill="var(--snow-scarf)"/></g>`);
  p.push(`<g fill="none" stroke="var(--snow-line)" stroke-width="1"><circle class="sm-bubble" cx="72" cy="104" r="1.6"/><circle class="sm-bubble sm-bubble--2" cx="46" cy="104" r="1.2"/></g>`);
  // past the point of no return: a tiny sign
  if (m >= 9 && !happy) {
    p.push(`<g class="sm-sign"><path d="M93 108 V82" stroke="#7a5638" stroke-width="2" stroke-linecap="round"/><rect x="81" y="72" width="26" height="12" rx="2" fill="#fff8e1" stroke="#7a5638" stroke-width="1.2"/>` +
      `<text x="94" y="81" text-anchor="middle" font-size="8" font-family="system-ui, sans-serif" font-weight="700" fill="${INK}">help</text></g>`);
  }
  return p.join('');
}

function star(cx, cy, r) {
  const s = r * 0.32;
  return `<path class="sm-spark" d="M${cx} ${cy - r} L${cx + s} ${cy - s} L${cx + r} ${cy} L${cx + s} ${cy + s} L${cx} ${cy + r} L${cx - s} ${cy + s} L${cx - r} ${cy} L${cx - s} ${cy - s}z"/>`;
}

/* ---------------- placements ---------------- */

/**
 * Flurry plus a one-line remark, for the bottom of a verdict or a summary.
 * Returns null when he is switched off (el()/setChildren skip nulls).
 * Tapping him gets a poke response; tap him a lot and he lies down.
 */
export function buddy({ face, melt = 0, quip = '', place = 'verdict', wave = false, className = '' } = {}) {
  if (!isEnabled()) return null;
  const dims = SIZES[place] ? SIZES[place]() : SIZES.verdict();
  const say = el('span', { class: 'buddy__say' }, quip);
  let fig = snowman({ face, melt, wave, ...dims });
  let pokes = 0;
  const wrap = el('div', { class: `buddy${className ? ' ' + className : ''}`, 'aria-hidden': 'true' });
  const poke = () => {
    pokes++;
    const lots = pokes >= 5;
    say.textContent = lots ? POKE_LOTS[Math.min(POKE_LOTS.length - 1, Math.floor((pokes - 5) / 2))] : pick(POKE);
    const next = snowman({ face: lots ? 'nervous' : 'happy', melt, ...dims });
    if (pokes >= 9) next.classList.add('is-toppled');
    else next.classList.add('is-poked');
    fig.replaceWith(next);
    fig = next;
    fig.addEventListener('click', poke);
  };
  fig.addEventListener('click', poke);
  append(wrap, [fig, quip ? say : null]);
  return wrap;
}

/** A bigger Flurry for summaries and empty states (no bubble, caption under). */
export function hero({ face, melt = 0, quip = '', big = false, wave = false } = {}) {
  if (!isEnabled()) return null;
  return el('div', { class: 'buddy-hero', 'aria-hidden': 'true' },
    snowman({ face, melt, wave, ...SIZES.hero(big) }),
    quip ? el('p', { class: 'buddy-hero__say' }, quip) : null);
}
