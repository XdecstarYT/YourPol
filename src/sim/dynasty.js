// sim/dynasty.js — political dynasties. Prominent figures acquire families, and
// their children can follow them into politics (inheriting traits and a famous
// surname), the judiciary, media or business — dynasties that rise over decades.

import { RNG, clamp } from '../engine.js';
import { FIRST_NAMES, PARTIES, partyById } from '../data.js';
import { makePolitician } from './state.js';
import { archive } from './state.js';

const PATHS = ['politics', 'judiciary', 'media', 'business', 'private life'];

export function tickDynasty(state) {
  const rng = RNG.fromJSON(state.rng);

  // give prominent, family-less figures a family
  const prominent = state.politicians.filter((p) => p.chamber && !p.family &&
    (p.isPlayer || p.rank === 'pm' || p.rank === 'leader' || p.rank === 'minister' || p.popularity > 62));
  for (const p of prominent) {
    if (rng.chance(0.04)) {
      const kids = rng.int(0, 3);
      p.family = {
        spouse: rng.chance(0.8) ? fullName(rng, p) : null,
        children: Array.from({ length: kids }, () => ({
          name: childName(rng, p), age: rng.int(2, 30), path: 'undecided',
        })),
        founder: true,
      };
    }
  }

  // grown children may launch their own careers, continuing the dynasty
  for (const p of state.politicians) {
    if (!p.family?.children) continue;
    for (const child of p.family.children) {
      child.age += 1 / 12;
      if (child.path === 'undecided' && child.age >= 25 && rng.chance(0.01)) {
        child.path = rng.weighted(PATHS.map((x) => [x, x === 'politics' ? 2 : 1]));
        if (child.path === 'politics') {
          // enters as a candidate in the parent's party, inheriting some standing
          const heir = makePolitician(rng, p.party, p.state, { rank: 'candidate', name: child.name });
          heir.popularity = clamp(heir.popularity + 12);   // name recognition
          heir.dynasty = p.name;
          state.politicians.push(heir);
          archive(state, `👑 ${child.name}, child of ${p.name}, enters politics for ${partyById(p.party).short}.`, 'dynasty');
        } else {
          archive(state, `${child.name} (${p.name}'s child) pursues a career in ${child.path}.`, 'dynasty');
        }
      }
    }
  }

  state.rng = rng.toJSON();
}

function surnameOf(name) { return name.split(' ').slice(-1)[0]; }
function fullName(rng, p) { return `${rng.pick(FIRST_NAMES)} ${surnameOf(p.name)}`; }
function childName(rng, p) { return `${rng.pick(FIRST_NAMES)} ${surnameOf(p.name)}`; }

// Collect everyone in the same dynasty (shared surname + family links) for display.
export function dynastyMembers(state, pol) {
  const sur = surnameOf(pol.name);
  return state.politicians.filter((p) => surnameOf(p.name) === sur);
}
