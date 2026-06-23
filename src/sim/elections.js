// sim/elections.js — voter behaviour, preferential (instant-runoff) seat
// counting, Senate proportional allocation, and government formation.

import { RNG, clamp, sum } from '../engine.js';
import { STATES, PARTIES, COALITION, TOTAL_HOR, partyById } from '../data.js';
import { makePolitician, formGovernment, archive, polName } from './state.js';
import { approval } from './economy.js';

// How well a party matches a voter cohort: closeness in 2D ideology space,
// modulated by national mood (incumbents punished/rewarded by approval).
function affinity(party, cohort, state, incumbentParties) {
  const d = Math.hypot(party.econ - cohort.econ, party.soc - cohort.soc);
  let score = Math.max(0, 1.4 - d);            // 0..~1.4
  score *= party.base * 3 + 0.3;               // brand strength
  // incumbency effect from approval
  if (incumbentParties.includes(party.id)) {
    const swing = (approval(state) - 50) / 100; // -.5..+.5
    score *= 1 + swing * 0.9;
  }
  // cohort dissatisfaction pushes toward minor parties / protest votes
  if (cohort.happiness < 45 && party.base < 0.15) score *= 1.25;
  return Math.max(0.01, score);
}

// Compute national first-preference support % from the cohort model.
export function computeSupport(state) {
  const inc = state.gov.parties;
  const tally = {};
  PARTIES.forEach((p) => (tally[p.id] = 0));
  for (const c of state.cohorts) {
    const scores = PARTIES.map((p) => [p.id, affinity(p, c, state, inc)]);
    const tot = sum(scores, ([, s]) => s);
    for (const [id, s] of scores) tally[id] += (s / tot) * c.weight;
  }
  const totalW = sum(Object.values(tally));
  const support = {};
  for (const id of Object.keys(tally)) support[id] = (tally[id] / totalW) * 100;
  state.support = support;
  return support;
}

// Instant-runoff within a single seat given first-preference vote shares.
// Preferences flow by ideological proximity (the classic Labor↔Greens,
// Coalition↔One Nation flows fall out of the geometry naturally).
function preferentialWinner(rng, firstPrefs) {
  let live = { ...firstPrefs };
  const order = (id) => partyById(id);
  while (true) {
    const entries = Object.entries(live).filter(([, v]) => v > 0);
    const total = sum(entries, ([, v]) => v);
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length === 1 || entries[0][1] > total / 2) return entries[0][0];
    // eliminate lowest, distribute by nearest ideological neighbour
    const [loserId, loserVotes] = entries[entries.length - 1];
    const loser = order(loserId);
    delete live[loserId];
    const remaining = Object.keys(live);
    const dist = remaining.map((id) => {
      const p = order(id);
      return [id, 1 / (0.1 + Math.hypot(p.econ - loser.econ, p.soc - loser.soc))];
    });
    const dtot = sum(dist, ([, w]) => w);
    for (const [id, w] of dist) live[id] += loserVotes * (w / dtot);
  }
}

// Run a full federal election: 151 HoR seats by preferential vote,
// Senate by simplified proportional allocation, then form government.
export function runElection(state) {
  const rng = RNG.fromJSON(state.rng);
  computeSupport(state);

  // Remove current elected MPs (they must re-contest); keep candidate pool.
  const survivors = state.politicians.filter((p) => !p.chamber);
  const newMPs = [];
  const seatResults = [];

  for (const st of STATES) {
    // per-state base support tilts by state lean
    for (let i = 0; i < st.hor; i++) {
      const fp = {};
      for (const p of PARTIES) {
        const tilt = 1 + st.lean * (p.econ + p.soc) * 0.4;
        // per-seat random local factor
        fp[p.id] = Math.max(0, state.support[p.id] * tilt * rng.range(0.7, 1.3));
      }
      const winnerParty = preferentialWinner(rng, fp);
      const mp = makePolitician(rng, winnerParty, st.code, {
        seat: { state: st.code }, chamber: 'hor', rank: 'backbench',
      });
      newMPs.push(mp);
      seatResults.push({ state: st.code, party: winnerParty });
    }
    // Senate: proportional (half the state's seats up; we re-seat full for sim simplicity)
    const senateSeats = st.senate;
    const quota = 100 / (senateSeats + 1);
    let remaining = senateSeats;
    const senTally = PARTIES.map((p) => ({ id: p.id, v: state.support[p.id] * rng.range(0.85, 1.15) }));
    senTally.sort((a, b) => b.v - a.v);
    let idx = 0;
    while (remaining > 0) {
      const cand = senTally[idx % senTally.length];
      if (cand.v >= quota * 0.5 || remaining > senTally.length) {
        newMPs.push(makePolitician(rng, cand.id, st.code, { chamber: 'senate', rank: 'backbench' }));
        cand.v -= quota; remaining--;
      }
      idx++;
      if (idx > 200) break;
    }
  }

  // Carry the player's politician through if they held/contested a seat.
  state.politicians = [...survivors, ...newMPs];
  reinstatePlayer(state, rng);

  state.gov = formGovernment(state.politicians);
  state.rng = rng.toJSON();
  state.nextElection = state.tick + 36;

  const result = tallyResult(state);
  const pm = state.gov.pm ? polName(state, state.gov.pm) : 'a hung parliament';
  archive(state,
    `FEDERAL ELECTION: ${govLabel(state.gov)} ${state.gov.majority ? 'wins majority' : 'forms minority government'}. ${pm} to be Prime Minister.`,
    'election');
  return { ...result, seatResults };
}

// If the player ran, give them a seat based on their reputation vs swing.
function reinstatePlayer(state, rng) {
  const pl = state.player;
  if (!pl || !pl.partyId || !pl.running) return;
  // win chance scales with reputation, party support and incumbency
  const partySup = state.support[pl.partyId] || 10;
  const winP = clamp((pl.reputation - 40) + partySup, 5, 92) / 100;
  if (rng.chance(winP)) {
    const mp = makePolitician(rng, pl.partyId, pl.homeState || 'NSW', {
      name: pl.name, seat: { state: pl.homeState || 'NSW' }, chamber: 'hor',
      rank: pl.rank && pl.rank !== 'candidate' ? pl.rank : 'backbench', isPlayer: true,
    });
    state.politicians.push(mp);
    pl.polId = mp.id;
    pl.rank = mp.rank;
    pl.elected = true;
    archive(state, `${pl.name} WINS the seat of ${seatName(pl.homeState)} for ${partyById(pl.partyId).short}.`, 'player');
  } else {
    pl.elected = false;
    pl.polId = null;
    archive(state, `${pl.name} loses the contest for ${seatName(pl.homeState)}. The campaign continues.`, 'player');
  }
  pl.running = false;
}
function seatName(code) { return (STATES.find((s) => s.code === code)?.name || code) + ' (local seat)'; }

export function tallyResult(state) {
  const seats = {};
  PARTIES.forEach((p) => (seats[p.id] = { hor: 0, senate: 0 }));
  for (const p of state.politicians) {
    if (p.chamber === 'hor') seats[p.party].hor++;
    else if (p.chamber === 'senate') seats[p.party].senate++;
  }
  return { seats, support: state.support };
}

export function govLabel(gov) {
  if (gov.parties.length > 1) return 'The Coalition';
  return partyById(gov.parties[0])?.short || 'Government';
}
