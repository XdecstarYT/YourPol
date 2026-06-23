// sim/career.js — the player's journey from ordinary citizen to Prime Minister.
// Actions cost influence/time and shift reputation; promotion is gated by the
// player's standing within their party and the parliament.

import { RNG, clamp } from '../engine.js';
import { RANKS, partyById } from '../data.js';
import { polById, archive } from './state.js';

export function currentRankIndex(state) {
  const pl = state.player;
  if (!pl || !pl.rank) return -1;
  return RANKS.findIndex((r) => r.id === pl.rank);
}

// Available player actions depend on current standing. Each returns
// {id, label, desc, enabled, run(state)}.
export function availableActions(state) {
  const pl = state.player;
  if (!pl) return [];
  const acts = [];
  const pol = pl.polId ? polById(state, pl.polId) : null;
  const inParty = !!pl.partyId;

  if (!inParty) {
    acts.push(act('join_party', 'Join a Party', 'Pledge to a political party to begin a parliamentary career.', true));
  }
  if (inParty && !pl.elected) {
    acts.push(act('campaign', 'Campaign Locally', 'Door-knock and build a profile (+reputation).', pl.influence >= 1));
    acts.push(act('fundraise', 'Fundraise', 'Hold events to build a war chest.', true));
    acts.push(act('run', 'Stand for Election', 'Nominate as a candidate at the next federal election.',
      !pl.running, pl.running ? 'Already nominated.' : ''));
  }
  if (pol) {
    acts.push(act('media', 'Media Appearance', 'Raise your profile on TV and online (+reputation, scandal risk).', pl.influence >= 1));
    acts.push(act('network', 'Work the Numbers', 'Build support among colleagues toward promotion.', pl.influence >= 1));
    const ri = currentRankIndex(state);
    if (ri >= 0 && ri < RANKS.length - 1) {
      acts.push(act('promote', `Push for Promotion → ${RANKS[ri + 1].name}`,
        'Seek the next rung. Success depends on your standing.', pl.influence >= 2));
    }
    if (pol.rank === 'leader' || pol.rank === 'pm') {
      acts.push(act('spill', 'Settle the Leadership', 'Consolidate your grip on the party.', pl.influence >= 2));
    }
  }
  return acts;
}
function act(id, label, desc, enabled, note = '') { return { id, label, desc, enabled, note }; }

// Execute a player action. Returns a short result message.
export function runAction(state, actionId, payload = {}) {
  const pl = state.player;
  const rng = RNG.fromJSON(state.rng);
  let msg = '';
  const pol = pl.polId ? polById(state, pl.polId) : null;

  switch (actionId) {
    case 'join_party':
      pl.partyId = payload.partyId;
      pl.rank = 'candidate';
      pl.homeState = payload.homeState || 'NSW';
      msg = `You join ${partyById(pl.partyId).name}.`;
      break;

    case 'campaign':
      pl.influence -= 1;
      pl.reputation = clamp(pl.reputation + rng.range(2, 6));
      msg = `You campaign hard. Reputation now ${Math.round(pl.reputation)}.`;
      break;

    case 'fundraise':
      pl.money += rng.range(0.005, 0.02);
      msg = `Fundraiser banked. War chest growing.`;
      break;

    case 'run':
      pl.running = true;
      msg = `You are nominated to contest the next federal election.`;
      break;

    case 'media':
      pl.influence -= 1;
      if (rng.chance(0.85)) {
        pl.reputation = clamp(pl.reputation + rng.range(3, 8));
        if (pol) pol.popularity = clamp(pol.popularity + rng.range(2, 6));
        msg = `A strong media performance lifts your profile.`;
      } else {
        pl.reputation = clamp(pl.reputation - rng.range(4, 10));
        if (pol) pol.scandalRisk = clamp(pol.scandalRisk + 10);
        msg = `A gaffe goes viral. Reputation takes a hit.`;
      }
      break;

    case 'network':
      pl.influence -= 1;
      pl.numbers = clamp((pl.numbers || 30) + rng.range(4, 10), 0, 100);
      msg = `You shore up support. Internal numbers now ${Math.round(pl.numbers)}.`;
      break;

    case 'promote': {
      const ri = currentRankIndex(state);
      if (ri < 0 || ri >= RANKS.length - 1) { msg = 'You are already at the top of the ladder.'; break; }
      pl.influence -= 2;
      const standing = (pl.reputation + (pol?.popularity || 50) + (pl.numbers || 30)) / 3;
      // higher rungs are harder; PM requires governing-party leadership
      const next = RANKS[ri + 1];
      let need = 45 + ri * 6;
      if (next.id === 'pm' && !state.gov.parties.includes(pl.partyId)) {
        msg = `You can only become PM if your party wins government.`;
        break;
      }
      if (next.id === 'pm') need = 55; // leader of governing party → PM
      if (standing + rng.range(-8, 8) >= need) {
        promote(state, next.id);
        msg = `Promotion secured: you are now ${next.name}.`;
      } else {
        pl.reputation = clamp(pl.reputation - 3);
        msg = `The push for ${next.name} falls short. Build more support.`;
      }
      break;
    }

    case 'spill': {
      pl.influence -= 2;
      const standing = (pl.reputation + (pol?.popularity || 50) + (pl.numbers || 40)) / 3;
      if (standing > 50) { pl.numbers = 80; msg = `You crush the challengers. Your leadership is secure.`; }
      else { pl.reputation = clamp(pl.reputation - 8); msg = `The spill backfires and weakens you.`; }
      break;
    }
    default: msg = 'Nothing happens.';
  }

  state.rng = rng.toJSON();
  if (msg) archive(state, `👤 ${msg}`, 'player');
  return msg;
}

function promote(state, rankId) {
  const pl = state.player;
  pl.rank = rankId;
  const pol = polById(state, pl.polId);
  if (pol) {
    pol.rank = rankId;
    // demote previous holder of unique offices
    if (rankId === 'pm') {
      state.politicians.forEach((p) => { if (p.id !== pol.id && p.rank === 'pm') p.rank = 'backbench'; });
      state.gov.pm = pol.id;
      pl.inGovernment = true;
    }
  }
}

// Monthly passive career progression: restore influence, drift reputation.
export function tickCareer(state) {
  const pl = state.player;
  if (!pl) return;
  pl.influence = Math.min(10, pl.influence + 1);
  const pol = pl.polId ? polById(state, pl.polId) : null;
  if (pol) {
    // a governing player's reputation tracks national approval somewhat
    pl.reputation = clamp(pl.reputation + (pol.popularity - pl.reputation) * 0.02);
  }
}
