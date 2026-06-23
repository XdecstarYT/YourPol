// sim/index.js — orchestrates one monthly tick across all subsystems and
// re-exports the simulation API consumed by the UI.

import { tickEconomy, tickMetrics } from './economy.js';
import { computeSupport, runElection, tickStateElections } from './elections.js';
import { aiLegislate } from './legislation.js';
import { tickEvents } from './events.js';
import { tickCareer as careerTick } from './career.js';
import { updateCohorts } from './cohorts.js';
import { tickReferendums } from './referendum.js';

export * from './state.js';
export * from './economy.js';
export * from './elections.js';
export * from './legislation.js';
export * from './events.js';
export * from './career.js';
export * from './cohorts.js';
export * from './referendum.js';
export * from './voting.js';

// Advance the world by one month. Returns events that need player attention.
export function tick(state) {
  state.tick++;

  tickEconomy(state);
  tickMetrics(state);
  updateCohorts(state);     // citizen happiness/trust + ageing
  tickEvents(state);
  aiLegislate(state);
  careerTick(state);
  tickReferendums(state);
  tickStateElections(state);

  // Recompute live party support every quarter (cheap enough monthly too).
  if (state.tick % 3 === 0) computeSupport(state);

  // Federal election when due.
  if (state.tick >= state.nextElection) {
    const result = runElection(state);
    state._transient = state._transient || {};
    state._transient.lastElection = result;
    return { election: result };
  }
  return {};
}
