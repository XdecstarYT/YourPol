// sim/achievements.js — the meta-game layer: dynamic objectives that guide the
// player, unlockable achievements, long-run trend recording for the charts, and
// a "legacy score" so each playthrough has a final verdict.

import { renewableShare } from './industry.js';
import { polById } from './state.js';

export const ACHIEVEMENTS = [
  { id: 'elected',    icon: '🎖️', name: 'Member of Parliament', desc: 'Win a seat in the House.', check: (s) => s.player?.elected },
  { id: 'minister',   icon: '🏛️', name: 'Cabinet Minister',     desc: 'Be appointed to Cabinet.', check: (s) => rank(s) >= 3 },
  { id: 'pm',         icon: '👑', name: 'The Lodge',            desc: 'Become Prime Minister.',   check: (s) => rank(s) >= 6 },
  { id: 'firstlaw',   icon: '⚖️', name: 'Lawmaker',             desc: 'Pass your first law.',     check: (s) => s.laws.length >= 1 },
  { id: 'reformer',   icon: '📜', name: 'Great Reformer',       desc: 'Have 10 laws in force.',   check: (s) => s.laws.length >= 10 },
  { id: 'surplus',    icon: '💰', name: 'Back in Black',        desc: 'Run a budget surplus.',    check: (s) => s.budget.lastBalance > 0 },
  { id: 'debtfree',   icon: '🏦', name: 'Debt Free',            desc: 'Eliminate net debt.',      check: (s) => s.economy.debt < 1 },
  { id: 'boom',       icon: '📈', name: 'Boom Times',           desc: 'Reach 4%+ growth.',        check: (s) => s.economy.growth >= 4 },
  { id: 'green',      icon: '🌿', name: 'Clean & Green',        desc: '80%+ renewable energy.',   check: (s) => renewableShare(s) >= 80 },
  { id: 'utopia',     icon: '✨', name: 'The Lucky Country',    desc: 'All metrics above 70.',    check: (s) => Object.values(s.metrics).every((v) => v > 70) },
  { id: 'diplomat',   icon: '🤝', name: 'Master Diplomat',      desc: 'Average relations above 70.', check: (s) => (s.world?.avgRelation ?? 0) > 70 },
  { id: 'republic',   icon: '🇦🇺', name: 'A New Republic',       desc: 'Pass the Republic referendum.', check: (s) => s.referendums.some((r) => r.refId === 'republic' && r.status === 'passed') },
  { id: 'dynasty',    icon: '👑', name: 'Founding a Dynasty',   desc: 'A child of yours enters politics.', check: (s) => dynastyStarted(s) },
  { id: 'longreign',  icon: '⏳', name: 'Statesman',            desc: 'Serve 5 years as PM.',     check: (s) => (s.stats?.monthsAsPM ?? 0) >= 60 },
  { id: 'survivor',   icon: '🛡️', name: 'Survivor',             desc: 'Govern through a major crisis.', check: (s) => (s.stats?.crisesHandled ?? 0) >= 1 },
];

function rank(s) {
  if (!s.player?.polId) return -1;
  const ranks = ['candidate','backbench','shadow','minister','treasurer','leader','pm'];
  const p = polById(s, s.player.polId);
  return p ? ranks.indexOf(p.rank) : -1;
}
function dynastyStarted(s) {
  if (!s.player?.polId) return false;
  const me = polById(s, s.player.polId);
  return me?.family?.children?.some((c) => c.path === 'politics') || s.politicians.some((p) => p.dynasty === me?.name);
}

// Called each tick: maintain counters, unlock achievements, refresh objectives.
export function tickMeta(state) {
  state.stats = state.stats || { monthsAsPM: 0, crisesHandled: 0 };
  state.achievements = state.achievements || [];
  if (rank(state) >= 6) state.stats.monthsAsPM++;

  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements.includes(a.id) && a.check(state)) {
      state.achievements.push(a.id); newly.push(a);
    }
  }
  recordTrend(state);
  state.objectives = computeObjectives(state);
  return newly;
}

// Rolling time-series for the charts (sampled monthly, capped).
export function recordTrend(state) {
  state.trends = state.trends || [];
  if (state.tick % 1 !== 0) return;
  state.trends.push({
    t: state.tick,
    approval: Math.round(approxApproval(state)),
    happiness: Math.round(state.metrics.happiness),
    growth: +state.economy.growth.toFixed(2),
    unemployment: +state.economy.unemployment.toFixed(2),
    debt: Math.round(state.economy.debt),
    gdp: Math.round(state.economy.gdp),
  });
  if (state.trends.length > 720) state.trends.shift(); // 60 years
}
function approxApproval(s) {
  const m = s.metrics, e = s.economy;
  return Math.max(0, Math.min(100, m.happiness * 0.5 + m.economy * 0.2 + m.institutions * 0.15
    - (e.inflation - 2.5) * 1.5 - (e.unemployment - 4.5) * 1.2));
}

// Context-aware objectives so the player always has a next goal.
function computeObjectives(state) {
  const objs = [];
  const pl = state.player;
  if (!pl) return objs;
  const r = rank(state);
  if (!pl.partyId) objs.push(obj('Join a political party', false));
  else if (!pl.elected) objs.push(obj('Win a seat at the next election', false));
  else {
    if (r < 3) objs.push(obj('Rise to Cabinet Minister', false));
    else if (r < 6) objs.push(obj('Become Prime Minister', false));
    else objs.push(obj('Serve 5 years as PM', (state.stats?.monthsAsPM ?? 0) >= 60));
  }
  objs.push(obj('Pass 10 reforms into law', state.laws.length >= 10, `${state.laws.length}/10`));
  objs.push(obj('Lift national happiness above 70', state.metrics.happiness > 70, `${Math.round(state.metrics.happiness)}/70`));
  objs.push(obj('Eliminate net debt', state.economy.debt < 1, `$${Math.round(state.economy.debt)}B`));
  return objs;
}
function obj(text, done, progress = '') { return { text, done, progress }; }

// A final verdict on the player's term(s) in power.
export function legacyScore(state) {
  const m = state.metrics;
  const avgMetric = Object.values(m).reduce((a, v) => a + v, 0) / Object.keys(m).length;
  const years = Math.floor(state.tick / 12);
  const score = Math.round(
    avgMetric * 40 +
    (state.stats?.monthsAsPM ?? 0) * 8 +
    state.laws.length * 25 +
    state.achievements.length * 60 +
    Math.max(0, 1000 - state.economy.debt) * 0.2 +
    (state.world?.avgRelation ?? 0) * 3
  );
  let grade = 'C';
  if (score > 6000) grade = 'S'; else if (score > 4500) grade = 'A';
  else if (score > 3000) grade = 'B';
  return { score, grade, years, avgMetric: Math.round(avgMetric) };
}
