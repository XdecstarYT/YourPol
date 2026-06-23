// sim/judiciary.js — the courts, culminating in the High Court of Australia.
// Enacted laws can be challenged on constitutional grounds; the seven Justices
// rule according to their interpretive philosophy, and can strike laws down.

import { RNG, uid, clamp } from '../engine.js';
import { archive } from './state.js';
import { POLICY_CATALOGUE } from './legislation.js';

const JUSTICE_NAMES = ['Whitfield','Marchetti','Nguyen','Okafor','Brennan','Castillo','Adeyemi','Tan','Forsythe','Kirby','Mason','Gaudron'];

// Some policies carry more constitutional risk (s.51 powers, rights, etc.).
const CONSTITUTIONAL_RISK = {
  carbon_price: 0.25, integrity: 0.15, law_order: 0.35, public_housing: 0.2,
  welfare_raise: 0.1, renewables: 0.15, defence_up: 0.05,
};

export function initJudiciary(rng) {
  const justices = [];
  for (let i = 0; i < 7; i++) {
    justices.push({
      id: uid('jus'), name: `Justice ${rng.pick(JUSTICE_NAMES)}`,
      age: rng.int(52, 68),
      // interpretation: -1 literalist/conservative .. +1 progressive/expansive
      interpretation: rng.range(-0.7, 0.7),
      appointedBy: 'historic',
    });
  }
  justices[0].chief = true;
  return { justices, cases: [], strikes: 0 };
}

export function tickJudiciary(state) {
  const rng = RNG.fromJSON(state.rng);
  const c = state.courts;

  // justices age and retire at 70 (constitutional limit), creating vacancies
  for (const j of c.justices) j.age += 1 / 12;
  const retiring = c.justices.filter((j) => j.age >= 70);
  for (const j of retiring) {
    archive(state, `⚖️ ${j.name} retires from the High Court at 70.`, 'court');
    // government of the day appoints a replacement leaning toward its philosophy
    const govSoc = (state.gov.parties.includes('alp')) ? -0.4 : 0.4;
    const repl = {
      id: uid('jus'), name: `Justice ${rng.pick(JUSTICE_NAMES)}`, age: rng.int(50, 60),
      interpretation: clamp(govSoc + rng.range(-0.3, 0.3), -1, 1),
      appointedBy: state.gov.parties[0], chief: j.chief,
    };
    c.justices = c.justices.map((x) => (x.id === j.id ? repl : x));
    archive(state, `⚖️ ${repl.name} appointed to the High Court.`, 'court');
  }

  // a recently enacted law may be challenged
  if (rng.chance(0.06) && state.laws.length) {
    const law = rng.pick(state.laws);
    const risk = CONSTITUTIONAL_RISK[law.policyId] ?? 0.08;
    if (rng.chance(risk + 0.1) && !c.cases.some((cs) => cs.lawId === law.id && cs.status === 'pending')) {
      c.cases.push({
        id: uid('case'), lawId: law.id, title: `Challenge to ${law.title}`,
        filed: state.tick, hearAt: state.tick + rng.int(2, 5), status: 'pending', risk,
      });
      archive(state, `⚖️ A constitutional challenge is filed against ${law.title}.`, 'court');
    }
  }

  // hear pending cases that have reached their date
  for (const cs of c.cases) {
    if (cs.status !== 'pending' || state.tick < cs.hearAt) continue;
    hearCase(state, cs, rng);
  }

  state.rng = rng.toJSON();
}

function hearCase(state, cs, rng) {
  const c = state.courts;
  const law = state.laws.find((l) => l.id === cs.lawId);
  const pol = law ? POLICY_CATALOGUE.find((p) => p.id === law.policyId) : null;
  // each justice votes to strike based on the law's "expansiveness" vs their lean
  const lawExpansive = pol ? clamp((pol.soc < 0 ? 0.3 : -0.1) + cs.risk, -1, 1) : 0;
  let strike = 0;
  for (const j of c.justices) {
    // a literalist justice (interpretation < 0) more likely to strike an expansive law
    const p = clamp(0.5 + (lawExpansive) * (-j.interpretation) * 1.2 + cs.risk * 0.5 + rng.range(-0.2, 0.2), 0.05, 0.95);
    if (rng.chance(p)) strike++;
  }
  cs.status = strike >= 4 ? 'struck' : 'upheld';
  cs.vote = `${strike}–${7 - strike}`;
  cs.decided = state.tick;
  if (cs.status === 'struck' && law) {
    // strike down: remove the law and reverse part of its effect
    if (pol) for (const [k, v] of Object.entries(pol.impact || {})) {
      if (k in state.metrics) state.metrics[k] = clamp(state.metrics[k] - v * 0.6);
    }
    state.laws = state.laws.filter((l) => l.id !== law.id);
    c.strikes++;
    state.metrics.institutions = clamp(state.metrics.institutions + 2); // rule of law upheld
    archive(state, `⚖️ HIGH COURT (${cs.vote}): ${law.title} is INVALID and struck down.`, 'court');
  } else if (law) {
    archive(state, `⚖️ HIGH COURT (${cs.vote}): ${law.title} is upheld as constitutional.`, 'court');
  }
}

export function courtBalance(state) {
  const js = state.courts.justices;
  const avg = js.reduce((a, j) => a + j.interpretation, 0) / js.length;
  return avg; // -ve literalist, +ve progressive
}
