// sim/referendum.js — national referendums, decided by the constitutional
// "double majority": a national majority of voters AND a majority of states (4/6).

import { RNG, uid, clamp } from '../engine.js';
import { STATES, partyById } from '../data.js';
import { archive } from './state.js';

export const REFERENDUM_CATALOGUE = [
  { id: 'republic',  title: 'An Australian Republic',
    desc: 'Replace the monarch with an Australian head of state.',
    baseYes: 45, econ: -0.1, soc: -0.4, onPass: { institutions: +4, freedom: +3 } },
  { id: 'voice',     title: 'Constitutional Recognition & Voice',
    desc: 'Recognise First Peoples with an advisory Voice to Parliament.',
    baseYes: 43, econ: -0.2, soc: -0.5, onPass: { institutions: +3, happiness: +2 } },
  { id: 'fouryear',  title: 'Four-Year Parliamentary Terms',
    desc: 'Extend federal terms from three to four years.',
    baseYes: 48, econ: 0.0, soc: 0.1, onPass: { institutions: +3 } },
  { id: 'localgov',  title: 'Recognition of Local Government',
    desc: 'Recognise local councils in the Constitution.',
    baseYes: 50, econ: 0.0, soc: -0.1, onPass: { institutions: +2, transport: +1 } },
  { id: 'rights',    title: 'A Constitutional Bill of Rights',
    desc: 'Entrench fundamental rights and freedoms.',
    baseYes: 47, econ: -0.1, soc: -0.4, onPass: { freedom: +6, institutions: +2 } },
];

export function proposeReferendum(state, refId) {
  const tpl = REFERENDUM_CATALOGUE.find((r) => r.id === refId);
  if (!tpl) return null;
  if (state.referendums.some((r) => r.refId === refId && r.status === 'pending')) return null;
  const ref = {
    id: uid('ref'), refId, title: tpl.title, desc: tpl.desc,
    status: 'pending', proposed: state.tick, voteAt: state.tick + 6, // campaign period
  };
  state.referendums.push(ref);
  archive(state, `📜 REFERENDUM called: "${tpl.title}". A national vote will be held in 6 months.`, 'referendum');
  return ref;
}

// Each tick, hold any referendum whose vote date has arrived.
export function tickReferendums(state) {
  for (const ref of state.referendums) {
    if (ref.status === 'pending' && state.tick >= ref.voteAt) holdReferendum(state, ref);
  }
}

function holdReferendum(state, ref) {
  const tpl = REFERENDUM_CATALOGUE.find((r) => r.id === ref.refId);
  const rng = RNG.fromJSON(state.rng);

  // National + per-state Yes vote from cohort ideology proximity to the proposal,
  // plus the historical "fear of change" drag and government endorsement effect.
  const stateYes = {};
  let natYesW = 0, natW = 0;
  for (const st of STATES) {
    const cohorts = state.cohorts.filter((c) => c.state === st.code);
    let yes = 0, w = 0;
    for (const c of cohorts) {
      const align = 1 - Math.hypot(c.econ - tpl.econ, c.soc - tpl.soc) / 2; // 0..1
      const p = clamp(tpl.baseYes + (align - 0.5) * 60, 5, 95);
      yes += p * c.weight; w += c.weight;
    }
    const statePct = yes / w + rng.range(-3, 3);
    stateYes[st.code] = clamp(statePct);
    // territories don't count toward the states majority, but do count nationally
    natYesW += statePct * w; natW += w;
  }
  const nationalYes = clamp(natYesW / natW);
  const statesCarried = STATES.filter((s) => s.code !== 'ACT' && s.code !== 'NT')
    .filter((s) => stateYes[s.code] > 50).length;

  const carried = nationalYes > 50 && statesCarried >= 4;   // double majority
  ref.status = carried ? 'passed' : 'failed';
  ref.nationalYes = nationalYes;
  ref.stateYes = stateYes;
  ref.statesCarried = statesCarried;
  ref.decidedAt = state.tick;

  if (carried) {
    for (const [k, v] of Object.entries(tpl.onPass || {})) {
      if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] + v);
    }
  }
  state.rng = rng.toJSON();
  archive(state,
    `📜 REFERENDUM RESULT — "${ref.title}": ${carried ? 'CARRIED ✅' : 'DEFEATED ❌'} ` +
    `(${nationalYes.toFixed(1)}% Yes, ${statesCarried}/6 states).`,
    'referendum');
}
