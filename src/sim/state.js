// sim/state.js — builds the initial world state and procedurally generates
// the political class (AI politicians) and the citizen cohort model.

import { RNG, uid } from '../engine.js';
import { STATES, PARTIES, TOTAL_HOR, TOTAL_SENATE, FIRST_NAMES, LAST_NAMES, partyById } from '../data.js';

const PUBLIC_TRAITS = ['Charismatic','Honest','Corrupt','Intelligent','Ambitious','Ruthless','Compassionate','Populist','Technocratic','Nationalist','Progressive','Conservative'];
const SKILLS = ['speaking','negotiation','economics','legal','media','foreign','crisis','leadership','campaigning','policy'];

function makeName(rng) {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

// Generate one AI politician with public traits, hidden traits and skills.
export function makePolitician(rng, partyId, stateCode, opts = {}) {
  const party = partyById(partyId);
  const skills = {};
  SKILLS.forEach((s) => (skills[s] = Math.round(rng.range(20, 80))));
  const traits = [];
  const pool = [...PUBLIC_TRAITS];
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) traits.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  return {
    id: uid('pol'),
    name: opts.name || makeName(rng),
    party: partyId,
    state: stateCode,
    age: opts.age ?? rng.int(32, 68),
    // ideology near party centre with personal deviation
    econ: clampv(party.econ + rng.normal(0, 0.12)),
    soc: clampv(party.soc + rng.normal(0, 0.12)),
    traits,
    skills,
    hidden: {
      ego: Math.round(rng.range(0, 100)),
      greed: Math.round(rng.range(0, 100)),
      loyalty: Math.round(rng.range(30, 100)),
      risk: Math.round(rng.range(0, 100)),
      temperament: Math.round(rng.range(0, 100)),
    },
    popularity: Math.round(rng.range(35, 70)),
    competence: Math.round((skills.policy + skills.leadership + skills.economics) / 3),
    scandalRisk: Math.round((rng.range(0, 40)) + (traits.includes('Corrupt') ? 30 : 0)),
    seat: opts.seat || null,        // {state} if holding a HoR seat
    chamber: opts.chamber || null,  // 'hor' | 'senate' | null
    rank: opts.rank || 'backbench',
    isPlayer: !!opts.isPlayer,
    alive: true,
  };
}
const clampv = (v) => Math.max(-1, Math.min(1, v));

// Citizen model: rather than literally 26M objects, we simulate weighted cohorts
// (age band × state × ideology). This scales to "millions of citizens"
// statistically while staying performant. Each cohort carries a population weight.
function buildCohorts(rng) {
  const cohorts = [];
  const ageBands = [[18, 29], [30, 44], [45, 59], [60, 79], [80, 95]];
  for (const st of STATES) {
    for (const band of ageBands) {
      // older cohorts skew slightly conservative; younger skew progressive
      const ageMid = (band[0] + band[1]) / 2;
      const ageTilt = (ageMid - 45) / 60; // -.45 .. +.83
      cohorts.push({
        state: st.code,
        ageMin: band[0], ageMax: band[1],
        // population weight (millions) spread across 5 bands
        weight: st.pop * bandShare(band),
        econ: clampv(st.lean * 0.5 + ageTilt * 0.4 + rng.normal(0, 0.15)),
        soc: clampv(st.lean * 0.4 + ageTilt * 0.55 + rng.normal(0, 0.15)),
        happiness: 55,
        trust: 50,
      });
    }
  }
  return cohorts;
}
function bandShare(band) {
  // rough share of population in each age band
  const shares = { '18,29': 0.20, '30,44': 0.26, '45,59': 0.23, '60,79': 0.23, '80,95': 0.08 };
  return shares[`${band[0]},${band[1]}`] ?? 0.2;
}

export function newGame({ seed, career, playerName, partyId } = {}) {
  const rng = new RNG(seed ?? Date.now());

  // --- Politicians: fill parliament proportional to party base support ---
  const politicians = [];
  // Allocate HoR seats per state by current support, simplest: base shares.
  for (const st of STATES) {
    for (let i = 0; i < st.hor; i++) {
      const pid = rng.weighted(PARTIES.map((p) => [p.id, p.base * seatBias(p.id, st.lean)]));
      politicians.push(makePolitician(rng, pid, st.code, { seat: { state: st.code }, chamber: 'hor' }));
    }
    const senseats = st.senate / 2; // half up each cycle; seed full complement
    for (let i = 0; i < st.senate; i++) {
      const pid = rng.weighted(PARTIES.map((p) => [p.id, p.base]));
      politicians.push(makePolitician(rng, pid, st.code, { chamber: 'senate' }));
    }
  }
  // A pool of unelected aspirants per party for future candidates.
  for (let i = 0; i < 120; i++) {
    const p = rng.pick(PARTIES);
    politicians.push(makePolitician(rng, p.id, rng.pick(STATES).code, { rank: 'candidate' }));
  }

  // --- Party support snapshot from politician counts ---
  const support = {};
  PARTIES.forEach((p) => (support[p.id] = p.base * 100));

  const cohorts = buildCohorts(rng);

  // --- Government formation from seeded HoR ---
  const gov = formGovernment(politicians);

  // --- Player character ---
  let player = null;
  if (career) {
    player = {
      careerId: career,
      name: playerName || makeName(rng),
      partyId: partyId || null,
      polId: null,         // links to a politician once elected
      rank: null,          // null until elected; then RANKS id
      influence: 5,
      money: 0.05,         // personal funds, A$ billions (i.e. $50M war chest scale—abstracted)
      reputation: 50,
      inGovernment: false,
    };
  }

  const state = {
    version: 1,
    seed: rng.seed,
    rng: rng.toJSON(),
    tick: 0,
    speed: 2,
    paused: false,

    metrics: {
      happiness: 55, institutions: 62, housing: 42, safety: 60, education: 58,
      environment: 50, entertainment: 56, freedom: 70, economy: 55, health: 64, transport: 52,
    },
    economy: {
      gdp: 2620,            // A$ billions
      growth: 2.1,          // % annual
      inflation: 3.2,       // %
      unemployment: 4.1,    // %
      cashRate: 4.35,       // %
      debt: 920,            // A$ billions net debt
      confidence: 55,       // consumer/business confidence 0-100
    },
    budget: {
      revenue: 720,         // A$ billions / yr
      // line-item spending (A$ billions / yr)
      spend: {
        health: 110, education: 48, welfare: 250, defence: 52, infrastructure: 28,
        science: 14, climate: 12, policing: 18, housing: 10,
      },
      tax: { income: 0.24, company: 0.30, gst: 0.10, capital: 0.50, carbon: 0.0, resource: 0.05 },
      lastBalance: 0,       // computed each year
    },

    support,                // party support %, sums ~100
    politicians,
    cohorts,
    gov,                    // { parties:[], pm: polId, majority: bool, seats:{} }

    bills: [],              // active/pending legislation
    laws: [],               // enacted laws (with ongoing effects)
    history: [],            // permanent archive of events
    nextElection: 36,       // tick of next federal election (3 years)
    events: [],             // active event queue awaiting player choice

    player,
    log: [],                // recent ticker messages
  };

  archive(state, `The simulation begins. ${gov.pm ? polName(state, gov.pm) : 'A caretaker government'} leads the nation.`);
  return state;
}

// Bias seat allocation: regional parties (Nationals) stronger where lean is rightward.
function seatBias(pid, lean) {
  if (pid === 'nat') return lean > 0.05 ? 2.2 : 0.3;
  if (pid === 'grn') return lean < 0 ? 1.4 : 0.6;
  if (pid === 'onp') return lean > 0.05 ? 1.5 : 0.5;
  return 1;
}

// Determine government from House of Representatives composition.
export function formGovernment(politicians) {
  const seatsByParty = {};
  politicians.filter((p) => p.chamber === 'hor').forEach((p) => {
    seatsByParty[p.party] = (seatsByParty[p.party] || 0) + 1;
  });
  // Coalition counts together.
  const coalition = (seatsByParty.lib || 0) + (seatsByParty.nat || 0);
  const labor = seatsByParty.alp || 0;
  const majority = Math.floor(TOTAL_HOR / 2) + 1;

  let parties, pmParty;
  if (coalition >= labor) { parties = ['lib', 'nat']; pmParty = 'lib'; }
  else { parties = ['alp']; pmParty = 'alp'; }

  const govSeats = parties.reduce((a, p) => a + (seatsByParty[p] || 0), 0);
  // pick the highest-popularity member of the governing party as PM
  const pmCandidates = politicians.filter((p) => p.party === pmParty && p.chamber === 'hor');
  pmCandidates.sort((a, b) => b.popularity + b.competence - a.popularity - a.competence);
  if (pmCandidates[0]) pmCandidates[0].rank = 'pm';

  return {
    parties,
    pm: pmCandidates[0]?.id || null,
    majority: govSeats >= majority,
    seats: seatsByParty,
    govSeats,
  };
}

export function polById(state, id) { return state.politicians.find((p) => p.id === id); }
export function polName(state, id) { return polById(state, id)?.name || 'Unknown'; }

// Append to permanent historical archive + recent ticker log.
export function archive(state, text, kind = 'event') {
  const entry = { tick: state.tick, year: 2026 + Math.floor(state.tick / 12), text, kind };
  state.history.push(entry);
  state.log.unshift(entry);
  if (state.log.length > 40) state.log.pop();
  return entry;
}
