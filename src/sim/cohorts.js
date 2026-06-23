// sim/cohorts.js — the living population model. Each cohort's happiness and
// trust drift toward what national conditions justify; cohorts age and, over
// long timescales, generational replacement shifts the ideological centre.

import { clamp } from '../engine.js';
import { approval } from './economy.js';

export function updateCohorts(state) {
  const m = state.metrics;
  const appr = approval(state);
  for (const c of state.cohorts) {
    // happiness reflects national metrics weighted by cohort priorities:
    // younger care more about housing/environment, older about health/safety.
    const young = c.ageMax <= 44;
    const wHousing = young ? 0.22 : 0.10;
    const wHealth = young ? 0.10 : 0.22;
    const wEnv = young ? 0.14 : 0.06;
    const target = clamp(
      m.happiness * 0.30 +
      m.housing * wHousing +
      m.health * wHealth +
      m.environment * wEnv +
      m.economy * 0.18 +
      m.safety * 0.10
    );
    c.happiness = clamp(c.happiness + (target - c.happiness) * 0.1);
    c.trust = clamp(c.trust + (appr - c.trust) * 0.08);
  }

  // Generational replacement once a year: nudge the youngest cohort's ideology
  // toward whatever values are ascendant, so the electorate slowly evolves.
  if (state.tick % 12 === 0) {
    for (const c of state.cohorts) {
      if (c.ageMax <= 29) {
        // new young voters trend progressive when environment/education are strong
        const prog = (m.environment + m.education) / 200 - 0.5; // -.5..+.5
        c.soc = clamp(c.soc - prog * 0.04, -1, 1);
      }
    }
  }
}

// Aggregate national happiness/trust for display.
export function nationalMood(state) {
  let hw = 0, tw = 0, w = 0;
  for (const c of state.cohorts) { hw += c.happiness * c.weight; tw += c.trust * c.weight; w += c.weight; }
  return { happiness: hw / w, trust: tw / w };
}
