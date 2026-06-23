// sim/society.js — media organisations, social-media dynamics, lobby groups
// and civil unrest. These shape the narrative around the government, pressure
// politicians, and turn discontent into strikes, protests and riots.

import { RNG, clamp, sum } from '../engine.js';
import { partyById } from '../data.js';
import { archive, polById } from './state.js';
import { approval } from './economy.js';

const MEDIA_DEFS = [
  { id: 'natpost', name: 'The National Post',     type: 'Newspaper', lean:  0.5, reach: 28 },
  { id: 'herald',  name: 'Morning Herald',        type: 'Newspaper', lean: -0.2, reach: 24 },
  { id: 'tv9',     name: 'Channel Nine News',     type: 'Television',lean:  0.1, reach: 40 },
  { id: 'abc',     name: 'National Broadcaster',   type: 'Television',lean: -0.3, reach: 35 },
  { id: 'skyaus',  name: 'Sky After Dark',         type: 'Cable',     lean:  0.7, reach: 16 },
  { id: 'guardau', name: 'The Guardian',          type: 'Online',    lean: -0.55,reach: 20 },
  { id: 'podcast', name: 'The Daily Pod',          type: 'Podcast',   lean: -0.1, reach: 14 },
];

const LOBBY_DEFS = [
  { id: 'mining',  name: 'Minerals Council',         icon: '⛏️', wants: { resource: -1, carbon: -1 } },
  { id: 'banks',   name: 'Banking Association',      icon: '🏦', wants: { company: -1 } },
  { id: 'defence', name: 'Defence Contractors',      icon: '🛡️', wants: { defence: +1 } },
  { id: 'green',   name: 'Conservation Foundation',  icon: '🌿', wants: { carbon: +1, climate: +1 } },
  { id: 'unions',  name: 'Council of Unions',        icon: '✊', wants: { welfare: +1, income: +1 } },
  { id: 'church',  name: 'Faith Alliance',          icon: '⛪', wants: {} },
  { id: 'tech',    name: 'Tech Industry Group',      icon: '💻', wants: { science: +1, company: -1 } },
];

export function initSociety(rng) {
  return {
    media: MEDIA_DEFS.map((d) => ({ ...d, credibility: Math.round(rng.range(45, 80)), narrative: 0 })),
    social: { followers: 0, sentiment: 0, virality: 30, disinfo: 25, movements: [] },
    lobby: LOBBY_DEFS.map((d) => ({ ...d, influence: Math.round(rng.range(40, 75)), favour: 50 })),
    unrest: 18,
  };
}

export function tickSociety(state) {
  const rng = RNG.fromJSON(state.rng);
  const s = state.society;
  const appr = approval(state);
  const govLean = partyById(state.gov.parties[0])?.econ ?? 0;

  // --- media narrative: each outlet judges the government through its bias ---
  let mediaPressure = 0, reachTot = 0;
  for (const o of s.media) {
    // outlets aligned with the government go easier on it
    const alignment = -Math.abs(o.lean - govLean);          // 0 best, negative worse
    const judged = (appr - 50) * 0.4 + alignment * 12 + rng.range(-4, 4);
    o.narrative += (judged - o.narrative) * 0.2;
    o.credibility = clamp(o.credibility + (o.lean === 0 ? 0.1 : -0.01));
    mediaPressure += o.narrative * o.reach; reachTot += o.reach;
  }
  const netNarrative = mediaPressure / reachTot;             // -ve = hostile coverage

  // --- social media ---
  s.social.followers = Math.round(state.economy.gdp * 9000 / 1000); // grows with connectivity
  s.social.sentiment += ((appr - 50) + netNarrative * 0.5 - s.social.sentiment) * 0.15;
  s.social.virality = clamp(s.social.virality + rng.range(-3, 3));
  s.social.disinfo = clamp(s.social.disinfo + (state.world?.intel.foreignInterference - 30) * 0.02 + rng.range(-1, 1));

  // narrative + social sentiment nudge institutions/approval-facing happiness
  state.metrics.institutions = clamp(state.metrics.institutions + netNarrative * 0.004);

  // --- lobby groups press their agenda ---
  for (const g of s.lobby) {
    g.favour = clamp(g.favour + rng.range(-2, 2));
    // measure how well current policy matches their wishes
    let satisfied = 0, n = 0;
    for (const [k, dir] of Object.entries(g.wants)) {
      const cur = state.budget.tax[k] ?? (state.budget.spend[k] !== undefined ? state.budget.spend[k] / 100 : 0.3);
      satisfied += dir > 0 ? cur : (1 - cur); n++;
    }
    g.favour = clamp(g.favour + (n ? (satisfied / n - 0.5) * 4 : 0));
  }
  // occasional lobby push
  if (rng.chance(0.05)) {
    const g = rng.weighted(s.lobby.map((x) => [x, x.influence]));
    archive(state, `${g.icon} ${g.name} launches a campaign to influence government policy.`, 'lobby');
  }

  // --- civil unrest ---
  const m = state.metrics;
  const grievance = (60 - m.happiness) * 0.5 + (60 - m.freedom) * 0.2 + (state.economy.unemployment - 4.5) * 2
    + (60 - m.housing) * 0.15 - netNarrative * 0.1;
  s.unrest = clamp(s.unrest + (grievance * 0.4 - s.unrest) * 0.06);

  if (s.unrest > 55 && rng.chance(0.08)) unrestEvent(state, rng, s.unrest);

  state.rng = rng.toJSON();
}

function unrestEvent(state, rng, level) {
  const kind = level > 78 ? 'Riots' : level > 65 ? 'Mass protests' : 'Strikes';
  const hit = level / 20;
  state.metrics.safety = clamp(state.metrics.safety - hit);
  state.metrics.economy = clamp(state.metrics.economy - hit * 0.6);
  state.metrics.happiness = clamp(state.metrics.happiness - hit * 0.4);
  archive(state, `🪧 ${kind} break out across major cities amid public anger.`, 'unrest');
}

export function mediaMood(state) {
  const s = state.society;
  return sum(s.media, (o) => o.narrative * o.reach) / sum(s.media, (o) => o.reach);
}
