// sim/index.js — orchestrates one monthly tick across all subsystems and
// re-exports the simulation API consumed by the UI.

import { tickEconomy, tickMetrics } from './economy.js';
import { computeSupport, runElection, tickStateElections } from './elections.js';
import { aiLegislate } from './legislation.js';
import { tickEvents } from './events.js';
import { tickCareer as careerTick } from './career.js';
import { updateCohorts } from './cohorts.js';
import { tickReferendums } from './referendum.js';
import { tickIndustry } from './industry.js';
import { tickWorld } from './world.js';
import { tickSociety } from './society.js';
import { tickJudiciary } from './judiciary.js';
import { tickDynasty } from './dynasty.js';
import { tickMeta } from './achievements.js';

export * from './state.js';
export * from './economy.js';
export * from './elections.js';
export * from './legislation.js';
export * from './events.js';
export * from './career.js';
export * from './cohorts.js';
export * from './referendum.js';
export * from './voting.js';
export * from './industry.js';
export * from './world.js';
export * from './society.js';
export * from './judiciary.js';
export * from './dynasty.js';
export * from './achievements.js';

// Advance the world by one month. Returns events that need player attention.
export function tick(state) {
  state.tick++;

  tickEconomy(state);
  tickIndustry(state);      // sectors & energy grid feed back into the economy
  tickMetrics(state);
  updateCohorts(state);     // citizen happiness/trust + ageing
  tickWorld(state);         // foreign nations, defence, intelligence
  tickSociety(state);       // media, social media, lobbying, civil unrest
  tickEvents(state);
  aiLegislate(state);
  tickJudiciary(state);     // constitutional challenges in the High Court
  careerTick(state);
  tickDynasty(state);       // political families rise over time
  tickReferendums(state);
  tickStateElections(state);

  // Recompute live party support every quarter (cheap enough monthly too).
  if (state.tick % 3 === 0) computeSupport(state);

  // Meta layer: objectives, achievements, trend recording.
  const unlocked = tickMeta(state);

  // Federal election when due.
  if (state.tick >= state.nextElection) {
    const result = runElection(state);
    state._transient = state._transient || {};
    state._transient.lastElection = result;
    return { election: result, achievements: unlocked };
  }
  return { achievements: unlocked };
}
