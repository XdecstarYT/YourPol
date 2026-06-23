// sim/elections.js — the real election engine. Voter intention is computed from
// the citizen cohorts; every one of the 151 divisions is then contested with a
// full preferential count, producing winners, two-candidate-preferred margins,
// seat-by-seat swings, a national two-party-preferred and an electoral pendulum.

import { RNG, clamp, sum } from '../engine.js';
import { STATES, PARTIES, COALITION, TOTAL_HOR, partyById } from '../data.js';
import { makePolitician, formGovernment, archive, polName, seatStatus } from './state.js';
import { approval } from './economy.js';
import { ideologyAffinity, firstPreferences, preferentialCount, twoPartyPreferred } from './voting.js';

// --- National voting intention from the cohort model -----------------------
function cohortAffinity(party, cohort, state, incumbentParties) {
  let score = ideologyAffinity(party, cohort);
  if (incumbentParties.includes(party.id)) {
    const swing = (approval(state) - 50) / 100;        // incumbency reward/punishment
    score *= 1 + swing * 0.9;
  }
  if (cohort.happiness < 45 && party.base < 0.15) score *= 1.25; // protest vote to minors
  return Math.max(0.01, score);
}

export function computeSupport(state) {
  const inc = state.gov.parties;
  const tally = {};
  PARTIES.forEach((p) => (tally[p.id] = 0));
  for (const c of state.cohorts) {
    const scores = PARTIES.map((p) => [p.id, cohortAffinity(p, c, state, inc)]);
    const tot = sum(scores, ([, s]) => s);
    for (const [id, s] of scores) tally[id] += (s / tot) * c.weight;
  }
  const totalW = sum(Object.values(tally));
  const support = {};
  for (const id of Object.keys(tally)) support[id] = (tally[id] / totalW) * 100;
  state.support = support;
  // national 2PP from aggregate first preferences
  state.tpp = twoPartyPreferred(support).alp;
  return support;
}

// --- A full federal election ----------------------------------------------
export function runElection(state) {
  const rng = RNG.fromJSON(state.rng);
  computeSupport(state);

  // Keep only non-elected aspirants; sitting MPs must recontest.
  const survivors = state.politicians.filter((p) => !p.chamber);
  const newMembers = [];
  const seatResults = [];

  // House: contest every division.
  for (const e of state.electorates) {
    const st = STATES.find((s) => s.code === e.state);
    // local first preferences = seat ideology + national support + local swing
    const fp = firstPreferences(e, state.support, () => rng.range(1 - e.volatility, 1 + e.volatility));
    const res = preferentialCount(fp);
    const tpp = twoPartyPreferred(fp);
    const prevTppAlp = e.tppAlp ?? 50;
    const swing = tpp.alp - prevTppAlp;          // 2PP swing to Labor (+) / Coalition (-)
    const prevHeld = e.held;

    // create the winning member
    const mp = makePolitician(rng, res.winner, e.state, {
      seat: { id: e.name, state: e.state }, chamber: 'hor', rank: 'backbench',
    });
    newMembers.push(mp);

    // update the electorate record
    e.held = res.winner;
    e.tcp = res.two;
    e.margin = res.margin;
    e.tppAlp = tpp.alp;
    e.fp = fp;
    e.mpId = mp.id;

    seatResults.push({
      name: e.name, state: e.state, kind: e.kind,
      held: res.winner, prevHeld, gain: res.winner !== prevHeld,
      margin: res.margin, status: seatStatus(res.margin),
      swing, winnerName: mp.name, tcp: res.two, twoShares: res.twoShares, fp,
      // a notional "count speed": marginals & big seats report later
      reportOrder: rng.range(0, 1) + (res.margin < 4 ? 0.6 : 0),
    });
  }

  // Senate: proportional by state (full re-seat for simulation simplicity).
  for (const st of STATES) {
    const quota = 100 / (st.senate + 1);
    let remaining = st.senate;
    const tally = PARTIES.map((p) => ({ id: p.id, v: state.support[p.id] * rng.range(0.85, 1.15) }));
    tally.sort((a, b) => b.v - a.v);
    let idx = 0;
    while (remaining > 0 && idx < 200) {
      const cand = tally[idx % tally.length];
      if (cand.v >= quota * 0.5 || remaining > tally.length) {
        newMembers.push(makePolitician(rng, cand.id, st.code, { chamber: 'senate', rank: 'backbench' }));
        cand.v -= quota; remaining--;
      }
      idx++;
    }
  }

  state.politicians = [...survivors, ...newMembers];
  state.rng = rng.toJSON();
  reinstatePlayer(state);                 // uses its own rng pull

  state.gov = formGovernment(state.politicians);
  state.nextElection = state.tick + 36;

  const result = tallyResult(state);
  result.seatResults = seatResults;
  result.tpp = state.tpp;
  result.nationalSwing = avgSwing(seatResults);
  result.pendulum = buildPendulum(state);
  result.gains = seatResults.filter((s) => s.gain);

  const pm = state.gov.pm ? polName(state, state.gov.pm) : 'a hung parliament';
  archive(state,
    `🗳️ FEDERAL ELECTION: ${govLabel(state.gov)} ${state.gov.majority ? 'wins majority' : 'forms minority government'} ` +
    `(2PP ${result.tpp.toFixed(1)}% ALP). ${pm} to be PM. ${result.gains.length} seats change hands.`,
    'election');
  return result;
}

function avgSwing(seatResults) {
  return sum(seatResults, (s) => s.swing) / seatResults.length;
}

// The electoral pendulum: every seat sorted by margin, government seats on one
// side, opposition on the other — the classic Australian "who's next to fall".
export function buildPendulum(state) {
  const rows = state.electorates.map((e) => ({
    name: e.name, state: e.state, held: e.held, margin: e.margin, status: seatStatus(e.margin),
  }));
  const govParties = state.gov.parties;
  const govSide = rows.filter((r) => govParties.includes(r.held)).sort((a, b) => a.margin - b.margin);
  const oppSide = rows.filter((r) => !govParties.includes(r.held)).sort((a, b) => a.margin - b.margin);
  return { govSide, oppSide };
}

// Player contests their chosen division.
function reinstatePlayer(state) {
  const pl = state.player;
  if (!pl || !pl.partyId || !pl.running) return;
  const rng = RNG.fromJSON(state.rng);

  // pick the seat the player is contesting (their nominated seat, else home-state)
  let seat = state.electorates.find((e) => e.name === pl.electorate);
  if (!seat) seat = state.electorates.find((e) => e.state === (pl.homeState || 'NSW'));
  if (!seat) { state.rng = rng.toJSON(); return; }

  // base local support for the player's party + personal reputation boost +
  // incumbency if they already hold the seat
  const partyLocal = (state.support[pl.partyId] || 10);
  const personal = (pl.reputation - 50) * 0.6 + (pl.campaignedSeat === seat.name ? 8 : 0);
  const incumbent = pl.electorate === seat.name && pl.elected ? 6 : 0;
  const seatFavour = -Math.hypot(partyById(pl.partyId).econ - seat.econ, partyById(pl.partyId).soc - seat.soc) * 10;
  const winP = clamp(35 + (partyLocal - 30) + personal + incumbent + seatFavour, 5, 95) / 100;

  if (rng.chance(winP)) {
    // replace whoever the generic sim seated here with the player's member
    state.politicians = state.politicians.filter((p) => !(p.chamber === 'hor' && p.seat?.id === seat.name));
    const mp = makePolitician(rng, pl.partyId, seat.state, {
      name: pl.name, seat: { id: seat.name, state: seat.state }, chamber: 'hor',
      rank: pl.rank && pl.rank !== 'candidate' ? pl.rank : 'backbench', isPlayer: true,
    });
    state.politicians.push(mp);
    seat.held = pl.partyId; seat.mpId = mp.id;
    pl.polId = mp.id; pl.rank = mp.rank; pl.elected = true; pl.electorate = seat.name;
    archive(state, `🎉 ${pl.name} WINS ${seat.name} (${seat.state}) for ${partyById(pl.partyId).short}.`, 'player');
  } else {
    pl.elected = false; pl.polId = null;
    archive(state, `${pl.name} falls short in ${seat.name}. The campaign continues.`, 'player');
  }
  pl.running = false;
  state.rng = rng.toJSON();
}

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

// --- State & territory elections (lighter weight) --------------------------
export function tickStateElections(state) {
  for (const st of STATES) {
    const sg = state.stateGovs[st.code];
    if (!sg) continue;
    if (state.tick >= (sg._scheduled ?? sg.nextElection)) {
      runStateElection(state, st.code);
    }
  }
}

export function runStateElection(state, code) {
  const rng = RNG.fromJSON(state.rng);
  const st = STATES.find((s) => s.code === code);
  const sg = state.stateGovs[code];
  const seats = state.electorates.filter((e) => e.state === code);
  const tally = {};
  for (const e of seats) {
    const fp = firstPreferences(e, state.support, () => rng.range(0.85, 1.15));
    const w = preferentialCount(fp).winner;
    tally[w] = (tally[w] || 0) + 1;
  }
  const coalition = (tally.lib || 0) + (tally.nat || 0);
  const labor = tally.alp || 0;
  const newParty = coalition >= labor ? 'lib' : 'alp';
  const changed = newParty !== sg.party;
  sg.party = newParty;
  sg.seats = tally;
  sg.approval = Math.round(rng.range(42, 58));
  if (changed) sg.premier = pickName(rng);
  sg.nextElection = state.tick + 48;
  sg._scheduled = state.tick + 48;
  state.rng = rng.toJSON();
  archive(state,
    `🏛️ ${st.name} ELECTION: ${partyById(newParty).short} ${changed ? 'wins government' : 'returned'} under ${sg.title} ${sg.premier}.`,
    'election');
}
function pickName(rng) {
  const F = ['Sam','Chris','Pat','Jo','Alex','Lee','Morgan','Riley','Jordan','Casey'];
  const L = ['Bennett','Nguyen','Walker','Singh','Brown','Murphy','Chen','Kelly','Hughes','Ryan'];
  return `${rng.pick(F)} ${rng.pick(L)}`;
}
