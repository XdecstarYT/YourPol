// sim/world.js — a lightweight simulation of the wider world: foreign nations
// with their own economies and leaders, Australia's diplomatic relations and
// trade, plus the defence and intelligence postures that flow from them.

import { RNG, clamp, sum } from '../engine.js';
import { archive } from './state.js';

const NATION_DEFS = [
  { id: 'usa', name: 'United States',  flag: '🇺🇸', gdp: 27000, gov: 'Republic',     stance: 'ally',    rel: 75 },
  { id: 'chn', name: 'China',          flag: '🇨🇳', gdp: 18000, gov: 'One-party',    stance: 'rival',   rel: 5 },
  { id: 'jpn', name: 'Japan',          flag: '🇯🇵', gdp: 4200,  gov: 'Parliamentary',stance: 'ally',    rel: 70 },
  { id: 'gbr', name: 'United Kingdom', flag: '🇬🇧', gdp: 3300,  gov: 'Parliamentary',stance: 'ally',    rel: 78 },
  { id: 'ind', name: 'India',          flag: '🇮🇳', gdp: 3900,  gov: 'Republic',     stance: 'partner', rel: 55 },
  { id: 'idn', name: 'Indonesia',      flag: '🇮🇩', gdp: 1400,  gov: 'Republic',     stance: 'partner', rel: 50 },
  { id: 'nzl', name: 'New Zealand',    flag: '🇳🇿', gdp: 250,   gov: 'Parliamentary',stance: 'ally',    rel: 90 },
  { id: 'kor', name: 'South Korea',    flag: '🇰🇷', gdp: 1800,  gov: 'Republic',     stance: 'partner', rel: 62 },
  { id: 'fra', name: 'France',         flag: '🇫🇷', gdp: 3100,  gov: 'Republic',     stance: 'partner', rel: 48 },
  { id: 'rus', name: 'Russia',         flag: '🇷🇺', gdp: 2200,  gov: 'Authoritarian',stance: 'rival',   rel: -20 },
];

const LEADER_FIRST = ['President','Prime Minister','Chancellor','Premier','Chairman'];

export function initWorld(rng) {
  const nations = NATION_DEFS.map((d) => ({
    ...d, relation: d.rel, leader: `${rng.pick(LEADER_FIRST)} ${surname(rng)}`,
    growth: rng.range(-1, 6), trade: Math.round(d.gdp * rng.range(0.005, 0.02)),
    sanctioned: false, treaty: d.stance === 'ally',
  }));
  return {
    nations,
    avgRelation: 0,
    defence: { army: 60, navy: 64, airforce: 66, cyber: 48, intelligence: 55, readiness: 70 },
    intel: { threat: 28, foreignInterference: 30, cyberThreat: 35, terror: 22 },
  };
}
function surname(rng) {
  const s = ['Müller','Tanaka','Smith','Chen','Singh','Petrov','Dubois','Kim','Silva','Haddad','Okafor','Novak'];
  return rng.pick(s);
}

export function tickWorld(state) {
  const w = state.world;
  const rng = RNG.fromJSON(state.rng);
  const b = state.budget;

  for (const n of w.nations) {
    // foreign economies drift
    n.growth += (rng.range(-1, 6) - n.growth) * 0.1;
    n.gdp *= 1 + n.growth / 100 / 12;
    // relations drift toward a baseline by stance, perturbed by events
    let target = n.stance === 'ally' ? 80 : n.stance === 'rival' ? 0 : 55;
    if (n.sanctioned) target -= 40;
    if (n.treaty) target += 10;
    n.relation += (target - n.relation) * 0.02 + rng.range(-1.5, 1.5);
    n.relation = clamp(n.relation, -100, 100);
    // trade scales with relation and our economy
    n.trade = Math.round(n.gdp * (0.004 + (n.relation + 100) / 200 * 0.02));
  }
  w.avgRelation = sum(w.nations, (n) => n.relation) / w.nations.length;

  // trade contributes to Australian growth (export demand)
  const tradeBn = sum(w.nations, (n) => n.trade) / 1000;
  state._tradeImpulse = clamp((w.avgRelation) * 0.01, -1, 1);
  state.economy.growth += state._tradeImpulse * 0.01;

  // --- Defence posture from budget ---------------------------------------
  const d = w.defence;
  const fund = (b.spend.defence - 52) * 0.08;
  d.readiness = clamp(d.readiness + fund * 0.4 + 0.05);
  d.cyber = clamp(d.cyber + fund * 0.3);
  for (const k of ['army', 'navy', 'airforce']) d[k] = clamp(d[k] + fund * 0.2 - 0.02);

  // --- Intelligence threats ----------------------------------------------
  const intel = w.intel;
  const chinaRel = w.nations.find((n) => n.id === 'chn').relation;
  const rusRel = w.nations.find((n) => n.id === 'rus').relation;
  intel.foreignInterference = clamp(40 - (chinaRel + rusRel) / 4 - d.cyber * 0.1 + rng.range(-2, 2));
  intel.cyberThreat = clamp(50 - d.cyber * 0.3 + rng.range(-3, 3));
  intel.terror = clamp(intel.terror + rng.range(-2, 2.2) - state.metrics.safety * 0.005);
  intel.threat = clamp((intel.foreignInterference + intel.cyberThreat + intel.terror) / 3);

  // a strong intelligence posture protects safety; aggressive surveillance costs freedom
  if (d.intelligence > 70) state.metrics.freedom = clamp(state.metrics.freedom - 0.02);

  // occasional diplomatic event
  if (rng.chance(0.04)) diplomaticEvent(state, rng);

  state.rng = rng.toJSON();
}

function diplomaticEvent(state, rng) {
  const w = state.world;
  const n = rng.pick(w.nations);
  const roll = rng.next();
  if (roll < 0.4 && n.stance === 'rival') {
    n.relation = clamp(n.relation - rng.range(4, 12));
    archive(state, `🌏 Tensions rise with ${n.name}; relations cool.`, 'foreign');
  } else if (roll < 0.7) {
    n.relation = clamp(n.relation + rng.range(3, 9));
    archive(state, `🤝 A diplomatic breakthrough warms ties with ${n.name}.`, 'foreign');
  } else {
    archive(state, `📈 ${n.name} signs a new trade arrangement with Australia.`, 'foreign');
    n.trade = Math.round(n.trade * 1.1);
  }
}

// --- player/government foreign actions ------------------------------------
export function foreignAction(state, nationId, action) {
  const n = state.world.nations.find((x) => x.id === nationId);
  if (!n) return;
  if (action === 'treaty') { n.treaty = true; n.relation = clamp(n.relation + 8); archive(state, `🤝 Australia signs a treaty with ${n.name}.`, 'foreign'); }
  else if (action === 'trade') { n.trade = Math.round(n.trade * 1.15); n.relation = clamp(n.relation + 5); archive(state, `📈 New trade deal with ${n.name}.`, 'foreign'); }
  else if (action === 'sanction') { n.sanctioned = true; n.relation = clamp(n.relation - 20); state.metrics.institutions = clamp(state.metrics.institutions + 1); archive(state, `🚫 Australia sanctions ${n.name}.`, 'foreign'); }
  else if (action === 'aid') { n.relation = clamp(n.relation + 10); state.economy.debt += 1; archive(state, `💝 Foreign aid extended to ${n.name}.`, 'foreign'); }
}
